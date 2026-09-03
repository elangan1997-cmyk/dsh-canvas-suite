#!/bin/bash
set -euo pipefail

PINNED_COMMIT="7af23286c2a4a1083af9a8ea7d25767d7d94d894"
REPOSITORY="github:AITabby/dockyard-dsh#$PINNED_COMMIT"
CONSOLE_HOME="${HOME:?无法确定用户目录}"
BACKUP_DIR="$CONSOLE_HOME/Library/Application Support/DSH Canvas Suite/Backups/dockyard-$(date '+%Y%m%d-%H%M%S')"

echo "Dockyard Codex 推理（可选组件）"
echo "来源：https://github.com/AITabby/dockyard-dsh"
echo "固定版本：$PINNED_COMMIT"
echo
echo "它会通过官方浏览器 OAuth 使用你自己的 Codex 订阅额度。"
echo "凭据由 macOS Keychain 保存，不会写入画布项目或安装包。"
echo
read -r -p "继续安装到 DSH Profile？[y/N] " ANSWER
case "$ANSWER" in
  y|Y|yes|YES) ;;
  *) echo "已取消。"; exit 0 ;;
esac

if ! command -v dsh >/dev/null 2>&1; then
  echo
  echo "未发现 dsh 命令。请先安装/启动官方 DSH，并按官方说明安装 DSH CLI 后重试。"
  echo "Dockyard 当前要求 Node.js 22.19+ 的 22.x，或 Node.js 24+。"
  read -r -p "按回车退出..." _
  exit 1
fi

mkdir -p "$BACKUP_DIR"
for PROFILE in web desktop; do
  [ -d "$CONSOLE_HOME/.dsh/profiles/$PROFILE" ] || continue
  ditto "$CONSOLE_HOME/.dsh/profiles/$PROFILE" "$BACKUP_DIR/$PROFILE"
done

ACTIVE=""
SELECTION="$CONSOLE_HOME/Library/Application Support/DSH Desktop/profile-selection/state.json"
if [ -f "$SELECTION" ]; then
  ACTIVE="$(/usr/bin/plutil -extract active raw -o - "$SELECTION" 2>/dev/null || true)"
fi

PROFILES=(web desktop)
if [ -n "$ACTIVE" ] && [ "$ACTIVE" != "web" ] && [ "$ACTIVE" != "desktop" ]; then
  PROFILES+=("$ACTIVE")
fi

FAILED=0
for PROFILE in "${PROFILES[@]}"; do
  [ -d "$CONSOLE_HOME/.dsh/profiles/$PROFILE" ] || continue
  echo
  echo "安装 Dockyard → Profile: $PROFILE"
  if ! dsh plugin --profile "$PROFILE" add "$REPOSITORY"; then
    echo "Profile $PROFILE 安装失败；其他 Profile 将继续尝试。" >&2
    FAILED=1
  fi
done

echo
if [ "$FAILED" -eq 0 ]; then
  echo "Dockyard 安装完成。请完整退出并重新打开 DSH Desktop。"
  echo "进入 DSH 后使用 /dockyard login codex 登录，再用 /dockyard status 检查状态。"
else
  echo "部分 Profile 安装失败。备份位于：$BACKUP_DIR"
  echo "这通常是 DSH 预览版依赖不匹配；画布插件本身不受影响。"
fi
echo "备份：$BACKUP_DIR"
read -r -p "按回车退出..." _
exit "$FAILED"
