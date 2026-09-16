# v1.8 重构执行进度（自主运行日志）

> 开始：2026-09-17 夜间（用户授权全程自主执行，早上审阅）
> 分支：`refactor/v1.8`
> 规则：每步留证据；行为零变更优先；任何 FAIL 先修再前进；不推 main、不打 v1.8.0 tag（§40 含 Windows 实机条件，本机无法满足）。

## 状态总览

| 阶段 | 状态 | 证据 |
|---|---|---|
| Phase 0 基线文档 | ✅ 已提交 1eb4de2 | docs/refactor/BASELINE.md, REGRESSION-v1.7.0.md |
| Phase 1 目录骨架 | ✅ 已提交 c3f45f3 | canvas-workbench/src/**, tests/** |
| Phase 0 补齐：1.7.0 运行时基线（截图/API 样例/DOM 快照/fixtures） | ✅ ac702ff, 9dd6ea6 | docs/refactor/baseline/（30→55 条 API 样例、DOM 快照、4 张截图）；tests/integration/host-harness.mjs |
| Phase 2 Host 拆分 | ✅ | src/host/{index,routes/8 文件,services/3,server/2,vendor-assets,plugin-meta}.js + src/shared/utils/4；lib/index.js 成薄壳；API 对等 55 条 0 差异 |
| Phase 3 Provider 抽象 | ✅ | src/providers/{registry,image-engine}.js + image/{dsh-codex,openai-compatible}.provider.js + host/services/image-engine-settings.js；lib/image-engine.js 成薄壳；11 项单元测试；对等 55/0 |
| Phase 4 Job Manager | ⏳ | |
| Phase 5 Client 拆分（构建管线，字节一致） | ⏳ | |
| Phase 6 Command + History | ⏳ | |
| Phase 7 CanvasObject / Asset | ⏳ | |
| Phase 8 Text Feature 整合 | ⏳ | |
| 测试套件 unit/integration/smoke/migration | ⏳ | |
| 重构后运行时回归对比 | ⏳ | |
| 文档/交接/报告 | ⏳ | |

## 环境（开工时）

- 插件四副本 1.7.0 已由用户侧 GitHub 安装流程重装；3 个 patch 含 canvas-workbench
- `~/.codex/auth.json` 存在（Codex 已登录）；codex-pixel / image-engine.json 不存在（引擎为默认）
- DSH Desktop 未运行；43120 无监听

## 详细日志

- [开工] 侦察完成，见上。

- [Phase 0 补齐] DSH 网关对 curl 403 → 改用 `--remote-debugging-port` + CDP 在页面内 fetch；macOS 权限弹窗封了截图 → CDP 截图；发现 DSH 透明材质窗口下 CDP 像素与 DOM 不一致 → UI 对比改用 DOM 真值快照。
- [Phase 0 补齐] 发现并单独修复 1.7.0 缺陷：`system-appearance` 里 `isMac()`/`isWindows()` 误把常量当函数（aa36de7）。
- [Phase 2] 写机械拆分工具 `scripts/refactor/split-host.mjs`（从 `refactor-baseline` 标签读原文，可重复运行）：42 个 handler 块逐字迁入 8 个 routes 文件，闭包辅助区逐字保留在 host/index.js，唯一文本替换是把 handler 内联的 `dirname(dirname(fileURLToPath(import.meta.url)))` 换成共享 `PLUGIN_ROOT`（否则 5 个 Python 脚本路径错位——对等测试的 ocr 路径差异抓出来的）。
- [Phase 2] 对等测试从 30 条扩到 55 条（含 state POST/stale、materials save/delete、import/materialize/rename/archive/restore、backup、chat-context、open/rename/delete-project、ocr 无模型错误形状），基线 vs 工作树 **0 差异**。
- [Phase 2] `build-npm-package.mjs` 白名单与拷贝加 `src`；`check-portability.mjs` 的 Host 断言改为扫描 lib/index.js + src/host/** + src/shared/**。
- [Phase 3] image-engine.js 376 行拆为：settings 服务（含 API Key 本地 0600 存储，路径不变）、dsh-codex Provider、openai-compatible Provider（重试/退避/连通性测试逐字迁移）、Provider Registry（register/require/findByCapability）、门面（generateImage/generateChatImage/imageEngineHealth 签名与语义不变，内部经注册表分派）。`npm test` 11 项；`npm run check` = check-portability + 递归 node --check（41 文件）。
