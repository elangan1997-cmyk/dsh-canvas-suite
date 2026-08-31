#!/usr/bin/env python3
"""Return OCR text blocks for a raster image.

This is intentionally small and deterministic: the browser owns the review UI,
while this script only returns candidate text and pixel bounds.  It never edits
the source image.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


def clean_text(value: object) -> str:
    # Tesseract often inserts a space between adjacent CJK glyphs.  Those
    # spaces are not part of the artwork and would become visible gaps in a
    # Photoshop text layer, so remove whitespace only at CJK/CJK boundaries;
    # normal spaces inside Latin words (for example “Aquarium Filter Media”)
    # remain intact.
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    text = re.sub(r"(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])", "", text)
    text = re.sub(r"(?<=[\u3400-\u9fff])\s+(?=[，。！？；：、）》】])", "", text)
    text = re.sub(r"([（【《])\s+", r"\1", text)
    return text


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--lang", default="chi_sim+eng")
    parser.add_argument("--psm", default="11")
    parser.add_argument("--crop", default="", help="optional JSON rectangle in original-image pixels")
    args = parser.parse_args()
    try:
        from PIL import Image
        import pytesseract
        from pytesseract import Output

        image_path = Path(args.input)
        if not image_path.is_file() or image_path.stat().st_size <= 0:
            raise RuntimeError("OCR 输入图片不存在或为空")
        image = Image.open(image_path).convert("RGB")
        original_width, original_height = image.size
        offset_x = 0
        offset_y = 0
        crop_info = None
        if args.crop:
            try:
                raw_crop = json.loads(args.crop)
            except json.JSONDecodeError as exc:
                raise RuntimeError("框选区域无效") from exc
            if not isinstance(raw_crop, dict):
                raise RuntimeError("框选区域无效")
            left = max(0, min(original_width - 1, int(round(float(raw_crop.get("x", 0) or 0)))))
            top = max(0, min(original_height - 1, int(round(float(raw_crop.get("y", 0) or 0)))))
            right = max(left + 1, min(original_width, int(round(left + float(raw_crop.get("width", 0) or 0)))))
            bottom = max(top + 1, min(original_height, int(round(top + float(raw_crop.get("height", 0) or 0)))))
            if right - left < 6 or bottom - top < 6:
                raise RuntimeError("框选区域太小")
            offset_x, offset_y = left, top
            crop_info = {"x": left, "y": top, "width": right - left, "height": bottom - top}
            image = image.crop((left, top, right, bottom))
        data = pytesseract.image_to_data(
            image,
            lang=args.lang,
            config=f"--psm {args.psm}",
            output_type=Output.DICT,
        )
        groups: dict[tuple[str, str, str, str], dict] = {}
        total = len(data.get("text", []))
        for index in range(total):
            text = clean_text(data["text"][index])
            try:
                confidence = float(data.get("conf", ["-1"] * total)[index])
            except (TypeError, ValueError):
                confidence = -1.0
            if not text or confidence < 30:
                continue
            # Tesseract occasionally emits short Latin-looking fragments for
            # Chinese artwork (e.g. “STL”, “eae”, “ou”).  Keep normal English
            # phrases and numbers, but require stronger evidence for a
            # Latin-only token and discard tiny one/two-character fragments.
            has_cjk = bool(re.search(r"[\u3400-\u9fff]", text))
            has_digit = bool(re.search(r"[0-9]", text))
            latin_only = bool(re.fullmatch(r"[A-Za-z][A-Za-z .,'’:/+&-]*", text))
            if latin_only and not has_digit and confidence < 55:
                continue
            compact_len = len(re.sub(r"[^A-Za-z0-9\u3400-\u9fff]", "", text))
            if not has_cjk and compact_len <= 2 and confidence < 58:
                continue
            key = tuple(str(data.get(name, [""] * total)[index]) for name in ("block_num", "par_num", "line_num", "page_num"))
            left = int(data.get("left", [0] * total)[index] or 0)
            top = int(data.get("top", [0] * total)[index] or 0)
            width = int(data.get("width", [0] * total)[index] or 0)
            height = int(data.get("height", [0] * total)[index] or 0)
            item = groups.setdefault(key, {"parts": [], "x": left, "y": top, "right": left + width, "bottom": top + height, "confidence": confidence, "context": key[:2]})
            item["parts"].append(text)
            item["x"] = min(item["x"], left)
            item["y"] = min(item["y"], top)
            item["right"] = max(item["right"], left + width)
            item["bottom"] = max(item["bottom"], top + height)
            item["confidence"] = max(item["confidence"], confidence)

        # Tesseract's line_num is a useful hint but not a visual guarantee:
        # one long artwork line is sometimes returned as two adjacent lines
        # (especially after a crop or with mixed CJK/Latin text).  First turn
        # the groups into geometry-aware rows, then merge only items that are
        # on the same baseline and close enough horizontally.  This keeps real
        # stacked lines separate while avoiding duplicate PSD text layers.
        lines = []
        for item in groups.values():
            text = clean_text(" ".join(item["parts"]))
            if not text or not re.search(r"[A-Za-z0-9\u3400-\u9fff]", text):
                continue
            box_height = max(1, int(item["bottom"] - item["y"]))
            lines.append({
                "text": text,
                "originalText": text,
                "x": max(0, int(item["x"]) + offset_x),
                "y": max(0, int(item["y"]) + offset_y),
                "width": max(1, int(item["right"] - item["x"])),
                "height": box_height,
                "right": max(0, int(item["right"]) + offset_x),
                "bottom": max(0, int(item["bottom"]) + offset_y),
                "context": tuple(str(item.get(name, "")) for name in ("block_num", "par_num")),
                "confidence": round(float(item["confidence"]), 1),
                "enabled": True,
                "fontSize": max(12, min(220, int(box_height * 0.92))),
                # Photoshop needs a real PostScript font name.  Arial Unicode
                # MS is absent on many current macOS installations and can
                # make native Chinese layers appear garbled.
                "fontFamily": "PingFang SC",
                "fontPostScript": "PingFangSC-Regular",
                "fontWeight": "normal",
                "color": "#111827",
            })
        lines.sort(key=lambda item: (item["y"], item["x"]))
        merged_lines = []
        for item in lines:
            if not merged_lines:
                merged_lines.append(item)
                continue
            previous = merged_lines[-1]
            previous_height = max(1, int(previous["height"]))
            current_height = max(1, int(item["height"]))
            max_height = max(previous_height, current_height)
            overlap = max(0, min(previous["bottom"], item["bottom"]) - max(previous["y"], item["y"]))
            overlap_ratio = overlap / max(1, min(previous_height, current_height))
            center_delta = abs((previous["y"] + previous["bottom"]) / 2 - (item["y"] + item["bottom"]) / 2)
            same_row = overlap_ratio >= 0.45 or center_delta <= max_height * 0.45
            left_item, right_item = (previous, item) if previous["x"] <= item["x"] else (item, previous)
            horizontal_gap = max(0, int(right_item["x"] - left_item["right"]))
            near = horizontal_gap <= max(96, int(max_height * 4))
            same_context = previous.get("context") == item.get("context")
            if same_row and near and (same_context or overlap_ratio >= 0.62):
                previous["text"] = clean_text(previous["text"] + " " + item["text"])
                previous["originalText"] = previous["text"]
                previous["x"] = min(previous["x"], item["x"])
                previous["y"] = min(previous["y"], item["y"])
                previous["right"] = max(previous["right"], item["right"])
                previous["bottom"] = max(previous["bottom"], item["bottom"])
                previous["width"] = max(1, int(previous["right"] - previous["x"]))
                previous["height"] = max(1, int(previous["bottom"] - previous["y"]))
                previous["confidence"] = max(previous["confidence"], item["confidence"])
                previous["fontSize"] = max(12, min(220, int(previous["height"] * 0.92)))
            else:
                merged_lines.append(item)

        blocks = []
        for index, item in enumerate(merged_lines):
            item.pop("right", None)
            item.pop("bottom", None)
            item.pop("context", None)
            item["id"] = f"ocr-{index + 1}"
            blocks.append(item)
        for index, item in enumerate(blocks):
            item["id"] = f"ocr-{index + 1}"
        result = {"success": True, "width": original_width, "height": original_height, "blocks": blocks[:200]}
        if crop_info:
            result["crop"] = crop_info
        # Keep stdout ASCII-only so Windows DSH subprocess decoding cannot
        # replace Chinese OCR text before the host parses the JSON.
        print(json.dumps(result))
        return 0
    except Exception as exc:  # pragma: no cover - surfaced to host/UI
        print(json.dumps({"success": False, "error": str(exc)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
