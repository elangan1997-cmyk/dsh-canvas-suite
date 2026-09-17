#!/usr/bin/env python3
"""List / edit layers of DSH-generated (or compatible) SVG documents.

--list                                  one JSON per line: {id, name, kind, x, y, w, h}
--replace-image --input new.png         replace the embedded background image's
--svg doc.svg --output out.svg          data URI with the new PNG (text elements untouched)

图层语义：SVG 没有真正的图层面板；我们把可编辑对象列为「背景位图（Image）」与
「文字对象（Text）」。文字对象由 Illustrator/编辑器直接编辑，本脚本不改动它们。
"""

import argparse
import base64
import io
import json
import pathlib
import sys
import xml.etree.ElementTree as ET

SVG_NS = "http://www.w3.org/2000/svg"
XLINK_NS = "http://www.w3.org/1999/xlink"
ET.register_namespace("", SVG_NS)
ET.register_namespace("xlink", XLINK_NS)


def attr_number(el, name, default=0.0):
    try:
        return round(float(el.get(name, default)), 1)
    except (TypeError, ValueError):
        return default


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--svg", required=True, type=pathlib.Path)
    parser.add_argument("--list", action="store_true")
    parser.add_argument("--replace-image", action="store_true")
    parser.add_argument("--input", type=pathlib.Path)
    parser.add_argument("--output", type=pathlib.Path)
    args = parser.parse_args()
    try:
        tree = ET.parse(args.svg)
        root = tree.getroot()
        canvas_w = attr_number(root, "width", 1)
        canvas_h = attr_number(root, "height", 1)
        if args.list:
            index = 0
            for image in root.iter(f"{{{SVG_NS}}}image"):
                print(json.dumps({
                    "id": index, "name": "背景位图", "kind": "Image", "visible": True,
                    "x": attr_number(image, "x"), "y": attr_number(image, "y"),
                    "w": attr_number(image, "width"), "h": attr_number(image, "height"),
                    "canvas": [canvas_w, canvas_h],
                }, ensure_ascii=False))
                index += 1
            for text in root.iter(f"{{{SVG_NS}}}text"):
                content = "".join(text.itertext()).strip()
                print(json.dumps({
                    "id": index, "name": (content[:16] or "文字对象"), "kind": "Text", "visible": True,
                    "x": attr_number(text, "x"), "y": attr_number(text, "y"),
                    "w": attr_number(text, "width", 0), "h": attr_number(text, "font-size", 0),
                    "canvas": [canvas_w, canvas_h],
                }, ensure_ascii=False))
                index += 1
            return 0
        if args.replace_image:
            if not args.input or not args.output:
                parser.error("--replace-image 需要 --input 与 --output")
            from PIL import Image
            png = Image.open(args.input).convert("RGBA")
            buffer = io.BytesIO()
            png.save(buffer, format="PNG", optimize=True)
            href = "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")
            replaced = 0
            for image in root.iter(f"{{{SVG_NS}}}image"):
                image.set(f"{{{XLINK_NS}}}href", href)
                replaced += 1
            if not replaced:
                raise ValueError("SVG 中没有找到内嵌位图")
            args.output.parent.mkdir(parents=True, exist_ok=True)
            tree.write(args.output, encoding="utf-8", xml_declaration=True)
            print(json.dumps({"success": True, "replaced": replaced, "canvas": [canvas_w, canvas_h]}, ensure_ascii=False))
            return 0
        parser.error("需要 --list 或 --replace-image")
    except Exception as exc:
        print(json.dumps({"success": False, "error": str(exc)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
