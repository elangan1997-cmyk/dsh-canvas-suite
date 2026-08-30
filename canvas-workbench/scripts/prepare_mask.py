#!/usr/bin/env python3
"""Normalize and expand a transparent-area inpainting mask."""

import argparse
import pathlib
from PIL import Image, ImageFilter


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=pathlib.Path)
    parser.add_argument("--mask", required=True, type=pathlib.Path)
    parser.add_argument("--output", required=True, type=pathlib.Path)
    args = parser.parse_args()

    source = Image.open(args.source)
    mask = Image.open(args.mask).convert("RGBA")
    if mask.size != source.size:
        mask = mask.resize(source.size, Image.Resampling.NEAREST)

    # The canvas mask uses transparent pixels for the editable region. Expand
    # that region enough to include glyph antialiasing, shadows and outlines.
    selected = mask.getchannel("A").point(lambda value: 255 - value)
    # Bold display type often has antialiasing, shadow and outline extending
    # well beyond the user's painted centre line. At 2K/2.4K the previous 24px
    # cap could leave vertical glyph fragments outside the composite core.
    # Use roughly 2% of the short side, capped at 48px to avoid reaching nearby
    # products when the user paints a reasonably tight selection.
    radius = max(10, min(48, round(min(source.size) * 0.020)))
    kernel = radius * 2 + 1
    if kernel % 2 == 0:
        kernel += 1
    selected = selected.filter(ImageFilter.MaxFilter(kernel)).point(lambda value: 255 if value >= 8 else 0)
    alpha = selected.point(lambda value: 255 - value)

    prepared = Image.new("RGBA", source.size, (255, 255, 255, 255))
    prepared.putalpha(alpha)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    prepared.save(args.output, format="PNG", optimize=True)


if __name__ == "__main__":
    main()
