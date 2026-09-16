# v1.8 重构执行进度（自主运行日志）

> 开始：2026-09-17 夜间（用户授权全程自主执行，早上审阅）
> 分支：`refactor/v1.8`
> 规则：每步留证据；行为零变更优先；任何 FAIL 先修再前进；不推 main、不打 v1.8.0 tag（§40 含 Windows 实机条件，本机无法满足）。

## 状态总览

| 阶段 | 状态 | 证据 |
|---|---|---|
| Phase 0 基线文档 | ✅ 已提交 1eb4de2 | docs/refactor/BASELINE.md, REGRESSION-v1.7.0.md |
| Phase 1 目录骨架 | ✅ 已提交 c3f45f3 | canvas-workbench/src/**, tests/** |
| Phase 0 补齐：1.7.0 运行时基线（截图/API 样例/性能/fixtures） | 🔄 进行中 | docs/refactor/baseline/ |
| Phase 2 Host 拆分 | ⏳ | |
| Phase 3 Provider 抽象 | ⏳ | |
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
