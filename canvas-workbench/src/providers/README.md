# providers/

Phase 3：`registry.js`（`register` / `findByCapability`），Provider 只处理输入/任务/状态/输出/错误，**禁止触碰 UI**（§3.3）。

来源 `lib/image-engine.js`（376 行）：
- `generateWithDshCodex` 323 → `image/dsh-codex.provider.js`
- `generateWithApi` 208 + `parseImagePayload` 172 + `imageApiRetryDelay` 185 + `testImageApiConnection` 277 → `image/openai-compatible.provider.js`
- `readImageEngineSettings/writeImageEngineSettings/readLegacyApiAuth/writeLegacyApiAuth` → host `settings` service（API Key 继续本地安全存储，禁止 9）
