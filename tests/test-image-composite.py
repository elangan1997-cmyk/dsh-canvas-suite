"""Regression checks for the canvas erase/edit mask and seam composite."""

from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
PREPARE_MASK = ROOT / "canvas-workbench" / "scripts" / "prepare_mask.py"
COMPOSITE = ROOT / "canvas-workbench" / "scripts" / "composite_edit.py"


def run(*args: str) -> None:
    result = subprocess.run([sys.executable, *args], cwd=ROOT, capture_output=True, text=True)
    if result.returncode:
        raise AssertionError(f"command failed: {result.stderr or result.stdout}")


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="dsh-image-composite-") as temp:
        temp_dir = Path(temp)
        source_path = temp_dir / "source.png"
        raw_mask_path = temp_dir / "raw-mask.png"
        prepared_path = temp_dir / "prepared.png"
        generated_path = temp_dir / "generated.png"
        output_path = temp_dir / "output.png"

        # A simple 100px image makes the expected 0.5% mask allowance easy to
        # reason about: a 4px dilation, not the former 10px minimum.
        Image.new("RGB", (100, 100), (20, 80, 180)).save(source_path)
        raw_mask = Image.new("RGBA", (100, 100), (255, 255, 255, 255))
        for y in range(40, 60):
            for x in range(40, 60):
                raw_mask.putpixel((x, y), (255, 255, 255, 0))
        raw_mask.save(raw_mask_path)
        run(str(PREPARE_MASK), "--source", str(source_path), "--mask", str(raw_mask_path), "--output", str(prepared_path))

        prepared = Image.open(prepared_path).convert("RGBA")
        selected = [(x, y) for y in range(100) for x in range(100) if prepared.getpixel((x, y))[3] == 0]
        min_x = min(x for x, _ in selected)
        max_x = max(x for x, _ in selected)
        min_y = min(y for _, y in selected)
        max_y = max(y for _, y in selected)
        assert (min_x, max_x, min_y, max_y) == (36, 63, 36, 63), (min_x, max_x, min_y, max_y)

        Image.new("RGB", (100, 100), (220, 40, 40)).save(generated_path)
        run(str(COMPOSITE), "--source", str(source_path), "--generated", str(generated_path), "--mask", str(prepared_path), "--output", str(output_path))
        output = Image.open(output_path).convert("RGB")

        # Core is generated, far outside is byte-for-byte source, and the
        # boundary is an actual blend rather than a hard rectangular cut.
        assert output.getpixel((50, 50)) == (220, 40, 40)
        assert output.getpixel((5, 5)) == (20, 80, 180)
        boundary = output.getpixel((35, 50))
        assert boundary != (20, 80, 180) and boundary != (220, 40, 40), boundary

    print("image mask/composite seam checks passed")


if __name__ == "__main__":
    main()
