import { randomBytes } from 'crypto';
import type { ComfyUIClient } from '../comfyui/client.js';
import type { WorkflowLoader } from '../workflows/workflow-loader.js';
import { RemoveBackgroundInputSchema, isAbsolutePath } from '../utils/validation.js';
import type { RequestHistoryEntry } from './get-request-history.js';

export interface RemoveBackgroundOutput {
  prompt_id: string;
  number: number;
  status: string;
}

export async function removeBackground(
  input: unknown,
  client: ComfyUIClient,
  workflowLoader: WorkflowLoader,
  requestHistory: RequestHistoryEntry[],
): Promise<RemoveBackgroundOutput> {
  // Validate input
  const validatedInput = RemoveBackgroundInputSchema.parse(input);

  // Validate that image_path is absolute
  if (!isAbsolutePath(validatedInput.image_path)) {
    throw new Error(`Image path must be absolute. Received: ${validatedInput.image_path}`);
  }

  // Upload image to ComfyUI
  console.error(`Uploading image from: ${validatedInput.image_path}`);
  const uploadResult = await client.uploadImage(validatedInput.image_path);
  console.error(`Image uploaded successfully: ${uploadResult.name}`);

  // Determine workflow name
  const workflowName = validatedInput.workflow_name;

  // Load workflow (uses cache if available)
  const baseWorkflow = await workflowLoader.loadWorkflow(workflowName);

  // Inject parameters (only input image needed for background removal)
  const modifiedWorkflow = workflowLoader.injectParameters(baseWorkflow, {
    input_image: uploadResult.name,
  });

  // Generate unique client ID
  const clientId = randomBytes(16).toString('hex');

  // Queue the prompt
  const response = await client.queuePrompt(modifiedWorkflow, clientId);

  // Add to request history
  requestHistory.push({
    prompt_id: response.prompt_id,
    prompt: 'Remove background',
    width: 0,
    height: 0,
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
