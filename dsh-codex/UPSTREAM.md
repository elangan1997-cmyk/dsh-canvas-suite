# dsh-codex 兼容构建

此目录只保留运行所需的预构建 `lib/` 与公开元数据，作为 DSH Canvas Suite 的可选 Codex 路由组件。

- 上游仓库：https://github.com/Yan-Zero/dsh-codex
- 取用版本：工作区已检查的兼容构建（详见 `package.json` 版本）。`0.3.0-dsh2.0.1` 补齐 DSH 2.0.4 所需的 `maxRequestImageBytes`、`requestImagePixelBudget` 和 `requestImageMaxBytes`，避免 Codex 会话携带图片时出现 `Image request maxPixels must be a positive integer`。
- 许可证：Apache-2.0
- 不包含 `node_modules`、OAuth 凭据、API Key 或用户会话。

更新该组件时，请先在独立 checkout 完成上游测试，再复制预构建 `lib/` 与元数据，并更新 CHANGELOG。
