#!/usr/bin/env bash
# Install ComfyUI-RMBG and download the Qwen-Image model files required by
# workflow_files/workflow.json.
#
# Usage:
#   scripts/setup-comfyui.sh /path/to/ComfyUI
#   COMFYUI_PATH=/path/to/ComfyUI scripts/setup-comfyui.sh
#   scripts/setup-comfyui.sh        # probes $HOME/ComfyUI, $HOME/comfyui, /opt/ComfyUI

set -euo pipefail

RMBG_REPO="https://github.com/1038lab/ComfyUI-RMBG.git"

FLUX2_BASE="https://huggingface.co/Comfy-Org/flux2-klein-4B/resolve/main/split_files"
UNET_URL="${FLUX2_BASE}/diffusion_models/flux-2-klein-base-4b.safetensors"
CLIP_URL="${FLUX2_BASE}/text_encoders/qwen_3_4b.safetensors"
VAE_URL="${FLUX2_BASE}/vae/flux2-vae.safetensors"

UNET_FILE="flux-2-klein-base-4b.safetensors"
CLIP_FILE="qwen_3_4b.safetensors"
VAE_FILE="flux2-vae.safetensors"

print_usage() {
  cat <<'EOF'
Usage: scripts/setup-comfyui.sh [/path/to/ComfyUI] [/path/to/models]

Resolves the ComfyUI install in this order:
  1. First positional argument
  2. $COMFYUI_PATH environment variable
  3. Common defaults: $HOME/ComfyUI, $HOME/comfyui, /opt/ComfyUI

The install path must contain main.py and a custom_nodes/ directory.

Resolves the models base directory in this order (useful for Docker
bind-mounts where models live outside the ComfyUI install tree):
  1. Second positional argument
  2. $COMFYUI_MODELS_PATH environment variable
  3. <install_path>/models

What this script does:
  * Clones ComfyUI-RMBG into <install>/custom_nodes/ (skipped if present)
  * Downloads three FLUX.2 [klein] 4B model files into <models>/diffusion_models,
    <models>/text_encoders, <models>/vae (skipped per-file if already present
    and non-empty):
      - flux-2-klein-base-4b.safetensors  (~7.75 GB)
      - qwen_3_4b.safetensors             (~8.04 GB)
      - flux2-vae.safetensors             (~254 MB)

Requires: bash, git, curl.
EOF
}

resolve_comfyui_path() {
  if [ -n "${1:-}" ]; then
    printf '%s' "$1"
    return 0
  fi
  if [ -n "${COMFYUI_PATH:-}" ]; then
    printf '%s' "$COMFYUI_PATH"
    return 0
  fi
  for candidate in "$HOME/ComfyUI" "$HOME/comfyui" "/opt/ComfyUI"; do
    if [ -d "$candidate" ] && [ -f "$candidate/main.py" ]; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  return 1
}

resolve_models_path() {
  local comfy="$1"
  local arg="${2:-}"
  if [ -n "$arg" ]; then
    printf '%s' "$arg"
    return 0
  fi
  if [ -n "${COMFYUI_MODELS_PATH:-}" ]; then
    printf '%s' "$COMFYUI_MODELS_PATH"
    return 0
  fi
  printf '%s' "$comfy/models"
}

validate_comfyui_path() {
  local path="$1"
  if [ ! -d "$path" ]; then
    echo "error: ComfyUI path does not exist: $path" >&2
    return 1
  fi
  if [ ! -f "$path/main.py" ]; then
    echo "error: $path does not look like a ComfyUI install (no main.py)" >&2
    return 1
  fi
  if [ ! -d "$path/custom_nodes" ]; then
    echo "error: $path does not look like a ComfyUI install (no custom_nodes/ directory)" >&2
    return 1
  fi
  return 0
}

require_bin() {
  local bin="$1"
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "error: required command not found: $bin" >&2
    exit 1
  fi
}

install_rmbg() {
  local comfy="$1"
  local target="$comfy/custom_nodes/ComfyUI-RMBG"
  if [ -d "$target" ]; then
    echo "[skip] ComfyUI-RMBG already present at $target"
    return 0
  fi
  echo "[install] cloning ComfyUI-RMBG into $target"
  git clone "$RMBG_REPO" "$target"
}

download_model() {
  local url="$1"
  local dest_dir="$2"
  local filename="$3"
  local dest="$dest_dir/$filename"

  mkdir -p "$dest_dir"

  if [ -s "$dest" ]; then
    echo "[skip] $filename already present at $dest"
    return 0
  fi

  echo "[download] $filename -> $dest"
  # --fail: abort on HTTP errors; -L: follow redirects; --progress-bar: tidy progress.
  if ! curl -L --fail --progress-bar --output "$dest" "$url"; then
    rm -f "$dest"
    echo "error: failed to download $filename from $url" >&2
    return 1
  fi
}

main() {
  if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
    print_usage
    exit 0
  fi

  require_bin git
  require_bin curl

  local comfy
  if ! comfy="$(resolve_comfyui_path "${1:-}")"; then
    echo "error: could not locate a ComfyUI install." >&2
    echo >&2
    print_usage >&2
    exit 1
  fi

  validate_comfyui_path "$comfy"

  local models
  models="$(resolve_models_path "$comfy" "${2:-}")"

  echo "Using ComfyUI at: $comfy"
  echo "Using models dir: $models"
  echo

  install_rmbg "$comfy"
  echo

  download_model "$UNET_URL" "$models/diffusion_models" "$UNET_FILE"
  download_model "$CLIP_URL" "$models/text_encoders"    "$CLIP_FILE"
  download_model "$VAE_URL"  "$models/vae"              "$VAE_FILE"

  echo
  echo "Done. Next steps:"
  echo "  1. Restart ComfyUI so the new ComfyUI-RMBG custom node is loaded."
  echo "  2. The RMBG-2.0 weights will auto-download on first workflow run."
}

main "$@"
