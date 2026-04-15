# ComfyUI MCP — Add LoRA Support

## Context

Asset overhaul calibration (Pixel Farm LibGDX, 2026-04-12/13) showed FLUX.2 Klein 4B delivers strong painterly environments and pixel-art characters, but fails at isolated minimal subjects (pixel cubes, small icons). Research (Everypixel, fal.ai, Diffusion Doodles) confirms this is a **base-FLUX-family trait**, not a Klein-4B-specific flaw — swapping to Klein 9B, FLUX.2 Dev, or Qwen-Image 20B will not fix it. The practitioner-standard fix is a **pixel-art LoRA** stacked on top of FLUX. The MCP server currently has no LoRA support, which blocks that path.

## Goal

Add LoRA stacking (1–N LoRAs per request) to `comfyui_generate_image` without breaking the existing three-mode auto-detect (`txt2img`/`img2img`/`post-process`).

## Changes required

### 1. Workflow graph (`workflow_files/workflow.json`)
- Insert one or more `LoraLoader` nodes between `UNETLoader` (node `37`) + `CLIPLoader` (node `38`) and everything downstream.
  - New chain: `UNETLoader → LoraLoader → KSampler.model`, `CLIPLoader → LoraLoader → CLIPTextEncode.clip`.
- Keep a "bypass" state in the base workflow: `LoraLoader` present but `strength_model=0`, `strength_clip=0` so default runs behave identically when no LoRA is requested. Pruner can remove the node entirely when `loras` array is empty.

### 2. Tool schema (`src/utils/validation.ts`)
Extend `GenerateImageInputSchema` with:
```
loras?: Array<{
  name: string;            // filename under ComfyUI's models/loras/
  strength_model?: number; // default 1.0, clamp [-2, 2]
  strength_clip?: number;  // default = strength_model, clamp [-2, 2]
}>
```
Max array length 4 (stacked LoRAs beyond that rarely help and blow VRAM).

### 3. Workflow pruning (`src/workflows/workflow-loader.ts`)
Add a step between mode selection and post-processing:
- If `params.loras` is empty/undefined: strip `LoraLoader`, rewire `KSampler.model ← UNETLoader` and `CLIPTextEncode.clip ← CLIPLoader` directly.
- If `params.loras.length === N`: clone the `LoraLoader` node N times, chain them serially (each consumes the previous `MODEL`/`CLIP` outputs), set per-node `lora_name`, `strength_model`, `strength_clip`. Terminal node feeds `KSampler` and both `CLIPTextEncode`s.
- Existing dangling-reference validator already in place — use it as the safety net.

### 4. Discovery / validation
- New tool `comfyui_list_loras` (optional but high-value): calls `GET /object_info/LoraLoader` on ComfyUI, returns the `lora_name` enum (list of available LoRA filenames). Saves the assistant from guessing filenames.
- Or: make `generate_image` call `/object_info/LoraLoader` on first request with LoRAs and validate names, return a clear error listing available LoRAs when a name is missing.

### 5. Config
`COMFYUI_DEFAULT_LORAS` env var (comma-separated `name:strength` pairs, e.g. `"pixel-art-flux.safetensors:0.8"`) — always-applied LoRAs. Useful for per-project style locks. Explicit `loras:[]` in a request overrides (empty array = no LoRAs).

### 6. Docs
- Update `README.md`, `SETUP.md`, `ARCHITECTURE.md` §3.5 with the LoRA chain, new schema field, and the optional discovery tool.
- Update `scripts/setup-comfyui.sh` to `mkdir -p models/loras` and document where users should drop `.safetensors` LoRA files.

## Critical files
- `/home/alec/projects/comfyui-mcp/workflow_files/workflow.json` — add `LoraLoader` node, rewire model+clip edges
- `/home/alec/projects/comfyui-mcp/src/workflows/workflow-loader.ts` — pruning + cloning logic
- `/home/alec/projects/comfyui-mcp/src/utils/validation.ts` — Zod schema extension
- `/home/alec/projects/comfyui-mcp/src/tools/generate-image.ts` — pass `loras` through
- `/home/alec/projects/comfyui-mcp/src/tools/list-loras.ts` — NEW optional tool
- `/home/alec/projects/comfyui-mcp/src/index.ts` — register new tool
- `/home/alec/projects/comfyui-mcp/src/comfyui/client.ts` — add `getObjectInfo(nodeType)` helper
- `/home/alec/projects/comfyui-mcp/ARCHITECTURE.md` — document the change

## Verification
1. Unit: call `generate_image` with no `loras` — bit-identical output to pre-change (seed-locked regression test).
2. Integration: place a known pixel-art LoRA in `models/loras/`, call `generate_image` with `{prompt: "a red pixel cube", loras: [{name: "pixel-art.safetensors", strength_model: 0.9}]}`, verify output is visibly pixel-art vs no-LoRA baseline.
3. Chain: request two LoRAs simultaneously, confirm both apply (e.g. pixel-art + neon-glow) and no dangling refs.
4. Discovery: `list_loras` returns the filenames matching `ls models/loras/`.
5. Bypass path: `loras: []` explicitly passed → same as omitting the field.

---

## Pixel-art LoRA — how to get one for FLUX.2 Klein

**Short version:** FLUX.2-specific LoRAs are still rare (model is new). FLUX.1-Dev LoRAs are **not guaranteed** to load on FLUX.2 Klein — the underlying UNet architecture changed. Plan for either (a) waiting/searching for a FLUX.2-compatible LoRA, or (b) falling back to FLUX.1-Dev + a proven LoRA if Klein-compatible options don't exist yet.

**Search paths (ranked):**
1. **HuggingFace** — search `flux.2 pixel art lora`, `flux2 klein lora`, filter by recency (post-Nov 2025). Reliable authors to watch: `alvdansen`, `nerijs`, `XLabs-AI`, `Shakker-Labs`. Confirm **FLUX.2 Klein compatibility** in the model card before downloading — many list "FLUX.1-Dev" only.
2. **Civitai** — filter: Base Model = FLUX.2 Klein (when the filter exists), Category = LoRA, sort by downloads. `pixel art`, `16-bit`, `sprite` tags.
3. **Known FLUX.1 pixel-art LoRAs as a fallback** (require running FLUX.1-Dev, not Klein):
   - `nerijs/pixel-art-xl` (note: XL = SDXL, won't work on FLUX; check for a FLUX variant)
   - `alvdansen/flux-koda` (retro film style, not pixel-art per se)
   - `XLabs-AI/flux-RealismLora` (wrong direction — realism, avoid)
   - Search `flux pixel art lora site:huggingface.co` for current best picks.

**Install path (once the MCP supports LoRA):**
1. Download the `.safetensors` file from HuggingFace/Civitai.
2. Drop into `<ComfyUI>/models/loras/` (default `~/ComfyUI/models/loras/`).
3. Call `comfyui_list_loras` to confirm the filename is picked up.
4. Reference by filename in `generate_image` requests: `loras: [{name: "pixel-art-flux2.safetensors", strength_model: 0.8}]`.

**Testing protocol (3-shot calibration):**
- Baseline: no LoRA, prompt = "a single red pixel cube, 16-bit pixel art, centered, black backdrop"
- Test A: LoRA @ strength 0.6 — likely preserves subject, hints at style
- Test B: LoRA @ strength 1.0 — full style push, may over-stylize
- Pick whichever renders a clear pixel-grid silhouette with glow. Lock that strength for all P0.2-class assets.

**If no FLUX.2-Klein-compatible pixel-art LoRA exists:**
- Fallback plan: swap the bundled model to FLUX.1-Dev (setup script change), accept the ~24B parameter count (needs heavy offload on 16GB VRAM — GGUF Q4 ~11GB for the UNet), use a known-good FLUX.1-Dev pixel LoRA. This is a larger project — do only if post-2026-04-13 search turns up nothing Klein-compatible.

### Downstream verification (Pixel Farm side)
After pixel-art LoRA is installed and MCP supports LoRAs: regenerate the rejected `P0.2a red pixel tile` using the chosen LoRA. If output shows a crisp visible pixel grid with a clean square halo and proper cel-shaded faces, accept it and un-park the procedural-only plan for P0.2/P0.4/P3.1. Otherwise keep procedural path.
