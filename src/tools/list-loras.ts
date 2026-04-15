import type { ComfyUIClient } from '../comfyui/client.js';

export interface ListLorasOutput {
  loras: string[];
}

/**
 * Read the LoraLoader.lora_name enum from ComfyUI's /object_info endpoint.
 * Shape: info['LoraLoader'].input.required.lora_name[0] is the list of
 * available .safetensors filenames under ComfyUI's models/loras/.
 */
export async function listLoras(client: ComfyUIClient): Promise<ListLorasOutput> {
  const info = await client.getObjectInfo('LoraLoader');
  const node = info?.LoraLoader ?? info;
  const enumField = node?.input?.required?.lora_name;
  const names = Array.isArray(enumField) && Array.isArray(enumField[0]) ? enumField[0] : [];
  return { loras: names as string[] };
}
