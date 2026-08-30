#!/usr/bin/env python3
"""Prepare a compact, dimension-matched image/mask pair for image APIs."""

import argparse
import pathlib
from PIL import Image


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=pathlib.Path)
    parser.add_argument("--output-image", required=True, type=pathlib.Path)
    parser.add_argument("--mask", type=pathlib.Path)
    parser.add_argument("--output-mask", type=pathlib.Path)
    parser.add_argument("--max-side", type=int, default=1024)
    args = parser.parse_args()

    source = Image.open(args.source).convert("RGB")
    width, height = source.size
    scale = min(1.0, max(64, args.max_side) / max(width, height))
    target = (max(1, round(width * scale)), max(1, round(height * scale)))
    if target != source.size:
        source = source.resize(target, Image.Resampling.LANCZOS)

    args.output_image.parent.mkdir(parents=True, exist_ok=True)
    source.save(args.output_image, format="WEBP", quality=90, method=6)

    if args.mask:
        if not args.output_mask:
            parser.error("--output-mask is required with --mask")
        mask = Image.open(args.mask).convert("RGBA")
        if mask.size != target:
            mask = mask.resize(target, Image.Resampling.LANCZOS)
        args.output_mask.parent.mkdir(parents=True, exist_ok=True)
        mask.save(args.output_mask, format="PNG", optimize=True)

    print(f"{width}x{height}->{target[0]}x{target[1]}")


if __name__ == "__main__":
    main()
