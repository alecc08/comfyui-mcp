import type { ComfyUIClient } from '../comfyui/client.js';

// Timeout constant: 15 minutes in milliseconds
const GENERATION_TIMEOUT_MS = 15 * 60 * 1000;

export interface RequestHistoryEntry {
  prompt_id: string;
  prompt: string;
  negative_prompt?: string;
  width: number;
  height: number;
  workflow_name: string;
  timestamp: string;
  status: 'queued' | 'executing' | 'completed' | 'failed' | 'unknown';
  queue_position?: number;
  image_path?: string; // For image modification/processing workflows
  error_message?: string; // Error details when status is 'failed'
}

export interface GetRequestHistoryOutput {
  history: RequestHistoryEntry[];
  total_requests: number;
}

/**
 * Get the history of image generation requests made through this server
 */
export async function getRequestHistory(
  requestHistory: RequestHistoryEntry[],
  client: ComfyUIClient,
): Promise<GetRequestHistoryOutput> {
  // Update status for each request by checking ComfyUI history
  const updatedHistory = await Promise.all(
    requestHistory.map(async (entry) => {
      // Check for timeout first
      const requestTime = new Date(entry.timestamp).getTime();
      const currentTime = Date.now();
      const elapsedTime = currentTime - requestTime;

      if (elapsedTime > GENERATION_TIMEOUT_MS && entry.status !== 'completed') {
        entry.status = 'failed';
        entry.error_message = `Request timed out after ${Math.floor(elapsedTime / 1000 / 60)} minutes (max: 15 minutes)`;
        return entry;
      }

      try {
        const history = await client.getHistory(entry.prompt_id);

        if (history[entry.prompt_id]) {
          const historyEntry = history[entry.prompt_id];

          // Determine status from ComfyUI history
          // Check for error status first, as it can be both completed and failed
          if (historyEntry.status.status_str === 'error') {
            entry.status = 'failed';
            // Extract error messages from status.messages if available
            if (historyEntry.status.messages && Array.isArray(historyEntry.status.messages)) {
              const errorMessages = historyEntry.status.messages
                .map((msg: any) => {
                  if (typeof msg === 'string') return msg;
                  if (msg && typeof msg === 'object') return JSON.stringify(msg);
                  return String(msg);
                })
                .filter(Boolean);
              entry.error_message = errorMessages.join('; ');
            }
          } else if (historyEntry.status.completed) {
            entry.status = 'completed';
          } else {
            entry.status = 'executing';
          }
        }
      } catch (error) {
        // If we can't fetch status, keep the current status
        // This could happen if the request is still in queue or ComfyUI was restarted
      }

      return entry;
    }),
  );

  return {
    history: updatedHistory,
    total_requests: updatedHistory.length,
  };
}
