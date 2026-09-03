#!/usr/bin/env bash
set -euo pipefail
umask 022

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
WORKSPACE_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
CACHE_DIR="${MAC_BUNDLE_CACHE:-$SCRIPT_DIR/cache}"
PYTHON_TAG="${PYTHON_STANDALONE_TAG:-20260825}"
PYTHON_VERSION="${PYTHON_STANDALONE_VERSION:-3.12.14}"
PYTHON_BASE="https://github.com/astral-sh/python-build-standalone/releases/download/$PYTHON_TAG"
MODEL_URL="https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx"
MODEL_SHA256="60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a"
REQUIREMENTS="$SCRIPT_DIR/runtime-requirements.txt"

mkdir -p "$CACHE_DIR/downloads" "$CACHE_DIR/runtimes" "$CACHE_DIR/models" "$CACHE_DIR/js"

download() {
  local url="$1" output="$2"
  [ -s "$output" ] && return 0
  local temporary="$output.part"
  rm -f "$temporary"
  echo "下载：$url"
  curl --fail --location --retry 4 --retry-delay 3 --connect-timeout 30 \
    -A 'DSH-Canvas-Suite-Builder/1.0' -o "$temporary" "$url"
  mv "$temporary" "$output"
}

sha256_value() {
  shasum -a 256 "$1" | awk '{print $1}'
}

prepare_python_arch() {
  local arch="$1"
  local archive="$CACHE_DIR/downloads/cpython-$PYTHON_VERSION-$arch.tar.gz"
  local url="$PYTHON_BASE/cpython-$PYTHON_VERSION+$PYTHON_TAG-$arch-apple-darwin-install_only_stripped.tar.gz"
  local target="$CACHE_DIR/runtimes/$arch"
  local marker="$target/.dsh-canvas-runtime-ready"
  local requirement_hash
  requirement_hash="$(sha256_value "$REQUIREMENTS")"
  if [ -f "$marker" ] && grep -qF "$PYTHON_VERSION:$PYTHON_TAG:$requirement_hash" "$marker"; then
    echo "复用 Python 运行时：$arch"
    return 0
  fi
  download "$url" "$archive"
  rm -rf "$target"
  mkdir -p "$target"
  tar -xzf "$archive" -C "$target" --strip-components=1
  local python="$target/bin/python3"
  [ -x "$python" ] || { echo "Python 解压失败：$python" >&2; exit 1; }
  if [ "$arch" = "x86_64" ] && [ "$(uname -m)" = "arm64" ]; then
    arch -x86_64 "$python" -m pip install --disable-pip-version-check --prefer-binary -r "$REQUIREMENTS"
  else
    "$python" -m pip install --disable-pip-version-check --prefer-binary -r "$REQUIREMENTS"
  fi
  # Remove only deterministic caches/tests; package metadata and licenses stay
  # in the installer for auditability.
  find "$target" -type d \( -name __pycache__ -o -name tests -o -name test \) -prune -exec rm -rf {} + 2>/dev/null || true
  find "$target" -type f \( -name '*.pyc' -o -name '*.pyo' \) -delete 2>/dev/null || true
  printf '%s\n' "$PYTHON_VERSION:$PYTHON_TAG:$requirement_hash" > "$marker"
  "$python" - <<'PY'
import PIL, psd_tools, pytesseract, rembg, vtracer
print('runtime imports ok')
PY
}

prepare_model() {
  local output="$CACHE_DIR/models/isnet-general-use.onnx"
  local local_model="$HOME/.dsh/canvas-workbench/rembg-models/isnet-general-use.onnx"
  if [ ! -s "$output" ] && [ -s "$local_model" ]; then
    cp "$local_model" "$output"
  fi
  if [ ! -s "$output" ]; then download "$MODEL_URL" "$output"; fi
  local actual
  actual="$(sha256_value "$output")"
  [ "$actual" = "$MODEL_SHA256" ] || { echo "ISNet 模型校验失败：$actual" >&2; exit 1; }
}

prepare_imagetracer() {
  local source="$HOME/.dsh/canvas-workbench/imagetracer-runtime"
  local target="$CACHE_DIR/js/imagetracer-runtime"
  if [ -f "$source/node_modules/imagetracerjs/nodecli/nodecli.js" ]; then
    rm -rf "$target"
    mkdir -p "$target"
    cp -R "$source/." "$target/"
    return 0
  fi
  rm -rf "$target"
  mkdir -p "$target"
  npm install --prefix "$target" --no-package-lock --ignore-scripts --no-audit --no-fund imagetracerjs@1.2.6
}

prepare_python_arch aarch64
prepare_python_arch x86_64
prepare_model
prepare_imagetracer

cat > "$CACHE_DIR/runtime-manifest.json" <<EOF
{
  "schemaVersion": 1,
  "python": "$PYTHON_VERSION+$PYTHON_TAG",
  "architectures": ["arm64", "x86_64"],
  "rembg": "2.0.61",
  "backgroundModel": "isnet-general-use",
  "backgroundModelSha256": "$MODEL_SHA256",
  "vtracer": "0.6.15",
  "imagetracerjs": "1.2.6",
  "networkPolicy": "bundled-first; configurable API and Codex OAuth remain available"
}
EOF

echo "macOS 运行环境准备完成：$CACHE_DIR"
