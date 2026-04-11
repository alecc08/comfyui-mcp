#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config/config.js';
import { ComfyUIClient } from './comfyui/client.js';
import { WorkflowLoader } from './workflows/workflow-loader.js';
import { ImageServer } from './http/image-server.js';
import { generateImage } from './tools/generate-image.js';
import { getImage } from './tools/get-image.js';
import { getRequestHistory } from './tools/get-request-history.js';
import { type RequestHistoryEntry } from './utils/history.js';
import {
  GenerateImageInputSchema,
  GetImageInputSchema,
  GetRequestHistoryInputSchema,
} from './utils/validation.js';

// Load configuration
const config = loadConfig();

// Initialize ComfyUI client
const comfyClient = new ComfyUIClient(config.comfyui.baseUrl);

// Initialize workflow loader
const workflowLoader = new WorkflowLoader(
  config.workflow.workspaceDir,
  config.workflow.defaultWorkflow,
  config.workflow.editWorkflow,
  config.workflow.randomizeSeeds
);

// Initialize HTTP image server
const imageServer = new ImageServer(
  {
    port: config.http.port,
    cacheDir: config.http.cacheDir,
  },
  comfyClient
);

// Initialize request history storage (in-memory)
const requestHistory: RequestHistoryEntry[] = [];

// Create MCP server
const server = new McpServer({
  name: config.mcp.name,
  version: config.mcp.version,
});

// Register tools
server.tool(
  'comfyui_generate_image',
  `Generate, modify, or post-process images using ComfyUI. Three modes (auto-detected):
- txt2img: Provide prompt → generates image from text
- img2img: Provide prompt + image_path → edits the reference image using Flux 2 Klein's
  native edit pattern (ReferenceLatent + CFGGuider), which preserves character/subject
  identity far better than classic denoise-based img2img. Best results at ~1MP references;
  128×128 inputs will be upscaled before encoding.
- post-process: Provide image_path without prompt → resize and/or remove background only

Blocks until the image is ready (or fails/times out) and returns the image
URLs directly in the tool result. No polling required from the caller.

Parameters:
- prompt (string, optional): Text description of desired image
- negative_prompt (string, optional): What to avoid in the image
- image_path (string, optional): Absolute path to input image (triggers img2img or post-process)
- width/height (int, optional): Target output dimensions (triggers resize post-processing)
- remove_background (boolean, optional): Remove background from output image

Must provide at least prompt or image_path.`,
  GenerateImageInputSchema.shape,
  { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  async (args) => {
    try {
      const result = await generateImage(
        args,
        comfyClient,
        workflowLoader,
        imageServer,
        requestHistory,
        config.polling,
      );
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Error in comfyui_generate_image:', msg);
      return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: msg }) }] };
    }
  }
);

server.tool(
  'comfyui_get_image',
  'Retrieve image URLs for a previously queued job by prompt_id. Normally unnecessary because comfyui_generate_image already blocks and returns images directly — use this only for manual recovery or to inspect an older prompt_id.',
  GetImageInputSchema.shape,
  { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  async (args) => {
    try {
      const result = await getImage(args, comfyClient, imageServer, requestHistory);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Error in comfyui_get_image:', msg);
      return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: msg }) }] };
    }
  }
);

server.tool(
  'comfyui_get_request_history',
  'List past image generation requests with current status.',
  GetRequestHistoryInputSchema.shape,
  { readOnlyHint: true, idempotentHint: false, openWorldHint: false },
  async (args) => {
    try {
      const result = await getRequestHistory(args, requestHistory, comfyClient);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Error in comfyui_get_request_history:', msg);
      return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: msg }) }] };
    }
  }
);

// Start the server
async function main() {
  // Start HTTP image server, retrying on port conflicts
  const MAX_PORT_ATTEMPTS = 10;
  let started = false;
  for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt++) {
    try {
      await imageServer.start();
      started = true;
      break;
    } catch (error) {
      const msg = (error as Error).message;
      if (msg.includes('already in use') && attempt < MAX_PORT_ATTEMPTS - 1) {
        imageServer.setPort(imageServer.getPort() + 1);
        console.error(`Port in use, trying ${imageServer.getPort()}...`);
      } else {
        console.error(`Failed to start image server: ${msg}`);
        process.exit(1);
      }
    }
  }
  if (started) {
    console.error(`Image server started on ${imageServer.getBaseUrl()}`);
    console.error(`Image cache directory: ${config.http.cacheDir}`);
  }

  // Check ComfyUI connectivity
  const isHealthy = await comfyClient.healthCheck();
  if (!isHealthy) {
    console.error(
      `Warning: Cannot connect to ComfyUI at ${config.comfyui.baseUrl}. Please ensure ComfyUI is running.`,
    );
  }

  // Verify workflow workspace directory exists
  try {
    const workflows = await workflowLoader.listWorkflows();
    console.error(`Workflow workspace: ${config.workflow.workspaceDir}`);
    console.error(`Found ${workflows.length} workflow file(s)`);
    console.error(`Default workflow: ${config.workflow.defaultWorkflow}`);
    console.error(`Seed randomization: ${config.workflow.randomizeSeeds ? 'enabled' : 'disabled'}`);
  } catch (error) {
    console.error(`Warning: Failed to access workflow workspace: ${(error as Error).message}`);
    console.error(`Workspace directory: ${config.workflow.workspaceDir}`);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Generation poll interval: ${config.polling.intervalMs}ms`);
  console.error('ComfyUI MCP Server running on stdio');
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.error('\nShutting down...');
  await imageServer.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.error('\nShutting down...');
  await imageServer.stop();
  process.exit(0);
});

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
