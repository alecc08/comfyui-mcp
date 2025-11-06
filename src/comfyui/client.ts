import type {
  ComfyUIWorkflow,
  QueuePromptResponse,
  HistoryResponse,
  ImageMetadata,
  QueueResponse,
  UploadImageResponse,
} from './types.js';
import fs from 'fs/promises';
import path from 'path';

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

  /**
   * Upload an image file to ComfyUI
   */
  async uploadImage(imagePath: string): Promise<UploadImageResponse> {
    // Validate file exists and is readable
    try {
      await fs.access(imagePath, fs.constants.R_OK);
    } catch (error) {
      throw new Error(`Cannot read file at path: ${imagePath}. Make sure the file exists and is readable.`);
    }

    // Validate file extension (case-insensitive)
    const ext = path.extname(imagePath).toLowerCase();
    const validExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'];
    if (!validExtensions.includes(ext)) {
      throw new Error(`Invalid image file extension: ${ext}. Supported formats: ${validExtensions.join(', ')}`);
    }

    // Read file
    let fileBuffer: Buffer;
    try {
      fileBuffer = await fs.readFile(imagePath);
    } catch (error) {
      throw new Error(`Failed to read image file: ${(error as Error).message}`);
    }

    // Determine MIME type
    const mimeTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.bmp': 'image/bmp',
    };
    const mimeType = mimeTypes[ext] || 'application/octet-stream';

    // Create FormData
    const formData = new FormData();
    const filename = path.basename(imagePath);

    // Create a File/Blob from the buffer
    const blob = new Blob([fileBuffer], { type: mimeType });
    formData.append('image', blob, filename);

    // Upload to ComfyUI
    const url = `${this.baseUrl}/upload/image`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        body: formData,
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
      throw new Error(`Failed to upload image: ${errorDetails}`);
    }

    try {
      const data = await response.json();
      return data as UploadImageResponse;
    } catch (error) {
      throw new Error(`Invalid JSON response from ComfyUI upload endpoint: ${(error as Error).message}`);
    }
  }
}
