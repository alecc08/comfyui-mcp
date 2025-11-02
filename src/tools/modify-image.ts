import { randomBytes } from 'crypto';
import type { ComfyUIClient } from '../comfyui/client.js';
import type { WorkflowLoader } from '../workflows/workflow-loader.js';
import { ModifyImageInputSchema, sanitizePrompt, isAbsolutePath } from '../utils/validation.js';
import type { RequestHistoryEntry } from './get-request-history.js';

export interface ModifyImageOutput {
  prompt_id: string;
  number: number;
  status: string;
}

export async function modifyImage(
  input: unknown,
  client: ComfyUIClient,
  workflowLoader: WorkflowLoader,
  requestHistory: RequestHistoryEntry[],
): Promise<ModifyImageOutput> {
  // Validate input
  const validatedInput = ModifyImageInputSchema.parse(input);

  // Validate that image_path is absolute
  if (!isAbsolutePath(validatedInput.image_path)) {
    throw new Error(`Image path must be absolute. Received: ${validatedInput.image_path}`);
  }

  // Upload image to ComfyUI
  console.error(`Uploading image from: ${validatedInput.image_path}`);
  const uploadResult = await client.uploadImage(validatedInput.image_path);
  console.error(`Image uploaded successfully: ${uploadResult.name}`);

  // Sanitize prompts
  const sanitizedPrompt = sanitizePrompt(validatedInput.prompt);
  const sanitizedNegativePrompt = validatedInput.negative_prompt
    ? sanitizePrompt(validatedInput.negative_prompt)
    : undefined;

  // Determine workflow name
  const workflowName = validatedInput.workflow_name;

  // Load workflow (uses cache if available)
  const baseWorkflow = await workflowLoader.loadWorkflow(workflowName);

  // Inject parameters
  const modifiedWorkflow = workflowLoader.injectParameters(baseWorkflow, {
    prompt: sanitizedPrompt,
    negative_prompt: sanitizedNegativePrompt,
    width: validatedInput.width,
    height: validatedInput.height,
    input_image: uploadResult.name,
    denoise_strength: validatedInput.denoise_strength,
  });

  // Generate unique client ID
  const clientId = randomBytes(16).toString('hex');

  // Queue the prompt
  const response = await client.queuePrompt(modifiedWorkflow, clientId);

  // Add to request history
  requestHistory.push({
    prompt_id: response.prompt_id,
    prompt: sanitizedPrompt,
    negative_prompt: sanitizedNegativePrompt,
    width: validatedInput.width || 0,
    height: validatedInput.height || 0,
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
