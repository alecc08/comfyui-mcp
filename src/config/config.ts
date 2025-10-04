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
  };
  mcp: {
    name: string;
    version: string;
  };
}

export function loadConfig(): Config {
  const config: Config = {
    comfyui: {
      baseUrl: process.env.COMFYUI_URL || 'http://127.0.0.1:8188',
    },
    workflow: {
      workspaceDir: process.env.COMFYUI_WORKFLOW_DIR || resolve(process.cwd(), 'workflow_files'),
      defaultWorkflow: 'default_workflow.json',
    },
    mcp: {
      name: 'comfyui-mcp-server',
      version: '0.1.0',
    },
  };

  return config;
}
