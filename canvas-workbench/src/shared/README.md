# shared/

Host 与 Client 共用、**不依赖 DOM 也不依赖 Node fs** 的代码。

- `contracts/` CanvasObject / Asset / GenerationJob / Feature / Provider / Capabilities 契约（§6-10）
- `schemas/` project / asset / job Schema 与 `schemaVersion` 迁移（§14）
- `events/` EventBus 与事件名常量（§24）
- `utils/` 纯函数：路径归一化、图片 header 尺寸解析（index.js `parseImageHeaderSize` 119-193 → `image-metadata.js`）
