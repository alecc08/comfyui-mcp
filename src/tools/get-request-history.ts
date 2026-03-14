import type { ComfyUIClient } from '../comfyui/client.js';
import type { RequestHistoryEntry } from '../utils/history.js';
import { isTimedOut, GENERATION_TIMEOUT_MS } from '../utils/timeout.js';
import { GetRequestHistoryInputSchema } from '../utils/validation.js';

export interface GetRequestHistoryOutput {
  history: RequestHistoryEntry[];
  total_count: number;
  limit: number;
  offset: number;
  has_more: boolean;
  next_offset: number;
}

export async function getRequestHistory(
  input: unknown,
  requestHistory: RequestHistoryEntry[],
  client: ComfyUIClient,
): Promise<GetRequestHistoryOutput> {
  const { limit, offset } = GetRequestHistoryInputSchema.parse(input);

  const page = requestHistory.slice(offset, offset + limit);

  const updatedPage = await Promise.all(
    page.map(async (entry) => {
      if (isTimedOut(entry.timestamp) && entry.status !== 'completed') {
        const elapsed = Math.floor((Date.now() - new Date(entry.timestamp).getTime()) / 1000 / 60);
        entry.status = 'failed';
        entry.error_message = `Request timed out after ${elapsed} minutes (max: ${GENERATION_TIMEOUT_MS / 60000})`;
        return entry;
      }

      try {
        const history = await client.getHistory(entry.prompt_id);

        if (history[entry.prompt_id]) {
          const historyEntry = history[entry.prompt_id];

          if (historyEntry.status.status_str === 'error') {
            entry.status = 'failed';
            if (historyEntry.status.messages && Array.isArray(historyEntry.status.messages)) {
              const msgs = historyEntry.status.messages
                .map((msg: any) => {
                  if (typeof msg === 'string') return msg;
                  if (msg && typeof msg === 'object') return JSON.stringify(msg);
                  return String(msg);
                })
                .filter(Boolean);
              entry.error_message = msgs.join('; ');
            }
          } else if (historyEntry.status.completed) {
            entry.status = 'completed';
          } else {
            entry.status = 'executing';
          }
        }
      } catch {
        // keep current status if ComfyUI is unreachable
      }

      return entry;
    }),
  );

  const total_count = requestHistory.length;
  const next_offset = offset + limit;

  return {
    history: updatedPage,
    total_count,
    limit,
    offset,
    has_more: next_offset < total_count,
    next_offset,
  };
}
