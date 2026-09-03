#!/usr/bin/env bash
set -euo pipefail
umask 022

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
WORKSPACE_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
DSH_APP_PATH="${DSH_APP_PATH:-/Applications/DSH Desktop.app}"
OUTPUT_DIR="${OUTPUT_DIR:-$WORKSPACE_DIR/dist}"
CACHE_DIR="${MAC_BUNDLE_CACHE:-$SCRIPT_DIR/cache}"
PACKAGE_ID="ai.deepseek.dsh.canvas-suite"
SUITE_NAME="DSH Canvas Suite"
SUITE_VERSION="$(/usr/bin/plutil -extract version raw -o - "$WORKSPACE_DIR/canvas-workbench/package.json" 2>/dev/null || true)"
SUITE_VERSION="${SUITE_VERSION%%-*}"

[ -n "$SUITE_VERSION" ] || { echo "无法读取画布插件版本" >&2; exit 1; }
[ -d "$DSH_APP_PATH" ] || { echo "未找到 DSH Desktop：$DSH_APP_PATH" >&2; exit 1; }
[ -f "$WORKSPACE_DIR/dsh-codex/package.json" ] || { echo "缺少内置 dsh-codex 兼容组件" >&2; exit 1; }
[ -f "$WORKSPACE_DIR/dsh-codex/lib/index.js" ] || { echo "内置 dsh-codex 缺少 lib/index.js" >&2; exit 1; }

for tool in pkgbuild pkgutil mkbom lsbom cpio gzip hdiutil ditto codesign shasum; do
  command -v "$tool" >/dev/null 2>&1 || { echo "缺少构建工具：$tool" >&2; exit 1; }
done

if [ "${SKIP_RUNTIME_PREPARE:-0}" != "1" ]; then
  "$SCRIPT_DIR/prepare-macos-bundle.sh"
fi

node --check "$WORKSPACE_DIR/canvas-workbench/lib/client.js"
node --check "$WORKSPACE_DIR/canvas-workbench/lib/index.js"
node --check "$WORKSPACE_DIR/canvas-workbench/lib/image-engine.js"
bash -n "$WORKSPACE_DIR/sync-local-plugins.sh"
bash -n "$SCRIPT_DIR/scripts/postinstall"
bash -n "$SCRIPT_DIR/uninstall.sh"
bash -n "$SCRIPT_DIR/安装Dockyard-Codex推理.command"
codesign --verify --deep --strict "$DSH_APP_PATH"
[ -f "$CACHE_DIR/runtime-manifest.json" ] || { echo "缺少运行时清单：$CACHE_DIR" >&2; exit 1; }
[ -f "$CACHE_DIR/models/isnet-general-use.onnx" ] || { echo "缺少 ISNet 模型：$CACHE_DIR" >&2; exit 1; }

BUILD_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/dsh-canvas-installer.XXXXXX")"
trap 'rm -rf "$BUILD_ROOT"' EXIT
PKG_ROOT="$BUILD_ROOT/pkg-root"
DMG_ROOT="$BUILD_ROOT/dmg-root"
SUITE_ROOT="$PKG_ROOT/Library/Application Support/$SUITE_NAME"
SCRIPTS_ROOT="$BUILD_ROOT/pkg-scripts"

mkdir -p "$PKG_ROOT/Applications" "$SUITE_ROOT" "$SCRIPTS_ROOT" "$DMG_ROOT" "$OUTPUT_DIR"
/usr/bin/ditto "$DSH_APP_PATH" "$PKG_ROOT/Applications/DSH Desktop.app"
/bin/cp -R -X "$WORKSPACE_DIR/canvas-workbench" "$SUITE_ROOT/canvas-workbench"
/bin/mkdir -p "$SUITE_ROOT/dsh-codex" "$SUITE_ROOT/runtime/macos" "$SUITE_ROOT/runtime/models" "$SUITE_ROOT/runtime/imagetracer-runtime"
for item in package.json cordis.patch.yml LICENSE README.md INSTALL.md README.zh.md UPSTREAM.md; do
  [ -e "$WORKSPACE_DIR/dsh-codex/$item" ] && /bin/cp -R -X "$WORKSPACE_DIR/dsh-codex/$item" "$SUITE_ROOT/dsh-codex/$item"
done
/bin/cp -R -X "$WORKSPACE_DIR/dsh-codex/lib" "$SUITE_ROOT/dsh-codex/lib"
/bin/cp -R -X "$CACHE_DIR/runtimes/aarch64" "$SUITE_ROOT/runtime/macos/aarch64"
/bin/cp -R -X "$CACHE_DIR/runtimes/x86_64" "$SUITE_ROOT/runtime/macos/x86_64"
/bin/cp -X "$CACHE_DIR/models/isnet-general-use.onnx" "$SUITE_ROOT/runtime/models/isnet-general-use.onnx"
/bin/cp -R -X "$CACHE_DIR/js/imagetracer-runtime/." "$SUITE_ROOT/runtime/imagetracer-runtime/"
/bin/cp -X "$CACHE_DIR/runtime-manifest.json" "$SUITE_ROOT/runtime/runtime-manifest.json"
/bin/cp -X "$WORKSPACE_DIR/sync-local-plugins.sh" "$SUITE_ROOT/sync-local-plugins.sh"
/bin/cp -X "$SCRIPT_DIR/uninstall.sh" "$SUITE_ROOT/uninstall.sh"
/bin/cp -X "$SCRIPT_DIR/health-check.sh" "$SUITE_ROOT/health-check.sh"
/bin/cp -X "$SCRIPT_DIR/scripts/postinstall" "$SCRIPTS_ROOT/postinstall"
chmod 755 "$SUITE_ROOT/sync-local-plugins.sh" "$SUITE_ROOT/uninstall.sh" "$SUITE_ROOT/health-check.sh" "$SCRIPTS_ROOT/postinstall"
# Finder/外置盘可能给源码附加 AppleDouble `._*` 侧车或 provenance xattr。
# 先清除扩展属性，再清理一次侧车；否则 pkgbuild 可能把它们重新写入 payload。
/usr/bin/xattr -cr "$PKG_ROOT" >/dev/null 2>&1 || true
/usr/sbin/dot_clean -m "$PKG_ROOT" >/dev/null 2>&1 || true
/usr/bin/find "$PKG_ROOT" -name '._*' -type f -delete
/usr/bin/xattr -cr "$PKG_ROOT" >/dev/null 2>&1 || true
/usr/bin/find "$PKG_ROOT" -name '._*' -type f -delete

PKG_PATH="$OUTPUT_DIR/DSH-Canvas-Suite-$SUITE_VERSION-macOS-Complete.pkg"
DMG_PATH="$OUTPUT_DIR/DSH-Canvas-Suite-$SUITE_VERSION-macOS-Complete.dmg"
rm -f "$PKG_PATH" "$DMG_PATH" "$PKG_PATH.sha256" "$DMG_PATH.sha256"

pkgbuild \
  --root "$PKG_ROOT" \
  --scripts "$SCRIPTS_ROOT" \
  --identifier "$PACKAGE_ID" \
  --version "$SUITE_VERSION" \
  --install-location / \
  "$PKG_PATH"

# pkgbuild 在带有 macOS provenance 扩展属性的文件上会生成 AppleDouble
# `._*` 条目。它们不是应用内容，若直接安装会污染套件目录；展开后移除
# 再重新压回 pkg，同时保留 root:wheel 归档所有权。可用
# STRIP_APPLEDOUBLE=0 关闭（仅用于排查 pkgbuild 行为）。
if [ "${STRIP_APPLEDOUBLE:-1}" = "1" ]; then
  NORMALIZE_ROOT="$BUILD_ROOT/pkg-normalize"
  EXPANDED_PKG="$NORMALIZE_ROOT/expanded"
  PAYLOAD_ROOT="$NORMALIZE_ROOT/payload-root"
  NORMALIZED_PKG="$NORMALIZE_ROOT/normalized.pkg"
  mkdir -p "$NORMALIZE_ROOT" "$PAYLOAD_ROOT"
  pkgutil --expand "$PKG_PATH" "$EXPANDED_PKG"
  (
    cd "$PAYLOAD_ROOT"
    gzip -dc "$EXPANDED_PKG/Payload" | cpio -idm -m >/dev/null 2>&1
    find . -name '._*' -type f -delete
    find . -name '.DS_Store' -type f -delete
    find . -print | cpio -o -H odc --owner 0:0 2>/dev/null | gzip -c > "$EXPANDED_PKG/Payload"
  )
  # 以 pkgbuild 原始 BOM 为基准过滤路径，保留 Installer 需要的 root:wheel
  # 所有权和模式；直接对临时目录 mkbom 会把当前构建用户写进 BOM。
  lsbom "$EXPANDED_PKG/Bom" \
    | awk -F '\t' '$1 !~ /(^|\/)\._[^\/]+$/ && $1 !~ /(^|\/)\.DS_Store$/ { print }' \
    > "$NORMALIZE_ROOT/payload.bom.list"
  mkbom -i "$NORMALIZE_ROOT/payload.bom.list" "$EXPANDED_PKG/Bom"
  find "$EXPANDED_PKG" -name '._*' -type f -delete
  pkgutil --flatten "$EXPANDED_PKG" "$NORMALIZED_PKG"
  mv "$NORMALIZED_PKG" "$PKG_PATH"
fi

cp "$PKG_PATH" "$DMG_ROOT/DSH 完整安装包.pkg"
cp "$SCRIPT_DIR/安装说明.txt" "$DMG_ROOT/安装说明.txt"
/bin/cp -X "$SCRIPT_DIR/交给Agent的安装说明.md" "$DMG_ROOT/交给 Agent 的安装说明.md"
/bin/cp -X "$SCRIPT_DIR/THIRD_PARTY_NOTICES.md" "$DMG_ROOT/第三方组件声明.md"
cp "$SCRIPT_DIR/安装Dockyard-Codex推理.command" "$DMG_ROOT/安装 Dockyard Codex 推理.command"
chmod 755 "$DMG_ROOT/安装 Dockyard Codex 推理.command"
/usr/sbin/dot_clean -m "$DMG_ROOT" >/dev/null 2>&1 || true

hdiutil create \
  -volname "DSH 画布套件 $SUITE_VERSION" \
  -srcfolder "$DMG_ROOT" \
  -format UDZO \
  -imagekey zlib-level=9 \
  -ov "$DMG_PATH"

(cd "$OUTPUT_DIR" && shasum -a 256 "$(basename "$PKG_PATH")" > "$(basename "$PKG_PATH").sha256")
(cd "$OUTPUT_DIR" && shasum -a 256 "$(basename "$DMG_PATH")" > "$(basename "$DMG_PATH").sha256")

echo "构建完成："
echo "  $PKG_PATH"
echo "  $DMG_PATH"
