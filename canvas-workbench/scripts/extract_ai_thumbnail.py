#!/usr/bin/env python3
import argparse
import base64
import html
import re
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    raw = Path(args.input).read_bytes()
    text = raw.decode("latin-1", errors="ignore")
    match = re.search(
        r"<xmpGImg:image>(.*?)</xmpGImg:image>", text, flags=re.IGNORECASE | re.DOTALL
    )
    if not match:
        raise RuntimeError("AI file has no embedded XMP thumbnail")

    encoded = html.unescape(match.group(1))
    encoded = re.sub(r"\s+", "", encoded)
    image = base64.b64decode(encoded, validate=True)
    if len(image) < 256 or not image.startswith(b"\xff\xd8\xff"):
        raise RuntimeError("AI embedded thumbnail is not a valid JPEG")

    Path(args.output).write_bytes(image)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

