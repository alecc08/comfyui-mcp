# ComfyUI MCP Server Workflows

This directory contains workflow JSON files in API format for use with the ComfyUI MCP Server.

## Current Workflows

### ✅ Ready to Use

1. **default_workflow.json** - Text-to-image generation
   - Uses Qwen Image model (UNET + CLIP + VAE loaders)
   - Works with `generate_image` tool
   - No additional setup required

2. **img2img_workflow.json** - Image-to-image transformation
   - Uses Qwen Image model
   - Works with `modify_image` tool
   - Supports denoise strength control (0.0-1.0)
   - No additional setup required

3. **resize_workflow.json** - Simple image resizing/downscaling
   - Uses ImageScale node (built-in)
   - Works with `resize_image` tool (method="downscale")
   - No additional setup required

### ⚠️ Requires Additional Setup

4. **upscale_workflow.json** - High-quality AI upscaling
   - Works with `resize_image` tool (method="upscale")
   - **REQUIRES**: RealESRGAN upscale models
   - See "Upscale Model Setup" below

5. **remove_background_workflow.json** - Background removal
   - Works with `remove_background` tool
   - **REQUIRES**: Background removal extension
   - See "Background Removal Setup" below

## Setup Instructions

### Upscale Model Setup

**What you need:**
- Upscale models (RealESRGAN or similar)
- No custom nodes required (built-in nodes only)

**Step 1: Download Models**

Choose one or more upscale models:

| Model | Scale | Size | Best For | Download Link |
|-------|-------|------|----------|---------------|
| RealESRGAN_x4plus.pth | 4x | 64MB | **RECOMMENDED** - General use | [Download](https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth) |
| RealESRGAN_x2plus.pth | 2x | 64MB | 2x upscaling | [Download](https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x2plus.pth) |
| 4x-UltraSharp.pth | 4x | 67MB | Alternative 4x | Find on [OpenModelDB](https://openmodeldb.info) |

**Step 2: Install Models**

Place downloaded `.pth` files in the ComfyUI upscale models directory:

```
ComfyUI/
└── models/
    └── upscale_models/           ← Create if doesn't exist
        ├── RealESRGAN_x4plus.pth  ← Place here
        └── RealESRGAN_x2plus.pth  ← Optional
```

**Windows path example:**
```
C:\ComfyUI\models\upscale_models\RealESRGAN_x4plus.pth
```

**macOS/Linux path example:**
```
/home/user/ComfyUI/models/upscale_models/RealESRGAN_x4plus.pth
```

**Step 3: Verify Installation**

1. **Restart ComfyUI** (important!)
2. Open `upscale_workflow.json` in ComfyUI (drag and drop)
3. Check the **UpscaleModelLoader** node
4. The dropdown should show "RealESRGAN_x4plus.pth"
5. Queue prompt to test - should upscale without errors

**Troubleshooting:**
- **Model not showing in dropdown?** → Restart ComfyUI
- **Wrong directory?** → Check the ComfyUI console for the exact models path
- **File extension wrong?** → Must be `.pth`, not `.pth.txt` or other

---

### Background Removal Setup

**What you need:**
- Background removal custom node extension
- Models (auto-downloaded by extension)

#### Option 1: RemBG (Recommended - Easiest)

**Extension Details:**
- **Name:** ComfyUI rembg
- **Author:** Jcd1230
- **GitHub:** https://github.com/Jcd1230/rembg-comfyui-node
- **Node Name:** `Image Remove Background (rembg)`
- **Model Size:** ~176MB (auto-downloaded)
- **Quality:** Good
- **Setup:** ⭐ Easy

**Installation Steps:**

1. **Open ComfyUI Manager:**
   - Open ComfyUI in your browser
   - Click the **"Manager"** button (usually in the sidebar)

2. **Install Custom Node:**
   ```
   Manager → Install Custom Nodes → Search "rembg"
   → Find "ComfyUI rembg" by Jcd1230
   → Click Install
   → Wait for installation to complete
   ```

3. **Restart ComfyUI:**
   - Close ComfyUI completely
   - Restart the ComfyUI server
   - Reload the browser page

4. **Models Auto-Download:**
   - On first use, the extension downloads the model (~176MB)
   - This happens automatically when you queue a prompt
   - Wait for download to complete (check ComfyUI console)

5. **Verify:**
   - Load `remove_background_workflow.json` in ComfyUI
   - You should see the node "Image Remove Background (rembg)"
   - Queue prompt to test

**The workflow is already configured for this option!**

---

#### Option 2: ComfyUI-RMBG (Best Quality)

**Extension Details:**
- **Name:** ComfyUI-RMBG
- **Author:** 1038lab
- **GitHub:** https://github.com/1038lab/ComfyUI-RMBG
- **Supported Models:** BiRefNet, RMBG-2.0, InSPyReNet, BEN, BEN2, and more
- **Model Size:** 300-500MB per model
- **Quality:** Excellent (best quality)

**Installation Steps:**

1. **Install via ComfyUI Manager:**
   ```
   Manager → Install Custom Nodes → Search "RMBG"
   → Find "ComfyUI-RMBG" by 1038lab
   → Click Install
   → Restart ComfyUI
   ```

2. **Models Auto-Download:**
   - Models download automatically on first use
   - Or manually download from extension's GitHub repo
   - BiRefNet models: https://huggingface.co/ZhengPeng7/BiRefNet/tree/main

3. **Update Workflow:**
   Since the workflow expects RemBG, you need to update it:

   a. Open `remove_background_workflow.json` in ComfyUI

   b. Find node "2" (the background removal node)

   c. Replace with your installed RMBG node:
      - Delete the RemBG node
      - Add your RMBG node (e.g., "BiRefNet", "RMBG Remove Background")
      - Reconnect: LoadImage → RMBG Node → SaveImage

   d. Save (API Format):
      - Enable "Dev mode Options" in Settings
      - Click "Save (API Format)"
      - Save over `remove_background_workflow.json`

4. **Verify:**
   - Queue a test prompt in ComfyUI
   - Check output has transparent background

---

#### Option 3: ComfyUI-RemoveBackground_SET (Alternative)

**Extension Details:**
- **Name:** ComfyUI-RemoveBackground_SET
- **Author:** set-soft
- **GitHub:** https://github.com/set-soft/ComfyUI-RemoveBackground_SET
- **Supported Models:** BiRefNet, BRIA, Depth Anything V2, InSPyReNet, MODNet, etc.
- **Quality:** Excellent (multiple options)

**Installation:**
```
Manager → Install Custom Nodes → Search "RemoveBackground"
→ Install "ComfyUI-RemoveBackground_SET" by set-soft
→ Restart ComfyUI
→ Follow similar update process as Option 2
```

---

### Model Storage Locations

After installing extensions, models are stored in:

```
ComfyUI/
├── models/
│   ├── upscale_models/            ← RealESRGAN models
│   │   └── RealESRGAN_x4plus.pth
│   └── RMBG/                      ← Background removal models (if using RMBG)
│       └── BiRefNet/
│           └── (model files auto-download here)
└── custom_nodes/
    ├── rembg-comfyui-node/        ← RemBG extension (Option 1)
    ├── ComfyUI-RMBG/              ← OR RMBG extension (Option 2)
    └── ComfyUI-RemoveBackground_SET/  ← OR this extension (Option 3)
```

**Note:** Background removal extensions usually auto-download models to their own directories within the extension folder.

## Customizing Workflows

### How to Modify Workflows

1. **Open in ComfyUI:**
   - Drag the JSON file into ComfyUI, OR
   - File → Open → Select the workflow JSON

2. **Make Changes:**
   - Modify nodes, connections, parameters
   - Change models (checkpoint, VAE, etc.)
   - Add/remove nodes

3. **Export:**
   - **IMPORTANT**: Enable "Dev mode Options" in Settings
   - Click "Save (API Format)"
   - Replace the original file

### Common Customizations

**Change Models:**
- Edit the model filenames in UNET/CLIP/VAE loader nodes
- Make sure models exist in your ComfyUI models directory

**Adjust Quality Settings:**
- KSampler: steps (10-50), cfg (1.5-8.0)
- Denoise: 0.75 default for img2img (adjust in workflow or via tool parameter)

**Change Samplers:**
- KSampler: sampler_name, scheduler
- Common: euler, dpmpp_2m, dpmpp_3m_sde

## Workflow Parameter Injection

The MCP server automatically injects parameters into these workflows:

| Workflow | Injected Parameters |
|----------|-------------------|
| default_workflow.json | prompt, negative_prompt, width, height, seed (random) |
| img2img_workflow.json | prompt, negative_prompt, input_image, denoise_strength, seed (random) |
| upscale_workflow.json | input_image, scale_factor |
| resize_workflow.json | input_image, width, height |
| remove_background_workflow.json | input_image |

The server uses intelligent node tracing to find the correct nodes:
- Finds KSampler and traces positive/negative connections for prompts
- Finds LoadImage for input images
- Finds EmptyLatentImage for dimensions
- Randomizes all seed values (unless disabled)

## Complete ComfyUI Directory Structure

Here's the complete directory structure showing where all models and custom nodes should be placed:

```
ComfyUI/                                    # Main ComfyUI installation directory
│
├── models/                                 # All model files go here
│   │
│   ├── checkpoints/                        # Standard SD checkpoint models
│   │   ├── sd_xl_base_1.0.safetensors     # SDXL checkpoint example
│   │   ├── sd_v1-5.safetensors            # SD 1.5 checkpoint example
│   │   └── flux_dev.safetensors           # Flux checkpoint example
│   │
│   ├── unet/                               # UNET models (for split models like Qwen)
│   │   └── qwen_image_fp8_e4m3fn.safetensors   # Used by default_workflow.json
│   │
│   ├── clip/                               # CLIP models (for split models)
│   │   └── qwen_2.5_vl_7b_fp8_scaled.safetensors   # Used by default_workflow.json
│   │
│   ├── vae/                                # VAE models (for split models)
│   │   ├── qwen_image_vae.safetensors     # Used by default_workflow.json
│   │   └── sdxl_vae.safetensors           # Optional VAE override
│   │
│   ├── upscale_models/                     # ⚠️ FOR UPSCALING - Download these!
│   │   ├── RealESRGAN_x4plus.pth          # 4x upscale (RECOMMENDED)
│   │   ├── RealESRGAN_x2plus.pth          # 2x upscale (optional)
│   │   └── 4x-UltraSharp.pth              # Alternative 4x (optional)
│   │
│   ├── loras/                              # LoRA models (optional)
│   │   └── (your LoRA files)
│   │
│   ├── controlnet/                         # ControlNet models (if using ControlNet)
│   │   └── (ControlNet model files)
│   │
│   └── RMBG/                               # ⚠️ Background removal models (auto-created)
│       └── BiRefNet/                       # BiRefNet models (if using RMBG extension)
│           └── (model files auto-downloaded here)
│
├── custom_nodes/                           # Custom node extensions
│   │
│   ├── ComfyUI-Manager/                    # ComfyUI Manager (highly recommended)
│   │
│   ├── rembg-comfyui-node/                 # ⚠️ RemBG extension (Option 1)
│   │   └── (extension files)               # Install via Manager for background removal
│   │
│   ├── ComfyUI-RMBG/                       # ⚠️ OR RMBG extension (Option 2)
│   │   └── (extension files)               # Alternative for background removal
│   │
│   └── ComfyUI-RemoveBackground_SET/       # ⚠️ OR this extension (Option 3)
│       └── (extension files)               # Another alternative
│
├── input/                                  # Uploaded images go here (auto-managed by MCP server)
│   └── (uploaded image files)
│
├── output/                                 # Generated images saved here
│   └── (output images from workflows)
│
└── temp/                                   # Temporary files
    └── (temporary processing files)
```


### Model Requirements by Workflow

| Workflow | Required Models | Required Extensions | Directory |
|----------|----------------|---------------------|-----------|
| default_workflow.json | Qwen Image (UNET+CLIP+VAE) OR any SD checkpoint | None | `models/unet/`, `models/clip/`, `models/vae/` OR `models/checkpoints/` |
| img2img_workflow.json | Same as above | None | Same as above |
| resize_workflow.json | None | None | N/A |
| upscale_workflow.json | RealESRGAN_x4plus.pth | None | `models/upscale_models/` |
| remove_background_workflow.json | Auto-downloaded | rembg OR RMBG | `custom_nodes/` |

### Finding Your ComfyUI Directory

**If you're not sure where ComfyUI is installed:**

1. **Check the terminal/console** where you run ComfyUI
2. Look for a line like:
   ```
   Total VRAM 16384 MB, total RAM 32768 MB
   pytorch version: 2.1.0+cu121
   Set vram state to: NORMAL_VRAM
   Device: cuda:0 NVIDIA GeForce RTX 3080 : cudaMallocAsync
   VAE dtype: torch.float32
   Using xformers cross attention
   ```
3. The models path is usually shown when models are loaded
4. **Or** check the ComfyUI web interface console (F12) for path information

### Quick Reference: What Goes Where

| Model Type | File Extension | Directory |
|------------|----------------|-----------|
| SD/SDXL Checkpoint | `.safetensors`, `.ckpt` | `models/checkpoints/` |
| UNET | `.safetensors` | `models/unet/` |
| CLIP | `.safetensors` | `models/clip/` |
| VAE | `.safetensors` | `models/vae/` |
| Upscale Models | `.pth` | `models/upscale_models/` |
| LoRA | `.safetensors` | `models/loras/` |
| ControlNet | `.safetensors`, `.pth` | `models/controlnet/` |
| Background Removal | Auto-managed | `models/RMBG/` or in extension folder |

## Troubleshooting

### Workflow Won't Load in ComfyUI

**Problem:** Error when dragging JSON into ComfyUI

**Solutions:**
- Make sure it's in API format (not UI format)
- Check for missing custom nodes
- Verify model files exist
- Check ComfyUI console for specific errors

### Missing Nodes Error

**Problem:** "Node type not found" errors

**Solutions:**
- Install required custom nodes via ComfyUI Manager
- For background removal: Install rembg or BiRefNet extension
- Restart ComfyUI after installing nodes

### Models Not Found

**Problem:** Model dropdown shows empty or missing files

**Solutions:**
- Download required models
- Place in correct ComfyUI/models/ subdirectory
- Restart ComfyUI to refresh model list

### MCP Server Can't Find Workflow

**Problem:** Tool returns "workflow not found" error

**Solutions:**
- Verify file is in this directory
- Check filename matches exactly (case-sensitive)
- Ensure `COMFYUI_WORKFLOW_DIR` environment variable points here

## Testing Workflows

Before using with the MCP server, test workflows manually in ComfyUI:

1. **Load workflow** in ComfyUI
2. **Queue Prompt** to ensure it runs without errors
3. **Verify output** image is generated correctly
4. **Test with MCP server** using the appropriate tool

## File Format

All workflows in this directory must be in **API Format** (not UI format):

**API Format** (Correct):
```json
{
  "1": {
    "inputs": { ... },
    "class_type": "NodeName"
  }
}
```

**UI Format** (Wrong):
```json
{
  "nodes": [
    {
      "id": 1,
      "type": "NodeName",
      "pos": [x, y]
    }
  ]
}
```

To convert UI format to API format:
1. Enable "Dev mode Options" in ComfyUI Settings
2. Load UI format workflow
3. Click "Save (API Format)"

## Additional Resources

- **ComfyUI Documentation**: https://docs.comfy.org
- **ComfyUI Examples**: https://comfyanonymous.github.io/ComfyUI_examples/
- **Upscale Models**: https://openmodeldb.info
- **Custom Nodes**: Install via ComfyUI Manager

## Support

If you have issues:
1. Check ComfyUI console for errors
2. Test workflow directly in ComfyUI first
3. Verify all required models/nodes are installed
4. Check MCP server logs for parameter injection errors
