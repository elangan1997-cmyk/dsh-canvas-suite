#!/usr/bin/env bash
set -u

USER_HOME="${HOME:?cannot determine home}"
SUITE_ROOT="/Library/Application Support/DSH Canvas Suite"
MANAGED_ROOT="$USER_HOME/.dsh/canvas-workbench"
PASS=0
WARN=0
FAIL=0

ok() { printf '✅ %s\n' "$*"; PASS=$((PASS + 1)); }
warn() { printf '⚠️  %s\n' "$*"; WARN=$((WARN + 1)); }
bad() { printf '❌ %s\n' "$*"; FAIL=$((FAIL + 1)); }

if [ -d "/Applications/DSH Desktop.app" ]; then
  if /usr/bin/codesign --verify --deep --strict "/Applications/DSH Desktop.app" >/dev/null 2>&1; then
    ok "DSH Desktop 存在且签名完整"
  else
    bad "DSH Desktop 签名校验失败"
  fi
else
  bad "未安装 DSH Desktop"
fi

for item in canvas-workbench dsh-codex; do
  [ -f "$SUITE_ROOT/$item/package.json" ] && ok "套件源码完整：$item" || bad "套件源码缺失：$item"
done

PYTHON="$MANAGED_ROOT/python-runtime/bin/python3"
if [ -x "$PYTHON" ]; then
  if "$PYTHON" -c 'import PIL, psd_tools, pytesseract, rembg, vtracer' >/dev/null 2>&1; then
    ok "本地 Python 图像运行时可用"
  else
    bad "Python 图像依赖导入失败"
  fi
else
  bad "本地 Python 运行时缺失"
fi

MODEL="$MANAGED_ROOT/rembg-models/isnet-general-use.onnx"
EXPECTED="60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a"
if [ -f "$MODEL" ]; then
  ACTUAL="$(/usr/bin/shasum -a 256 "$MODEL" | /usr/bin/awk '{print $1}')"
  [ "$ACTUAL" = "$EXPECTED" ] && ok "ISNet 去背景模型校验通过" || bad "ISNet 模型校验失败"
else
  bad "ISNet 去背景模型缺失"
fi

[ -f "$MANAGED_ROOT/imagetracer-runtime/node_modules/imagetracerjs/nodecli/nodecli.js" ] \
  && ok "ImageTracerJS 运行时可用" || bad "ImageTracerJS 运行时缺失"

if [ -d "$USER_HOME/.dsh/profiles" ]; then
  if "$SUITE_ROOT/sync-local-plugins.sh" --check --quiet >/dev/null 2>&1; then
    ok "DSH 插件同步与兼容检查通过"
  else
    bad "DSH 插件同步检查失败，请运行一键修复"
  fi
else
  warn "DSH 尚未首次启动；启动后将自动完成插件注入"
fi

DSH_CODE="$(/usr/bin/curl -sS -o /dev/null --max-time 3 -w '%{http_code}' http://127.0.0.1:43120/ 2>/dev/null || true)"
case "$DSH_CODE" in
  2??|3??|401|403) ok "DSH 本地服务已监听（HTTP $DSH_CODE）" ;;
  *) warn "DSH 当前未运行（不影响安装完整性）" ;;
esac

printf '\n结果：%d 通过，%d 提示，%d 失败\n' "$PASS" "$WARN" "$FAIL"
[ "$FAIL" -eq 0 ]
