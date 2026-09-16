# client/

Client 半边：UI、画布、选区、命令、HTTP Client。**禁止**任何 fs/spawn（§3.1）。

当前来源 `lib/client.js`（2,344,322 字节 / 4,551 行）的真实构成：

| 行段 | 字节占比 | 内容 | 目标 |
|---|---|---|---|
| 1537 | **82%**（1,927,330 B） | `TLDR_BUNDLE` 内嵌 Excalidraw 厂商包 | 外置为静态 vendor 资产（已有 `/dsh-canvas/vendor/` 路由） |
| 1558-2042 | ~7% | `EXCALIDRAW_SRCDOC` iframe 内 HTML/CSS/JS（转义字符串） | `core/canvas/frame/` 独立源码 + 构建期注入 |
| 2133-4238 | ~8% | `CanvasOverlay` 单组件 2,100 行 | `features/*` + `app/panels/` |
| 其余 | ~3% | 常量、模式、路径、聊天图片管线、ImageTail、TextRebuildPanel、CSS、apply | `shared/` `core/` `features/` `main.js` |

拆分顺序严格按 §22：utils → shared components → core → features → registry。
