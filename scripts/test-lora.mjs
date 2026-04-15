#!/usr/bin/env node
// Drive the rebuilt MCP code end-to-end against a local ComfyUI.
// Usage: node scripts/test-lora.mjs [--with-lora]
import { randomBytes } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { ComfyUIClient } from '../dist/comfyui/client.js';
import { WorkflowLoader } from '../dist/workflows/workflow-loader.js';

const WITH_LORA = process.argv.includes('--with-lora');
const LORA_NAME = 'PixelArtV3Flux.safetensors';
const BASE = 'http://127.0.0.1:8188';
const client = new ComfyUIClient(BASE);
const loader = new WorkflowLoader('./workflow_files', 'workflow.json', 'workflow_edit.json', true);

const baseWorkflow = await loader.loadWorkflowForMode('txt2img');
const options = {
  prompt: 'a single red pixel cube on a pure black backdrop, centered, game asset',
  width: 512,
  height: 512,
};
if (WITH_LORA) {
  options.loras = [{ name: LORA_NAME, strength_model: 0.9 }];
}

const { workflow } = loader.prepareWorkflow(baseWorkflow, options);
const loraNodes = Object.entries(workflow).filter(([, n]) => n.class_type === 'LoraLoader');
console.log(`[prepare] mode=txt2img loraNodes=${loraNodes.length}`);

const clientId = randomBytes(16).toString('hex');
const resp = await client.queuePrompt(workflow, clientId);
const promptId = resp.prompt_id;
console.log(`[queue] prompt_id=${promptId}`);

const started = Date.now();
const timeoutMs = 15 * 60 * 1000;
while (true) {
  if (Date.now() - started > timeoutMs) throw new Error('timeout');
  await new Promise((r) => setTimeout(r, 2000));
  const h = await client.getHistory(promptId).catch(() => ({}));
  const entry = h[promptId];
  if (!entry) {
    process.stdout.write('.');
    continue;
  }
  console.log(`\n[done] status=${entry.status?.status_str} completed=${entry.status?.completed}`);
  if (!entry.status?.completed) {
    console.error(JSON.stringify(entry.status, null, 2));
    process.exit(1);
  }
  const outputs = entry.outputs || {};
  const imgs = [];
  for (const [nodeId, out] of Object.entries(outputs)) {
    if (Array.isArray(out.images)) for (const img of out.images) imgs.push({ nodeId, ...img });
  }
  console.log(`[images] ${imgs.length}`);
  mkdirSync('/tmp/lora-test', { recursive: true });
  for (const img of imgs) {
    const buf = await client.getImage(img.filename, img.subfolder || '', img.type || 'output');
    const suffix = WITH_LORA ? 'lora' : 'baseline';
    const path = `/tmp/lora-test/${suffix}-${img.filename}`;
    writeFileSync(path, buf);
    console.log(`  -> ${path} (${buf.length} bytes)`);
  }
  break;
}
console.log(`[ok] ${Date.now() - started}ms`);
