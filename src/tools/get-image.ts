import type { ComfyUIClient } from '../comfyui/client.js';
import type { ImageData } from '../comfyui/types.js';
import type { RequestHistoryEntry } from '../utils/history.js';
import type { ImageServer } from '../http/image-server.js';
import { GetImageInputSchema, validateFilename } from '../utils/validation.js';
import { isTimedOut } from '../utils/timeout.js';

export interface GetImageOutput {
  status: 'completed' | 'executing' | 'pending' | 'not_found' | 'failed';
  images?: ImageData[];
  queue_position?: number;
  queue_size?: number;
  retry_after_seconds?: number;
  error?: string;
}

export async function getImage(
  input: unknown,
  client: ComfyUIClient,
  imageServer: ImageServer,
  requestHistory?: RequestHistoryEntry[]
): Promise<GetImageOutput> {
  // Validate input
  const validatedInput = GetImageInputSchema.parse(input);
  const promptId = validatedInput.prompt_id;

  // Check for timeout in request history
  if (requestHistory) {
    const historyEntry = requestHistory.find((entry) => entry.prompt_id === promptId);
    if (historyEntry && isTimedOut(historyEntry.timestamp)) {
      const elapsed = Math.floor((Date.now() - new Date(historyEntry.timestamp).getTime()) / 1000 / 60);
      return {
        status: 'failed',
        error: `Request timed out after ${elapsed} minutes (max: 15 minutes)`,
      };
    }
  }

  try {
    // Fetch history for this prompt
    const history = await client.getHistory(promptId);

    // Check if prompt exists in ComfyUI history
    if (!history[promptId]) {
      // Check queue status for pending items
      try {
        const queueStatus = await client.getQueue();
        const allQueueItems = [...queueStatus.queue_running, ...queueStatus.queue_pending];
        const queueItem = allQueueItems.find((item) => item.prompt_id === promptId);

        if (queueItem) {
          // Find position in pending queue (0-indexed in pending, but we want 1-indexed for user)
          const pendingPosition = queueStatus.queue_pending.findIndex(
            (item) => item.prompt_id === promptId
          );

          if (pendingPosition >= 0) {
            // In pending queue
            return {
              status: 'pending',
              queue_position: pendingPosition + 1,
              queue_size: queueStatus.queue_pending.length,
              retry_after_seconds: 30,
            };
          } else {
            // In running queue
            return {
              status: 'executing',
              retry_after_seconds: 30,
            };
          }
        }
      } catch (queueError) {
        // If queue check fails, fall back to checking our history
        console.error('Failed to check queue status:', queueError);
      }

      // Check if it exists in our request history (fallback)
      if (requestHistory) {
        const existsInOurHistory = requestHistory.some((entry) => entry.prompt_id === promptId);
        if (existsInOurHistory) {
          return {
            status: 'pending',
            retry_after_seconds: 30,
          };
        }
      }

      return {
        status: 'not_found',
        error: `Prompt ID ${promptId} not found`,
      };
    }

    const entry = history[promptId];

    // Check for failure status first
    if (entry.status.status_str === 'error') {
      // Extract error messages from status.messages if available
      let errorMessage = 'Image generation failed';
      if (entry.status.messages && Array.isArray(entry.status.messages)) {
        const errorMessages = entry.status.messages
          .map((msg: any) => {
            if (typeof msg === 'string') return msg;
            if (msg && typeof msg === 'object') return JSON.stringify(msg);
            return String(msg);
          })
          .filter(Boolean);
        if (errorMessages.length > 0) {
          errorMessage = errorMessages.join('; ');
        }
      }

      return {
        status: 'failed',
        error: errorMessage,
      };
    }

    // Check completion status
    if (!entry.status.completed) {
      return {
        status: 'executing',
        retry_after_seconds: 30,
      };
    }

    // Extract images from outputs and build URLs
    const images: ImageData[] = [];

    for (const [nodeId, output] of Object.entries(entry.outputs)) {
      if (output.images && Array.isArray(output.images)) {
        for (const imageMetadata of output.images) {
          // Validate filename to prevent path traversal
          if (!validateFilename(imageMetadata.filename)) {
            console.error(`Invalid filename: ${imageMetadata.filename}`);
            continue;
          }

          // Build image URL using the image server
          const imageUrl = imageServer.buildImageUrl(promptId, imageMetadata);

          images.push({
            filename: imageMetadata.filename,
            subfolder: imageMetadata.subfolder,
            type: imageMetadata.type,
            url: imageUrl,
          });
        }
      }
    }

    if (images.length === 0) {
      return {
        status: 'completed',
        error: 'No images found in output',
      };
    }

    return {
      status: 'completed',
      images,
    };
  } catch (error) {
    return {
      status: 'not_found',
      error: (error as Error).message,
    };
  }
}
