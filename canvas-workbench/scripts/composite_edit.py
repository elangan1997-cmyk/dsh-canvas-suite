#!/usr/bin/env python3
"""Preserve source pixels outside an inpainting mask."""

import argparse
import pathlib
from PIL import Image, ImageChops, ImageFilter


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=pathlib.Path)
    parser.add_argument("--generated", required=True, type=pathlib.Path)
    parser.add_argument("--mask", type=pathlib.Path)
    parser.add_argument("--output", required=True, type=pathlib.Path)
    args = parser.parse_args()

    source = Image.open(args.source).convert("RGBA")
    generated = Image.open(args.generated).convert("RGBA")
    if generated.size != source.size:
        generated = generated.resize(source.size, Image.Resampling.LANCZOS)

    if args.mask:
        mask_rgba = Image.open(args.mask).convert("RGBA")
        if mask_rgba.size != source.size:
            mask_rgba = mask_rgba.resize(source.size, Image.Resampling.NEAREST)
        alpha = mask_rgba.getchannel("A")
        selected = alpha.point(lambda value: 255 - value)
        # The prepared mask already contains the safety expansion around the
        # painted area. Keep that core fully generated so old glyphs cannot
        # leak back into the repaired region.
        core = selected.point(lambda value: 255 if value >= 8 else 0)
        # Feather only a narrow outer ring to remove the visible cut line. The
        # prepared mask has already covered antialiasing/shadows, so this ring
        # is deliberately small and cannot reintroduce the original content.
        # A 2–6px ring is barely visible at normal zoom but still reads as a
        # hard layer edge when the user inspects the result closely. Use a
        # wider, low-frequency transition (roughly 1.2% of the image short side)
        # while keeping the generated core fully opaque.
        feather_radius = max(12, min(24, round(min(source.size) * 0.012)))
        feather_kernel = feather_radius * 2 + 1
        expanded = core.filter(ImageFilter.MaxFilter(feather_kernel))
        feather = expanded.filter(ImageFilter.GaussianBlur(max(2.5, feather_radius * 0.72)))
        # GaussianBlur has a soft tail; clip it back to the geometric ring so
        # no generated pixels are ever written outside the declared feather.
        feather = ImageChops.multiply(feather, expanded)
        edit_region = ImageChops.lighter(core, feather)
        result = Image.composite(generated, source, edit_region)
    else:
        result = generated

    args.output.parent.mkdir(parents=True, exist_ok=True)
    result.convert("RGB").save(args.output, format="PNG", optimize=True)


if __name__ == "__main__":
    main()
