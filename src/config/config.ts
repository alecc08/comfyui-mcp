import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface Config {
  comfyui: {
    baseUrl: string;
  };
  workflow: {
    workspaceDir: string;
    defaultWorkflow: string;
    randomizeSeeds: boolean;
  };
  mcp: {
    name: string;
    version: string;
  };
  http: {
    port: number;
    cacheDir: string;
  };
}

export function loadConfig(): Config {
  // Default workflow directory to workflow_files relative to dist/index.js
  const defaultWorkflowDir = resolve(__dirname, '../..', 'workflow_files');

  const config: Config = {
    comfyui: {
      baseUrl: process.env.COMFYUI_URL || 'http://127.0.0.1:8188',
    },
    workflow: {
      workspaceDir: process.env.COMFYUI_WORKFLOW_DIR || defaultWorkflowDir,
      defaultWorkflow: 'default_workflow.json',
      randomizeSeeds: process.env.COMFYUI_RANDOMIZE_SEEDS !== 'false',
    },
    mcp: {
      name: 'comfyui-mcp-server',
      version: '0.1.0',
    },
    http: {
      port: parseInt(process.env.COMFYUI_MCP_HTTP_PORT || '8190', 10),
      cacheDir: process.env.COMFYUI_IMAGE_CACHE_DIR || resolve(process.cwd(), 'image_cache'),
    },
  };

  return config;
}
