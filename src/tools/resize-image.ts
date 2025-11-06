import { randomBytes } from 'crypto';
import type { ComfyUIClient } from '../comfyui/client.js';
import type { WorkflowLoader } from '../workflows/workflow-loader.js';
import { ResizeImageInputSchema, isAbsolutePath } from '../utils/validation.js';
import type { RequestHistoryEntry } from './get-request-history.js';

export interface ResizeImageOutput {
  prompt_id: string;
  number: number;
  status: string;
}

export async function resizeImage(
  input: unknown,
  client: ComfyUIClient,
  workflowLoader: WorkflowLoader,
  requestHistory: RequestHistoryEntry[],
): Promise<ResizeImageOutput> {
  // Validate input
  const validatedInput = ResizeImageInputSchema.parse(input);

  // Validate that image_path is absolute
  if (!isAbsolutePath(validatedInput.image_path)) {
    throw new Error(`Image path must be absolute. Received: ${validatedInput.image_path}`);
  }

  // Upload image to ComfyUI
  console.error(`Uploading image from: ${validatedInput.image_path}`);
  const uploadResult = await client.uploadImage(validatedInput.image_path);
  console.error(`Image uploaded successfully: ${uploadResult.name}`);

  // Determine workflow name based on method if not specified
  let workflowName = validatedInput.workflow_name;
  if (!workflowName) {
    workflowName = validatedInput.method === 'upscale'
      ? 'upscale_workflow.json'
      : 'resize_workflow.json';
  }

  // Load workflow (uses cache if available)
  const baseWorkflow = await workflowLoader.loadWorkflow(workflowName);

  // Inject parameters
  const modifiedWorkflow = workflowLoader.injectParameters(baseWorkflow, {
    input_image: uploadResult.name,
    scale_factor: validatedInput.scale_factor,
    width: validatedInput.target_width,
    height: validatedInput.target_height,
  });

  // Generate unique client ID
  const clientId = randomBytes(16).toString('hex');

  // Queue the prompt
  const response = await client.queuePrompt(modifiedWorkflow, clientId);

  // Add to request history
  requestHistory.push({
    prompt_id: response.prompt_id,
    prompt: `Resize (${validatedInput.method})`,
    width: validatedInput.target_width || 0,
    height: validatedInput.target_height || 0,
    workflow_name: workflowName || workflowLoader.getDefaultWorkflow(),
    timestamp: new Date().toISOString(),
    status: 'queued',
    queue_position: response.number,
    image_path: validatedInput.image_path,
  });

  return {
    prompt_id: response.prompt_id,
    number: response.number,
    status: 'queued',
  };
}
