#!/usr/bin/env python3
"""Make a transparent-hole image for Codex, whose edit endpoint has no mask field."""

from __future__ import annotations

import argparse
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--mask", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        from PIL import Image

        source = Image.open(args.source).convert("RGBA")
        mask = Image.open(args.mask).convert("RGBA")
        if mask.size != source.size:
            mask = mask.resize(source.size, Image.Resampling.NEAREST)
        # prepare_mask.py uses alpha=0 for the editable region and alpha=255
        # outside. Preserve RGB context while exposing that convention through
        # the first image itself; Codex has no multipart `mask` parameter.
        editable_alpha = mask.getchannel("A")
        source.putalpha(editable_alpha)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        source.save(args.output, format="PNG", optimize=True)
        print(f"{source.width}x{source.height}")
        return 0
    except Exception as exc:
        print(str(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

