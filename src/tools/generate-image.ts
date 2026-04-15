import { randomBytes } from 'crypto';
import type { ComfyUIClient } from '../comfyui/client.js';
import type { WorkflowLoader } from '../workflows/workflow-loader.js';
import type { Mode } from '../workflows/workflow-loader.js';
import type { ImageServer } from '../http/image-server.js';
import type { ImageData } from '../comfyui/types.js';
import { GenerateImageInputSchema, sanitizePrompt, isAbsolutePath, type LoraSpec } from '../utils/validation.js';
import { listLoras } from './list-loras.js';
import {
  type RequestHistoryEntry,
  recordHistoryEntry,
  updateHistoryEntryStatus,
} from '../utils/history.js';
import { classifyHistoryEntry } from '../comfyui/status.js';

export type GenerateImageOutput =
  | {
      prompt_id: string;
      status: 'completed';
      mode: Mode;
      images: ImageData[];
      duration_ms: number;
    }
  | {
      prompt_id: string;
      status: 'queued';
      mode: Mode;
      queue_position?: number;
    };

export interface PollOptions {
  intervalMs: number;
  maxDurationMs: number;
}

interface SetupResult {
  promptId: string;
  mode: Mode;
  historyEntry: RequestHistoryEntry;
  startedAt: number;
  queuePosition?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function setupGeneration(
  input: unknown,
  client: ComfyUIClient,
  workflowLoader: WorkflowLoader,
  requestHistory: RequestHistoryEntry[],
  defaultLoras: LoraSpec[],
): Promise<{ setup: SetupResult; wait: boolean }> {
  const validatedInput = GenerateImageInputSchema.parse(input);

  if (!validatedInput.prompt && !validatedInput.image_path) {
    throw new Error('Must provide at least prompt or image_path');
  }

  // Distinguish "omitted" (use defaults) from "explicit []" (no LoRAs).
  const effectiveLoras: LoraSpec[] = validatedInput.loras !== undefined
    ? validatedInput.loras
    : defaultLoras;

  if (effectiveLoras.length > 0) {
    const available = await listLoras(client).catch(() => ({ loras: [] as string[] }));
    const availableSet = new Set(available.loras);
    const missing = effectiveLoras.filter((l) => !availableSet.has(l.name)).map((l) => l.name);
    if (missing.length > 0 && available.loras.length > 0) {
      throw new Error(
        `Unknown LoRA(s): ${missing.join(', ')}. Available: ${available.loras.join(', ') || '(none)'}`,
      );
    }
  }

  const sanitizedPrompt = validatedInput.prompt
    ? sanitizePrompt(validatedInput.prompt)
    : undefined;
  const sanitizedNegativePrompt = validatedInput.negative_prompt
    ? sanitizePrompt(validatedInput.negative_prompt)
    : undefined;

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

  const options = {
    prompt: sanitizedPrompt,
    negative_prompt: sanitizedNegativePrompt,
    input_image: uploadedFilename,
    width: validatedInput.width,
    height: validatedInput.height,
    remove_background: validatedInput.remove_background,
    loras: effectiveLoras.length > 0 ? effectiveLoras.map((l) => ({
      name: l.name,
      strength_model: l.strength_model,
      strength_clip: l.strength_clip,
    })) : undefined,
  };
  const detectedMode = workflowLoader.detectMode(options);
  const baseWorkflow = await workflowLoader.loadWorkflowForMode(detectedMode);
  const { workflow: modifiedWorkflow, mode } = workflowLoader.prepareWorkflow(baseWorkflow, options);

  const clientId = randomBytes(16).toString('hex');
  const response = await client.queuePrompt(modifiedWorkflow, clientId);
  const promptId = response.prompt_id;
  const startedAt = Date.now();

  const historyEntry = recordHistoryEntry(requestHistory, {
    prompt_id: promptId,
    prompt: sanitizedPrompt,
    negative_prompt: sanitizedNegativePrompt,
    width: validatedInput.width,
    height: validatedInput.height,
    mode,
    remove_background: validatedInput.remove_background,
    workflow_name: workflowLoader.getWorkflowNameForMode(mode),
    queue_position: response.number,
    image_path: validatedInput.image_path,
  });

  return {
    setup: {
      promptId,
      mode,
      historyEntry,
      startedAt,
      queuePosition: response.number,
    },
    wait: validatedInput.wait,
  };
}

async function waitForCompletion(
  setup: SetupResult,
  client: ComfyUIClient,
  imageServer: ImageServer,
  pollOptions: PollOptions,
): Promise<GenerateImageOutput> {
  const { promptId, mode, historyEntry, startedAt } = setup;

  let sawExecuting = false;
  while (true) {
    if (Date.now() - startedAt > pollOptions.maxDurationMs) {
      const minutes = Math.floor(pollOptions.maxDurationMs / 60000);
      const errorMessage = `Request timed out after ${minutes} minutes`;
      updateHistoryEntryStatus(historyEntry, 'failed', { error_message: errorMessage });
      throw new Error(errorMessage);
    }

    await sleep(pollOptions.intervalMs);

    let history;
    try {
      history = await client.getHistory(promptId);
    } catch (error) {
      console.error(
        `generateImage: failed to fetch history for ${promptId}: ${(error as Error).message}`,
      );
      continue;
    }

    const historyRecord = history[promptId];
    if (!historyRecord) {
      try {
        const queue = await client.getQueue();
        const running = queue.queue_running.find((item) => item.prompt_id === promptId);
        if (running) {
          if (!sawExecuting) {
            sawExecuting = true;
            updateHistoryEntryStatus(historyEntry, 'executing');
          }
        } else {
          const pendingIndex = queue.queue_pending.findIndex(
            (item) => item.prompt_id === promptId,
          );
          if (pendingIndex >= 0) {
            updateHistoryEntryStatus(historyEntry, 'queued', {
              queue_position: pendingIndex + 1,
            });
          }
        }
      } catch (error) {
        console.error(
          `generateImage: failed to fetch queue for ${promptId}: ${(error as Error).message}`,
        );
      }
      continue;
    }

    const state = classifyHistoryEntry(historyRecord, promptId, imageServer);

    if (state.kind === 'executing') {
      if (!sawExecuting) {
        sawExecuting = true;
        updateHistoryEntryStatus(historyEntry, 'executing');
      }
      continue;
    }

    if (state.kind === 'error') {
      updateHistoryEntryStatus(historyEntry, 'failed', { error_message: state.errorMessage });
      throw new Error(state.errorMessage);
    }

    updateHistoryEntryStatus(historyEntry, 'completed');
    return {
      prompt_id: promptId,
      status: 'completed',
      mode,
      images: state.images,
      duration_ms: Date.now() - startedAt,
    };
  }
}

export async function generateImage(
  input: unknown,
  client: ComfyUIClient,
  workflowLoader: WorkflowLoader,
  imageServer: ImageServer,
  requestHistory: RequestHistoryEntry[],
  pollOptions: PollOptions,
  defaultLoras: LoraSpec[] = [],
): Promise<GenerateImageOutput> {
  const { setup, wait } = await setupGeneration(input, client, workflowLoader, requestHistory, defaultLoras);

  if (wait) {
    return waitForCompletion(setup, client, imageServer, pollOptions);
  }

  return {
    prompt_id: setup.promptId,
    status: 'queued',
    mode: setup.mode,
    queue_position: setup.queuePosition,
  };
}
