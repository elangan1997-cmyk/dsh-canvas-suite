# 1.7.0 运行时基线证据（2026-09-17 凌晨采集）

采集对象：用户侧通过 GitHub 安装流程重装的 `@local/canvas-workbench` 1.7.0（与仓库 main `72bdc33` 内容一致），DSH Desktop 2.0.4（深色主题、透明材质窗口）。

| 文件 | 内容 | 采集方式 |
|---|---|---|
| `screenshots/01-*.jpg` `02-*.jpg` | 设计模式 + 画布 + 聊天图片输出；素材库（排序/七色筛选/尺寸大小） | macOS `screencapture`（真实屏幕像素） |
| `screenshots/03-*.jpg` `04-*.jpg` | 选区工具栏；「更多」菜单 + 七色标记调色板 | CDP `Page.captureScreenshot`。**注意**：DSH 透明材质窗口下 CDP 像素与屏幕观感不一致（DOM 为深色、渲染呈浅色），仅作结构参考 |
| `api-samples-1.7.0/summary.json` | 30 条请求的归一化响应（`tests/integration/api-requests.mjs` 清单） | CDP 在页面上下文 `fetch`（同源，经 DSH 网关） |
| `ui-snapshot-1.7.0-selected-menu-open.json` | DOM 真值快照：令牌、工具栏按钮、iframe 主题变量、选区工具栏/菜单计算样式、标记色点数、聊天图片输出 | `tests/smoke/ui-snapshot.mjs` |

## 采集期间发现的 1.7.0 既有缺陷

1. **`/dsh-canvas/system-appearance` 永远 `known:false`**：`isMac()`/`isWindows()` 把布尔常量当函数调用 → TypeError 被 catch。已在 `aa36de7` 单独修复（非重构提交）。基线样例保留修复前的返回；重构后对比时该条差异为**预期**。

## 采集方法说明

- DSH 网关对外部 `curl` 一律 403（`text/plain forbidden`，插件代码之前），所以 API 样例必须在页面上下文里发起。
- DSH 以 `open -a "DSH Desktop" --args --remote-debugging-port=9222` 启动后，`tests/smoke/cdp-client.mjs` 通过 CDP 求值/输入/截图。
- macOS 在采集中途弹出 ZCode 屏幕录制的系统确认框，按安全规则未代点，此后 `screencapture` 与 computer-use 截图都只能得到壁纸，故 03/04 改用 CDP。
- 像素截图对该窗口不可靠，重构前后 UI 对比以 `ui-snapshot` 的 DOM 真值为准。
