import type { ComfyUIClient } from '../comfyui/client.js';

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
      try {
        const history = await client.getHistory(entry.prompt_id);

        if (history[entry.prompt_id]) {
          const historyEntry = history[entry.prompt_id];

          // Determine status from ComfyUI history
          if (historyEntry.status.completed) {
            entry.status = 'completed';
          } else if (historyEntry.status.status_str === 'error') {
            entry.status = 'failed';
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
