#!/usr/bin/env python3
"""Render the merged composite of a PSD as a bounded JPEG preview."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from export_text_psd import ensure_runtime


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--max-side", type=int, default=2400)
    args = parser.parse_args()

    ensure_runtime()
    from PIL import Image
    from psd_tools import PSDImage

    psd = PSDImage.open(args.input)
    composite = psd.composite()
    if composite is None:
        raise RuntimeError("PSD does not contain a renderable composite")
    composite.thumbnail((args.max_side, args.max_side), Image.Resampling.LANCZOS)
    if composite.mode == "RGBA":
        background = Image.new("RGB", composite.size, "white")
        background.paste(composite, mask=composite.getchannel("A"))
        composite = background
    elif composite.mode != "RGB":
        composite = composite.convert("RGB")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    composite.save(args.output, "JPEG", quality=88, optimize=True)
    print(json.dumps({"ok": True, "width": composite.width, "height": composite.height, "output": str(args.output)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
