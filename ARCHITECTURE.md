# ComfyUI MCP Server — Architecture

This document describes the design of the ComfyUI MCP server at a design-doc
level. For operational details (commands, env vars, file layout) see
`CLAUDE.md`; for end-user documentation see `README.md` and `SETUP.md`.

## 1. Overview & Design Principles

The ComfyUI MCP server bridges MCP-compatible AI assistants (Claude Desktop,
Cline, Cursor, etc.) with a local [ComfyUI](https://github.com/comfyanonymous/ComfyUI)
instance. The server exposes three tools over MCP stdio transport:

- `comfyui_generate_image` — unified tool for text-to-image generation,
  image-to-image editing, and post-processing (auto-detected from parameters).
- `comfyui_get_image` — poll for the result of a queued job by `prompt_id`.
- `comfyui_get_request_history` — paginated list of past requests with
  current status.

Design principles:

1. **One unified workflow, dynamic pruning.** A single `workflow.json` holds
   every node used by every mode. At request time the workflow engine removes
   unused nodes and rewires connections. There is no mode-specific workflow
   file.
2. **HTTP URLs, not base64.** Generated images are served by a built-in
   Express proxy that fetches from ComfyUI on demand, caches to disk, and
   hands the AI assistant a plain HTTP URL. No base64 payloads flow through
   the MCP channel.
3. **Non-blocking by default, blocking on request.** `generate_image` queues
   the prompt and returns `{ prompt_id, status: 'queued' }` immediately.
   Clients poll via `comfyui_get_image`. Setting `wait: true` makes the tool
   block until the image is ready (or fails/times out) and return URLs in
   the same response.
4. **Fail soft at startup, strict at request time.** The server starts even
   if ComfyUI is unreachable or the workflow file is missing — errors surface
   when a tool is invoked, not during boot.
5. **Type safety end-to-end.** All tool inputs are validated with Zod;
   TypeScript strict mode is on throughout.

## 2. System Architecture

```
┌──────────────────────┐   MCP stdio    ┌────────────────────────────────┐
│   AI Assistant/LLM   │ ─────────────▶ │     ComfyUI MCP Server         │
│ (Claude, GPT, etc.)  │ ◀───────────── │      (this package)            │
└──────────────────────┘                │                                │
                                        │  ┌──────────────────────────┐  │
                                        │  │  MCP Protocol Layer      │  │
                                        │  │  (src/index.ts)          │  │
                                        │  └──────────┬───────────────┘  │
                                        │             │                  │
                                        │  ┌──────────▼───────────────┐  │
                                        │  │  Tool Layer              │  │
                                        │  │  generate_image          │  │
                                        │  │  get_image               │  │
                                        │  │  get_request_history     │  │
                                        │  └──────┬────────────┬──────┘  │
                                        │         │            │         │
                                        │    ┌────▼────┐  ┌────▼──────┐  │
                                        │    │Workflow │  │ ComfyUI   │  │
                                        │    │ Loader  │  │ Client    │  │
                                        │    └─────────┘  └────┬──────┘  │
                                        │                      │         │
                                        │    ┌─────────────────▼──────┐  │
                                        │    │  HTTP Image Server     │  │
                                        │    │  + Disk Image Cache    │  │
                                        │    └─────────────────┬──────┘  │
                                        └──────────────────────┼─────────┘
                                                               │
                                                               ▼
                                                   ┌───────────────────────┐
                                                   │  ComfyUI REST API     │
                                                   │  (localhost:8188)     │
                                                   └───────────────────────┘
                                                               ▲
                                        ┌──────────────────────┴─────────┐
                                        │  HTTP GET from AI assistant    │
                                        │  http://localhost:8190/images/…│
                                        └────────────────────────────────┘
```

The AI assistant communicates over the MCP stdio channel for tool calls and
over plain HTTP for image fetches. The server owns two processes worth of
state: an MCP server (stdio) and an Express image proxy (TCP).

## 3. Component Design

### 3.1 MCP Protocol Layer (`src/index.ts`)

Entry point. Responsibilities:

- Boot the MCP server using `@modelcontextprotocol/sdk` on stdio transport.
- Register the three tools with their Zod-derived input schemas and
  human-readable descriptions.
- Construct and wire singletons: `ComfyUIClient`, `WorkflowLoader`,
  `ImageServer`, and the in-memory request history array.
- Start the HTTP image proxy on `COMFYUI_MCP_HTTP_PORT`.

Each tool handler is a thin wrapper that delegates to `src/tools/*.ts`,
returns `content: [{ type: 'text', text: JSON.stringify(result) }]`, and
converts thrown errors into MCP `isError: true` responses.

### 3.2 Tool Layer (`src/tools/`)

#### `generate-image.ts` — `comfyui_generate_image`

Auto-detects mode from input:

| `prompt` | `image_path` | Mode           |
|----------|--------------|----------------|
| yes      | no           | `txt2img`      |
| yes      | yes          | `img2img`      |
| no       | yes          | `post-process` |
| no       | no           | error          |

Input schema (Zod, see `src/utils/validation.ts`):

```
prompt?            string
negative_prompt?   string
image_path?        string (absolute path)
width?             positive int
height?            positive int
remove_background? boolean
wait?              boolean (default false)
```

Flow:

1. Validate input, detect mode.
2. If `image_path` is set, upload the file to ComfyUI via `/upload/image`.
3. Call `WorkflowLoader.prepareWorkflow(mode, params)` to obtain a pruned,
   rewired workflow.
4. `POST /prompt` to ComfyUI; capture the returned `prompt_id`.
5. Record an entry in the in-memory request history.
6. If `wait: false` (default): return
   `{ prompt_id, status: 'queued', mode, queue_position? }`.
7. If `wait: true`: poll `GET /history/{prompt_id}` every
   `COMFYUI_POLL_INTERVAL_MS`, up to `GENERATION_TIMEOUT_MS` (~15 min).
   Return `{ prompt_id, status: 'completed', mode, images, duration_ms }`
   on success; throw on failure or timeout.

#### `get-image.ts` — `comfyui_get_image`

Primary polling tool for the non-blocking path. Given a `prompt_id`:

1. Check the live `/queue` endpoint for pending/executing items.
2. Check `/history/{prompt_id}` for completion metadata.
3. Return one of: `pending`, `executing`, `completed` (with `images[]` of
   HTTP URLs), `failed` (with `error`), or `not_found`.

#### `get-request-history.ts` — `comfyui_get_request_history`

Paginated read of the in-memory history (no persistence across restarts).
Takes `limit` (≤100, default 50) and `offset` (default 0). For each entry,
queries ComfyUI for current status so the response reflects reality rather
than just the stored state at queue time.

### 3.3 HTTP Image Server + Cache (`src/http/`)

`image-server.ts` — Express app with three routes:

- `GET /images/:prompt_id/:filename?subfolder=X&type=Y` — fetch an image
  from ComfyUI's `/view` endpoint on cache miss, stream bytes to the
  caller while writing to the disk cache.
- `GET /health` — liveness probe.
- `DELETE /cache` — wipe the image cache (debugging aid).

`image-cache.ts` — disk-backed cache rooted at `COMFYUI_IMAGE_CACHE_DIR`
(default `~/.cache/comfyui-mcp`). The cache is content-addressed by
`(prompt_id, filename, subfolder, type)`.

Why a proxy instead of raw `/view` links? Two reasons:

1. The AI assistant may run on a different machine than ComfyUI; the MCP
   process is the only component guaranteed to reach both.
2. Caching avoids re-fetching the same image across repeated `get_image`
   calls and across assistant sessions.

### 3.4 ComfyUI Client (`src/comfyui/client.ts`)

Plain `fetch`-based HTTP client. No WebSocket dependency. Methods:

- `queuePrompt(workflow)` — `POST /prompt` with `{prompt, client_id}`.
- `uploadImage(filePath)` — `POST /upload/image` multipart.
- `getQueue()` — `GET /queue`.
- `getHistory(promptId)` — `GET /history/{id}`.
- `getImage(...)` — used by the image server to stream from `/view`.

A shared history-entry classifier lives in `src/comfyui/status.ts` and maps
raw history payloads to one of `executing`, `error`, `completed`.

### 3.5 Workflow Engine (`src/workflows/workflow-loader.ts`)

Single source of workflow truth. Loads `workflow.json` once, then for each
request calls `prepareWorkflow(mode, params)` to produce a per-request
pruned graph.

**Target model.** The bundled workflow is wired for **FLUX.2 [klein] 4B**:

- `flux-2-klein-base-4b.safetensors` (UNETLoader)
- `qwen_3_4b.safetensors` (CLIPLoader, type `flux2`)
- `flux2-vae.safetensors` (VAELoader)

`scripts/setup-comfyui.sh` downloads all three from the
`Comfy-Org/flux2-klein-4B` HuggingFace repo and installs `ComfyUI-RMBG`.

**Full node set.**

- Model loading: `UNETLoader`, `CLIPLoader`, `VAELoader`
- txt2img path: `EmptyFlux2LatentImage` → `KSampler`
- img2img path: `LoadImage` → `VAEEncode` → `KSampler`
  (Flux 2 Klein edit: `ReferenceLatent` + `CFGGuider` preserves subject
  identity natively — there is no denoise knob)
- Core generation: `CLIPTextEncode` (pos/neg) → `KSampler` → `VAEDecode`
- Post-processing: `RMBG` (background removal), `ImageScale` (resize)
- Output: `SaveImage`

**Pruning algorithm.**

Step 1 — select input branch:

- `txt2img`: remove `LoadImage`, `VAEEncode`. Point
  `KSampler.latent_image` at `EmptyFlux2LatentImage`. Compute aspect-
  ratio-aware generation dimensions (see §6.2).
- `img2img`: remove `EmptyFlux2LatentImage`. Rewire
  `KSampler.latent_image` to `VAEEncode`. Upload the input image and set
  the `LoadImage` filename.
- `post-process`: remove the entire generation pipeline (`KSampler`, both
  `CLIPTextEncode` nodes, `VAEEncode`, `VAEDecode`, all model loaders).
  Keep only `LoadImage` → post-processing → `SaveImage`.

Step 2 — build post-processing chain starting from `VAEDecode` (generation
modes) or `LoadImage` (post-process mode):

1. If `remove_background`: keep `RMBG`, wire to `lastNode`. Else remove it.
2. If `width`/`height` set: keep `ImageScale`, wire to `lastNode`, set
   target dimensions. Else remove it.
3. Wire `SaveImage` to the final `lastNode`.

Step 3 — LoRA injection (`applyLoras`): if `options.loras` is non-empty and
both `UNETLoader` + `CLIPLoader` are still present (i.e. not post-process
mode), clone one `LoraLoader` node per entry with fresh IDs starting at
`max(existing) + 1`. Chain them serially — each consumes the previous
`(MODEL, CLIP)` pair — then rewire every existing consumer of
`[UNETLoader, 0]` / `[CLIPLoader, 0]` to point at the terminal
`LoraLoader` outputs 0 / 1 respectively. The consumer scan is generic
over `class_type`, so the same code handles `KSampler.model`,
`CFGGuider.model` (edit workflow), and both `CLIPTextEncode.clip`
inputs. An empty/omitted `loras` array is a no-op, keeping no-LoRA
requests bit-identical to pre-change.

Step 4 — validation: scan remaining nodes for any `[nodeId, outputIdx]`
reference whose target no longer exists. A dangling reference throws
before the workflow is queued.

**LoRA schema (input).** `loras: Array<{ name, strength_model?, strength_clip? }>`,
max length 4, strengths clamped to `[-2, 2]`. `strength_clip` defaults to
`strength_model`. `strength_model` itself defaults to `1.0`. Distinguish
"omitted" (→ fall back to `COMFYUI_DEFAULT_LORAS`) from "explicit empty
array" (→ no LoRAs, overrides defaults) in Zod by not applying a default.

**LoRA discovery.** `comfyui_list_loras` calls
`GET /object_info/LoraLoader` and returns the `lora_name` enum. The
`generate_image` tool re-uses this endpoint to validate requested names
before queuing and throws with a complete list of available filenames
when one is missing.

**Prompt injection.** Trace `KSampler.positive` and `KSampler.negative`
links to their `CLIPTextEncode` nodes and set `inputs.text`.

**Seed randomization.** Scan every node for a `seed` input and replace it
with a random 64-bit value. Disabled via `COMFYUI_RANDOMIZE_SEEDS=false`.

### 3.6 Config Layer (`src/config/config.ts`)

Reads environment variables at boot, applies defaults, and exposes a
typed config object. Relevant settings:

| Variable                   | Default                  | Purpose |
|----------------------------|--------------------------|---------|
| `COMFYUI_URL`              | `http://127.0.0.1:8188`  | Upstream ComfyUI base URL |
| `COMFYUI_WORKFLOW_DIR`     | `<repo>/workflow_files`  | Where `workflow.json` lives |
| `COMFYUI_MCP_HTTP_PORT`    | `8190`                   | Port for the built-in image proxy |
| `COMFYUI_IMAGE_CACHE_DIR`  | `~/.cache/comfyui-mcp`   | Disk image cache root |
| `COMFYUI_RANDOMIZE_SEEDS`  | `true`                   | Randomize `seed` inputs per request |
| `COMFYUI_DEFAULT_LORAS`    | *(none)*                 | Comma-separated `name:strength` LoRA defaults, applied when a request omits `loras`. |
| `COMFYUI_POLL_INTERVAL_MS` | `2000`                   | Interval between ComfyUI status checks while blocking in `wait: true` mode |

## 4. Data Flow

### 4.1 Text-to-image (`txt2img`)

1. Assistant calls `comfyui_generate_image` with `prompt` (optionally
   `width`, `height`, `remove_background`, `wait`).
2. `WorkflowLoader.prepareWorkflow('txt2img', params)` prunes the graph
   and computes generation dimensions.
3. `ComfyUIClient.queuePrompt()` posts to `/prompt`.
4. History entry recorded; `prompt_id` returned.
5. If `wait: false`: response is `{ prompt_id, status: 'queued', mode,
   queue_position? }`. Assistant polls `comfyui_get_image`.
6. If `wait: true`: server polls `/history/{id}` every
   `COMFYUI_POLL_INTERVAL_MS` until done or timeout, then returns
   `{ prompt_id, status: 'completed', mode, images, duration_ms }`.

### 4.2 Image-to-image (Flux 2 Klein edit)

1. Assistant calls with `prompt` + `image_path` (+ optional sizing flags).
2. Client uploads the image via `/upload/image`.
3. Workflow pruned for `img2img`: `LoadImage` + `VAEEncode` kept,
   `EmptyFlux2LatentImage` removed, `KSampler.latent_image` rewired.
4. The Flux 2 Klein edit pattern (`ReferenceLatent` + `CFGGuider`) runs;
   subject identity is preserved without a denoise parameter.
5. Same queued-vs-completed response split as §4.1.

### 4.3 Post-processing only

1. Assistant calls with `image_path` (no `prompt`), plus any of `width`,
   `height`, `remove_background`.
2. Image uploaded; entire generation pipeline pruned from the workflow.
3. Remaining chain: `LoadImage` → optional `RMBG` → optional `ImageScale`
   → `SaveImage`.
4. Same queued-vs-completed response split as §4.1.

### 4.4 Image retrieval

1. Assistant calls `comfyui_get_image(prompt_id)`.
2. Tool checks `/queue` (pending/executing) and `/history/{id}`
   (completed/failed).
3. On completion, tool constructs image URLs of the form
   `http://localhost:8190/images/{prompt_id}/{filename}?subfolder=…&type=…`.
4. Assistant fetches those URLs over HTTP; image server serves from cache
   or fetches from ComfyUI `/view` on a cache miss.

## 5. API Specifications

### 5.1 ComfyUI REST endpoints used

| Method | Path                    | Purpose |
|--------|-------------------------|---------|
| POST   | `/prompt`               | Queue a workflow (`{prompt, client_id}`) |
| POST   | `/upload/image`         | Upload an image (multipart/form-data) |
| GET    | `/queue`                | List pending and running jobs |
| GET    | `/history/{prompt_id}`  | Execution status + output metadata |
| GET    | `/view`                 | Stream a generated image (`filename`, `subfolder`, `type`) |

No WebSocket endpoints are used.

### 5.2 Built-in HTTP image server

| Method | Path                                   | Purpose |
|--------|----------------------------------------|---------|
| GET    | `/images/:prompt_id/:filename`         | Proxy an image (cached on first hit) |
| GET    | `/health`                              | Liveness probe |
| DELETE | `/cache`                               | Wipe the on-disk cache (debug only) |

Query parameters on `/images/...`: `subfolder`, `type` (mirrors ComfyUI's
`/view` contract).

## 6. Workflow Management

### 6.1 Single unified workflow

Only one workflow file ships with the project: `workflow_files/workflow.json`.
It must contain every node any mode could need. Exporting from ComfyUI
uses the "Save (API Format)" button. Node additions that break the
prepare-and-prune algorithm will be caught by the dangling-reference
validator before the workflow hits ComfyUI.

### 6.2 Aspect-ratio strategy for `txt2img`

When `width` and `height` are given:

1. `ratio = width / height`
2. `genHeight = sqrt(1024² / ratio)`, `genWidth = ratio × genHeight`
3. Round each to the nearest multiple of 64, clamp to `[512, 2048]`.
4. Apply to `EmptyFlux2LatentImage`.
5. `ImageScale` resizes the final output to the exact requested dimensions.

Examples:

- `1920×1080` → generate `1344×768` → resize `1920×1080`
- `1080×1920` → generate `768×1344` → resize `1080×1920`
- `1024×1024` → generate `1024×1024` (no resize needed)
- `512×512` → generate `1024×1024` → resize `512×512`

When neither is given: generate `1024×1024`, no resize.

## 7. Error Handling & Timeouts

- **Startup errors are non-fatal.** If ComfyUI is down or `workflow.json`
  is missing, the MCP server still boots and registers tools. Errors
  surface on the first tool call that needs the missing resource.
- **Tool errors** are returned as MCP tool responses with `isError: true`
  and a JSON `{ error: message }` payload. The assistant sees a normal
  tool result, not a transport error.
- **`wait: true` timeouts.** `GENERATION_TIMEOUT_MS` (~15 min, defined in
  `src/utils/timeout.ts`) bounds how long the server will block. On
  timeout the tool throws; the job may still complete in ComfyUI and
  remain retrievable via `comfyui_get_image`.
- **Dangling workflow references** throw synchronously during
  `prepareWorkflow`, before the prompt is queued.
- **Request history** is purely in-memory: a server restart drops it.
  `comfyui_get_request_history` always re-queries ComfyUI for current
  status so stale in-memory state cannot mislead the caller.

## 8. Type Safety

- Tool input shapes are defined once, as Zod schemas in
  `src/utils/validation.ts` (`GenerateImageInputSchema`,
  `GetImageInputSchema`, `GetRequestHistoryInputSchema`). TypeScript
  types are inferred with `z.infer<…>`.
- ComfyUI response shapes live in `src/comfyui/types.ts`.
- TypeScript strict mode is enabled project-wide.
- The MCP SDK's tool registration consumes the Zod `shape`, so input
  validation and the advertised tool schema stay in lock-step.
