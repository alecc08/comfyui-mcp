import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import os from 'os';
import { GENERATION_TIMEOUT_MS } from '../utils/timeout.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface Config {
  comfyui: {
    baseUrl: string;
  };
  workflow: {
    workspaceDir: string;
    defaultWorkflow: string;
    editWorkflow: string;
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
  polling: {
    intervalMs: number;
    maxDurationMs: number;
  };
  lora: {
    defaults: Array<{ name: string; strength_model: number; strength_clip?: number }>;
  };
}

/**
 * Parse `COMFYUI_DEFAULT_LORAS`: comma-separated `name:strength` pairs.
 * Bad entries are skipped with a warning.
 */
function parseDefaultLoras(raw: string | undefined): Array<{ name: string; strength_model: number }> {
  if (!raw) return [];
  const out: Array<{ name: string; strength_model: number }> = [];
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const lastColon = trimmed.lastIndexOf(':');
    if (lastColon < 0) {
      out.push({ name: trimmed, strength_model: 1.0 });
      continue;
    }
    const name = trimmed.slice(0, lastColon).trim();
    const strength = parseFloat(trimmed.slice(lastColon + 1).trim());
    if (!name || isNaN(strength)) {
      console.error(`Ignoring malformed COMFYUI_DEFAULT_LORAS entry: "${trimmed}"`);
      continue;
    }
    out.push({ name, strength_model: strength });
  }
  return out;
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
      defaultWorkflow: 'workflow.json',
      editWorkflow: 'workflow_edit.json',
      randomizeSeeds: process.env.COMFYUI_RANDOMIZE_SEEDS !== 'false',
    },
    mcp: {
      name: 'comfyui-mcp-server',
      version: '0.1.0',
    },
    http: {
      port: parseInt(process.env.COMFYUI_MCP_HTTP_PORT || '8190', 10),
      cacheDir: process.env.COMFYUI_IMAGE_CACHE_DIR || resolve(os.homedir(), '.cache', 'comfyui-mcp'),
    },
    polling: {
      intervalMs: parseInt(process.env.COMFYUI_POLL_INTERVAL_MS || '2000', 10),
      maxDurationMs: GENERATION_TIMEOUT_MS,
    },
    lora: {
      defaults: parseDefaultLoras(process.env.COMFYUI_DEFAULT_LORAS),
    },
  };

  return config;
}
