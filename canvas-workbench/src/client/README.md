# client/ — 浏览器 bundle 分段源码

`lib/client.js` 由 `scripts/build-client.mjs` 按 `build-manifest.json` 拼接生成（`npm run build`）。所有分段共享同一个 `window.__ModuleLoader__.load({ factory })` 闭包，**顺序即作用域**。

| 目录 | 内容 |
|---|---|
| `main/` | 00 加载器前奏（React 单例）· 01 localStorage 键常量 · 99 `apply()` 注册 slots/turnTail/overlay/input dock |
| `registry/` | 10 运行时内核：Feature Registry / Command Bus / History → `window.__dshCanvas` |
| `shared/utils/` | storage · url · asset 工具 |
| `core/document/` | 设计模式状态 · 画布状态版本化/读写 |
| `core/capabilities/` | DSH 会话桥接 · 兼容层（safeEffect/safeSlot） |
| `core/canvas/frame/` | `EXCALIDRAW_SRCDOC` iframe 模板 + 本地 vendor / 清洁版变体 |
| `features/chat-image-output/` | 聊天事件 → 图片提取管线 · turnTail 定义 · ImageTail 组件 |
| `features/text-edit/` | 免费商用字体白名单 · TextRebuildPanel |
| `features/material-library/` | 七色标记常量（素材库主体仍在 CanvasOverlay 分段） |
| `features/project-browser/` | 项目选择记忆 |
| `app/` | DesignModeToggle · 分栏布局 · **CanvasOverlay（2,100 行，下一步按 Feature 再拆）** · CSS 字符串 |

内联的共享模块（`order[].inline`）：`shared/registry/feature-registry.js`、`shared/commands/{history,command-bus}.js`、`shared/contracts/canvas-object.js`。

srcdoc 模板内的 iframe 脚本仍是转义字符串；改动后用「抽 `<script>` → 反转义 → node --check」校验（check-portability 已内置）。
