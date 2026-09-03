#!/usr/bin/env bash
set -euo pipefail

USER_HOME="${HOME:?无法确定用户目录}"
LABEL="ai.deepseek.dsh.canvas-suite.sync"
UID_VALUE="$(id -u)"

launchctl bootout "gui/$UID_VALUE/$LABEL" >/dev/null 2>&1 || true
rm -f "$USER_HOME/Library/LaunchAgents/$LABEL.plist"

for target in \
  "$USER_HOME/.dsh/profiles/node_modules/@local/canvas-workbench" \
  "$USER_HOME/.dsh/profiles/desktop/node_modules/@local/canvas-workbench" \
  "$USER_HOME/.dsh/profiles/node_modules/dsh-codex"; do
  [ -e "$target" ] || [ -L "$target" ] || continue
  rm -rf "$target"
done

for patch in "$USER_HOME/.dsh/profiles"/*/cordis.patch.yml; do
  [ -f "$patch" ] || continue
  temp="$patch.tmp.$$"
  awk '
    BEGIN { skip=0; n=0 }
    /^- insert:/ { n=1; block[1]=$0; next }
    n>0 {
      n++; block[n]=$0
      if ($0 ~ /^[^[:space:]-]/ || ($0 ~ /^- / && $0 !~ /^- insert:/)) {
        for (i=1;i<n;i++) print block[i]
        n=0; print $0
      } else if ($0 ~ /name:.*(@local\/canvas-workbench|dsh-codex)/) {
        skip=1
      }
      next
    }
    { print }
    END { if (n>0 && !skip) for (i=1;i<=n;i++) print block[i] }
  ' "$patch" > "$temp"
  mv "$temp" "$patch"
done

# 只移除套件管理的运行时与模型；画布项目、图片、API 凭据和 DSH 会话不删除。
rm -rf "$USER_HOME/.dsh/canvas-workbench/python-runtime" \
  "$USER_HOME/.dsh/canvas-workbench/imagetracer-runtime" \
  "$USER_HOME/.dsh/canvas-workbench/rembg-models/isnet-general-use.onnx" \
  "$USER_HOME/.dsh/canvas-workbench/runtime-manifest.json"

echo "已移除 DSH 画布插件。请重启 DSH Desktop。"
