#!/usr/bin/env python3
"""Preserve source pixels outside an inpainting mask."""

import argparse
import pathlib
from PIL import Image, ImageChops, ImageFilter, ImageOps


def resize_preserving_aspect(image, size):
    """Map a model result to the source canvas without non-uniform stretching."""
    if image.size == size:
        return image
    # Image models normally preserve the requested aspect ratio.  When a
    # provider returns a square/legacy response, fit (crop) rather than
    # stretching the product or text; this keeps circles and rounded labels
    # geometrically correct at the cost of only the provider's excess border.
    return ImageOps.fit(image, size, method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))


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
        generated = resize_preserving_aspect(generated, source.size)

    if args.mask:
        mask_rgba = Image.open(args.mask).convert("RGBA")
        if mask_rgba.size != source.size:
            mask_rgba = mask_rgba.resize(source.size, Image.Resampling.NEAREST)
        alpha = mask_rgba.getchannel("A")
        selected = alpha.point(lambda value: 255 - value)
        # The model needs a hard editable area, but a hard compositing edge
        # exposes a rectangular patch whenever the generated clean plate and
        # the source have slightly different colour/noise. Feather only a
        # narrow ring around the prepared selection; never blur the whole
        # image and never expand the model mask here.
        hard = selected.point(lambda value: 255 if value >= 128 else 0)
        short_edge = min(source.size)
        feather_px = max(2, min(12, round(short_edge * 0.006)))
        blurred = hard.filter(ImageFilter.GaussianBlur(feather_px))
        ring_px = max(2, feather_px * 2)
        ring = hard.filter(ImageFilter.MaxFilter(ring_px * 2 + 1))
        soft = ImageChops.multiply(blurred, ring)
        # Keep the inner core fully generated while leaving a smooth gradient
        # at the actual selection edge. Eroding by half the feather width
        # avoids reintroducing a hard transition at the old mask boundary.
        core_px = max(1, feather_px // 2)
        core = hard.filter(ImageFilter.MinFilter(core_px * 2 + 1))
        soft = ImageChops.lighter(soft, core)
        # Pixels outside the ring remain exactly the source pixels.
        result = Image.composite(generated, source, soft)
    else:
        result = generated

    args.output.parent.mkdir(parents=True, exist_ok=True)
    result.convert("RGB").save(args.output, format="PNG", optimize=True)


if __name__ == "__main__":
    main()
