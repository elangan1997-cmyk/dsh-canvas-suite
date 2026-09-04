#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
SOURCE="$SCRIPT_DIR/canvas-workbench"
[ -d "$SOURCE" ] || SOURCE="$SCRIPT_DIR/../canvas-workbench"
DSH_ROOT="${DSH_HOME:-$HOME/.dsh}"
PROFILES_ROOT="$DSH_ROOT/profiles"
LOG_DIR="$DSH_ROOT/logs"
LOG_FILE="$LOG_DIR/dsh-canvas-workbench-install.log"
mkdir -p "$LOG_DIR"

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG_FILE"; }
fail() { log "错误：$*" >&2; exit 1; }
[ -f "$SOURCE/package.json" ] || fail "独立插件包不完整：$SOURCE/package.json"
[ -f "$SOURCE/lib/index.js" ] || fail "独立插件包不完整：$SOURCE/lib/index.js"
[ -d "$PROFILES_ROOT" ] || fail "未找到 DSH profiles：$PROFILES_ROOT。请先安装并启动一次 DSH Desktop。"

copy_plugin() {
  local target="$1" parent stage backup
  parent="$(dirname "$target")"
  stage="$parent/.canvas-workbench.stage.$$"
  backup="$DSH_ROOT/canvas-suite/plugin-backups/$(date '+%Y%m%d-%H%M%S')-$$/$(basename "$target")"
  mkdir -p "$parent" "$stage"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete --exclude='*.pyc' --exclude='*.pyo' --exclude='*.log' --exclude='*.map' --exclude='__pycache__' "$SOURCE/" "$stage/"
  else
    cp -R "$SOURCE/." "$stage/"
    find "$stage" -type f \( -name '*.pyc' -o -name '*.pyo' -o -name '*.log' -o -name '*.map' \) -delete
    find "$stage" -type d -name '__pycache__' -prune -exec rm -rf {} +
  fi
  if [ -e "$target" ] || [ -L "$target" ]; then mkdir -p "$(dirname "$backup")"; mv "$target" "$backup"; fi
  mv "$stage" "$target"
  log "已安装到：$target"
}

for target in \
  "$PROFILES_ROOT/node_modules/@local/canvas-workbench" \
  "$PROFILES_ROOT/web/node_modules/@local/canvas-workbench" \
  "$PROFILES_ROOT/desktop/node_modules/@local/canvas-workbench" \
  "$DSH_ROOT/electron/node_modules/@local/canvas-workbench"; do
  copy_plugin "$target"
done

for profile in web desktop; do
  patch="$PROFILES_ROOT/$profile/cordis.patch.yml"
  [ -f "$patch" ] || continue
  grep -q "name: '@local/canvas-workbench'" "$patch" && continue
  printf '\n- insert:\n    - id: canvas-workbench\n      name: '\''@local/canvas-workbench'\''\n' >> "$patch"
done

electron_patch="$DSH_ROOT/electron/plugins.cordis.yml"
if [ -f "$electron_patch" ] && ! grep -q "name: '@local/canvas-workbench'" "$electron_patch"; then
  printf '\n- id: canvas-workbench\n  name: '\''@local/canvas-workbench'\''\n' >> "$electron_patch"
fi
log 'DSH画布工作台安装检查通过。项目、登录和 API 凭据未修改。'
log '请完全退出并重新打开 DSH Desktop。'
