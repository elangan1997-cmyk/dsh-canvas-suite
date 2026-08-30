#!/usr/bin/env bash
# 兼容旧入口：统一交给一键同步 + 健康检查脚本处理。
# 旧命令仍然可用，同时会同步 canvas-workbench 与 home-explorer 两个本地插件。

set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
exec "$SCRIPT_DIR/sync-local-plugins.sh" "$@"
