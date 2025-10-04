import { readFile } from 'fs/promises';
import type { ComfyUIWorkflow, WorkflowNode } from '../comfyui/types.js';

export interface WorkflowParameters {
  prompt?: string;
  negative_prompt?: string;
  width?: number;
  height?: number;
}

export class WorkflowLoader {
  private workflowPath: string;
  private cachedWorkflow: ComfyUIWorkflow | null = null;

  constructor(workflowPath: string) {
    this.workflowPath = workflowPath;
  }

  /**
   * Load workflow from file (cached after first load)
   */
  async loadWorkflow(): Promise<ComfyUIWorkflow> {
    if (this.cachedWorkflow) {
      return this.cachedWorkflow;
    }

    try {
      const fileContent = await readFile(this.workflowPath, 'utf-8');
      const workflow = JSON.parse(fileContent) as ComfyUIWorkflow;

      // Validate basic structure
      this.validateWorkflow(workflow);

      this.cachedWorkflow = workflow;
      return workflow;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Workflow file not found: ${this.workflowPath}`);
      }
      throw new Error(`Failed to load workflow: ${(error as Error).message}`);
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
    const modifiedWorkflow = JSON.parse(JSON.stringify(workflow)) as ComfyUIWorkflow;

    // Find KSampler node to intelligently locate positive/negative prompt nodes
    const samplerNodeId = this.findNodeByType(modifiedWorkflow, 'KSampler');

    if (samplerNodeId) {
      const samplerNode = modifiedWorkflow[samplerNodeId];

      // Inject positive prompt by following the "positive" connection
      if (params.prompt !== undefined && samplerNode.inputs.positive) {
        const positiveConnection = samplerNode.inputs.positive;
        if (Array.isArray(positiveConnection) && positiveConnection.length > 0) {
          const positiveNodeId = String(positiveConnection[0]);
          if (modifiedWorkflow[positiveNodeId]?.class_type === 'CLIPTextEncode') {
            modifiedWorkflow[positiveNodeId].inputs.text = params.prompt;
          }
        }
      }

      // Inject negative prompt by following the "negative" connection
      if (params.negative_prompt !== undefined && samplerNode.inputs.negative) {
        const negativeConnection = samplerNode.inputs.negative;
        if (Array.isArray(negativeConnection) && negativeConnection.length > 0) {
          const negativeNodeId = String(negativeConnection[0]);
          if (modifiedWorkflow[negativeNodeId]?.class_type === 'CLIPTextEncode') {
            modifiedWorkflow[negativeNodeId].inputs.text = params.negative_prompt;
          }
        }
      }
    } else {
      // Fallback: if no KSampler found, use the old method (find first CLIPTextEncode)
      if (params.prompt !== undefined) {
        const promptNodeId = this.findNodeByType(modifiedWorkflow, 'CLIPTextEncode');
        if (promptNodeId) {
          modifiedWorkflow[promptNodeId].inputs.text = params.prompt;
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
        if (params.width !== undefined) {
          modifiedWorkflow[latentNodeId].inputs.width = params.width;
        }
        if (params.height !== undefined) {
          modifiedWorkflow[latentNodeId].inputs.height = params.height;
        }
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
   * Get the current workflow path
   */
  getWorkflowPath(): string {
    return this.workflowPath;
  }

  /**
   * Update workflow path and clear cache
   */
  setWorkflowPath(path: string): void {
    this.workflowPath = path;
    this.cachedWorkflow = null;
  }
}
