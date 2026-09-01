#!/usr/bin/env python3
"""Remove only glyph-mask pixels while preserving surrounding artwork."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--mask", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        import numpy as np
        from PIL import Image

        source = np.asarray(Image.open(args.source).convert("RGB"), dtype=np.uint8)
        rgba = Image.open(args.mask).convert("RGBA")
        alpha = np.asarray(rgba.getchannel("A"), dtype=np.uint8)
        editable = 255 - alpha
        # The prepared mask already follows glyph contours. A small binary
        # core covers antialiasing without opening the underlying button/card.
        binary = np.where(editable >= 18, 255, 0).astype(np.uint8)
        if binary.shape[:2] != source.shape[:2]:
            binary = np.asarray(Image.fromarray(binary).resize((source.shape[1], source.shape[0]), Image.Resampling.NEAREST))
        if not np.any(binary):
            raise RuntimeError("字形遮罩为空")
        repaired = source.copy()
        active = binary > 0
        height, width = active.shape
        # Artwork labels commonly use a vertical gradient. For every
        # contiguous glyph run in a column, interpolate only between the
        # untouched pixels immediately above and below it. This preserves the
        # original button/card gradient and changes zero pixels outside glyphs.
        for x in range(width):
            ys = np.flatnonzero(active[:, x])
            if ys.size == 0:
                continue
            start = 0
            while start < ys.size:
                end = start
                while end + 1 < ys.size and ys[end + 1] == ys[end] + 1:
                    end += 1
                y0, y1 = int(ys[start]), int(ys[end])
                top = y0 - 1
                bottom = y1 + 1
                if top >= 0 and bottom < height:
                    first = source[top, x].astype(np.float32)
                    last = source[bottom, x].astype(np.float32)
                    span = float(bottom - top)
                    for y in range(y0, y1 + 1):
                        ratio = (y - top) / span
                        repaired[y, x] = np.clip(first * (1.0 - ratio) + last * ratio, 0, 255).astype(np.uint8)
                elif top >= 0:
                    repaired[y0:y1 + 1, x] = source[top, x]
                elif bottom < height:
                    repaired[y0:y1 + 1, x] = source[bottom, x]
                start = end + 1
        args.output.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(repaired, mode="RGB").save(args.output, format="PNG", optimize=True)
        print(json.dumps({"success": True, "pixels": int(np.count_nonzero(binary)), "engine": "scanline-gradient-glyph-mask"}, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({"success": False, "error": str(exc)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
