#!/usr/bin/env python3
"""Build a narrow, feathered image2 inpainting mask from OCR boxes.

The image-generation runners use the same convention as the canvas masks:
transparent pixels are editable and opaque pixels are locked.  OCR boxes are
expanded just enough to include antialiasing and glyph shadows, then blurred
at the edge so the later pixel-preserving composite cannot leave a hard seam.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path


def _number(value: object, fallback: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--blocks", required=True, help="OCR block JSON array")
    parser.add_argument("--regions", default="[]", help="authoritative user-selected region JSON array")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--padding", type=float, default=0.0, help="extra pixels around each OCR box")
    args = parser.parse_args()
    try:
        import numpy as np
        from PIL import Image, ImageChops, ImageDraw, ImageFilter
        from scipy import ndimage

        def components(binary):
            labels, component_count = ndimage.label(binary, structure=np.ones((3, 3), dtype=np.uint8))
            objects = ndimage.find_objects(labels)
            result = []
            for component, bounds in enumerate(objects, start=1):
                if bounds is None:
                    continue
                ys, xs = bounds
                area = int(np.count_nonzero(labels[bounds] == component))
                result.append((component, xs.start, ys.start, xs.stop - xs.start, ys.stop - ys.start, area))
            return labels, result

        image = Image.open(args.source).convert("RGBA")
        try:
            blocks = json.loads(args.blocks)
        except json.JSONDecodeError:
            blocks = []
        if not isinstance(blocks, list):
            blocks = []
        try:
            regions = json.loads(args.regions)
        except json.JSONDecodeError:
            regions = []
        if not isinstance(regions, list):
            regions = []

        width, height = image.size
        # A fixed 3-10px margin was insufficient for large display type and for
        # vision-model boxes that land a few pixels inside the actual glyphs.
        # Keep a small image-level floor, then expand every row proportionally
        # to its own box/font height.  This covers outlines, shadows and
        # antialiasing without turning a text edit into a whole-image edit.
        automatic = max(4.0, min(14.0, min(width, height) * 0.005))
        base_padding = max(2.0, min(24.0, automatic + max(0.0, args.padding)))
        selected = Image.new("L", (width, height), 0)
        draw = ImageDraw.Draw(selected)
        region_mask = Image.new("L", (width, height), 0)
        region_draw = ImageDraw.Draw(region_mask)
        valid_regions = []
        for raw in regions[:24]:
            if not isinstance(raw, dict):
                continue
            rx0 = max(0.0, _number(raw.get("x")))
            ry0 = max(0.0, _number(raw.get("y")))
            rx1 = min(width, rx0 + max(0.0, _number(raw.get("width"))))
            ry1 = min(height, ry0 + max(0.0, _number(raw.get("height"))))
            if rx1 - rx0 >= 6 and ry1 - ry0 >= 6:
                valid_regions.append((round(rx0), round(ry0), round(rx1), round(ry1)))
                region_draw.rectangle(valid_regions[-1], fill=255)
        count = 0
        region_count = 0
        # Repaint the reviewed text boxes, not the whole selection rectangle.
        # A large selection often contains products, spheres, lines or other
        # geometry. Sending that whole rectangle to image2 makes those objects
        # move and creates a visible rectangular seam at composite time.
        for raw in blocks[:200]:
            if not isinstance(raw, dict) or raw.get("enabled") is False:
                continue
            text = str(raw.get("text") or "").strip()
            if not text:
                continue
            box_x = max(0.0, _number(raw.get("x")))
            box_y = max(0.0, _number(raw.get("y")))
            box_w = max(2.0, _number(raw.get("width"), 2.0))
            box_h = max(2.0, _number(raw.get("height"), 2.0))
            font_h = max(box_h, _number(raw.get("fontSize"), box_h))
            # First try a glyph-colour mask. Rectangle masks let image models
            # redraw buttons, labels and rounded cards beneath the text.
            # Selecting pixels close to the model-estimated font colour keeps
            # those background structures locked.
            colour = str(raw.get("color") or "#111111").lstrip("#")
            try:
                target = tuple(int(colour[index:index + 2], 16) for index in (0, 2, 4)) if len(colour) == 6 else (17, 17, 17)
            except ValueError:
                target = (17, 17, 17)
            glyph_pad = max(2.0, min(7.0, box_h * 0.06))
            gx0 = round(max(0.0, box_x - glyph_pad))
            gy0 = round(max(0.0, box_y - glyph_pad))
            gx1 = round(min(width, box_x + box_w + glyph_pad))
            gy1 = round(min(height, box_y + box_h + glyph_pad))
            source_crop = image.convert("RGB").crop((gx0, gy0, gx1, gy1))
            target_crop = Image.new("RGB", source_crop.size, target)
            difference = ImageChops.difference(source_crop, target_crop)
            dr, dg, db = difference.split()
            maximum = ImageChops.lighter(ImageChops.lighter(dr, dg), db)
            glyph = maximum.point(lambda value: 255 if value <= 92 else 0)
            # Remove colour-matched background/card borders. They form large
            # components touching the crop edge; actual glyph components stay
            # inside the padded OCR box.
            glyph_array = np.asarray(glyph, dtype=np.uint8)
            labels, glyph_components = components(glyph_array > 0)
            filtered = np.zeros_like(glyph_array)
            crop_h, crop_w = glyph_array.shape
            for component, cx, cy, cw, ch, area in glyph_components:
                touches_edge = cx <= 0 or cy <= 0 or cx + cw >= crop_w or cy + ch >= crop_h
                structural = cw >= crop_w * 0.82 or ch >= crop_h * 0.82
                if area >= 4 and not touches_edge and not structural:
                    filtered[labels == component] = 255
            glyph = Image.fromarray(filtered, mode="L")
            glyph_pixels = sum(index * amount for index, amount in enumerate(glyph.histogram())) / 255
            glyph_ratio = glyph_pixels / max(1, source_crop.width * source_crop.height)
            if 0.004 <= glyph_ratio <= 0.62:
                glyph = glyph.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(1.4))
                layer = Image.new("L", (width, height), 0)
                layer.paste(glyph, (gx0, gy0))
                selected = ImageChops.lighter(selected, layer)
                count += 1
                continue

            # Vision models can read the selected text correctly while still
            # returning an imprecise text box. Search the authoritative user
            # selection for the same estimated glyph colour. This never opens
            # pixels outside the blue-box selection and avoids a no-op clean
            # background when the model coordinates drift.
            if valid_regions:
                full_rgb = np.asarray(image.convert("RGB"), dtype=np.int16)
                target_rgb = np.asarray(target, dtype=np.int16)
                distance = np.max(np.abs(full_rgb - target_rgb), axis=2)
                candidate = np.where((distance <= 92) & (np.asarray(region_mask) > 0), 255, 0).astype(np.uint8)
                labels, region_components = components(candidate > 0)
                filtered = np.zeros_like(candidate)
                for component, cx, cy, cw, ch, area in region_components:
                    structural = cw >= width * 0.45 or ch >= height * 0.45 or area > width * height * 0.08
                    if area >= 4 and not structural:
                        filtered[labels == component] = 255
                region_glyph = Image.fromarray(filtered, mode="L")
                region_pixels = sum(index * amount for index, amount in enumerate(region_glyph.histogram())) / 255
                if region_pixels >= 4:
                    region_glyph = region_glyph.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(1.4))
                    selected = ImageChops.lighter(selected, region_glyph)
                    count += 1
                    continue

            # Geometry fallback for unusual gradients or inaccurate colour.
            # Keep it tight so structural shapes below the text remain locked.
            pad_x = max(2.0, min(8.0, box_h * 0.08))
            pad_y = max(2.0, min(7.0, box_h * 0.08))
            x0 = box_x - pad_x
            y0 = box_y - pad_y
            x1 = box_x + box_w + pad_x
            y1 = box_y + box_h + pad_y
            if x1 <= 0 or y1 <= 0 or x0 >= width or y0 >= height:
                continue
            draw.rectangle((round(max(0.0, x0)), round(max(0.0, y0)), round(min(width, x1)), round(min(height, y1))), fill=255)
            count += 1

        # If recognition produced no usable rows, retain the user region as a
        # conservative compatibility fallback instead of turning the request
        # into a no-op. Normal reviewed exports always take the block path.
        if not count:
            for raw in regions[:24]:
                if not isinstance(raw, dict):
                    continue
                x0 = max(0.0, _number(raw.get("x")))
                y0 = max(0.0, _number(raw.get("y")))
                x1 = min(width, x0 + max(0.0, _number(raw.get("width"))))
                y1 = min(height, y0 + max(0.0, _number(raw.get("height"))))
                if x1 - x0 < 6 or y1 - y0 < 6:
                    continue
                draw.rectangle((round(x0), round(y0), round(x1), round(y1)), fill=255)
                region_count += 1

        # A fully opaque mask is a safe no-op if every OCR candidate was
        # disabled; it also makes accidental whole-image generation impossible.
        mask_count = region_count or count
        if mask_count:
            # Give the image model a visibly soft transition.  The later
            # composite still restores every pixel outside this declared mask.
            blur_radius = max(1.5, min(3.0, min(width, height) * 0.0025))
            selected = selected.filter(ImageFilter.GaussianBlur(blur_radius))
        alpha = selected.point(lambda value: 255 - value)
        result = Image.new("RGBA", image.size, (255, 255, 255, 255))
        result.putalpha(alpha)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        result.save(args.output, format="PNG", optimize=True)
        print(json.dumps({"success": True, "width": width, "height": height, "blocks": count, "regions": region_count, "padding": round(base_padding, 2), "blur": round(blur_radius if mask_count else 0, 2)}, ensure_ascii=False))
        return 0
    except Exception as exc:  # pragma: no cover
        print(json.dumps({"success": False, "error": str(exc)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
