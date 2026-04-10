import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import type { ComfyUIWorkflow } from '../comfyui/types.js';

export type Mode = 'txt2img' | 'img2img' | 'post-process';

export interface GenerateOptions {
  prompt?: string;
  negative_prompt?: string;
  input_image?: string;       // uploaded filename
  denoise_strength?: number;
  width?: number;
  height?: number;
  remove_background?: boolean;
}

export interface PreparedWorkflow {
  workflow: ComfyUIWorkflow;
  mode: Mode;
}

/**
 * Calculate aspect-ratio-aware generation dimensions targeting ~1M total pixels.
 */
export function calculateGenerationDimensions(
  targetWidth: number,
  targetHeight: number,
  nativeRes: number = 1024
): { genWidth: number; genHeight: number } {
  const ratio = targetWidth / targetHeight;
  let genHeight = Math.sqrt((nativeRes * nativeRes) / ratio);
  let genWidth = ratio * genHeight;

  // Round to nearest multiple of 64
  genWidth = Math.round(genWidth / 64) * 64;
  genHeight = Math.round(genHeight / 64) * 64;

  // Clamp to 512-2048
  genWidth = Math.max(512, Math.min(2048, genWidth));
  genHeight = Math.max(512, Math.min(2048, genHeight));

  return { genWidth, genHeight };
}

export class WorkflowLoader {
  private workspaceDir: string;
  private defaultWorkflow: string;
  private randomizeSeeds: boolean;
  private workflowCache: Map<string, ComfyUIWorkflow> = new Map();

  constructor(
    workspaceDir: string,
    defaultWorkflow: string = 'workflow.json',
    randomizeSeeds: boolean = true
  ) {
    this.workspaceDir = workspaceDir;
    this.defaultWorkflow = defaultWorkflow;
    this.randomizeSeeds = randomizeSeeds;
  }

  /**
   * List all available workflow files in the workspace directory
   */
  async listWorkflows(): Promise<string[]> {
    try {
      const files = await readdir(this.workspaceDir);
      return files.filter(file => file.endsWith('.json'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Workflow workspace directory not found: ${this.workspaceDir}`);
      }
      throw new Error(`Failed to list workflows: ${(error as Error).message}`);
    }
  }

  /**
   * Load workflow from file by name (cached after first load)
   */
  async loadWorkflow(workflowName?: string): Promise<ComfyUIWorkflow> {
    const name = workflowName || this.defaultWorkflow;

    if (this.workflowCache.has(name)) {
      return this.workflowCache.get(name)!;
    }

    try {
      const workflowPath = join(this.workspaceDir, name);
      const fileContent = await readFile(workflowPath, 'utf-8');
      const workflow = JSON.parse(fileContent) as ComfyUIWorkflow;

      this.validateWorkflow(workflow);

      this.workflowCache.set(name, workflow);
      return workflow;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Workflow file not found: ${name} in ${this.workspaceDir}`);
      }
      throw new Error(`Failed to load workflow ${name}: ${(error as Error).message}`);
    }
  }

  /**
   * Prepare workflow for execution by detecting mode, removing unused nodes,
   * rewiring connections, and injecting parameters.
   */
  prepareWorkflow(workflow: ComfyUIWorkflow, options: GenerateOptions): PreparedWorkflow {
    // Deep clone to avoid mutating the cached workflow
    const w = JSON.parse(JSON.stringify(workflow)) as ComfyUIWorkflow;

    // Detect mode
    const hasPrompt = !!options.prompt;
    const hasImage = !!options.input_image;
    let mode: Mode;
    if (hasPrompt && !hasImage) mode = 'txt2img';
    else if (hasPrompt && hasImage) mode = 'img2img';
    else mode = 'post-process';

    // Find all relevant nodes
    const ksamplerId = this.findNodeByType(w, 'KSampler');
    const emptyLatentId = this.findNodeByType(w, 'EmptySD3LatentImage')
      || this.findNodeByType(w, 'EmptyLatentImage');
    const loadImageId = this.findNodeByType(w, 'LoadImage');
    const vaeEncodeId = this.findNodeByType(w, 'VAEEncode');
    const vaeDecodeId = this.findNodeByType(w, 'VAEDecode');
    const rmbgId = this.findNodeByType(w, 'RMBG');
    const imageScaleId = this.findNodeByType(w, 'ImageScale');
    const saveImageId = this.findNodeByType(w, 'SaveImage');
    const unetLoaderId = this.findNodeByType(w, 'UNETLoader');
    const clipLoaderId = this.findNodeByType(w, 'CLIPLoader');
    const vaeLoaderId = this.findNodeByType(w, 'VAELoader');
    const modelSamplingId = this.findNodeByType(w, 'ModelSamplingAuraFlow');

    // Step 1: Configure input mode
    if (mode === 'txt2img') {
      // Remove img2img-only nodes
      this.removeNode(w, loadImageId);
      this.removeNode(w, vaeEncodeId);

      // Set generation dimensions on the latent node
      if (emptyLatentId) {
        if (options.width && options.height) {
          const { genWidth, genHeight } = calculateGenerationDimensions(options.width, options.height);
          w[emptyLatentId].inputs.width = genWidth;
          w[emptyLatentId].inputs.height = genHeight;
        }
        // else: keep default 1024x1024
      }

      // Inject prompts via KSampler connection tracing
      this.injectPrompts(w, ksamplerId, options.prompt!, options.negative_prompt);

    } else if (mode === 'img2img') {
      // Remove txt2img latent node
      this.removeNode(w, emptyLatentId);

      // Rewire KSampler.latent_image → VAEEncode
      if (ksamplerId && vaeEncodeId) {
        w[ksamplerId].inputs.latent_image = [vaeEncodeId, 0];
      }

      // Set LoadImage filename
      if (loadImageId) {
        w[loadImageId].inputs.image = options.input_image!;
      }

      // Set denoise strength (default 0.75 for img2img)
      if (ksamplerId) {
        w[ksamplerId].inputs.denoise = options.denoise_strength ?? 0.75;
      }

      // Inject prompts
      this.injectPrompts(w, ksamplerId, options.prompt!, options.negative_prompt);

    } else {
      // post-process: Remove entire generation pipeline
      // Get CLIP node IDs from KSampler connections before removing it
      let clipPosId: string | null = null;
      let clipNegId: string | null = null;
      if (ksamplerId && w[ksamplerId]) {
        const posConn = w[ksamplerId].inputs.positive;
        if (Array.isArray(posConn)) clipPosId = String(posConn[0]);
        const negConn = w[ksamplerId].inputs.negative;
        if (Array.isArray(negConn)) clipNegId = String(negConn[0]);
      }

      const genNodeIds = [
        ksamplerId, emptyLatentId, vaeEncodeId, vaeDecodeId,
        clipPosId, clipNegId, unetLoaderId, clipLoaderId,
        vaeLoaderId, modelSamplingId,
      ];
      for (const id of genNodeIds) {
        this.removeNode(w, id);
      }

      // Set LoadImage filename
      if (loadImageId) {
        w[loadImageId].inputs.image = options.input_image!;
      }
    }

    // Step 2: Build post-processing chain
    let lastNodeId: string;
    const lastNodeOutput = 0;

    if (mode === 'post-process') {
      if (!loadImageId || !w[loadImageId]) {
        throw new Error('LoadImage node required for post-process mode');
      }
      lastNodeId = loadImageId;
    } else {
      if (!vaeDecodeId || !w[vaeDecodeId]) {
        throw new Error('VAEDecode node required for generation modes');
      }
      lastNodeId = vaeDecodeId;
    }

    // RMBG (background removal)
    if (options.remove_background) {
      if (rmbgId && w[rmbgId]) {
        w[rmbgId].inputs.image = [lastNodeId, lastNodeOutput];
        lastNodeId = rmbgId;
      }
    } else {
      this.removeNode(w, rmbgId);
    }

    // ImageScale (resize)
    if (options.width !== undefined && options.height !== undefined) {
      if (imageScaleId && w[imageScaleId]) {
        w[imageScaleId].inputs.image = [lastNodeId, lastNodeOutput];
        w[imageScaleId].inputs.width = options.width;
        w[imageScaleId].inputs.height = options.height;
        lastNodeId = imageScaleId;
      }
    } else {
      this.removeNode(w, imageScaleId);
    }

    // Wire SaveImage to end of chain
    if (saveImageId && w[saveImageId]) {
      w[saveImageId].inputs.images = [lastNodeId, lastNodeOutput];
    }

    // Randomize seeds
    if (this.randomizeSeeds) {
      this.randomizeAllSeeds(w);
    }

    // Validate no dangling references
    this.validateNoDanglingRefs(w);

    return { workflow: w, mode };
  }

  /**
   * Find first node of a specific type
   */
  private findNodeByType(workflow: ComfyUIWorkflow, classType: string): string | null {
    for (const [nodeId, node] of Object.entries(workflow)) {
      if (node.class_type === classType) {
        return nodeId;
      }
    }
    return null;
  }

  /**
   * Remove a node from the workflow
   */
  private removeNode(workflow: ComfyUIWorkflow, nodeId: string | null): void {
    if (nodeId && workflow[nodeId]) {
      delete workflow[nodeId];
    }
  }

  /**
   * Inject prompts by tracing KSampler connections to CLIPTextEncode nodes
   */
  private injectPrompts(
    workflow: ComfyUIWorkflow,
    ksamplerId: string | null,
    prompt: string,
    negativePrompt?: string
  ): void {
    if (!ksamplerId || !workflow[ksamplerId]) return;

    const sampler = workflow[ksamplerId];

    // Positive prompt
    const posConn = sampler.inputs.positive;
    if (Array.isArray(posConn)) {
      const posNodeId = String(posConn[0]);
      if (workflow[posNodeId]?.class_type === 'CLIPTextEncode') {
        workflow[posNodeId].inputs.text = prompt;
      }
    }

    // Negative prompt
    if (negativePrompt) {
      const negConn = sampler.inputs.negative;
      if (Array.isArray(negConn)) {
        const negNodeId = String(negConn[0]);
        if (workflow[negNodeId]?.class_type === 'CLIPTextEncode') {
          workflow[negNodeId].inputs.text = negativePrompt;
        }
      }
    }
  }

  /**
   * Validate that no remaining node references a removed node
   */
  private validateNoDanglingRefs(workflow: ComfyUIWorkflow): void {
    const nodeIds = new Set(Object.keys(workflow));
    for (const [nodeId, node] of Object.entries(workflow)) {
      for (const [inputName, inputValue] of Object.entries(node.inputs)) {
        if (Array.isArray(inputValue) && inputValue.length >= 2) {
          const refId = String(inputValue[0]);
          if (!nodeIds.has(refId)) {
            throw new Error(
              `Dangling reference: node ${nodeId} (${node.class_type}) input "${inputName}" references removed node ${refId}`
            );
          }
        }
      }
    }
  }

  /**
   * Validate workflow structure
   */
  private validateWorkflow(workflow: ComfyUIWorkflow): void {
    if (!workflow || typeof workflow !== 'object') {
      throw new Error('Workflow must be an object');
    }

    const nodeCount = Object.keys(workflow).length;
    if (nodeCount === 0) {
      throw new Error('Workflow must contain at least one node');
    }

    for (const [nodeId, node] of Object.entries(workflow)) {
      if (!node.class_type) {
        throw new Error(`Node ${nodeId} missing class_type`);
      }
      if (!node.inputs || typeof node.inputs !== 'object') {
        throw new Error(`Node ${nodeId} missing inputs`);
      }
    }
  }

  /**
   * Get the workspace directory
   */
  getWorkspaceDir(): string {
    return this.workspaceDir;
  }

  /**
   * Get the default workflow name
   */
  getDefaultWorkflow(): string {
    return this.defaultWorkflow;
  }

  /**
   * Clear workflow cache
   */
  clearCache(workflowName?: string): void {
    if (workflowName) {
      this.workflowCache.delete(workflowName);
    } else {
      this.workflowCache.clear();
    }
  }

  /**
   * Randomize all seed values in the workflow
   */
  private randomizeAllSeeds(workflow: ComfyUIWorkflow): void {
    for (const [nodeId, node] of Object.entries(workflow)) {
      if (node.inputs && 'seed' in node.inputs) {
        const randomSeed = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
        workflow[nodeId].inputs.seed = randomSeed;
      }
    }
  }
}
