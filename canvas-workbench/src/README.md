# src/ — v1.8 重构源码树（Phase 1 骨架）

本目录是 v1.8 架构重构的目标源码树。**当前没有任何入口加载这里的文件**：
DSH 仍通过 `package.json` 的 `main: lib/index.js` 与 `exports["./client"]: lib/client.js` 加载运行时。

迁移策略（Strangler Pattern）：按 Phase 2→8 逐块把 `lib/` 中的职责抽到此处，
`lib/` 最终成为构建产物（见执行文档 §34）。在构建管线落地前，`lib/` 仍是可直接运行的权威代码。

| 子目录 | 用途 | 对应 lib/ 来源 | 迁入阶段 |
|---|---|---|---|
| `shared/` | Host/Client 共用契约、Schema、事件、纯工具 | index.js 55-428 纯函数、client.js 252-541 路径工具 | Phase 2 / 5 |
| `host/` | HTTP 服务、路由、服务层、Job、适配器 | index.js apply() 429-2256、platform.js | Phase 2 / 4 |
| `client/` | 应用壳、画布核心、注册表、Feature、共享组件 | client.js 全部业务段 | Phase 5 / 6 / 7 |
| `providers/` | 生成 Provider 注册表与实现 | image-engine.js | Phase 3 |
