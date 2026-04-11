export interface RequestHistoryEntry {
  prompt_id: string;
  prompt?: string;
  negative_prompt?: string;
  width?: number;
  height?: number;
  mode: 'txt2img' | 'img2img' | 'post-process';
  remove_background?: boolean;
  workflow_name: string;
  timestamp: string;
  status: 'queued' | 'executing' | 'completed' | 'failed' | 'unknown';
  queue_position?: number;
  image_path?: string;
  error_message?: string;
}

export function recordHistoryEntry(
  history: RequestHistoryEntry[],
  entry: Omit<RequestHistoryEntry, 'timestamp' | 'status'> & Partial<Pick<RequestHistoryEntry, 'status'>>,
): RequestHistoryEntry {
  const appended: RequestHistoryEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
    status: entry.status ?? 'queued',
  };
  history.push(appended);
  return appended;
}

export function updateHistoryEntryStatus(
  entry: RequestHistoryEntry,
  status: RequestHistoryEntry['status'],
  extras?: { error_message?: string; queue_position?: number },
): void {
  entry.status = status;
  if (extras?.error_message !== undefined) {
    entry.error_message = extras.error_message;
  }
  if (extras?.queue_position !== undefined) {
    entry.queue_position = extras.queue_position;
  }
}
