# Complete Setup Guide

This guide will walk you through setting up the ComfyUI MCP Server from scratch, including ComfyUI installation, model downloads, and MCP server configuration.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Step 1: Install ComfyUI](#step-1-install-comfyui)
3. [Step 2: Download AI Models](#step-2-download-ai-models)
4. [Step 3: Install ComfyUI Custom Nodes](#step-3-install-comfyui-custom-nodes)
5. [Step 4: Install MCP Server](#step-4-install-mcp-server)
6. [Step 5: Configure MCP Client](#step-5-configure-mcp-client)
7. [Step 6: Test the Setup](#step-6-test-the-setup)
8. [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before you begin, ensure you have:

- **Operating System**: Windows, macOS, or Linux
- **Python**: 3.10 or 3.11 (recommended)
- **Node.js**: v18 or higher (for the MCP server)
- **Git**: For cloning repositories
- **Disk Space**: At least 20GB free (for ComfyUI, models, and workflows)
- **GPU**: NVIDIA GPU with 6GB+ VRAM (recommended) or CPU (slower)
- **RAM**: 16GB minimum, 32GB recommended

---

## Step 1: Install ComfyUI

ComfyUI is the image generation backend that powers this MCP server.

### Option A: Portable Installation (Windows - Recommended)

1. **Download ComfyUI Portable:**
   - Visit the [ComfyUI Releases](https://github.com/comfyanonymous/ComfyUI/releases) page
   - Download the latest portable version:
     - **NVIDIA GPU**: `ComfyUI_windows_portable_nvidia_cu121_or_cpu.7z`
     - **AMD GPU**: `ComfyUI_windows_portable_amd.7z`
     - **CPU Only**: Use the NVIDIA version, it works on CPU too

2. **Extract the archive:**
   ```bash
   # Extract to a folder like C:\ComfyUI
   # Use 7-Zip or WinRAR to extract the .7z file
   ```

3. **Run ComfyUI:**
   ```bash
   # Double-click run_nvidia_gpu.bat (or run_cpu.bat for CPU)
   # Or from command line:
   cd C:\ComfyUI
   run_nvidia_gpu.bat
   ```

4. **Verify it's running:**
   - Open your browser to `http://127.0.0.1:8188`
   - You should see the ComfyUI interface

### Option B: Manual Installation (macOS/Linux or Advanced Users)

1. **Clone ComfyUI:**
   ```bash
   git clone https://github.com/comfyanonymous/ComfyUI.git
   cd ComfyUI
   ```

2. **Create Python virtual environment:**
   ```bash
   python -m venv venv

   # Windows
   venv\Scripts\activate

   # macOS/Linux
   source venv/bin/activate
   ```

3. **Install dependencies:**
   ```bash
   # For NVIDIA GPU (CUDA)
   pip install torch torchvision torchaudio --extra-index-url https://download.pytorch.org/whl/cu121
   pip install -r requirements.txt

   # For macOS (MPS)
   pip install torch torchvision torchaudio
   pip install -r requirements.txt

   # For CPU only
   pip install torch torchvision torchaudio
   pip install -r requirements.txt
   ```

4. **Run ComfyUI:**
   ```bash
   python main.py
   ```

5. **Verify it's running:**
   - Open your browser to `http://127.0.0.1:8188`

**Keep ComfyUI running** - the MCP server needs it to be accessible on port 8188.

---

## Step 2: Download AI Models

ComfyUI needs AI models to generate images. Here's what you need:

### Stable Diffusion Models

You need at least one Stable Diffusion checkpoint model:

#### Option A: SDXL (Recommended - Best Quality)

**SDXL Base 1.0** (6.46 GB)
- Download: [Hugging Face](https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors)
- Location: Place in `ComfyUI/models/checkpoints/`

#### Option B: SD 1.5 (Smaller, Faster)

**Stable Diffusion v1.5** (4.27 GB)
- Download: [Hugging Face](https://huggingface.co/runwayml/stable-diffusion-v1-5/resolve/main/v1-5-pruned-emaonly.safetensors)
- Location: Place in `ComfyUI/models/checkpoints/`

#### Option C: Realistic Vision (Great for Photos)

**Realistic Vision V5.1** (2.13 GB)
- Download: [Civitai](https://civitai.com/api/download/models/130072) (requires Civitai account)
- Location: Place in `ComfyUI/models/checkpoints/`

### VAE Models (Optional but Recommended)

VAE improves image quality and color accuracy:

**SDXL VAE** (335 MB)
- Download: [Hugging Face](https://huggingface.co/stabilityai/sdxl-vae/resolve/main/sdxl_vae.safetensors)
- Location: Place in `ComfyUI/models/vae/`

**SD 1.5 VAE** (335 MB)
- Download: [Hugging Face](https://huggingface.co/stabilityai/sd-vae-ft-mse-original/resolve/main/vae-ft-mse-840000-ema-pruned.safetensors)
- Location: Place in `ComfyUI/models/vae/`

### Quick Download Commands

```bash
# Navigate to your ComfyUI directory
cd ComfyUI/models/checkpoints

# Download SDXL (Linux/macOS with wget)
wget https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors

# Download SD 1.5 (Linux/macOS with wget)
wget https://huggingface.co/runwayml/stable-diffusion-v1-5/resolve/main/v1-5-pruned-emaonly.safetensors

# For Windows, use a browser or PowerShell:
# Invoke-WebRequest -Uri "https://huggingface.co/..." -OutFile "model.safetensors"
```

---

## Step 3: Install ComfyUI Custom Nodes

For advanced features like background removal, install ComfyUI-Manager and custom nodes:

### 3.1 Install ComfyUI-Manager

1. **Navigate to custom_nodes directory:**
   ```bash
   cd ComfyUI/custom_nodes
   ```

2. **Clone ComfyUI-Manager:**
   ```bash
   git clone https://github.com/ltdrdata/ComfyUI-Manager.git
   ```

3. **Restart ComfyUI**

4. **Access Manager:**
   - Open ComfyUI in browser (`http://127.0.0.1:8188`)
   - Click **Manager** button in the UI
   - You should see the ComfyUI-Manager interface

### 3.2 Install ComfyUI-RMBG (Background Removal)

**Via ComfyUI-Manager (Recommended):**

1. Open ComfyUI Manager in the web interface
2. Click **"Install Custom Nodes"**
3. Search for **"ComfyUI-RMBG"**
4. Click **Install**
5. Restart ComfyUI

**Manual Installation:**

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/1038lab/ComfyUI-RMBG.git
cd ComfyUI-RMBG

# Windows portable
../../python_embedded/python.exe -m pip install -r requirements.txt

# Manual installation
pip install -r requirements.txt
```

**Model Auto-Download:**
- The RMBG-2.0 model will automatically download the first time you use it
- It will be stored in `ComfyUI/models/rmbg/`

---

## Step 4: Install MCP Server

Now let's install the ComfyUI MCP Server itself:

### 4.1 Clone the Repository

```bash
# Navigate to your projects directory
cd ~/Documents/projects  # or wherever you keep projects

# Clone the MCP server
git clone https://github.com/YOUR-USERNAME/comfyui-mcp.git
cd comfyui-mcp
```

### 4.2 Install Dependencies

```bash
# Install Node.js dependencies
npm install
```

### 4.3 Build the Server

```bash
# Compile TypeScript to JavaScript
npm run build
```

### 4.4 Verify Installation

```bash
# Test the server builds correctly
npm start
# You should see: "ComfyUI MCP Server running on stdio"
# Press Ctrl+C to stop
```

---

## Step 5: Configure MCP Client

### Option A: Claude Desktop (Recommended)

1. **Install Claude Desktop:**
   - Download from [claude.ai/download](https://claude.ai/download)
   - Install and launch the application

2. **Locate the config file:**

   **Windows:**
   ```
   %APPDATA%\Claude\claude_desktop_config.json
   ```

   **macOS:**
   ```
   ~/Library/Application Support/Claude/claude_desktop_config.json
   ```

   **Linux:**
   ```
   ~/.config/Claude/claude_desktop_config.json
   ```

3. **Edit the config file:**

   ```json
   {
     "mcpServers": {
       "comfyui": {
         "command": "node",
         "args": [
           "C:\\Users\\YOUR-USERNAME\\Documents\\projects\\comfyui-mcp\\dist\\index.js"
         ],
         "env": {
           "COMFYUI_URL": "http://127.0.0.1:8188",
           "COMFYUI_WORKFLOW_DIR": "C:\\Users\\YOUR-USERNAME\\Documents\\projects\\comfyui-mcp\\workflow_files",
           "COMFYUI_MCP_HTTP_PORT": "8190",
           "COMFYUI_IMAGE_CACHE_DIR": "C:\\Users\\YOUR-USERNAME\\Documents\\projects\\comfyui-mcp\\image_cache",
           "COMFYUI_RANDOMIZE_SEEDS": "true"
         }
       }
     }
   }
   ```

   **Important:** Replace `YOUR-USERNAME` and paths with your actual paths!

4. **Restart Claude Desktop** completely (quit and reopen)

5. **Verify the connection:**
   - Look for the 🔌 MCP icon in Claude Desktop
   - Click it and verify "comfyui" appears with tools like `generate_image`

### Option B: Cline (VS Code Extension)

1. **Install Cline:**
   - Open VS Code
   - Install the "Cline" extension from the marketplace

2. **Configure MCP:**
   - Open Cline settings (gear icon)
   - Add MCP server configuration (similar to Claude Desktop format)

### Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `COMFYUI_URL` | `http://127.0.0.1:8188` | ComfyUI instance URL |
| `COMFYUI_WORKFLOW_DIR` | `./workflow_files` | Directory containing workflow JSON files |
| `COMFYUI_MCP_HTTP_PORT` | `8190` | Port for the HTTP image proxy server |
| `COMFYUI_IMAGE_CACHE_DIR` | `./image_cache` | Directory for caching downloaded images |
| `COMFYUI_RANDOMIZE_SEEDS` | `true` | Enable/disable seed randomization |

---

## Step 6: Test the Setup

Now let's verify everything works!

### 6.1 Test ComfyUI Connection

In Claude Desktop (or your MCP client):

```
Can you list the available ComfyUI workflows?
```

Expected response:
```
Available workflows:
- default_workflow.json (default)
- img2img_workflow.json
- resize_workflow.json
- upscale_workflow.json
- remove_background_workflow.json
```

### 6.2 Test Image Generation

```
Generate an image of a cute orange cat sitting on a wooden table
```

Claude should:
1. Call `generate_image` with your prompt
2. Return a prompt_id
3. Poll until completion
4. Return an HTTP URL to the generated image

### 6.3 Test Image Modification

```
Can you modify that cat image to look like a Van Gogh painting?
```

Claude should:
1. Download the previous image
2. Call `modify_image` with img2img parameters
3. Return the transformed image URL

### 6.4 Test Background Removal

```
Remove the background from the cat image
```

Claude should:
1. Upload the image to ComfyUI
2. Queue the remove_background workflow
3. Return an image with transparent background

---

## Troubleshooting

### ComfyUI Won't Start

**Problem:** ComfyUI fails to start or shows errors

**Solutions:**
1. Check Python version: `python --version` (should be 3.10 or 3.11)
2. Check GPU drivers are up to date (NVIDIA/AMD)
3. Try CPU mode: `run_cpu.bat` (Windows) or `python main.py --cpu` (manual)
4. Check logs in ComfyUI console window

### MCP Server Can't Connect to ComfyUI

**Problem:** Error: "Cannot connect to ComfyUI at http://127.0.0.1:8188"

**Solutions:**
1. Ensure ComfyUI is running (check `http://127.0.0.1:8188` in browser)
2. Check firewall isn't blocking port 8188
3. Verify `COMFYUI_URL` in config matches ComfyUI's address
4. Check ComfyUI console for errors

### Models Not Found

**Problem:** "Required models not found" or similar errors

**Solutions:**
1. Verify models are in correct directories:
   - Checkpoints: `ComfyUI/models/checkpoints/`
   - VAE: `ComfyUI/models/vae/`
   - RMBG: `ComfyUI/models/rmbg/` (auto-downloads)
2. Check model file extensions (should be `.safetensors` or `.ckpt`)
3. Restart ComfyUI after adding models

### Background Removal Fails

**Problem:** "Cannot execute because node RMBG does not exist"

**Solutions:**
1. Install ComfyUI-RMBG (see [Step 3.2](#32-install-comfyui-rmbg-background-removal))
2. Restart ComfyUI after installation
3. Check custom_nodes folder contains `ComfyUI-RMBG`
4. Run `pip install -r requirements.txt` in the ComfyUI-RMBG folder

### Images Won't Load

**Problem:** Image URLs return 404 or timeout

**Solutions:**
1. Check image cache directory exists and is writable
2. Verify `COMFYUI_MCP_HTTP_PORT` isn't blocked by firewall
3. Check disk space (cache directory needs space)
4. Look for errors in MCP server console

### "Request Timed Out After 15 Minutes"

**Problem:** Long generation times cause timeout

**Solutions:**
1. Use smaller resolutions (512x512 instead of 1024x1024)
2. Use faster models (SD 1.5 instead of SDXL)
3. Enable GPU mode if using CPU
4. Simplify workflows (fewer nodes)
5. Check if ComfyUI is actually processing (check its console)

### MCP Server Not Appearing in Claude Desktop

**Problem:** No MCP tools available in Claude Desktop

**Solutions:**
1. Restart Claude Desktop completely (quit, not minimize)
2. Check config file path is correct for your OS
3. Verify JSON syntax (use a JSON validator)
4. Check file paths use correct format:
   - Windows: `C:\\path\\to\\file` (double backslashes)
   - macOS/Linux: `/path/to/file` (forward slashes)
5. Check Claude Desktop logs:
   - Windows: `%APPDATA%\Claude\logs\`
   - macOS: `~/Library/Logs/Claude/`

### Out of Memory (OOM) Errors

**Problem:** ComfyUI crashes with CUDA OOM or system runs out of RAM

**Solutions:**
1. Use smaller models (SD 1.5 instead of SDXL)
2. Reduce image resolution (512x512 instead of 1024x1024)
3. Close other applications
4. Enable CPU mode (slower but uses less VRAM)
5. Add `--lowvram` flag when starting ComfyUI:
   ```bash
   python main.py --lowvram
   ```

---

## Advanced Configuration

### Using Custom Workflows

1. **Create workflow in ComfyUI:**
   - Design your workflow in the ComfyUI web interface
   - Click **"Save (API Format)"** (not "Save")
   - Save the JSON file

2. **Copy to workflow directory:**
   ```bash
   cp my_custom_workflow.json workflow_files/
   ```

3. **Use in MCP:**
   ```
   Generate an image using my_custom_workflow.json
   ```

### Multiple ComfyUI Instances

To run multiple ComfyUI instances on different ports:

```bash
# Instance 1 (default)
python main.py --port 8188

# Instance 2
python main.py --port 8189
```

Update MCP config to point to specific instance:
```json
"COMFYUI_URL": "http://127.0.0.1:8189"
```

### Remote ComfyUI Instance

To connect to ComfyUI on another machine:

```json
"COMFYUI_URL": "http://192.168.1.100:8188"
```

Ensure ComfyUI is started with `--listen` flag:
```bash
python main.py --listen 0.0.0.0
```

---

## Useful Resources

### ComfyUI Resources
- **Official Repo:** https://github.com/comfyanonymous/ComfyUI
- **ComfyUI Wiki:** https://github.com/comfyanonymous/ComfyUI/wiki
- **Community Workflows:** https://comfyworkflows.com/
- **Model Repository:** https://civitai.com/

### Model Download Sites
- **Hugging Face:** https://huggingface.co/models (free, official models)
- **Civitai:** https://civitai.com/ (community models, requires account)
- **Stability AI:** https://huggingface.co/stabilityai (official SDXL models)

### MCP Resources
- **MCP Specification:** https://modelcontextprotocol.io/
- **Claude Desktop:** https://claude.ai/download
- **MCP Inspector:** https://github.com/modelcontextprotocol/inspector

### Getting Help
- **GitHub Issues:** Report bugs or ask questions
- **ComfyUI Discord:** https://discord.gg/comfyui
- **Reddit:** r/StableDiffusion, r/ComfyUI

---

## Next Steps

Once everything is working:

1. **Explore workflows:** Try different ComfyUI workflows for various effects
2. **Download more models:** Experiment with different SD models for different styles
3. **Customize parameters:** Adjust settings like CFG scale, steps, samplers
4. **Create custom tools:** Extend the MCP server with your own tools
5. **Batch processing:** Use the MCP server to automate image generation tasks

Happy generating! 🎨
