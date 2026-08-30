#!/usr/bin/env python3
"""Create a PSD text-rebuild draft.

The base PSD is always valid without Photoshop.  It contains the untouched
source and reviewable raster previews for OCR lines.  When Photoshop is
available the host subsequently adds native text layers with JSX.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


def parse_color(value: object) -> tuple[int, int, int]:
    match = re.fullmatch(r"#?([0-9a-fA-F]{6})", str(value or ""))
    if not match:
        return (17, 24, 39)
    raw = match.group(1)
    return tuple(int(raw[index:index + 2], 16) for index in (0, 2, 4))


def normalize_text(value: object) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    # Tesseract may put a space between every Chinese glyph.  Remove only
    # those OCR artefacts; spaces inside English phrases remain readable.
    text = re.sub(r"(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])", "", text)
    text = re.sub(r"(?<=[\u3400-\u9fff])\s+(?=[，。！？；：、）》】])", "", text)
    text = re.sub(r"([（【《])\s+", r"\1", text)
    return text


def find_font() -> str | None:
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Helvetica.ttc",
    ]
    return next((item for item in candidates if Path(item).is_file()), None)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--blocks", required=True, help="JSON array of OCR blocks")
    parser.add_argument("--clean-input", default="", help="optional image2 clean-plate with OCR text removed")
    args = parser.parse_args()
    try:
        from PIL import Image, ImageDraw, ImageFont
        from psd_tools import PSDImage
        from psd_tools.api.layers import PixelLayer

        source = Path(args.input)
        output = Path(args.output)
        image = Image.open(source).convert("RGBA")
        # RGB keeps Photoshop and Quick Look compatibility predictable.  The
        # source itself is preserved as a full-canvas pixel layer.
        rgb = Image.new("RGB", image.size, (255, 255, 255))
        rgb.paste(image, mask=image.getchannel("A"))
        psd = PSDImage.new("RGB", image.size, color=0, depth=8)
        original = psd.create_pixel_layer(rgb, name="Original artwork (preserved)")
        clean_path = Path(args.clean_input) if args.clean_input else None
        clean_rgb = None
        if clean_path and clean_path.is_file() and clean_path.stat().st_size > 0:
            clean_image = Image.open(clean_path).convert("RGBA")
            if clean_image.size != image.size:
                clean_image = clean_image.resize(image.size, Image.Resampling.LANCZOS)
            clean_rgb = Image.new("RGB", clean_image.size, (255, 255, 255))
            clean_rgb.paste(clean_image, mask=clean_image.getchannel("A"))
        # The original is always kept for recovery.  When a clean plate is
        # available it becomes the visible base; otherwise the untouched source
        # remains visible and the PSD is still a safe review draft.
        original.visible = clean_rgb is None
        if clean_rgb is not None:
            clean_layer = psd.create_pixel_layer(clean_rgb, name="Clean background (image2)")
            clean_layer.visible = True

        try:
            blocks = json.loads(args.blocks)
        except json.JSONDecodeError:
            blocks = []
        if not isinstance(blocks, list):
            blocks = []
        # psd-tools 1.11 writes layer names through a legacy single-byte
        # encoder; ASCII names keep the offline fallback valid on macOS.
        group = psd.create_group(name="OCR text preview - replace in Photoshop", open_folder=False)
        # OCR/model geometry is a reconstruction suggestion, not verified
        # artwork.  Keep every candidate available for editing, but never let
        # an inaccurate candidate cover the successfully cleaned background
        # when the PSD is first opened or previewed on the canvas.
        group.visible = False
        font_path = find_font()
        for index, raw in enumerate(blocks[:200]):
            if not isinstance(raw, dict) or raw.get("enabled") is False:
                continue
            text = normalize_text(raw.get("text"))
            if not text:
                continue
            x = max(0, int(float(raw.get("x", 0) or 0)))
            y = max(0, int(float(raw.get("y", 0) or 0)))
            width = max(2, int(float(raw.get("width", 240) or 240)))
            height = max(2, int(float(raw.get("height", 48) or 48)))
            size = max(8, min(220, int(float(raw.get("fontSize", height * 0.92) or height * 0.92))))
            try:
                font = ImageFont.truetype(font_path, size) if font_path else ImageFont.load_default()
            except Exception:
                font = ImageFont.load_default()
            canvas = Image.new("RGBA", (max(width, 4), max(height, size + 8)), (0, 0, 0, 0))
            draw = ImageDraw.Draw(canvas)
            draw.text((1, 0), text, fill=parse_color(raw.get("color")), font=font, spacing=max(1, int(size * 0.15)))
            layer = PixelLayer.frompil(canvas, parent=group, name=f"OCR text {index + 1}", top=y, left=x)
            layer.visible = False
            group.append(layer)
        output.parent.mkdir(parents=True, exist_ok=True)
        psd.save(output)
        print(json.dumps({"success": True, "width": image.width, "height": image.height, "layers": len(blocks[:200]) + 1 + (1 if clean_rgb is not None else 0), "cleanBackground": clean_rgb is not None, "output": str(output)}, ensure_ascii=False))
        return 0
    except Exception as exc:  # pragma: no cover
        print(json.dumps({"success": False, "error": str(exc)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
