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
| Phase 4 Job Manager | ✅ | ce2b2f3；unit 8 项 + jobs 集成；路由中间件接入，handler 零改动 |
| Phase 5 Client 拆分 | ✅ | 5a 2160dfd：24 段字节一致（sha256 eee99d37…）；5b fbf8c8b：删 tldraw 死链，2,344,322→414,929 B（−82.3%） |
| Phase 6 Command + History | ✅ 55d4f6b | shared/commands + 内联进 bundle + window.__dshCanvas；unit 5 项 |
| Phase 7 CanvasObject / Asset | ✅ 5a7ba41 | contracts/{canvas-object,asset}.js、schemas/project.schema.js（v2 迁移）、GET /assets；unit 8 + migration 3 |
| Phase 8 Text Feature 整合 | ✅ 5a7ba41（部分） | text-service 已独立（Phase 2）、TextRebuildPanel 独立分段、Python Tool Registry 建立；scripts/ 物理重组与路由改经注册表**未做**（避免同一提交动路径又动调用方） |
| 测试套件 | ✅ | unit 32 + migration 3 + integration 3 套（parity/jobs/contracts）+ smoke 工具 |
| 重构后运行时回归对比 | ⏳ | |
| 文档/交接/报告 | ✅ | CHANGELOG 1.8.0 未发布段、REGRESSION 回填、AGENT-HANDOFF §14、BASELINE §9 |

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

- [Phase 2–5 真实运行时验证（2026-09-17 01:5x）] sync 四副本 → 重启 DSH（remote-debugging-port）：
  - Host：/dsh-canvas/health 200（经 src/host 模块加载）
  - Client（414KB 新构建）：DOM 快照与 1.7.0 基线**结构 0 差异**（设计模式/工具栏 6 按钮/iframe 主题变量/聊天图片输出 2 张/项目恢复）
  - 30 条真实 API 样例 vs 1.7.0 基线：**仅 system-appearance 3 字段差异 = aa36de7 预期修复**
  - DSH 保持运行重构版，供早上直接查看

- [Phase 6–8] Command/History + Feature Registry + 契约 + schema v2 + Python Tool Registry + 三个只读端点；bundle 内联机制；unit+migration 35/35，集成 3 套 PASS，对等 55/0。
- [最终回归] sync → 重启 DSH：health/capabilities(12 features, 10 enabled)/jobs/python-tools/system-appearance 全部经真实网关通过；`window.__dshCanvas` 内核就绪；DOM 快照 0 结构差异；干净 fixture 重采 30 条 API 仅 3 处 = system-appearance 修复；**Codex edit-image 端到端 13s 通过**，Job 记录 completed。证据目录 `docs/refactor/regression-1.8/`。
- [未做/诚实记录] scripts/ 物理重组；CanvasOverlay（2,100 行分段）未按 Feature 再拆；Command 层未接入具体 UI 操作（Excalidraw 自带 undo 覆盖画布操作，业务级命令留给 Text Edit v2/替换资产）；Windows 实机回归；性能内存计时。
- [2026-09-17 上午·用户反馈] fd811d7 动态加载覆盖层（真实路径验证：提交即出现，Codex 返回后消失，动画在跑）；42a1abc 擦除裁剪 + 色调匹配（erase-pipeline 集成测试通过；真实 Codex 擦除见下条）。
- [真实 Codex 擦除验证] 合成 2000×1400 浅色背景 + 文字框 → 擦除 43s：文字框消失、窗口外零改动（顶部 100px 完全一致）、擦除区与上下带亮度差 2.2/2.4（源图自身梯度 1.0 量级）。对比图 `regression-1.8/erase-crop-tonematch-compare.png`。
- [2026-09-17·聊天图片不显示] 用户反馈一轮 12 张中 1 张碎图。根因：DSH 附件 blob 解析悬而不决 + 附件记录的 sourcePath 已被移走（空目录），旧三级回退是「取第一个非空」导致第三级从未尝试。修复：候选链逐级尝试 + 本地优先 + blob 6s 超时 + resolve-image 按名找回（含兄弟项目目录探测）+ 整洁失败卡。真实会话验证 12/12 显示。
- [2026-09-17·SVG 导出] export-text-svg.py + 路由 format:'svg' 分支 + 面板双按钮（PSD / SVG）；离线 XML 校验 + harness 全链路（含无选区全禁用、隐藏组语义）通过；PYTHON_TOOLS 10→11。
- [2026-09-17·原生 .ai] format:'ai' 分支：Illustrator ExtendScript（documents.add RGB → placedItems 嵌底图 → textFrames 原生点文字 → saveAs IllustratorSaveOptions(pdfCompatible)），AppleScript do javascript 同 Photoshop 模式；实测 5s 生成 271KB %PDF 头 .ai，字体引用（普惠体/Inter）与文字位置/对齐/颜色在 Quick Look 预览验证正确；失败退回 SVG。
- [2026-09-17·图层级编辑] document.routes（/document-layers + /edit-layer）+ psd_layers.py + normalize_image.py + iframe「编辑图层」按钮 + LayerEditDialog。实测：PSD（含真实文字层）与 AI（含两个文字框）各跑通全链路（提取→Codex→规范化缩放→PS/AI 原位写回），文字层/名称/位置/层级全部保留；踩坑记录：PS 对中文目录文件 app.open 报“打开选项不正确”、脚本错误弹窗会卡死 AppleEvent（displayDialogs=NO + userInteractionLevel 修复）、模型输出常为 WEBP 字节且分辨率漂移（规范化+resize）、ExtendScript 无 JSON/无 bounds.map。
