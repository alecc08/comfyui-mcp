// ComfyUI workflow node structure
export interface WorkflowNode {
  class_type: string;
  inputs: Record<string, any>;
}

// Complete workflow is a mapping of node IDs to nodes
export interface ComfyUIWorkflow {
  [nodeId: string]: WorkflowNode;
}

// Response from POST /prompt
export interface QueuePromptResponse {
  prompt_id: string;
  number: number;
  node_errors?: Record<string, any>;
}

// Image metadata from history
export interface ImageMetadata {
  filename: string;
  subfolder: string;
  type: string;
}

// Single history entry for a prompt
export interface HistoryEntry {
  prompt: [number, ComfyUIWorkflow];
  outputs: {
    [nodeId: string]: {
      images?: ImageMetadata[];
      [key: string]: any;
    };
  };
  status: {
    status_str?: string;
    completed: boolean;
    messages?: any[];
  };
}

// Response from GET /history or GET /history/{prompt_id}
export interface HistoryResponse {
  [promptId: string]: HistoryEntry;
}

// Image data with HTTP URL
export interface ImageData {
  filename: string;
  subfolder: string;
  type: string;
  url: string; // HTTP URL to fetch the image
}

// Queue item structure
export interface QueueItem {
  prompt_id: string;
  number: number;
  prompt: [number, ComfyUIWorkflow];
}

// Response from GET /queue
export interface QueueResponse {
  queue_running: QueueItem[];
  queue_pending: QueueItem[];
}

// Response from POST /upload/image
export interface UploadImageResponse {
  name: string;
  subfolder: string;
  type: string;
}
