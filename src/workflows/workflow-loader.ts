import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import type { ComfyUIWorkflow, WorkflowNode } from '../comfyui/types.js';

export interface WorkflowParameters {
  prompt?: string;
  negative_prompt?: string;
  width?: number;
  height?: number;
}

export class WorkflowLoader {
  private workspaceDir: string;
  private defaultWorkflow: string;
  private workflowCache: Map<string, ComfyUIWorkflow> = new Map();

  constructor(workspaceDir: string, defaultWorkflow: string = 'default_workflow.json') {
    this.workspaceDir = workspaceDir;
    this.defaultWorkflow = defaultWorkflow;
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

    // Check cache first
    if (this.workflowCache.has(name)) {
      return this.workflowCache.get(name)!;
    }

    try {
      const workflowPath = join(this.workspaceDir, name);
      const fileContent = await readFile(workflowPath, 'utf-8');
      const workflow = JSON.parse(fileContent) as ComfyUIWorkflow;

      // Validate basic structure
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
   * Inject parameters into workflow
   *
   * This method intelligently finds the appropriate nodes to inject parameters:
   * - For prompts: Finds the KSampler node, then traces its "positive" and "negative"
   *   connections to find the CLIPTextEncode nodes
   * - For dimensions: Finds EmptyLatentImage or EmptySD3LatentImage nodes
   */
  injectParameters(workflow: ComfyUIWorkflow, params: WorkflowParameters): ComfyUIWorkflow {
    // Create a deep copy to avoid mutating the cached workflow
    let modifiedWorkflow: ComfyUIWorkflow;
    try {
      modifiedWorkflow = JSON.parse(JSON.stringify(workflow)) as ComfyUIWorkflow;
    } catch (error) {
      throw new Error(`Failed to clone workflow: ${(error as Error).message}`);
    }

    // Find KSampler node to intelligently locate positive/negative prompt nodes
    const samplerNodeId = this.findNodeByType(modifiedWorkflow, 'KSampler');

    if (samplerNodeId) {
      const samplerNode = modifiedWorkflow[samplerNodeId];

      // Inject positive prompt by following the "positive" connection
      if (params.prompt !== undefined && samplerNode.inputs.positive) {
        const positiveConnection = samplerNode.inputs.positive;
        if (Array.isArray(positiveConnection) && positiveConnection.length > 0) {
          const positiveNodeId = String(positiveConnection[0]);
          const positiveNode = modifiedWorkflow[positiveNodeId];
          if (!positiveNode) {
            throw new Error(`KSampler node ${samplerNodeId} references non-existent positive node ${positiveNodeId}`);
          }
          if (positiveNode.class_type === 'CLIPTextEncode') {
            modifiedWorkflow[positiveNodeId].inputs.text = params.prompt;
          } else {
            console.warn(`Positive connection from KSampler points to ${positiveNode.class_type} instead of CLIPTextEncode`);
          }
        }
      }

      // Inject negative prompt by following the "negative" connection
      if (params.negative_prompt !== undefined && samplerNode.inputs.negative) {
        const negativeConnection = samplerNode.inputs.negative;
        if (Array.isArray(negativeConnection) && negativeConnection.length > 0) {
          const negativeNodeId = String(negativeConnection[0]);
          const negativeNode = modifiedWorkflow[negativeNodeId];
          if (!negativeNode) {
            throw new Error(`KSampler node ${samplerNodeId} references non-existent negative node ${negativeNodeId}`);
          }
          if (negativeNode.class_type === 'CLIPTextEncode') {
            modifiedWorkflow[negativeNodeId].inputs.text = params.negative_prompt;
          } else {
            console.warn(`Negative connection from KSampler points to ${negativeNode.class_type} instead of CLIPTextEncode`);
          }
        }
      }
    } else {
      // Fallback: if no KSampler found, use the old method (find first CLIPTextEncode)
      if (params.prompt !== undefined) {
        const promptNodeId = this.findNodeByType(modifiedWorkflow, 'CLIPTextEncode');
        if (promptNodeId) {
          modifiedWorkflow[promptNodeId].inputs.text = params.prompt;
        } else {
          console.warn('No KSampler or CLIPTextEncode node found in workflow - prompt will not be injected');
        }
      }
    }

    // Inject width and height into latent image nodes
    // Support both EmptyLatentImage (SD1.5/SDXL) and EmptySD3LatentImage (SD3)
    if (params.width !== undefined || params.height !== undefined) {
      const latentNodeId =
        this.findNodeByType(modifiedWorkflow, 'EmptyLatentImage') ||
        this.findNodeByType(modifiedWorkflow, 'EmptySD3LatentImage');

      if (latentNodeId) {
        const latentNode = modifiedWorkflow[latentNodeId];
        if (params.width !== undefined) {
          if (typeof latentNode.inputs.width !== 'number') {
            console.warn(`Node ${latentNodeId} width is not a number: ${typeof latentNode.inputs.width}`);
          }
          modifiedWorkflow[latentNodeId].inputs.width = params.width;
        }
        if (params.height !== undefined) {
          if (typeof latentNode.inputs.height !== 'number') {
            console.warn(`Node ${latentNodeId} height is not a number: ${typeof latentNode.inputs.height}`);
          }
          modifiedWorkflow[latentNodeId].inputs.height = params.height;
        }
      } else {
        console.warn('No EmptyLatentImage or EmptySD3LatentImage node found in workflow - dimensions will not be injected');
      }
    }

    return modifiedWorkflow;
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

    // Validate each node has required fields
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
}
