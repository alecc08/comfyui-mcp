# ComfyUI MCP Server - Architecture Design

## Table of Contents

1. [Overview](#overview)
2. [System Architecture](#system-architecture)
3. [Component Design](#component-design)
4. [Data Flow](#data-flow)
5. [API Specifications](#api-specifications)
6. [Workflow Management](#workflow-management)
7. [Error Handling](#error-handling)
8. [Performance Considerations](#performance-considerations)
9. [Security](#security)
10. [Implementation Roadmap](#implementation-roadmap)

## Overview

The ComfyUI MCP Server bridges the Model Context Protocol with ComfyUI's image generation capabilities, enabling AI assistants to generate and retrieve images through a standardized interface.

### Design Principles

- **Simplicity**: Three core functions - generate images, retrieve results, and view history
- **User Control**: Users provide their own ComfyUI workflows
- **Type Safety**: Full TypeScript implementation with strict typing
- **Minimal State**: Request history stored in-memory for recovery and review
- **Standards Compliance**: Strict adherence to MCP 2025-06-18 specification

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    MCP Client (Claude Desktop)               │
│                                                               │
│  - Receives tool definitions                                 │
│  - Executes generate_image / get_image / get_request_history│
│  - Displays results to user                                  │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ JSON-RPC 2.0 over stdio
                     │
┌────────────────────▼────────────────────────────────────────┐
│              ComfyUI MCP Server (Node.js)                    │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │           MCP Protocol Layer                         │    │
│  │  - McpServer instance                                │    │
│  │  - StdioServerTransport                              │    │
│  │  - Tool registration and routing                     │    │
│  │  - In-memory request history storage                 │    │
│  └──────────────────┬──────────────────────────────────┘    │
│                     │                                         │
│  ┌──────────────────▼──────────────────────────────────┐    │
│  │           Tool Implementation Layer                   │    │
│  │                                                       │    │
│  │  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐│    │
│  │  │ generate_   │  │  get_image   │  │get_request_  ││    │
│  │  │   image     │  │              │  │  history     ││    │
│  │  │             │  │              │  │              ││    │
│  │  │ - Validate  │  │ - Validate   │  │ - Retrieve   ││    │
│  │  │ - Build     │  │ - Check      │  │   history    ││    │
│  │  │ - Queue     │  │   history    │  │ - Update     ││    │
│  │  │ - Record    │  │ - Fetch      │  │   status     ││    │
│  │  │   history   │  │   images     │  │              ││    │
│  │  └──────┬──────┘  └──────┬───────┘  └──────┬───────┘│    │
│  └─────────┼────────────────┼──────────────────┼────────┘    │
│            │                │                  │              │
│  ┌─────────▼────────────────▼──────────────────▼─────────┐    │
│  │          ComfyUI Client Layer                        │    │
│  │                                                       │    │
│  │  - HTTP client (fetch)                               │    │
│  │  - WebSocket client (ws)                             │    │
│  │  - Connection management                             │    │
│  │  - Request/response handling                         │    │
│  └──────────────────┬───────────────────────────────────┘    │
│                     │                                         │
│  ┌──────────────────▼───────────────────────────────────┐    │
│  │          Workflow Loader Layer                        │    │
│  │                                                       │    │
│  │  - Load user-provided workflow JSON                  │    │
│  │  - Inject prompt, negative_prompt, width, height     │    │
│  │  - Intelligent KSampler-based parameter injection    │    │
│  │  - Workflow validation                               │    │
│  └───────────────────────────────────────────────────────┘    │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ HTTP REST API + WebSocket
                     │
┌────────────────────▼────────────────────────────────────────┐
│                      ComfyUI Server                          │
│                                                               │
│  - Workflow execution engine                                 │
│  - Model management                                          │
│  - Queue management                                          │
│  - Image generation                                          │
└──────────────────────────────────────────────────────────────┘
```

## Component Design

### 1. MCP Protocol Layer

**File**: `src/index.ts`

**Responsibilities**:
- Initialize MCP server with metadata
- Configure stdio transport
- Register tools with schemas (generate_image, get_image, get_request_history)
- Route requests to tool handlers
- Maintain in-memory request history array
- Handle server lifecycle

**Key Classes/Functions**:

```typescript
class MCPServer {
  private server: McpServer;
  private comfyClient: ComfyUIClient;

  async initialize(): Promise<void>;
  private registerTools(): void;
  async start(): Promise<void>;
}
```

**Dependencies**:
- `@modelcontextprotocol/sdk/server/mcp.js`
- `@modelcontextprotocol/sdk/server/stdio.js`
- `zod` for schema validation

### 2. Tool Implementation Layer

**Files**:
- `src/tools/generate-image.ts`
- `src/tools/get-image.ts`
- `src/tools/get-request-history.ts`

**Responsibilities**:
- Validate input parameters using Zod schemas
- Coordinate with ComfyUI client
- Format responses according to MCP spec
- Handle tool-specific errors
- Track and retrieve request history

#### `generate_image` Tool

```typescript
interface GenerateImageInput {
  prompt: string;
  negative_prompt?: string;
  width?: number;
  height?: number;
  workflow_path?: string;  // Optional: override default workflow
}

interface GenerateImageOutput {
  prompt_id: string;
  number: number;
  status: string;
}

async function generateImage(
  input: GenerateImageInput,
  client: ComfyUIClient,
  workflowLoader: WorkflowLoader,
  requestHistory: RequestHistoryEntry[]
): Promise<GenerateImageOutput>;
```

**Input Validation**:
- `prompt`: Non-empty string (required)
- `negative_prompt`: String (optional)
- `width/height`: Positive integers (default: 512)
- `workflow_path`: Valid file path (optional)

**Processing Steps**:
1. Validate and sanitize input parameters (prompt and negative_prompt)
2. Load workflow JSON from file (COMFYUI_WORKFLOW_PATH)
3. Inject prompt, negative_prompt, width, height into appropriate nodes via KSampler connection tracing
4. Generate client_id (random hex string)
5. Queue modified workflow via POST /prompt
6. Record request to in-memory history with timestamp
7. Return prompt_id and queue position

#### `get_image` Tool

```typescript
interface GetImageInput {
  prompt_id: string;
}

interface GetImageOutput {
  status: 'completed' | 'executing' | 'pending' | 'not_found';
  images?: Array<{
    filename: string;
    subfolder: string;
    type: string;
    data: string; // base64
  }>;
  error?: string;
}

async function getImage(
  input: GetImageInput,
  client: ComfyUIClient
): Promise<GetImageOutput>;
```

**Processing Steps**:
1. Validate prompt_id format
2. Check history via GET /history/{prompt_id}
3. Parse execution status
4. If completed, iterate through outputs
5. Fetch each image via GET /view
6. Encode as base64
7. Return status and image data

#### `get_request_history` Tool

```typescript
interface RequestHistoryEntry {
  prompt_id: string;
  prompt: string;
  negative_prompt?: string;
  width: number;
  height: number;
  timestamp: string;
  status: 'queued' | 'executing' | 'completed' | 'failed' | 'unknown';
  queue_position?: number;
}

interface GetRequestHistoryOutput {
  history: RequestHistoryEntry[];
  total_requests: number;
}

async function getRequestHistory(
  requestHistory: RequestHistoryEntry[],
  client: ComfyUIClient
): Promise<GetRequestHistoryOutput>;
```

**Processing Steps**:
1. Retrieve in-memory request history array
2. For each entry, query ComfyUI GET /history/{prompt_id} to get current status
3. Update status field based on ComfyUI response
4. Return complete history with updated statuses and total count

**Use Cases**:
- Recover lost prompt IDs after context loss
- Review all past image generation requests
- Check status of multiple requests at once
- Audit request history for debugging

**Note**: History is stored in-memory only and will be cleared on server restart.

### 3. ComfyUI Client Layer

**File**: `src/comfyui/client.ts`

**Responsibilities**:
- Maintain connection to ComfyUI instance
- Provide typed API methods
- Handle HTTP requests and WebSocket events
- Manage retries and timeouts

**Class Design**:

```typescript
class ComfyUIClient {
  private baseUrl: string;
  private ws: WebSocket | null;

  constructor(baseUrl: string);

  // Connection management
  async connect(): Promise<void>;
  async disconnect(): Promise<void>;
  async healthCheck(): Promise<boolean>;

  // Prompt queue operations
  async queuePrompt(
    workflow: ComfyUIWorkflow,
    clientId: string
  ): Promise<QueuePromptResponse>;

  // History operations
  async getHistory(promptId: string): Promise<HistoryResponse>;
  async getHistory(): Promise<HistoryResponse>;
  async clearHistory(): Promise<void>;

  // Image operations
  async getImage(
    filename: string,
    subfolder: string,
    type: string
  ): Promise<Buffer>;

  // WebSocket operations
  private setupWebSocket(): void;
  async waitForCompletion(
    promptId: string,
    timeout?: number
  ): Promise<ExecutionResult>;
}
```

**API Method Details**:

##### `queuePrompt(workflow, clientId)`
- **Endpoint**: POST /prompt
- **Payload**: `{ prompt: workflow, client_id: clientId }`
- **Response**: `{ prompt_id: string, number: number }`
- **Errors**: Validation errors, network errors

##### `getHistory(promptId?)`
- **Endpoint**: GET /history or GET /history/{prompt_id}
- **Response**: Object mapping prompt_id to execution data
- **Errors**: Not found, network errors

##### `getImage(filename, subfolder, type)`
- **Endpoint**: GET /view?filename={}&subfolder={}&type={}
- **Response**: Binary image data
- **Errors**: Not found, network errors

##### WebSocket Events
- **Connected**: On `open`, send client_id
- **Status Update**: `{ type: 'status', data: { status, sid } }`
- **Execution Start**: `{ type: 'execution_start', data: { prompt_id } }`
- **Executing**: `{ type: 'executing', data: { node, prompt_id } }`
- **Progress**: `{ type: 'progress', data: { value, max } }`
- **Executed**: `{ type: 'executed', data: { node, output } }`

### 4. Workflow Loader Layer

**File**: `src/workflows/workflow-loader.ts`

**Responsibilities**:
- Load user-provided workflow JSON from filesystem
- Detect and inject parameters into appropriate nodes
- Validate workflow structure before submission
- Support multiple workflow file paths

**Class Design**:

```typescript
interface ComfyUIWorkflow {
  [nodeId: string]: WorkflowNode;
}

interface WorkflowNode {
  class_type: string;
  inputs: Record<string, any>;
}

class WorkflowLoader {
  private workflowPath: string;

  constructor(workflowPath: string);

  async loadWorkflow(): Promise<ComfyUIWorkflow>;

  injectParameters(
    workflow: ComfyUIWorkflow,
    params: {
      prompt?: string;
      negative_prompt?: string;
      width?: number;
      height?: number;
    }
  ): ComfyUIWorkflow;

  private findNodeByType(
    workflow: ComfyUIWorkflow,
    classType: string
  ): string | null;

  private validate(workflow: ComfyUIWorkflow): boolean;
}
```

**Parameter Injection Strategy**:

The loader uses an intelligent connection-based approach to inject parameters:

1. **Positive/Negative Prompt Injection**:
   - Finds the `KSampler` node in the workflow
   - Follows its `positive` connection (array reference) to locate the positive prompt `CLIPTextEncode` node
   - Follows its `negative` connection (array reference) to locate the negative prompt `CLIPTextEncode` node
   - Injects `prompt` into the positive node's `inputs.text` field
   - Injects `negative_prompt` into the negative node's `inputs.text` field (if provided)
   - **Fallback**: If no KSampler found, uses first `CLIPTextEncode` node for positive prompt

2. **Dimensions Injection**:
   - Searches for `EmptyLatentImage` (SD1.5/SDXL) or `EmptySD3LatentImage` (SD3) nodes
   - Updates `inputs.width` and `inputs.height` fields

This approach correctly handles workflows with both positive and negative prompts by tracing the actual node graph connections rather than making assumptions about node order or naming.

**Example User Workflow** (exported from ComfyUI):

```json
{
  "3": {
    "class_type": "KSampler",
    "inputs": {
      "seed": 156680208700286,
      "steps": 20,
      "cfg": 8.0,
      "sampler_name": "euler",
      "scheduler": "normal",
      "denoise": 1.0,
      "model": ["4", 0],
      "positive": ["6", 0],
      "negative": ["7", 0],
      "latent_image": ["5", 0]
    }
  },
  "5": {
    "class_type": "EmptyLatentImage",
    "inputs": {
      "width": 512,    // ← Injected by server
      "height": 512,   // ← Injected by server
      "batch_size": 1
    }
  },
  "6": {
    "class_type": "CLIPTextEncode",
    "inputs": {
      "text": "",      // ← Injected by server (positive prompt)
      "clip": ["4", 1]
    }
  },
  "7": {
    "class_type": "CLIPTextEncode",
    "inputs": {
      "text": "",      // ← Injected by server (negative prompt)
      "clip": ["4", 1]
    }
  }
}
```

### 5. Configuration Layer

**File**: `src/config/config.ts`

```typescript
interface Config {
  comfyui: {
    baseUrl: string;
    timeout: number;
    retries: number;
  };
  defaults: {
    model: string;
    width: number;
    height: number;
    steps: number;
    cfgScale: number;
    sampler: string;
    scheduler: string;
    negativePrompt: string;
  };
  mcp: {
    name: string;
    version: string;
  };
}

function loadConfig(): Config;
```

**Environment Variables**:
- `COMFYUI_URL`: Base URL (default: http://127.0.0.1:8188)
- `COMFYUI_WORKFLOW_PATH`: Path to workflow JSON file

## Data Flow

### Image Generation Flow

```
1. User Request
   └─> "Generate an image of a sunset"

2. MCP Client (Claude Desktop)
   └─> Calls generate_image tool
       Input: { prompt: "sunset", negative_prompt: "dark, night", width: 1024, height: 768 }

3. MCP Server - Tool Handler
   └─> Validates input with Zod schema
   └─> Sanitizes prompt and negative_prompt
   └─> Generates client_id: "hex-string-1234"

4. Workflow Loader
   └─> Loads user workflow from file
   └─> Finds KSampler node
   └─> Follows positive/negative connections to CLIPTextEncode nodes
   └─> Injects prompt, negative_prompt, width, height
   └─> Returns modified workflow object

5. ComfyUI Client
   └─> POST /prompt
       Payload: { prompt: workflow, client_id: "hex-string-1234" }
   └─> Response: { prompt_id: "abc123", number: 1 }

6. MCP Server - Tool Handler
   └─> Records request to in-memory history array:
       {
         prompt_id: "abc123",
         prompt: "sunset",
         negative_prompt: "dark, night",
         width: 1024,
         height: 768,
         timestamp: "2025-01-15T10:30:00.000Z",
         status: "queued",
         queue_position: 1
       }
   └─> Returns to MCP client
       Output: { prompt_id: "abc123", number: 1, status: "queued" }

7. MCP Client
   └─> Displays to user: "Image queued as abc123"
```

### Image Retrieval Flow

```
1. User Request
   └─> "Get the image we just generated"

2. MCP Client (Claude Desktop)
   └─> Calls get_image tool
       Input: { prompt_id: "abc123" }

3. MCP Server - Tool Handler
   └─> Validates prompt_id format

4. ComfyUI Client
   └─> GET /history/abc123
   └─> Response: {
         "abc123": {
           "status": { "completed": true },
           "outputs": {
             "9": { "images": [
               { "filename": "ComfyUI_00001_.png", "subfolder": "", "type": "output" }
             ]}
           }
         }
       }

5. ComfyUI Client (Image Fetch)
   └─> GET /view?filename=ComfyUI_00001_.png&subfolder=&type=output
   └─> Response: Binary image data (PNG)

6. MCP Server - Tool Handler
   └─> Encodes image as base64
   └─> Returns to MCP client
       Output: {
         status: "completed",
         images: [{ filename: "...", data: "base64..." }]
       }

7. MCP Client
   └─> Decodes and displays image to user
```

### Request History Retrieval Flow

```
1. User Request
   └─> "Show me my recent image generations"

2. MCP Client (Claude Desktop)
   └─> Calls get_request_history tool
       Input: {} (no parameters)

3. MCP Server - Tool Handler
   └─> Retrieves in-memory history array
   └─> For each entry, queries ComfyUI:
       GET /history/{prompt_id}

4. ComfyUI Client
   └─> Returns status for each prompt_id
   └─> Updates entry.status based on ComfyUI response:
       - "completed" if status.completed === true
       - "failed" if status.status_str === "error"
       - "executing" otherwise

5. MCP Server - Tool Handler
   └─> Returns to MCP client
       Output: {
         history: [
           {
             prompt_id: "abc123",
             prompt: "sunset",
             negative_prompt: "dark, night",
             width: 1024,
             height: 768,
             timestamp: "2025-01-15T10:30:00.000Z",
             status: "completed",
             queue_position: 1
           },
           { ... more entries ... }
         ],
         total_requests: 2
       }

6. MCP Client
   └─> Displays history table to user
```

## API Specifications

### ComfyUI REST API

#### POST /prompt
```typescript
Request:
{
  prompt: ComfyUIWorkflow;
  client_id: string;
}

Response (Success):
{
  prompt_id: string;
  number: number;
}

Response (Error):
{
  error: string;
  node_errors: Record<string, any>;
}
```

#### GET /history/{prompt_id}
```typescript
Response:
{
  [prompt_id: string]: {
    prompt: Array<number, ComfyUIWorkflow>;
    outputs: {
      [node_id: string]: {
        images?: Array<{
          filename: string;
          subfolder: string;
          type: string;
        }>;
      };
    };
    status: {
      status_str: string;
      completed: boolean;
      messages: Array<any>;
    };
  };
}
```

#### GET /view
```typescript
Query Parameters:
  filename: string;
  subfolder: string;
  type: 'output' | 'input' | 'temp';

Response:
  Binary image data (image/png, image/jpeg, etc.)
```

#### WebSocket /ws
```typescript
Message Types:

{ type: 'status', data: { status: { exec_info: { queue_remaining: number } } } }
{ type: 'execution_start', data: { prompt_id: string } }
{ type: 'executing', data: { node: string | null, prompt_id: string } }
{ type: 'progress', data: { value: number, max: number } }
{ type: 'executed', data: { node: string, output: any, prompt_id: string } }
```

## Workflow Management

### User-Provided Workflows

Users export their workflows from ComfyUI using "Save (API Format)" which produces a JSON file containing all nodes and connections.

**Example Workflow Path**: `./workflow.json` or `/path/to/my-workflow.json`

The server loads this file at runtime and modifies it before submission to ComfyUI.

### Parameter Injection

The server performs simple parameter injection by searching for known node types:

| Node Type | Field | Injected Parameter |
|-----------|-------|-------------------|
| `CLIPTextEncode` | `inputs.text` | User's prompt |
| `EmptyLatentImage` | `inputs.width` | User's width |
| `EmptyLatentImage` | `inputs.height` | User's height |

**Injection Algorithm**:
1. Parse workflow JSON
2. Iterate through all nodes
3. Find first node matching target class_type
4. Update the appropriate input field
5. Return modified workflow

### Workflow Validation

Basic validation before submission:

1. **File Exists**: Workflow path points to valid JSON file
2. **Valid JSON**: File can be parsed as JSON
3. **Has Nodes**: JSON contains at least one node
4. **Node Structure**: Each node has `class_type` and `inputs`

## Error Handling

### Error Categories

1. **Validation Errors**: Invalid input parameters
   - Status: 400
   - Example: "Width must be divisible by 8"

2. **Connection Errors**: Cannot reach ComfyUI
   - Status: 503
   - Example: "ComfyUI server unavailable"

3. **Execution Errors**: ComfyUI workflow failed
   - Status: 500
   - Example: "Model not found: xyz.safetensors"

4. **Not Found Errors**: Resource doesn't exist
   - Status: 404
   - Example: "Prompt ID not found"

### Error Response Format

```typescript
interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: any;
  };
}
```

### Retry Strategy

- **Connection Errors**: Exponential backoff (3 retries)
- **Timeout Errors**: Single retry with increased timeout
- **Validation Errors**: No retry (immediate failure)
- **Execution Errors**: No retry (user must fix workflow)

## Performance Considerations

### Caching

- **Workflow File**: Loaded once at startup, cached in memory
- **Connection Pooling**: Reuse HTTP connections to ComfyUI
- **WebSocket**: Single persistent connection per server instance (optional)

### Timeouts

- **HTTP Requests**: 30 seconds default
- **Image Generation**: 5 minutes (configurable)
- **Image Retrieval**: 10 seconds
- **WebSocket**: Infinite (with heartbeat)

### Resource Limits

- **Max Concurrent Requests**: 10 (configurable)
- **Max Image Size**: Limited by ComfyUI (typically 2048x2048 for SD 1.5)
- **Max Queue Depth**: Managed by ComfyUI

### Memory Management

- **Streaming Images**: Use streams for large images (>10MB)
- **Buffer Limits**: 50MB max per image response
- **WebSocket Buffer**: 1MB max message size

## Security

### Threat Model

1. **Malicious Prompts**: XSS via prompt injection
   - Mitigation: Sanitize prompts, no HTML rendering

2. **Path Traversal**: Access arbitrary files via filename
   - Mitigation: Validate filename format, no path separators

3. **Resource Exhaustion**: Queue flooding
   - Mitigation: Rate limiting (future), queue depth limits

4. **SSRF**: Access internal services via ComfyUI URL
   - Mitigation: Validate URL is localhost/127.0.0.1

### Input Sanitization

```typescript
function sanitizePrompt(prompt: string): string {
  // Remove control characters
  // Limit length to 10000 chars
  // Remove potentially dangerous strings
  return prompt.trim().slice(0, 10000);
}

function validateFilename(filename: string): boolean {
  // Must match: alphanumeric, dots, dashes, underscores only
  // No path separators (/, \)
  return /^[a-zA-Z0-9._-]+$/.test(filename);
}
```

### ComfyUI URL Validation

```typescript
function validateComfyUIUrl(url: string): boolean {
  const parsed = new URL(url);
  const allowedHosts = ['127.0.0.1', 'localhost', '::1'];
  return allowedHosts.includes(parsed.hostname);
}
```

## Implementation Roadmap

### Phase 1: Core Functionality (MVP)
**Goal**: Basic image generation and retrieval

**Tasks**:
1. Project setup (package.json, tsconfig.json)
2. MCP server initialization with stdio transport
3. ComfyUI client implementation (HTTP only)
4. Workflow loader (load JSON, inject parameters)
5. `generate_image` tool implementation
6. `get_image` tool implementation
7. Configuration management (env vars)
8. Error handling basics
9. Build and packaging for npm

**Duration**: 2-3 days

### Phase 2: Testing & Polish
**Goal**: Production-ready reliability

**Tasks**:
1. Unit tests for workflow loader
2. Integration tests with mock ComfyUI
3. Error handling and validation
4. Documentation finalization
5. Example workflow file

**Duration**: 1-2 days

## Technology Stack

### Core Dependencies

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.19.1",
    "zod": "^3.22.4",
    "uuid": "^9.0.1"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "@types/uuid": "^9.0.7",
    "typescript": "^5.3.3",
    "tsx": "^4.7.0"
  }
}
```

### Node.js Version

- **Minimum**: 18.0.0 (LTS)
- **Recommended**: 20.x or 22.x (Active LTS)
- **Engine Constraint**: `"node": ">=18.0.0"`

### Build Tools

- **TypeScript**: 5.3+ with strict mode
- **Build**: `tsc` for compilation
- **Runtime**: `node` with ES modules
- **Package Manager**: npm (for npx compatibility)

## File Structure

```
comfyui-mcp/
├── src/
│   ├── index.ts                    # Entry point, MCP server setup
│   ├── config/
│   │   └── config.ts               # Configuration management
│   ├── comfyui/
│   │   ├── client.ts               # ComfyUI API client
│   │   └── types.ts                # ComfyUI type definitions
│   ├── workflows/
│   │   └── workflow-loader.ts      # Load and inject parameters into workflows
│   ├── tools/
│   │   ├── generate-image.ts       # generate_image tool
│   │   ├── get-image.ts            # get_image tool
│   │   └── get-request-history.ts  # get_request_history tool
│   └── utils/
│       └── validation.ts           # Input validation helpers
├── dist/                           # Compiled output
├── package.json
├── tsconfig.json
├── README.md
├── ARCHITECTURE.md                 # This file
└── LICENSE
```

## Testing Strategy

### Manual Testing

**Checklist**:
- [ ] Test with real ComfyUI instance
- [ ] Test with Claude Desktop
- [ ] Test with MCP Inspector
- [ ] Test various image sizes and prompts
- [ ] Test workflow file loading
- [ ] Test parameter injection
- [ ] Test error scenarios (invalid workflow, connection refused)

## Deployment

### NPM Package

**Package Name**: `comfyui-mcp-server`

**Publishing**:
```bash
npm run build
npm version patch/minor/major
npm publish
```

**Installation**:
```bash
npx comfyui-mcp-server
```


## References

- [MCP Specification 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18)
- [ComfyUI Documentation](https://docs.comfy.org)
- [ComfyUI Server Routes](https://docs.comfy.org/development/comfyui-server/comms_routes)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [ComfyUI Examples](https://github.com/comfyanonymous/ComfyUI_examples)
