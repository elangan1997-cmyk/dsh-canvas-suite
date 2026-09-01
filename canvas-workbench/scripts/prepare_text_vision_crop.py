#!/usr/bin/env python3
"""Create a lossless, upscaled crop for small text vision analysis."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def number(value: object, fallback: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--mask-output", type=Path)
    parser.add_argument("--ocr-output", type=Path)
    parser.add_argument("--annotated-output", type=Path)
    parser.add_argument("--selection-region")
    parser.add_argument("--region", required=True)
    args = parser.parse_args()
    try:
        from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

        region = json.loads(args.region)
        selection_region = json.loads(args.selection_region) if args.selection_region else region
        image = Image.open(args.input).convert("RGB")
        width, height = image.size
        x0 = max(0, min(width - 1, round(number(region.get("x")))))
        y0 = max(0, min(height - 1, round(number(region.get("y")))))
        x1 = max(x0 + 1, min(width, round(number(region.get("x")) + number(region.get("width")))))
        y1 = max(y0 + 1, min(height, round(number(region.get("y")) + number(region.get("height")))))
        crop = image.crop((x0, y0, x1, y1))
        scale = max(1.0, min(6.0, 640.0 / max(1, min(crop.size))))
        scale = min(scale, 2048.0 / max(crop.size))
        output_size = (max(1, round(crop.width * scale)), max(1, round(crop.height * scale)))
        if output_size != crop.size:
            crop = crop.resize(output_size, Image.Resampling.LANCZOS)
        crop = ImageEnhance.Contrast(crop).enhance(1.08)
        crop = crop.filter(ImageFilter.UnsharpMask(radius=1.2, percent=115, threshold=3))
        args.output.parent.mkdir(parents=True, exist_ok=True)
        crop.save(args.output, format="PNG", optimize=True)
        if args.ocr_output:
            # Tesseract is unreliable on light glyphs over saturated colour.
            # Convert likely bright lettering to black on white while keeping
            # the lossless colour crop for the vision model.
            gray = crop.convert("L")
            ocr_crop = gray.point(lambda value: 0 if value >= 205 else 255, mode="1")
            args.ocr_output.parent.mkdir(parents=True, exist_ok=True)
            ocr_crop.save(args.ocr_output, format="PNG", optimize=True)
        if args.annotated_output:
            annotated = image.copy()
            sx0 = max(0, min(width - 1, round(number(selection_region.get("x")))))
            sy0 = max(0, min(height - 1, round(number(selection_region.get("y")))))
            sx1 = max(sx0 + 1, min(width, round(number(selection_region.get("x")) + number(selection_region.get("width")))))
            sy1 = max(sy0 + 1, min(height, round(number(selection_region.get("y")) + number(selection_region.get("height")))))
            guide = ImageDraw.Draw(annotated)
            stroke = max(3, round(max(width, height) / 250))
            guide.rectangle((sx0, sy0, sx1 - 1, sy1 - 1), outline=(25, 118, 255), width=stroke)
            args.annotated_output.parent.mkdir(parents=True, exist_ok=True)
            annotated.save(args.annotated_output, format="PNG", optimize=True)
        if args.mask_output:
            # A high-contrast full-size mask is sent beside the source image.
            # White is the only region the model may transcribe; black must be
            # ignored. Keeping it full-size makes the geometry unambiguous.
            mask = Image.new("L", (width, height), 0)
            draw = ImageDraw.Draw(mask)
            draw.rectangle((x0, y0, x1 - 1, y1 - 1), fill=255)
            args.mask_output.parent.mkdir(parents=True, exist_ok=True)
            mask.save(args.mask_output, format="PNG", optimize=True)
        print(json.dumps({
            "success": True,
            "x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0,
            "outputWidth": crop.width, "outputHeight": crop.height,
            "scaleX": crop.width / max(1, x1 - x0),
            "scaleY": crop.height / max(1, y1 - y0),
            "maskOutput": str(args.mask_output) if args.mask_output else "",
            "ocrOutput": str(args.ocr_output) if args.ocr_output else "",
            "annotatedOutput": str(args.annotated_output) if args.annotated_output else "",
        }, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({"success": False, "error": str(exc)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
