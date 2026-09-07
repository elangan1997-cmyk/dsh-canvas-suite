#!/usr/bin/env bash
set -euo pipefail

USER_HOME="${HOME:?无法确定用户目录}"
LABEL="ai.deepseek.dsh.canvas-suite.sync"
UID_VALUE="$(id -u)"

launchctl bootout "gui/$UID_VALUE/$LABEL" >/dev/null 2>&1 || true
rm -f "$USER_HOME/Library/LaunchAgents/$LABEL.plist"

targets=(
  "$USER_HOME/.dsh/profiles/node_modules/@local/canvas-workbench"
  "$USER_HOME/.dsh/profiles/node_modules/dsh-codex"
)
while IFS= read -r target; do targets+=("$target"); done < <(
  find "$USER_HOME/.dsh/profiles" -mindepth 3 -maxdepth 4 -type d \
    \( -path '*/node_modules/@local/canvas-workbench' -o -path '*/node_modules/dsh-codex' \) \
    2>/dev/null
)
for target in "${targets[@]}"; do
  [ -e "$target" ] || [ -L "$target" ] || continue
  rm -rf "$target"
done

for patch in "$USER_HOME/.dsh/profiles"/*/cordis.patch.yml; do
  [ -f "$patch" ] || continue
  temp="$patch.tmp.$$"
  awk '
    { lines[++n]=$0 }
    END {
      for (i=1; i<=n; i++) {
        if (lines[i] ~ /^[[:space:]]*- insert:[[:space:]]*$/ && i+2<=n &&
            lines[i+1] ~ /^[[:space:]]*- id:[[:space:]]*(canvas-workbench|llm-openai-codex)[[:space:]]*$/ &&
            lines[i+2] ~ /name:.*(@local\/canvas-workbench|dsh-codex)/) {
          i+=2
          continue
        }
        print lines[i]
      }
    }
  ' "$patch" > "$temp"
  mv "$temp" "$patch"
done

# 只移除套件管理的运行时与模型；画布项目、图片、API 凭据和 DSH 会话不删除。
rm -rf "$USER_HOME/.dsh/canvas-workbench/python-runtime" \
  "$USER_HOME/.dsh/canvas-workbench/imagetracer-runtime" \
  "$USER_HOME/.dsh/canvas-workbench/rembg-models/isnet-general-use.onnx" \
  "$USER_HOME/.dsh/canvas-workbench/runtime-manifest.json"

echo "已移除 DSH 画布插件。请重启 DSH Desktop。"
