import { randomBytes } from 'crypto';
import type { ComfyUIClient } from '../comfyui/client.js';
import type { WorkflowLoader } from '../workflows/workflow-loader.js';
import { GenerateImageInputSchema, sanitizePrompt } from '../utils/validation.js';
import type { RequestHistoryEntry } from './get-request-history.js';

export interface GenerateImageOutput {
  prompt_id: string;
  number: number;
  status: string;
}

export async function generateImage(
  input: unknown,
  client: ComfyUIClient,
  workflowLoader: WorkflowLoader,
  requestHistory: RequestHistoryEntry[],
): Promise<GenerateImageOutput> {
  // Validate input
  const validatedInput = GenerateImageInputSchema.parse(input);

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
    width: validatedInput.width,
    height: validatedInput.height,
    workflow_name: workflowName || workflowLoader.getDefaultWorkflow(),
    timestamp: new Date().toISOString(),
    status: 'queued',
    queue_position: response.number,
  });

  return {
    prompt_id: response.prompt_id,
    number: response.number,
    status: 'queued',
  };
}
