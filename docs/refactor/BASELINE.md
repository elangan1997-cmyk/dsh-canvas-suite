# v1.8 架构重构基线（Phase 0）

> 建立日期：2026-09-17
> 执行文档：《DSH Canvas Suite v1.8 架构重构执行文档》
> 重构分支：`refactor/v1.8`
> 基线提交：`72bdc33`（main，与 origin/main 一致）

---

## 0. 基线选择说明

执行文档 Phase 0 写的是「checkout `v1.7.0`」，但实际检查发现：

| 引用 | 提交 | 说明 |
|---|---|---|
| tag `v1.7.0` | `05944ec` | 附注标签，指向 README 文档提交 |
| main / origin/main | `72bdc33` | 比 tag 多两个提交 |

多出的两个提交：

- `bec5bd3` **fix: PSD 字体解析支持 Windows 字体目录** — 真实代码修复（`scripts/export_text_psd.py`），Windows 用户缺它 PSD 字体会回退到 Arial。
- `72bdc33` docs: README 全面对齐 1.7.0。

**决定：基线取 main `72bdc33`，而不是 tag。** 否则重构会建立在缺少 Windows 修复的代码上，Phase 8 回归 Windows PSD 时会出现「假回归」。`refactor/v1.8` 分支自 `72bdc33` 创建。发布 v1.8 前建议把 tag `v1.7.0` 的语义用 `v1.7.0` Release 说明补一句「代码基线为 72bdc33」。

## 1. 环境快照

| 项 | 值 |
|---|---|
| 平台 | macOS（darwin 25.1.0，arm64） |
| DSH Desktop | 2.0.4（Electron 43.3.0） |
| Node | v26.0.0 |
| 插件版本 | `@local/canvas-workbench` 1.7.0 |
| 加载方式 | `package.json` `main: lib/index.js`；`exports["./client"]: lib/client.js`；`dsh.client.platform: web` |
| 兼容策略 | `dshCanvasCompatibility.strategy: capability-detection`，`failurePolicy: disable-subfeature-without-blocking-renderer`；硬依赖仅 `slots`，可选能力 `conversation.chat.turnTail` / `conversation.input.dock` / `shell.overlay` / `dsh-codex` / `image-engine-settings` / `agent-scoped-imagegen-routing` |
| 运行副本 | 四份（`~/.dsh/profiles/node_modules/@local/canvas-workbench`、`profiles/desktop/…`、`profiles/web/…`、`profiles/设计d s/…`），由 `sync-local-plugins.sh` 整目录 `cp -R` 同步并注入 `cordis.patch.yml` |

**基线建立时的特殊状态：** 用户正在做 1.7.0「彻底卸载 → 由另一 AI 从 GitHub 全新安装」的干净测试，四份运行副本与 Codex 登录记录在 2026-09-16 23:57 被有意清空。因此本阶段**未运行** `sync-local-plugins.sh`，也没有启动 DSH 做 UI 截图。运行时基线由该干净测试结果补齐（见 §9）。

## 2. 文件规模

```text
canvas-workbench/lib/
├─ client.js             2,344,322 B   4,551 行
├─ index.js                141,976 B   2,256 行
├─ image-engine.js          18,657 B     376 行
├─ chat-image-router.js     18,505 B     342 行
└─ platform.js               5,421 B     131 行
                         ─────────────  ─────────
                         2,528,881 B   7,656 行
canvas-workbench/scripts/   10 个 Python 脚本，合计约 76 KB（vectorize_image.py 28 KB 最大）
```

### 2.1 client.js 的真实构成（关键发现）

`client.js` 只有 4,551 行却有 2.34 MB，因为**第 1537 行一行就是 1,927,330 字节**：

```js
const TLDR_BUNDLE = "(()=>{var Hxe=Object.create;var gD=Object.defineProperty; …
```

这是内嵌进字符串的 Excalidraw 厂商包（变量名 `TLDR_*` 是 tldraw 时代遗留），占整个文件 **82%**。真正的手写代码约 400 KB：

| 行段 | 约占字节 | 内容 |
|---|---|---|
| 1537 | 82% | `TLDR_BUNDLE` 厂商包（一行） |
| 1558–2042 | ~7% | `EXCALIDRAW_SRCDOC` iframe 模板：HTML + CSS + 大量转义 JS（`imageNameLabels`、`DSH_TAG_HEX`、`setCanvasImageTag`、`arrangeCanvasImages`、选区工具栏、主题接收器） |
| 2133–4238 | ~8% | `CanvasOverlay` 单个 React 组件，2,100 行 |
| 其余 | ~3% | 常量、模式、路径、聊天图片管线、`ImageTail`、`TextRebuildPanel`、CSS 字符串、`apply` |

**结论：** 「拆 God File」的第一刀不是拆业务，而是把厂商包外置为静态资产——零行为变更即可把 client.js 从 2.34 MB 降到约 420 KB。仓库已存在 `/dsh-canvas/vendor/` 路由与 `EXCALIDRAW_VENDOR_BOOTSTRAP` / `TLDR_BUNDLE_URL`（2043–2058、1540–1544）的双路径雏形，Phase 5 应先评估这条现成通路。

## 3. client.js 职责地图

外层结构：`window.__ModuleLoader__.load({ id: '@local/canvas-workbench', factory(require) { … } })`，所有代码在 `factory` 内以 4 空格缩进平铺。

| 行段 | 职责 | 主要符号 | 目标模块 |
|---|---|---|---|
| 1–20 | 模块加载器包装、取 React 单例 | `window.__ModuleLoader__.load` | `client/main.js` |
| 21–31 | CDN 常量（疑似遗留未用）+ localStorage key 常量 | `TLDRW` `REACT_URL` `TLDR_CSS` `MODE_KEY` `PROJECT_CHOICES_*` `PANEL_WIDTH_KEY` `MATERIAL_LIBRARY_KEY` `MATERIAL_SORT_KEY` | `client/shared/constants` |
| 33–44 | 素材七色标记定义 | `MATERIAL_TAG_COLORS` | `features/material-library` |
| 45–119 | 文字重建字体白名单与默认字体 | `TEXT_REBUILD_FONTS` `TEXT_REBUILD_DEFAULT_FONT` `textRebuildFontValue` | `features/text-edit/model/text-style` |
| 120–146 | 画布默认背景、存储读写 | `canvasDefaultBackground` `readStorageValue` `writeStorageValue` `removeStorageValue` | `client/shared/utils/storage` |
| 147–172 | 设计模式开关状态与订阅 | `mode` `getMode` `setMode` `toggleMode` `subscribeMode` | `client/core/document/mode` |
| 173–251 | 项目选择记忆（按 cwd / session） | `projectChoices` `loadProjectChoices` `chosenProject` `rememberProject` | `features/project-browser` |
| 252–335 | 路径 → URL 映射、Markdown 图片本地回退 | `imageUrl` `previewUrl` `displaySourceUrl` `localPathFromMarkdownImage` `installLocalMarkdownImageFallback` `stateEndpoint` | `client/shared/utils/url` |
| 336–425 | 画布状态版本化、去内联数据、读写项目 | `CANVAS_CLIENT_ID` `markCanvasChanged` `versionedCanvasState` `stripInlineFileData` `loadState` `saveState` `listProjects` | `client/core/document/state` |
| 426–541 | 附件与图片名工具、SVG 栅格化 | `basename` `attachmentMarker` `attachmentFromPath` `imageName` `dataURLToFile` `rasterizeSVGForChat` `resolveImagePath` | `client/shared/utils/asset` |
| 542–806 | **聊天图片提取管线**（事件 → 图片路径） | `IMAGE_EXT_RE` `isDirectImageSource` `pushImageCandidate` `pushIfImage` `collectImagePaths` `walkImagePayload` `dedupeImagePaths` `eventCwd` `extractImagePaths` `extractAssistantVisibleImages` `reconcileFinalImages` | `features/chat-image-output/extract` |
| 807–914 | turnTail 事件节点定义、加入画布 / 定位文件 | `canvasImagesDefinition` `CANVAS_ADD_TOKEN` `dispatchAddImage` `revealImageInFinder` | `features/chat-image-output` |
| 915–1129 | 聊天图片输出 UI（过滤旧图、三级回退加载、灯箱） | `ImageTail` | `features/chat-image-output/ImageTail` |
| 1130–1407 | 文字重建面板（识别结果编辑、字体/字重选择、PSD 导出） | `TextRebuildPanel` | `features/text-edit/editor` |
| 1408–1463 | 与 DSH 会话服务桥接（当前模型、cwd、sessionId、项目路径） | `conversationApi` `clientRootContext` `activeChat*` `setActiveChatContext` `resolveAttachmentSource` `dispatchResolvedImage` | `client/core/capabilities/dsh-bridge` |
| 1464–1536 | 设计模式开关按钮 | `DesignModeToggle` | `app/AppShell` |
| 1537–1557 | 厂商包与其 iframe 注入形态 | `TLDR_BUNDLE` `TLDR_BUNDLE_FOR_IFRAME` `TLDR_BUNDLE_URL` | 静态 vendor 资产 |
| 1558–2042 | **iframe 画布模板**（Excalidraw 宿主、图片名标签、颜色标记、整理布局、选区工具栏、主题接收） | `EXCALIDRAW_SRCDOC` 内：`imageNameLabels` `DSH_TAG_HEX` `setCanvasImageTag` `arrangeCanvasImages` `updateLabels` message 处理器 | `client/core/canvas/frame/*`（独立源码，构建期注入模板） |
| 2043–2058 | 模板变体（本地 vendor / 清洁版） | `EXCALIDRAW_VENDOR_BOOTSTRAP` `EXCALIDRAW_SRCDOC_LOCAL` `EXCALIDRAW_SRCDOC_CLEAN` | `client/core/canvas/frame/build` |
| 2059–2132 | 分栏布局与宿主 iframe 定位 | `findAppFrame` `notifySplitLayout` `applyFramePadding` `canvasPathWithin` | `app/layout` |
| 2133–4238 | **`CanvasOverlay` 巨型组件**：项目管理、素材库（排序/筛选/标记/尺寸）、图像引擎设置、编辑图片 / 擦除 / 去背景 / 矢量化 / OCR 入口、灯箱、反馈、主题同步（`dshThemeSnapshot` 2626、`pushDshTheme` 2654、跟随系统轮询）、工具栏 | — | 拆到 `features/*` + `app/panels/*` + `core/capabilities/theme` |
| 4239–4388 | 父侧样式字符串（已令牌化为 `--dsw-alias-*`） | `CSS` | 按 Feature 拆 `.css` |
| 4389–4424 | 兼容层 | `compatibilityLogger` `safeEffect` `safeSlot` | `client/core/capabilities` |
| 4425–4551 | 注册入口（slots、turnTail、overlay、input dock） | `apply` | `client/main.js` |

## 4. index.js 职责地图

| 行段 | 职责 | 主要符号 | 目标模块 |
|---|---|---|---|
| 1–54 | 导入、常量（MIME 表、扩展集合） | `IMAGE_MIME` `RASTER_EXTENSIONS` `SOURCE_EXTENSIONS` | `shared/utils/image-types` |
| 55–71 | 扩展名 / MIME / 类型判断 | `extOf` `mimeOf` `isImagePath` `isRasterImagePath` `isSourceImagePath` `sourceKindOf` `cleanJobId` | `shared/utils` |
| 72–118 | 读取画布项目元素、路径展开归一、素材目录解析 | `readCanvasProjectElements` `expandHome` `normalizeLocalPath` `materialDirectory` | `host/services/project-store` |
| 119–212 | **图片 header 尺寸解析**（PNG/GIF/BMP/WebP/JPEG/SVG）+ 带缓存的尺寸探测 | `parseImageHeaderSize` `probeMaterialSize` | `shared/utils/image-metadata` |
| 213–258 | 素材颜色标签持久化、路径包含判断 | `materialTagsPath` `readMaterialTags` `writeMaterialTags` `tagsForDirectory` `pathComparable` `isPathWithin` | `host/services/material-library` |
| 259–291 | HTTP 基础 | `parseQuery` `readBody` `respond` | `host/server/request` `response` |
| 292–366 | 视觉模型文字分析（提示词、坐标归一、流式装配） | `parseModelJson` `visionBlocks` `analyzeTextWithCurrentModel` | `host/services/text-service` + `adapters/dsh-llm` |
| 367–428 | 图片数据解码、安全文件名、文字层归一 | `sourcePathFromImageUrl` `firstExisting` `decodeImageData` `decodeSourceData` `safeImageName` `normalizeTextLayerText` | `shared/utils` |
| **429–2256** | **单个 `apply(ctx)`**：DSH 上下文获取、HTTP 服务、**41 条路由全部内联**、Python 子进程调度、项目/素材/生成/文字/导出/设置全部业务、聊天路由安装、dispose | — | `host/index.js`（200–400 行）+ `routes/*` + `services/*` + `adapters/python` |

## 5. 其他模块

### image-engine.js（376 行）— 已是 Provider 雏形

| 函数 | 目标 |
|---|---|
| `imageEngineSettingsPath` `normalizeImageEngine` `readImageEngineSettings` `writeImageEngineSettings` `readLegacyApiAuth` `writeLegacyApiAuth` | `host/services/settings`（API Key 继续本地安全存储） |
| `moduleCandidates` `loadCodexModule` `generateWithDshCodex` | `providers/image/dsh-codex.provider.js` |
| `generateWithApi` `parseImagePayload` `imageApiRetryDelay` `waitForImageApiRetry` `testImageApiConnection` `effectiveApiBase` `modelIdsFromPayload` | `providers/image/openai-compatible.provider.js` |
| `generateImage` `generateChatImage` `imageEngineHealth` | `providers/registry.js` 门面（保留旧函数签名做兼容） |

### chat-image-router.js（342 行）— 按 §27 暂保留独立

`routedTool`（187–299）包装 DSH 原生图片生成工具：deferContext、引擎路由、落盘 `uniqueOutputPath`、三级归档 `archiveBaseFor` → `sessionArchiveFolder`（会话标题/日期/5 小时时段，`~/.dsh/canvas-workbench/archive-folders.json` 索引 + 文件夹 `.dsh-canvas-session.json` 标记）、`agent/inbox/inserted` 标题改名同步。以后落盘结果应进入统一 Asset Service。

### platform.js（131 行）— 保留为 Platform Adapter

`platformName/isWindows/isMac` `userHome` `expandUserPath` `isAbsolutePath` `resolvePython` `pickFolder` `openFolder` `revealFile` `openWithSystem` `platformCapabilities`。已符合 §21，只需搬到 `host/adapters/platform.adapter.js`。

### scripts/（Python 原子能力）

| 现文件 | 目标（§20.1） |
|---|---|
| `pixel_edit.py` `composite_edit.py` `prepare_mask.py` `prepare_model_input.py` | `scripts/image/` |
| `ocr_image.py` `infer_text_style.py` `prepare_text_mask.py` | `scripts/text/` |
| `remove_background.py` | `scripts/background/` |
| `vectorize_image.py` | `scripts/vector/` |
| `export_text_psd.py` | `scripts/psd/` |

移动脚本必须与 `python.adapter.js` 的 Tool Registry 同时落地，路径由注册表提供而不是业务代码写死。

## 6. HTTP API 清单（41 条，回归基准）

所有路由前缀 `/dsh-canvas/`，监听 `127.0.0.1:43120`。**重构期间路径、方法、请求/响应形状一律不得变化**（禁止 3）；§28 的 `{ok,data}` 统一包装只能以「新增字段」方式叠加，不能替换现有字段。

| 领域 | 路由 |
|---|---|
| 健康 / 状态 | `health` `state` `system-appearance` `chat-context` |
| 项目 | `projects` `open-project` `import-project` `rename-project` `delete-project` `project-files` `list-directories` `backup-canvas` |
| 素材 / 资产 | `materials` `materials/tags` `materials/tag` `materials/save` `materials/delete` `materials/open` `materials/select` `image` `preview` `import-file` `materialize-image` `rename-image` `restore-image` `archive-images` `check-sources` `photoshop-outputs` `reveal-file` |
| 生成 / 编辑 | `edit-image` `remove-background` `remove-background-progress` `vectorize-image` |
| 文字 | `ocr-image` `export-text-psd` |
| 设置 | `image-settings` `image-setup` `image-status` |
| 外部应用 | `open-in-photoshop` `open-in-illustrator` |
| 静态 | `vendor/` |

## 7. 现有检查（2026-09-17 执行）

| 检查 | 结果 |
|---|---|
| `node --check` × 5（index / client / image-engine / chat-image-router / platform） | PASS |
| `node tests/check-portability.mjs` | PASS（`portability checks passed`） |
| `git diff --check` | PASS |
| 工作树 | 干净，main == origin/main |

Phase 1 建目录后复跑同一组检查，结果见 §10。

## 8. God File 拆分建议（供 Phase 2 / 5 使用）

1. **client.js 先外置厂商包，再拆业务。** 82% 是一行 vendor；`/dsh-canvas/vendor/` 路由与 `TLDR_BUNDLE_URL` 双路径已存在。需要确认的唯一风险：srcdoc iframe（`about:srcdoc` 源）通过 `<script src="http://127.0.0.1:43120/dsh-canvas/vendor/…">` 加载是否在 DSH 的 CSP 下被允许——当前内嵌形态很可能正是为了绕过这一点，Phase 5 第一步就是做这个验证，验证不过则保持内嵌、只在构建期拼接。
2. **srcdoc 内 JS 必须变成独立源码。** 1.7.0 开发期间多次因 `\"` 转义导致编辑失败与语法错误，已形成「抽 `<script>` → 反转义 → `node --check`」的专用校验法。把 `client/core/canvas/frame/*.js` 作为普通文件维护、构建期序列化进模板，可根治此问题。
3. **index.js 的 `apply()` 先抽路由表，不动业务体。** 第一步只把 1,800 行按路由切成 `routes/*.js` 的 handler 函数，保持每个 handler 内部代码逐字不变；第二步再把 handler 内的文件系统 / Python / 模型调用下沉到 services。两步之间跑一次回归。
4. **`CanvasOverlay` 按 Feature 边界切，不按「组件大小」切。** 2,100 行里素材库、引擎设置、编辑工具、主题同步彼此通过闭包共享 state；拆分前先画出 state 归属表（哪个 state 只被哪个 Feature 读写），共享的进 `core/document`，独占的跟 Feature 走。
5. **`chat-image-router.js` 与 `ImageTail` 是同一条 Asset 链的两端**（Host 落盘 ↔ Client 三级回退加载）。Phase 7 建 Asset 模型时应把二者作为第一个端到端样例，而不是最后处理。

## 9. 本阶段未完成的基线项（诚实记录）

| 执行文档要求 | 状态 | 原因 / 补齐计划 |
|---|---|---|
| 保存典型测试项目 | 未做 | 用户项目目录为个人资产（`TUPIAN/<项目>/…`），不进仓库；Phase 2 前由用户指定 1 个小型样例项目复制到 `tests/fixtures/`（不含个人图片） |
| 保存当前 UI 截图 | 未做 | 插件当时处于有意卸载状态；用户干净重装测试完成后补 6 张截图（设计模式开 / 素材库 / 颜色标记 / 选区工具栏浅深色 / 文字重建面板 / 聊天图片输出）到 `docs/refactor/baseline-screenshots/` |
| 保存核心 API 返回样例 | 未做 | 需要 DSH 运行；补齐时对 `health` `state` `materials` `materials/tags` `image-status` `system-appearance` 各存一份真实响应 JSON |
| 性能数据（§33） | 未做 | 启动 / 打开项目 / 保存 / 内存，需实机；补齐时在同一台机器测三次取中值 |

**这些缺项不阻塞 Phase 1（建目录不迁业务），但阻塞 Phase 2 开始**：没有真实 API 响应样例就无法为路由拆分写对比测试。

## 10. Phase 1 完成后复检

见提交记录与 `REGRESSION-v1.7.0.md` 「A. 静态检查」组。
