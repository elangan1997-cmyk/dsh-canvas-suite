# features/

| Feature | 现有代码位置（lib/client.js） |
|---|---|
| `material-library/` | CanvasOverlay 内素材面板：`MATERIAL_TAG_COLORS` 33、排序/筛选状态、`applyMaterialTag` 2347 |
| `image-generation/` | 引擎设置面板、生成入口 |
| `image-edit/` | 编辑图片 / 智能擦除 |
| `background-remove/` | 去背景 + 进度轮询 |
| `vectorize/` | 转矢量 |
| `text-edit/` | `TextRebuildPanel` 1130-1407、`TEXT_REBUILD_FONTS` 45-119（Phase 8 整合 OCR/字体推断/mask/PSD） |
| `project-browser/` | 项目选择/记忆 `projectChoices` 173-251 |
| `export/` | PNG 导出 / PSD 导出入口 |
| `chat-image-output/` | `canvasImagesDefinition` 807 + `ImageTail` 915-1129 + 提取管线 542-806（文档 §27 建议并入统一 Asset 服务） |
| `video-generation/` | **仅接口占位**，v1.8 不实现（禁止 5） |
