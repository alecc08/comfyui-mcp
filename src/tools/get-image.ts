import type { ComfyUIClient } from '../comfyui/client.js';
import type { ImageData } from '../comfyui/types.js';
import type { RequestHistoryEntry } from './get-request-history.js';
import { GetImageInputSchema, validateFilename } from '../utils/validation.js';

export interface GetImageOutput {
  status: 'completed' | 'executing' | 'pending' | 'not_found';
  images?: ImageData[];
  queue_position?: number;
  queue_size?: number;
  error?: string;
}

export async function getImage(
  input: unknown,
  client: ComfyUIClient,
  requestHistory?: RequestHistoryEntry[]
): Promise<GetImageOutput> {
  // Validate input
  const validatedInput = GetImageInputSchema.parse(input);
  const promptId = validatedInput.prompt_id;

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
            };
          } else {
            // In running queue
            return {
              status: 'executing',
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
          };
        }
      }

      return {
        status: 'not_found',
        error: `Prompt ID ${promptId} not found`,
      };
    }

    const entry = history[promptId];

    // Check completion status
    if (!entry.status.completed) {
      return {
        status: 'executing',
      };
    }

    // Extract images from outputs
    const images: ImageData[] = [];

    for (const [nodeId, output] of Object.entries(entry.outputs)) {
      if (output.images && Array.isArray(output.images)) {
        for (const imageMetadata of output.images) {
          // Validate filename to prevent path traversal
          if (!validateFilename(imageMetadata.filename)) {
            console.error(`Invalid filename: ${imageMetadata.filename}`);
            continue;
          }

          try {
            // Fetch the actual image data
            const imageBuffer = await client.getImage(
              imageMetadata.filename,
              imageMetadata.subfolder,
              imageMetadata.type,
            );

            // Convert to base64
            const base64Data = imageBuffer.toString('base64');

            images.push({
              filename: imageMetadata.filename,
              subfolder: imageMetadata.subfolder,
              type: imageMetadata.type,
              data: base64Data,
            });
          } catch (error) {
            console.error(`Failed to fetch image ${imageMetadata.filename}:`, error);
            // Continue with other images
          }
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
