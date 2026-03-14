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
import { listWorkflows } from './tools/list-workflows.js';
import { modifyImage } from './tools/modify-image.js';
import { resizeImage } from './tools/resize-image.js';
import { removeBackground } from './tools/remove-background.js';
import { type RequestHistoryEntry } from './utils/history.js';
import {
  GenerateImageInputSchema,
  GetImageInputSchema,
  ModifyImageInputSchema,
  ResizeImageInputSchema,
  RemoveBackgroundInputSchema,
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
  'Generate an image from a text prompt using ComfyUI.',
  GenerateImageInputSchema.shape,
  { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  async (args) => {
    try {
      const result = await generateImage(args, comfyClient, workflowLoader, requestHistory);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Error in comfyui_generate_image:', msg);
      return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: msg }) }] };
    }
  }
);

server.tool(
  'comfyui_modify_image',
  'Modify an existing image via img2img. Use denoise_strength (0.0–1.0) to control how much changes.',
  ModifyImageInputSchema.shape,
  { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  async (args) => {
    try {
      const result = await modifyImage(args, comfyClient, workflowLoader, requestHistory);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Error in comfyui_modify_image:', msg);
      return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: msg }) }] };
    }
  }
);

server.tool(
  'comfyui_resize_image',
  'Resize an image; auto-selects AI upscaling or simple downscale based on target vs source dimensions.',
  ResizeImageInputSchema.shape,
  { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  async (args) => {
    try {
      const result = await resizeImage(args, comfyClient, workflowLoader, requestHistory);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Error in comfyui_resize_image:', msg);
      return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: msg }) }] };
    }
  }
);

server.tool(
  'comfyui_remove_background',
  'Remove the background from an image, leaving the subject with transparency.',
  RemoveBackgroundInputSchema.shape,
  { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  async (args) => {
    try {
      const result = await removeBackground(args, comfyClient, workflowLoader, requestHistory);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Error in comfyui_remove_background:', msg);
      return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: msg }) }] };
    }
  }
);

server.tool(
  'comfyui_get_image',
  'Poll for completion of a queued job and retrieve image URLs. If status is "pending" or "executing", wait at least 30 seconds before polling again — image generation takes time.',
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

server.tool(
  'comfyui_list_workflows',
  'List available workflow files in the workspace directory.',
  {},
  { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  async () => {
    try {
      const result = await listWorkflows(workflowLoader);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Error in comfyui_list_workflows:', msg);
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
