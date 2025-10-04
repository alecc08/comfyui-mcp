import type {
  ComfyUIWorkflow,
  QueuePromptResponse,
  HistoryResponse,
  ImageMetadata,
  QueueResponse,
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

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      throw new Error(`Failed to connect to ComfyUI at ${this.baseUrl}: ${(error as Error).message}`);
    }

    if (!response.ok) {
      let errorDetails = response.statusText;
      try {
        const errorBody = await response.text();
        if (errorBody) {
          errorDetails = `${response.status} ${response.statusText}: ${errorBody}`;
        }
      } catch {
        // If we can't read the body, just use the status text
      }
      throw new Error(`Failed to queue prompt: ${errorDetails}`);
    }

    let data: any;
    try {
      data = await response.json();
    } catch (error) {
      throw new Error(`Invalid JSON response from ComfyUI: ${(error as Error).message}`);
    }

    // Check for node errors with detailed error reporting
    const hasError = data.error;
    const hasNodeErrors = data.node_errors && Object.keys(data.node_errors).length > 0;

    if (hasError || hasNodeErrors) {
      const errorParts: string[] = [];

      if (data.error) {
        errorParts.push(`Error: ${JSON.stringify(data.error)}`);
      }

      if (hasNodeErrors) {
        const nodeErrors = data.node_errors;
        const nodeErrorCount = Object.keys(nodeErrors).length;
        errorParts.push(`Node errors (${nodeErrorCount}):`);
        for (const [nodeId, nodeError] of Object.entries(nodeErrors)) {
          errorParts.push(`  Node ${nodeId}: ${JSON.stringify(nodeError)}`);
        }
      }

      throw new Error(`ComfyUI workflow error:\n${errorParts.join('\n')}`);
    }

    // Validate response structure
    if (!data.prompt_id) {
      throw new Error(`Invalid response from ComfyUI - missing prompt_id. Response: ${JSON.stringify(data)}`);
    }

    return data as QueuePromptResponse;
  }

  /**
   * Get execution history for a specific prompt ID
   */
  async getHistory(promptId: string): Promise<HistoryResponse> {
    const url = `${this.baseUrl}/history/${promptId}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
      });
    } catch (error) {
      throw new Error(`Failed to connect to ComfyUI at ${this.baseUrl}: ${(error as Error).message}`);
    }

    if (!response.ok) {
      let errorDetails = `${response.status} ${response.statusText}`;
      try {
        const errorBody = await response.text();
        if (errorBody) {
          errorDetails += `: ${errorBody}`;
        }
      } catch {
        // If we can't read the body, just use the status
      }
      throw new Error(`Failed to get history for prompt ${promptId}: ${errorDetails}`);
    }

    try {
      const data = await response.json();
      return data as HistoryResponse;
    } catch (error) {
      throw new Error(`Invalid JSON response from ComfyUI history endpoint: ${(error as Error).message}`);
    }
  }

  /**
   * Get all execution history
   */
  async getAllHistory(): Promise<HistoryResponse> {
    const url = `${this.baseUrl}/history`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
      });
    } catch (error) {
      throw new Error(`Failed to connect to ComfyUI at ${this.baseUrl}: ${(error as Error).message}`);
    }

    if (!response.ok) {
      let errorDetails = `${response.status} ${response.statusText}`;
      try {
        const errorBody = await response.text();
        if (errorBody) {
          errorDetails += `: ${errorBody}`;
        }
      } catch {
        // If we can't read the body, just use the status
      }
      throw new Error(`Failed to get all history: ${errorDetails}`);
    }

    try {
      const data = await response.json();
      return data as HistoryResponse;
    } catch (error) {
      throw new Error(`Invalid JSON response from ComfyUI history endpoint: ${(error as Error).message}`);
    }
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

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
      });
    } catch (error) {
      throw new Error(`Failed to connect to ComfyUI at ${this.baseUrl}: ${(error as Error).message}`);
    }

    if (!response.ok) {
      throw new Error(`Failed to get image (filename: ${filename}, subfolder: ${subfolder}): ${response.status} ${response.statusText}`);
    }

    try {
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      throw new Error(`Failed to read image data: ${(error as Error).message}`);
    }
  }

  /**
   * Get current queue status
   */
  async getQueue(): Promise<QueueResponse> {
    const url = `${this.baseUrl}/queue`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
      });
    } catch (error) {
      throw new Error(`Failed to connect to ComfyUI at ${this.baseUrl}: ${(error as Error).message}`);
    }

    if (!response.ok) {
      throw new Error(`Failed to get queue status: ${response.status} ${response.statusText}`);
    }

    try {
      const data = await response.json();
      return data as QueueResponse;
    } catch (error) {
      throw new Error(`Invalid JSON response from ComfyUI queue endpoint: ${(error as Error).message}`);
    }
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
