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
  image_path?: string;
  error_message?: string;
}

export function recordHistoryEntry(
  history: RequestHistoryEntry[],
  entry: Omit<RequestHistoryEntry, 'timestamp' | 'status'> & Partial<Pick<RequestHistoryEntry, 'status'>>,
): void {
  history.push({
    ...entry,
    timestamp: new Date().toISOString(),
    status: entry.status ?? 'queued',
  });
}
