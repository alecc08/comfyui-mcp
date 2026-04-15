import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import type { ComfyUIWorkflow } from '../comfyui/types.js';

export type Mode = 'txt2img' | 'img2img' | 'post-process';

export interface LoraOption {
  name: string;
  strength_model: number;
  strength_clip?: number;
}

export interface GenerateOptions {
  prompt?: string;
  negative_prompt?: string;
  input_image?: string;       // uploaded filename
  width?: number;
  height?: number;
  remove_background?: boolean;
  loras?: LoraOption[];
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
  private editWorkflow: string;
  private randomizeSeeds: boolean;
  private workflowCache: Map<string, ComfyUIWorkflow> = new Map();

  constructor(
    workspaceDir: string,
    defaultWorkflow: string = 'workflow.json',
    editWorkflow: string = 'workflow_edit.json',
    randomizeSeeds: boolean = true
  ) {
    this.workspaceDir = workspaceDir;
    this.defaultWorkflow = defaultWorkflow;
    this.editWorkflow = editWorkflow;
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
   * Detect mode from generation options.
   */
  detectMode(options: GenerateOptions): Mode {
    const hasPrompt = !!options.prompt;
    const hasImage = !!options.input_image;
    if (hasPrompt && !hasImage) return 'txt2img';
    if (hasPrompt && hasImage) return 'img2img';
    return 'post-process';
  }

  /**
   * Load the appropriate workflow file for a given mode.
   */
  async loadWorkflowForMode(mode: Mode): Promise<ComfyUIWorkflow> {
    const name = mode === 'img2img' ? this.editWorkflow : this.defaultWorkflow;
    return this.loadWorkflow(name);
  }

  /**
   * Prepare workflow for execution by removing unused nodes, rewiring
   * connections, and injecting parameters.
   */
  prepareWorkflow(workflow: ComfyUIWorkflow, options: GenerateOptions): PreparedWorkflow {
    const w = JSON.parse(JSON.stringify(workflow)) as ComfyUIWorkflow;
    const mode = this.detectMode(options);

    if (mode === 'img2img') {
      this.prepareEditWorkflow(w, options);
    } else {
      this.prepareDefaultWorkflow(w, options, mode);
    }

    this.applyLoras(w, options);

    if (this.randomizeSeeds) {
      this.randomizeAllSeeds(w);
    }

    this.validateNoDanglingRefs(w);

    return { workflow: w, mode };
  }

  /**
   * Handle txt2img and post-process using the default workflow.
   */
  private prepareDefaultWorkflow(w: ComfyUIWorkflow, options: GenerateOptions, mode: Mode): void {
    const ksamplerId = this.findNodeByType(w, 'KSampler');
    const emptyLatentId = this.findNodeByType(w, 'EmptyFlux2LatentImage')
      || this.findNodeByType(w, 'EmptySD3LatentImage')
      || this.findNodeByType(w, 'EmptyLatentImage');
    const loadImageId = this.findNodeByType(w, 'LoadImage');
    const vaeEncodeId = this.findNodeByType(w, 'VAEEncode');
    const vaeDecodeId = this.findNodeByType(w, 'VAEDecode');
    const unetLoaderId = this.findNodeByType(w, 'UNETLoader');
    const clipLoaderId = this.findNodeByType(w, 'CLIPLoader');
    const vaeLoaderId = this.findNodeByType(w, 'VAELoader');
    const modelSamplingId = this.findNodeByType(w, 'ModelSamplingAuraFlow');

    if (mode === 'txt2img') {
      this.removeNode(w, loadImageId);
      this.removeNode(w, vaeEncodeId);

      if (emptyLatentId && options.width && options.height) {
        const { genWidth, genHeight } = calculateGenerationDimensions(options.width, options.height);
        w[emptyLatentId].inputs.width = genWidth;
        w[emptyLatentId].inputs.height = genHeight;
      }

      this.injectPromptsAtCLIPTargets(w, this.findCLIPTargetsFromKSampler(w, ksamplerId), options);
    } else {
      // post-process: strip entire generation pipeline
      const { clipPosId, clipNegId } = this.findCLIPTargetsFromKSampler(w, ksamplerId);

      const genNodeIds = [
        ksamplerId, emptyLatentId, vaeEncodeId, vaeDecodeId,
        clipPosId, clipNegId, unetLoaderId, clipLoaderId,
        vaeLoaderId, modelSamplingId,
      ];
      for (const id of genNodeIds) {
        this.removeNode(w, id);
      }

      if (loadImageId) {
        w[loadImageId].inputs.image = options.input_image!;
      }
    }

    const chainStartId = mode === 'post-process' ? loadImageId : vaeDecodeId;
    const chainStartLabel = mode === 'post-process' ? 'LoadImage' : 'VAEDecode';
    this.buildPostProcessingChain(w, chainStartId, chainStartLabel, options);
  }

  /**
   * Handle img2img using the Flux 2 Klein edit workflow (ReferenceLatent +
   * CFGGuider + SamplerCustomAdvanced pattern). The reference image is
   * pre-scaled by ImageScaleToTotalPixels + GetImageSize, so per-mode
   * dimension math is not needed — the sampler generates at whatever size
   * the reference lands at after scaling.
   */
  private prepareEditWorkflow(w: ComfyUIWorkflow, options: GenerateOptions): void {
    const loadImageId = this.findNodeByType(w, 'LoadImage');
    const vaeDecodeId = this.findNodeByType(w, 'VAEDecode');
    const cfgGuiderId = this.findNodeByType(w, 'CFGGuider');

    if (!loadImageId) {
      throw new Error('Edit workflow missing LoadImage node');
    }
    if (!cfgGuiderId) {
      throw new Error('Edit workflow missing CFGGuider node');
    }

    w[loadImageId].inputs.image = options.input_image!;

    this.injectPromptsAtCLIPTargets(w, this.findCLIPTargetsFromCFGGuider(w, cfgGuiderId), options);

    this.buildPostProcessingChain(w, vaeDecodeId, 'VAEDecode', options);
  }

  /**
   * Build the shared RMBG → ImageScale → SaveImage chain starting from a
   * given upstream node. Mode-agnostic — used by both the default and edit
   * workflows.
   */
  private buildPostProcessingChain(
    w: ComfyUIWorkflow,
    startNodeId: string | null,
    startNodeLabel: string,
    options: GenerateOptions,
  ): void {
    const rmbgId = this.findNodeByType(w, 'RMBG');
    const imageScaleId = this.findNodeByType(w, 'ImageScale');
    const saveImageId = this.findNodeByType(w, 'SaveImage');

    if (!startNodeId || !w[startNodeId]) {
      throw new Error(`${startNodeLabel} node required as post-processing chain start`);
    }

    let lastNodeId: string = startNodeId;
    const lastNodeOutput = 0;

    if (options.remove_background) {
      if (rmbgId && w[rmbgId]) {
        w[rmbgId].inputs.image = [lastNodeId, lastNodeOutput];
        lastNodeId = rmbgId;
      }
    } else {
      this.removeNode(w, rmbgId);
    }

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

    if (saveImageId && w[saveImageId]) {
      w[saveImageId].inputs.images = [lastNodeId, lastNodeOutput];
    }
  }

  /**
   * Inject a chain of LoraLoader nodes between the UNETLoader/CLIPLoader and
   * their downstream consumers (KSampler/CFGGuider model inputs,
   * CLIPTextEncode clip inputs). Skipped for post-process mode where both
   * loaders have been stripped.
   */
  private applyLoras(w: ComfyUIWorkflow, options: GenerateOptions): void {
    if (!options.loras || options.loras.length === 0) return;

    const unetLoaderId = this.findNodeByType(w, 'UNETLoader');
    const clipLoaderId = this.findNodeByType(w, 'CLIPLoader');
    if (!unetLoaderId || !clipLoaderId) {
      // post-process mode — no generation pipeline to inject into.
      return;
    }

    const modelConsumers = this.findConsumers(w, unetLoaderId);
    const clipConsumers = this.findConsumers(w, clipLoaderId);

    const existingIds = Object.keys(w).map((id) => parseInt(id, 10)).filter((n) => !isNaN(n));
    let nextId = (existingIds.length ? Math.max(...existingIds) : 0) + 1;

    let prevModelRef: [string, number] = [unetLoaderId, 0];
    let prevClipRef: [string, number] = [clipLoaderId, 0];

    for (const lora of options.loras) {
      const id = String(nextId++);
      const strengthModel = lora.strength_model;
      const strengthClip = lora.strength_clip ?? lora.strength_model;
      w[id] = {
        class_type: 'LoraLoader',
        inputs: {
          lora_name: lora.name,
          strength_model: strengthModel,
          strength_clip: strengthClip,
          model: prevModelRef,
          clip: prevClipRef,
        },
      };
      prevModelRef = [id, 0];
      prevClipRef = [id, 1];
    }

    for (const { nodeId, inputName } of modelConsumers) {
      w[nodeId].inputs[inputName] = prevModelRef;
    }
    for (const { nodeId, inputName } of clipConsumers) {
      w[nodeId].inputs[inputName] = prevClipRef;
    }
  }

  /**
   * Find all (nodeId, inputName) pairs whose input is `[loaderId, 0]`.
   */
  private findConsumers(
    w: ComfyUIWorkflow,
    loaderId: string,
  ): Array<{ nodeId: string; inputName: string }> {
    const consumers: Array<{ nodeId: string; inputName: string }> = [];
    for (const [nodeId, node] of Object.entries(w)) {
      if (nodeId === loaderId || !node.inputs) continue;
      for (const [inputName, inputValue] of Object.entries(node.inputs)) {
        if (Array.isArray(inputValue) && inputValue.length >= 2
            && String(inputValue[0]) === loaderId && Number(inputValue[1]) === 0) {
          consumers.push({ nodeId, inputName });
        }
      }
    }
    return consumers;
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
   * Walk a node's positive/negative inputs back to the underlying
   * CLIPTextEncode nodes. Follows one level of indirection (e.g.
   * ReferenceLatent) so both the plain KSampler path and the
   * ReferenceLatent → CFGGuider path of the edit workflow resolve.
   */
  private findCLIPTargetsFromKSampler(
    workflow: ComfyUIWorkflow,
    ksamplerId: string | null,
  ): { clipPosId: string | null; clipNegId: string | null } {
    if (!ksamplerId || !workflow[ksamplerId]) {
      return { clipPosId: null, clipNegId: null };
    }
    return {
      clipPosId: this.resolveCLIPTextEncode(workflow, workflow[ksamplerId].inputs.positive),
      clipNegId: this.resolveCLIPTextEncode(workflow, workflow[ksamplerId].inputs.negative),
    };
  }

  private findCLIPTargetsFromCFGGuider(
    workflow: ComfyUIWorkflow,
    cfgGuiderId: string,
  ): { clipPosId: string | null; clipNegId: string | null } {
    const guider = workflow[cfgGuiderId];
    return {
      clipPosId: this.resolveCLIPTextEncode(workflow, guider.inputs.positive),
      clipNegId: this.resolveCLIPTextEncode(workflow, guider.inputs.negative),
    };
  }

  /**
   * Follow a conditioning input back to a CLIPTextEncode node. Handles one
   * level of indirection through ReferenceLatent (conditioning input).
   */
  private resolveCLIPTextEncode(
    workflow: ComfyUIWorkflow,
    connection: unknown,
  ): string | null {
    if (!Array.isArray(connection) || connection.length < 2) return null;
    const nodeId = String(connection[0]);
    const node = workflow[nodeId];
    if (!node) return null;

    if (node.class_type === 'CLIPTextEncode') {
      return nodeId;
    }
    if (node.class_type === 'ReferenceLatent') {
      return this.resolveCLIPTextEncode(workflow, node.inputs.conditioning);
    }
    return null;
  }

  private injectPromptsAtCLIPTargets(
    workflow: ComfyUIWorkflow,
    targets: { clipPosId: string | null; clipNegId: string | null },
    options: GenerateOptions,
  ): void {
    if (targets.clipPosId && workflow[targets.clipPosId] && options.prompt) {
      workflow[targets.clipPosId].inputs.text = options.prompt;
    }
    if (targets.clipNegId && workflow[targets.clipNegId] && options.negative_prompt) {
      workflow[targets.clipNegId].inputs.text = options.negative_prompt;
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
   * Get the workflow filename that will be used for a given mode.
   */
  getWorkflowNameForMode(mode: Mode): string {
    return mode === 'img2img' ? this.editWorkflow : this.defaultWorkflow;
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
   * Randomize all seed values in the workflow. Covers both the `seed` input
   * on KSampler-style nodes and the `noise_seed` input on RandomNoise.
   */
  private randomizeAllSeeds(workflow: ComfyUIWorkflow): void {
    for (const [nodeId, node] of Object.entries(workflow)) {
      if (!node.inputs) continue;
      if ('seed' in node.inputs) {
        workflow[nodeId].inputs.seed = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
      }
      if ('noise_seed' in node.inputs) {
        workflow[nodeId].inputs.noise_seed = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
      }
    }
  }
}
