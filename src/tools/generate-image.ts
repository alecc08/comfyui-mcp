import { randomBytes } from 'crypto';
import type { ComfyUIClient } from '../comfyui/client.js';
import type { WorkflowLoader } from '../workflows/workflow-loader.js';
import type { Mode } from '../workflows/workflow-loader.js';
import { GenerateImageInputSchema, sanitizePrompt, isAbsolutePath } from '../utils/validation.js';
import { type RequestHistoryEntry, recordHistoryEntry } from '../utils/history.js';

export interface GenerateImageOutput {
  prompt_id: string;
  number: number;
  status: string;
  mode: Mode;
}

export async function generateImage(
  input: unknown,
  client: ComfyUIClient,
  workflowLoader: WorkflowLoader,
  requestHistory: RequestHistoryEntry[],
): Promise<GenerateImageOutput> {
  // Validate input
  const validatedInput = GenerateImageInputSchema.parse(input);

  // Must have at least prompt or image_path
  if (!validatedInput.prompt && !validatedInput.image_path) {
    throw new Error('Must provide at least prompt or image_path');
  }

  // Sanitize prompts
  const sanitizedPrompt = validatedInput.prompt
    ? sanitizePrompt(validatedInput.prompt)
    : undefined;
  const sanitizedNegativePrompt = validatedInput.negative_prompt
    ? sanitizePrompt(validatedInput.negative_prompt)
    : undefined;

  // Upload image if provided
  let uploadedFilename: string | undefined;
  if (validatedInput.image_path) {
    if (!isAbsolutePath(validatedInput.image_path)) {
      throw new Error(`Image path must be absolute. Received: ${validatedInput.image_path}`);
    }
    console.error(`Uploading image from: ${validatedInput.image_path}`);
    const uploadResult = await client.uploadImage(validatedInput.image_path);
    console.error(`Image uploaded successfully: ${uploadResult.name}`);
    uploadedFilename = uploadResult.name;
  }

  // Load workflow
  const baseWorkflow = await workflowLoader.loadWorkflow();

  // Prepare workflow (mode detection, node removal/rewiring, parameter injection)
  const { workflow: modifiedWorkflow, mode } = workflowLoader.prepareWorkflow(baseWorkflow, {
    prompt: sanitizedPrompt,
    negative_prompt: sanitizedNegativePrompt,
    input_image: uploadedFilename,
    denoise_strength: validatedInput.denoise_strength,
    width: validatedInput.width,
    height: validatedInput.height,
    remove_background: validatedInput.remove_background,
  });

  // Generate unique client ID
  const clientId = randomBytes(16).toString('hex');

  // Queue the prompt
  const response = await client.queuePrompt(modifiedWorkflow, clientId);

  // Record history
  recordHistoryEntry(requestHistory, {
    prompt_id: response.prompt_id,
    prompt: sanitizedPrompt,
    negative_prompt: sanitizedNegativePrompt,
    width: validatedInput.width,
    height: validatedInput.height,
    mode,
    remove_background: validatedInput.remove_background,
    denoise_strength: validatedInput.denoise_strength,
    workflow_name: workflowLoader.getDefaultWorkflow(),
    queue_position: response.number,
    image_path: validatedInput.image_path,
  });

  return {
    prompt_id: response.prompt_id,
    number: response.number,
    status: 'queued',
    mode,
  };
}
