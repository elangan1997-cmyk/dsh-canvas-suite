#!/usr/bin/env python3
"""Preserve source pixels outside an inpainting mask."""

import argparse
import pathlib
from PIL import Image


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
        # prepare_text_mask already supplies an opaque repaired core plus a
        # controlled soft edge. Re-expanding it here used to overwrite nearby
        # geometry and produced the straight displaced borders visible around
        # balls/products. Respect the prepared alpha exactly once.
        result = Image.composite(generated, source, selected)
    else:
        result = generated

    args.output.parent.mkdir(parents=True, exist_ok=True)
    result.convert("RGB").save(args.output, format="PNG", optimize=True)


if __name__ == "__main__":
    main()
