"""
MediaVault — ComfyUI Custom Nodes
Load images/videos from MediaVault and save outputs back to it.
Persistent mapping: remembers which asset was loaded per node, so
re-opening a workflow auto-loads the same file.

Installation:
  Copy this folder (mediavault/) into ComfyUI/custom_nodes/
  Or symlink:  mklink /D "C:\ComfyUI_windows_portable\ComfyUI\custom_nodes\mediavault" "C:\MediaVault\comfyui"
"""

import os
import json
import time
import shutil
import urllib.request
import urllib.error
import numpy as np
from PIL import Image
import torch

# MediaVault API base — change if needed
MEDIAVAULT_URL = os.environ.get("MEDIAVAULT_URL", "http://localhost:7700")


# ═══════════════════════════════════════════
#  API Helpers
# ═══════════════════════════════════════════
def mv_api(path, method="GET", data=None):
    """Call MediaVault REST API."""
    url = f"{MEDIAVAULT_URL}{path}"
    headers = {"Content-Type": "application/json"}

    if data is not None:
        req = urllib.request.Request(url, data=json.dumps(data).encode(), headers=headers, method=method)
    else:
        req = urllib.request.Request(url, headers=headers, method=method)

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.URLError as e:
        print(f"[MediaVault] API error: {e}")
        return None
    except json.JSONDecodeError:
        return None


def get_projects():
    """Fetch project list for dropdown."""
    result = mv_api("/api/comfyui/projects")
    if result:
        return {f"{p['name']} ({p['code']})": str(p['id']) for p in result}
    return {"No projects found": "0"}


def get_assets(project_id=None, media_type=None):
    """Fetch asset list for dropdown."""
    params = []
    if project_id:
        params.append(f"project_id={project_id}")
    if media_type:
        params.append(f"media_type={media_type}")
    query = "&".join(params)
    path = f"/api/comfyui/assets?{query}" if query else "/api/comfyui/assets"

    result = mv_api(path)
    if result:
        return {f"{a['vault_name']}": str(a['id']) for a in result}
    return {"No assets found": "0"}


def get_asset_path(asset_id):
    """Get the absolute file path for an asset."""
    result = mv_api(f"/api/comfyui/asset/{asset_id}/path")
    if result and result.get("path"):
        return result["path"]
    return None


def save_mapping(workflow_id, node_id, asset_id):
    """Save persistent node → asset mapping."""
    mv_api("/api/comfyui/mapping", method="POST", data={
        "workflow_id": workflow_id,
        "node_id": node_id,
        "asset_id": int(asset_id),
    })


def load_mapping(workflow_id, node_id):
    """Load persistent mapping for this node."""
    result = mv_api(f"/api/comfyui/mapping?workflow_id={workflow_id}&node_id={node_id}")
    if result and result.get("asset_id"):
        return result
    return None


# ═══════════════════════════════════════════
#  Load From MediaVault
# ═══════════════════════════════════════════
class LoadFromMediaVault:
    """
    Load an image from MediaVault.
    Supports persistent mapping — when you save and reload a workflow,
    the same asset is loaded automatically.
    """

    @classmethod
    def INPUT_TYPES(cls):
        projects = get_projects()
        assets = get_assets(media_type="image")

        return {
            "required": {
                "project": (list(projects.keys()), {"default": list(projects.keys())[0]}),
                "asset": (list(assets.keys()), {"default": list(assets.keys())[0]}),
            },
            "optional": {
                "workflow_id": ("STRING", {"default": "default", "multiline": False}),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK", "STRING")
    RETURN_NAMES = ("image", "mask", "file_path")
    FUNCTION = "load_image"
    CATEGORY = "MediaVault"

    def load_image(self, project, asset, workflow_id="default"):
        # Find asset ID from display name
        assets = get_assets(media_type="image")
        asset_id = assets.get(asset, "0")

        if asset_id == "0":
            # Try persistent mapping
            mapping = load_mapping(workflow_id, self.__class__.__name__)
            if mapping:
                asset_id = str(mapping["asset_id"])

        # Get file path
        file_path = get_asset_path(asset_id)
        if not file_path or not os.path.exists(file_path):
            raise FileNotFoundError(f"[MediaVault] Asset not found: {asset} (id={asset_id})")

        # Save mapping for persistence
        save_mapping(workflow_id, self.__class__.__name__, asset_id)

        # Load image
        img = Image.open(file_path)
        img = img.convert("RGBA")
        image_np = np.array(img).astype(np.float32) / 255.0

        # Split RGB and Alpha
        rgb = image_np[:, :, :3]
        alpha = image_np[:, :, 3]

        image_tensor = torch.from_numpy(rgb).unsqueeze(0)  # [1, H, W, 3]
        mask_tensor = torch.from_numpy(1.0 - alpha).unsqueeze(0)  # [1, H, W]

        return (image_tensor, mask_tensor, file_path)


# ═══════════════════════════════════════════
#  Save To MediaVault
# ═══════════════════════════════════════════
class SaveToMediaVault:
    """
    Save a ComfyUI output image into MediaVault.
    The file is imported into the selected project with structured naming.
    """

    @classmethod
    def INPUT_TYPES(cls):
        projects = get_projects()

        return {
            "required": {
                "images": ("IMAGE",),
                "project": (list(projects.keys()), {"default": list(projects.keys())[0]}),
                "custom_name": ("STRING", {"default": "", "multiline": False}),
            },
            "optional": {
                "format": (["png", "jpg", "webp"], {"default": "png"}),
                "quality": ("INT", {"default": 95, "min": 1, "max": 100, "step": 1}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("saved_path",)
    FUNCTION = "save_image"
    CATEGORY = "MediaVault"
    OUTPUT_NODE = True

    def save_image(self, images, project, custom_name="", format="png", quality=95):
        # Find project ID
        projects = get_projects()
        project_id = projects.get(project, "0")

        if project_id == "0":
            raise ValueError(f"[MediaVault] Project not found: {project}")

        saved_paths = []

        for i, image in enumerate(images):
            # Convert tensor to PIL Image
            img_np = image.cpu().numpy()
            img_np = (img_np * 255).clip(0, 255).astype(np.uint8)
            img = Image.fromarray(img_np)

            # Save to temp file
            timestamp = int(time.time() * 1000)
            name_part = custom_name if custom_name else "comfyui_output"
            if len(images) > 1:
                name_part += f"_{i + 1:03d}"
            temp_name = f"{name_part}_{timestamp}.{format}"
            temp_path = os.path.join(os.path.dirname(__file__), "..", "temp", temp_name)
            os.makedirs(os.path.dirname(temp_path), exist_ok=True)

            if format == "jpg":
                img = img.convert("RGB")
                img.save(temp_path, "JPEG", quality=quality)
            elif format == "webp":
                img.save(temp_path, "WEBP", quality=quality)
            else:
                img.save(temp_path, "PNG")

            # Import into MediaVault via API
            result = mv_api("/api/comfyui/save", method="POST", data={
                "source_path": os.path.abspath(temp_path),
                "project_id": int(project_id),
                "custom_name": custom_name or None,
                "format": format,
            })

            if result and result.get("asset"):
                saved_paths.append(result["asset"].get("file_path", temp_path))
                # Clean up temp file
                try:
                    os.remove(temp_path)
                except OSError:
                    pass
            else:
                saved_paths.append(temp_path)
                print(f"[MediaVault] Warning: API save failed, file kept at {temp_path}")

        return (", ".join(saved_paths),)


# ═══════════════════════════════════════════
#  Load Video Frame From MediaVault
# ═══════════════════════════════════════════
class LoadVideoFrameFromMediaVault:
    """
    Load a specific frame from a video asset in MediaVault.
    Requires OpenCV (cv2) to be available.
    """

    @classmethod
    def INPUT_TYPES(cls):
        projects = get_projects()
        assets = get_assets(media_type="video")

        return {
            "required": {
                "project": (list(projects.keys()), {"default": list(projects.keys())[0]}),
                "asset": (list(assets.keys()), {"default": list(assets.keys())[0]}),
                "frame_number": ("INT", {"default": 0, "min": 0, "max": 999999, "step": 1}),
            },
        }

    RETURN_TYPES = ("IMAGE", "STRING", "INT")
    RETURN_NAMES = ("image", "file_path", "total_frames")
    FUNCTION = "load_frame"
    CATEGORY = "MediaVault"

    def load_frame(self, project, asset, frame_number):
        try:
            import cv2
        except ImportError:
            raise ImportError("[MediaVault] OpenCV (cv2) required for video frame loading. Install with: pip install opencv-python")

        assets = get_assets(media_type="video")
        asset_id = assets.get(asset, "0")
        file_path = get_asset_path(asset_id)

        if not file_path or not os.path.exists(file_path):
            raise FileNotFoundError(f"[MediaVault] Video not found: {asset}")

        cap = cv2.VideoCapture(file_path)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

        frame_number = min(frame_number, total_frames - 1)
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_number)
        ret, frame = cap.read()
        cap.release()

        if not ret:
            raise RuntimeError(f"[MediaVault] Failed to read frame {frame_number}")

        # BGR to RGB
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        frame_np = frame_rgb.astype(np.float32) / 255.0
        image_tensor = torch.from_numpy(frame_np).unsqueeze(0)

        return (image_tensor, file_path, total_frames)


# ═══════════════════════════════════════════
#  ComfyUI Registration
# ═══════════════════════════════════════════
NODE_CLASS_MAPPINGS = {
    "LoadFromMediaVault": LoadFromMediaVault,
    "SaveToMediaVault": SaveToMediaVault,
    "LoadVideoFrameFromMediaVault": LoadVideoFrameFromMediaVault,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "LoadFromMediaVault": "📂 Load from MediaVault",
    "SaveToMediaVault": "💾 Save to MediaVault",
    "LoadVideoFrameFromMediaVault": "🎬 Load Video Frame (MediaVault)",
}
