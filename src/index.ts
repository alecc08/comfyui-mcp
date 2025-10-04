#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { loadConfig } from './config/config.js';
import { ComfyUIClient } from './comfyui/client.js';
import { WorkflowLoader } from './workflows/workflow-loader.js';
import { generateImage } from './tools/generate-image.js';
import { getImage } from './tools/get-image.js';
import { getRequestHistory, type RequestHistoryEntry } from './tools/get-request-history.js';
import { listWorkflows } from './tools/list-workflows.js';

// Load configuration
const config = loadConfig();

// Initialize ComfyUI client
const comfyClient = new ComfyUIClient(config.comfyui.baseUrl);

// Initialize workflow loader
const workflowLoader = new WorkflowLoader(config.workflow.workspaceDir, config.workflow.defaultWorkflow);

// Initialize request history storage (in-memory)
const requestHistory: RequestHistoryEntry[] = [];

// Create MCP server
const server = new Server(
  {
    name: config.mcp.name,
    version: config.mcp.version,
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// Register tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'generate_image',
        description:
          'Generate an image using ComfyUI with the specified prompt and dimensions. ' +
          'The server loads a workflow JSON file and injects your parameters before queuing it to ComfyUI.',
        inputSchema: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description: 'Text description of the image to generate',
            },
            negative_prompt: {
              type: 'string',
              description: 'Optional: negative prompt to guide what should NOT be in the image',
            },
            width: {
              type: 'number',
              description: 'Image width in pixels (default: 512)',
              default: 512,
            },
            height: {
              type: 'number',
              description: 'Image height in pixels (default: 512)',
              default: 512,
            },
            workflow_name: {
              type: 'string',
              description: 'Optional: name of the workflow file to use (e.g., "default_workflow.json"). If not specified, uses default_workflow.json',
            },
          },
          required: ['prompt'],
        },
      },
      {
        name: 'get_image',
        description:
          'Retrieve a generated image by its prompt ID. ' +
          'Returns the image data as base64-encoded string along with metadata.',
        inputSchema: {
          type: 'object',
          properties: {
            prompt_id: {
              type: 'string',
              description: 'The prompt_id returned from generate_image',
            },
          },
          required: ['prompt_id'],
        },
      },
      {
        name: 'get_request_history',
        description:
          'Retrieve the history of image generation requests made through this server. ' +
          'Shows all previous requests with their prompts, dimensions, timestamps, and current status. ' +
          'Useful for recovering lost prompt IDs or reviewing past generations.',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'list_workflows',
        description:
          'List all available workflow files in the workflow workspace directory. ' +
          'Shows which workflow is configured as the default.',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === 'generate_image') {
      const result = await generateImage(args, comfyClient, workflowLoader, requestHistory);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } else if (name === 'get_image') {
      const result = await getImage(args, comfyClient, requestHistory);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } else if (name === 'get_request_history') {
      const result = await getRequestHistory(requestHistory, comfyClient);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } else if (name === 'list_workflows') {
      const result = await listWorkflows(workflowLoader);
      return {
        content: [
          {
            type: 'text',
            text: result,
          },
        ],
      };
    } else {
      throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    // Log full error to stderr for debugging
    console.error(`Error in tool '${name}':`, errorMessage);
    if (errorStack) {
      console.error('Stack trace:', errorStack);
    }

    // Return user-friendly error with details
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              error: errorMessage,
              tool: name,
              details: 'Check server logs for more information',
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  // Check ComfyUI connectivity
  const isHealthy = await comfyClient.healthCheck();
  if (!isHealthy) {
    console.error(
      `Warning: Cannot connect to ComfyUI at ${config.comfyui.baseUrl}. Please ensure ComfyUI is running.`,
    );
    // Continue anyway - the error will be caught when tools are called
  }

  // Verify workflow workspace directory exists
  try {
    const workflows = await workflowLoader.listWorkflows();
    console.error(`Workflow workspace: ${config.workflow.workspaceDir}`);
    console.error(`Found ${workflows.length} workflow file(s)`);
    console.error(`Default workflow: ${config.workflow.defaultWorkflow}`);
  } catch (error) {
    console.error(`Warning: Failed to access workflow workspace: ${(error as Error).message}`);
    console.error(`Workspace directory: ${config.workflow.workspaceDir}`);
    // Continue anyway - the error will be caught when tools are called
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('ComfyUI MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
