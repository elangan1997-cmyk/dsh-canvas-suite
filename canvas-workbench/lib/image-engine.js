// lib/image-engine.js — 兼容薄壳（v1.8 Phase 3）。
// 实现已迁至 src/providers/（Provider Registry + dsh-codex / openai-compatible 两个 Provider）
// 与 src/host/services/image-engine-settings.js；这里保留全部旧导出名，旧调用方无需改动。
export {
  imageEngineSettingsPath,
  normalizeImageEngine,
  readImageEngineSettings,
  writeImageEngineSettings,
  readLegacyApiAuth,
  writeLegacyApiAuth,
  testImageApiConnection,
  generateImage,
  generateChatImage,
  imageEngineHealth,
  imageProviders
} from '../src/providers/image-engine.js';
