# src/ — v1.8 重构后的源码树

**自 v1.8 起，这里是 canvas-workbench 的权威源码。** DSH 的加载路径不变：`package.json` `main → lib/index.js`、`exports["./client"] → lib/client.js`，两者分别是 Host 入口薄壳与 Client 构建产物（不要手改）。

| 目录 | 角色 | 入口 |
|---|---|---|
| `host/` | Host 半边：HTTP 路由、服务、Job、适配器 | `host/index.js` 的 `apply(ctx)`（被 `lib/index.js` re-export） |
| `client/` | Client 半边：浏览器 bundle 的**分段源码**，按 `build-manifest.json` 顺序由 `scripts/build-client.mjs` 拼接成 `lib/client.js` | `client/main/00-loader-prelude.js` … `main/99-apply.js` |
| `providers/` | 生成 Provider 注册表与实现（dsh-codex / openai-compatible） | `providers/image-engine.js` 门面（被 `lib/image-engine.js` re-export） |
| `shared/` | Host/Client 共用：契约（Asset / CanvasObject / Job / Feature）、Schema 迁移、事件总线、纯工具、Command/History | 被 host 直接 import；被 client 构建期内联 |

## 分段（src/client/**）的特殊性

浏览器 bundle 是**单个工厂函数闭包**（`window.__ModuleLoader__.load({ factory })`），分段文件是该函数体的连续文本片段，共享作用域、顺序即语义，**不可随意调换顺序**。清单 `src/client/build-manifest.json`：

- `order[].file` — 分段文件（改 UI 就改这些文件）
- `order[].inline` — 从 `src/shared/**` 构建期内联（去 import/export）进 bundle 的共享模块

改完跑 `npm run build`（重新生成 `lib/client.js`）；`npm run check` 含构建漂移守卫（分段与产物不一致会失败）。

## 验证矩阵

- `npm test` — unit + migration（node:test）
- `npm run test:integration` — API 对等（git 基线 vs 工作树，55 条逐字段 diff）；另有 `tests/integration/{jobs,contracts}.integration.mjs`
- `npm run check` — check-portability + 递归 node --check + client 构建一致
- 运行时回归：`tests/smoke/`（CDP 采集 API 样例与 DOM 真值快照，与 `docs/refactor/baseline/` 对比）

## 历史

Phase 1 建骨架 → Phase 2 Host 机械拆分（`scripts/refactor/split-host.mjs`，从 `refactor-baseline` 标签可复现）→ Phase 5a client 分段（`split-client.mjs`，首构建与原文件逐字节一致 sha256 eee99d37…）→ Phase 5b 删除 tldraw 死链（−82%）。拆分工具保留在 `scripts/refactor/` 供审计，**不要再运行**（会覆盖手工演进的源码）。
