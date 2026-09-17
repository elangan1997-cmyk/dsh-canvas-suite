#!/usr/bin/env python3
"""List / extract PSD layers without launching Photoshop.

--list            one JSON line per layer: {id, name, kind, visible, x, y, w, h}
--extract --id N  render layer N onto a full-canvas transparent PNG (pixels at
                  their original offset) so the edit keeps full context and the
                  write-back keeps the original position.

id = index in psd.descendants() order (top-most first, group children inline).
"""

import argparse
import json
import pathlib
import sys

from psd_tools import PSDImage


def layer_info(index, layer, size):
    return {
        "id": index,
        "name": str(layer.name or ("图层 " + str(index + 1))),
        "kind": str(layer.kind or "pixel"),
        "visible": bool(layer.visible),
        "x": int(layer.left or 0),
        "y": int(layer.top or 0),
        "w": int((layer.right or 0) - (layer.left or 0)),
        "h": int((layer.bottom or 0) - (layer.top or 0)),
        "canvas": [int(size[0]), int(size[1])],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--psd", required=True, type=pathlib.Path)
    parser.add_argument("--list", action="store_true")
    parser.add_argument("--thumbs", action="store_true", help="为每个图层生成缩略图（最大边 320px）到 --outdir")
    parser.add_argument("--outdir", type=pathlib.Path)
    parser.add_argument("--extract", action="store_true")
    parser.add_argument("--id", type=int, default=-1)
    parser.add_argument("--output", type=pathlib.Path)
    args = parser.parse_args()
    try:
        psd = PSDImage.open(args.psd)
        layers = list(psd.descendants())
        if args.list:
            for index, layer in enumerate(layers):
                print(json.dumps(layer_info(index, layer, psd.size), ensure_ascii=False))
            return 0
        if args.thumbs:
            if not args.outdir:
                parser.error("--thumbs 需要 --outdir")
            args.outdir.mkdir(parents=True, exist_ok=True)
            from PIL import Image
            for index, layer in enumerate(layers[:30]):
                try:
                    try:
                        pixels = layer.topil()
                    except Exception:
                        pixels = layer.composite()
                    if pixels is None:
                        continue
                    if pixels.mode != "RGBA":
                        pixels = pixels.convert("RGBA")
                    pixels.thumbnail((320, 320))
                    out = args.outdir / f"thumb-{index}.png"
                    pixels.save(out, format="PNG", optimize=True)
                    print(json.dumps({"id": index, "file": str(out)}, ensure_ascii=False))
                except Exception:
                    continue
            return 0
        if args.extract:
            if not (0 <= args.id < len(layers)) or not args.output:
                raise ValueError("需要 0 ≤ --id < 图层数，以及 --output")
            layer = layers[args.id]
            from PIL import Image
            canvas = Image.new("RGBA", psd.size, (0, 0, 0, 0))
            try:
                pixels = layer.topil()
            except Exception:
                pixels = None
            if pixels is None:
                pixels = layer.composite()
            if pixels.mode != "RGBA":
                pixels = pixels.convert("RGBA")
            # negative offsets（图层超出画布）用正数 paste 坐标无法表达，先裁掉界外部分
            px, py = max(0, layer.left or 0), max(0, layer.top or 0)
            paste = pixels.crop((px - (layer.left or 0), py - (layer.top or 0),
                                 px - (layer.left or 0) + min(pixels.width, psd.size[0] - px),
                                 py - (layer.top or 0) + min(pixels.height, psd.size[1] - py)))
            canvas.paste(paste, (px, py))
            args.output.parent.mkdir(parents=True, exist_ok=True)
            canvas.save(args.output, format="PNG", optimize=True)
            print(json.dumps({"success": True, "id": args.id, "canvas": [psd.size[0], psd.size[1]],
                              "bounds": [layer.left or 0, layer.top or 0, layer.right or 0, layer.bottom or 0]}, ensure_ascii=False))
            return 0
        parser.error("需要 --list 或 --extract")
    except Exception as exc:
        print(json.dumps({"success": False, "error": str(exc)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
