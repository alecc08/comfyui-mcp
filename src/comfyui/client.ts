import type {
  ComfyUIWorkflow,
  QueuePromptResponse,
  HistoryResponse,
  ImageMetadata,
} from './types.js';

export class ComfyUIClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
  }

  /**
   * Queue a workflow for execution
   */
  async queuePrompt(workflow: ComfyUIWorkflow, clientId: string): Promise<QueuePromptResponse> {
    const url = `${this.baseUrl}/prompt`;
    const payload = {
      prompt: workflow,
      client_id: clientId,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Failed to queue prompt: ${response.statusText}`);
    }

    const data = await response.json() as any;

    // Check for node errors
    if (data.error || data.node_errors) {
      throw new Error(`ComfyUI workflow error: ${data.error || JSON.stringify(data.node_errors)}`);
    }

    return data as QueuePromptResponse;
  }

  /**
   * Get execution history for a specific prompt ID
   */
  async getHistory(promptId: string): Promise<HistoryResponse> {
    const url = `${this.baseUrl}/history/${promptId}`;

    const response = await fetch(url, {
      method: 'GET',
    });

    if (!response.ok) {
      throw new Error(`Failed to get history: ${response.statusText}`);
    }

    const data = await response.json();
    return data as HistoryResponse;
  }

  /**
   * Get all execution history
   */
  async getAllHistory(): Promise<HistoryResponse> {
    const url = `${this.baseUrl}/history`;

    const response = await fetch(url, {
      method: 'GET',
    });

    if (!response.ok) {
      throw new Error(`Failed to get history: ${response.statusText}`);
    }

    const data = await response.json();
    return data as HistoryResponse;
  }

  /**
   * Fetch an image from ComfyUI
   */
  async getImage(filename: string, subfolder: string, type: string): Promise<Buffer> {
    const params = new URLSearchParams({
      filename,
      subfolder,
      type,
    });

    const url = `${this.baseUrl}/view?${params.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
    });

    if (!response.ok) {
      throw new Error(`Failed to get image: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Check if ComfyUI server is reachable
   */
  async healthCheck(): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/system_stats`;
      const response = await fetch(url, {
        method: 'GET',
      });

      return response.ok;
    } catch (error) {
      return false;
    }
  }
}
