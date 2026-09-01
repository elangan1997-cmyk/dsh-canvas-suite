# Windows Debug Report

## Environment

- Date: 2026-08-31 (Asia/Shanghai)
- DSH URL: `http://127.0.0.1:3080/`
- Active profile: `web`
- Installed canvas-workbench before repair: `1.4.0-windows-preview.1`
- Installed home-explorer: `1.1.0`
- Node.js: `24.16.0`
- Python: `3.12`
- Git: `2.54.0`

Secrets, chat contents, and user asset paths are intentionally omitted.

## WIN-001 Canvas iframe fails to parse and renders blank

- Severity: blocker
- Environment: Windows, DSH web profile, canvas-workbench 1.4.0-windows-preview.1
- Preconditions: enable Design Mode and open the existing test canvas project
- Minimal reproduction: Design Mode → project menu → open test project
- Expected: the saved canvas and its image elements render
- Actual: the shell reports the project as loaded, but the iframe is blank
- Console/service error: `SyntaxError: Unexpected token '.'` from `about:srcdoc`
- Root cause: the embedded iframe source contained `e.deltaY>0?.9:1.1`. Without separation after the ternary question mark, Chromium parses `0?.9` as malformed optional chaining and rejects the complete embedded script before startup.
- Modified files: `canvas-workbench/lib/client.js`, `tests/check-portability.mjs`
- Automatic check: `node --check` and portability check passed before installation
- Real UI regression: passed after installation and DSH reload; iframe controls and saved images render
- Status: passed

## WIN-002 Windows PowerShell 5.1 cannot parse localized installer

- Severity: blocker
- Environment: Windows PowerShell 5.1, repository installer scripts encoded as UTF-8 without BOM
- Minimal reproduction: run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File windows-installer/install.ps1 -NoScheduledTask`
- Expected: installer synchronizes both runtime copies and the recovery distribution
- Actual: Chinese text is decoded as mojibake, followed by unterminated-string and unexpected-brace parser errors
- Root cause: Windows PowerShell 5.1 does not reliably treat BOM-less localized scripts as UTF-8
- Modified files: all `windows-installer/*.ps1` files now use UTF-8 with BOM; `tests/check-portability.mjs` verifies the BOM
- Automatic check: PowerShell 5.1 parser and portability checks passed
- Real UI regression: installer synchronized web/desktop runtime copies successfully
- Status: passed

## WIN-003 Programmatic canvas changes disappear after reload

- Severity: critical data loss
- Minimal reproduction: copy a selected image or paste an image, wait for autosave, then reload
- Expected: the new element remains in the shared project
- Actual: the new element is visible and exportable in the live iframe but disappears after reload
- Root cause: Excalidraw programmatic `api.updateScene()` mutations were assumed to trigger the same persistence callback as direct pointer edits. The parent never received a guaranteed fresh snapshot for copy/paste and related programmatic operations.
- Fix: add an explicit `publishCanvasChange()` snapshot notification after programmatic mutations; assign unique names to copied images.
- Automatic check: added persistence-notification markers to portability checks
- Real UI regression: copy and paste snapshots wrote to `canvas.json`; reload preserved the new elements
- Status: passed

## WIN-004 Windows managed-asset path mismatch causes recursive copies

- Severity: critical disk growth / data corruption
- Minimal reproduction: load a managed image whose `dshSourcePath` uses a Windows drive path and allow project synchronization to run
- Expected: paths already inside `<project>\\assets` are recognized as managed and left in place
- Actual: the client compares a backslash path to a forward-slash `/assets/` prefix, repeatedly rematerializes the same image, and nests the previous full path into each new file name
- Root cause: separator and case normalization were missing from managed-path containment checks; the rename endpoint had the same separator-sensitive containment issue
- Fix: normalize drive paths to forward slashes and lower case before containment/deduplication; use resolved normalized paths on the host
- Test-data recovery: DSH was stopped; 1,016 generated files from the dedicated `TEST` project were moved (not deleted) to `D:\\dsh-画布\\TEST-quarantine-20260831`; `canvas.json` was backed up and its two original managed paths restored
- Automatic check: Windows managed-path marker added to portability checks
- Real UI regression: managed paths no longer recursively rematerialize; asset count remained stable except for one intentional copy per test action
- Status: passed

## WIN-005 Rename and project polling race removes the renamed element

- Severity: critical data loss / stale cross-chat state
- Minimal reproduction: duplicate a managed image, rename it, then open the same canvas project from a new chat
- Expected: the renamed image remains live and every chat reads the same four-image project snapshot
- Actual: the original chat temporarily keeps four images in memory, while `canvas.json` and a newly opened chat contain only three; the renamed element is marked `isDeleted`
- Root cause: the host renames the managed file before the iframe publishes the updated `dshSourcePath`. A project-files poll already in flight can compare its fresh disk listing with the stale element path and misclassify the renamed image as externally deleted.
- Fix: guard elements while their rename is in flight, update the known disk-path set, publish the rename-result scene explicitly, then release the guard and persist the new snapshot.
- Automatic check: `node --check`, portability check, diff check, and source/web/desktop SHA-256 equality passed
- Real UI regression: the fault was reproduced and diagnosed in the real UI; post-fix click regression awaits one manual local-page refresh because browser automation access to `127.0.0.1` was blocked after the DSH restart
- Status: fixed in code and installed; final UI confirmation pending

## WIN-006 Windows Adobe buttons use the default file association

- Severity: serious functional mismatch
- Expected: `Ps 编辑` always starts Photoshop and `AI 编辑` always starts Illustrator
- Actual: both endpoints used the Windows default file association, so raster images could open in Photos and SVG files could open in a browser while the canvas reported Adobe success
- Root cause: the Windows branch delegated to the generic system opener instead of resolving the requested Adobe executable
- Fix: discover installed Adobe product directories from Adobe registry keys and `.psd`/`.ai` file associations, verify the requested product exists, then use a PowerShell 5.1-safe non-blocking `Start-Process` launch; return an honest missing-product error when unavailable
- Environment result: Photoshop 2022 and Illustrator 2022 are installed at non-default Windows paths and both launched successfully with harmless test files
- Model image editing: `dsh-codex 0.2.5` is installed and OAuth-authenticated; the image engine health is `ready: true`. The fallback API is not configured. DSH/Node must inherit the active Clash proxy (`127.0.0.1:7890`) for token refresh and image requests.
- Automatic check: JavaScript syntax, portability, and diff checks passed
- Status: fixed, installed, and DSH restarted; PS endpoint and Illustrator endpoint both returned `ok: true` with responsive Adobe processes

## WIN-007 Windows 本地去背景/转矢量在 venv 切换阶段报 Errno 22

- Severity: serious functional failure / apparent hang
- Minimal reproduction: first click “去除背景” or “转矢量” on a raster image while the isolated Python runtime is not yet active
- Expected: prepare the isolated dependency environment, show progress, and complete the operation
- Actual: progress stopped after environment preparation and the request failed with `[Errno 22] Invalid argument`
- Root cause: both Python helpers called `os.execv` to replace the DSH-managed child process after creating their Windows virtual environment; this launch mode is rejected by the DSH subprocess host
- Fix: activate the venv’s `site-packages`, `PATH`, and Windows DLL directory in the current process instead of self-restarting
- Real script regression: rembg `isnet-general-use` downloaded/loaded and produced a transparent PNG; ImageTracerJS produced a valid SVG from the same test image
- Status: fixed, installed, and DSH restarted; direct rembg and ImageTracerJS regression passed

## Test Matrix

| Area | Static check | Real UI |
|---|---|---|
| DSH startup and Design Mode shell | n/a | passed |
| Embedded canvas startup | passed | passed after reload/restart |
| Project load and persistence | passed | copy and paste remained after reload |
| Drag/drop and paste deduplication | partial | consecutive paste added exactly one element per paste; OS drag still pending |
| Selection and send to chat | n/a | single selection and two-image selection attached to the current draft without sending |
| Move, resize, duplicate, rename, delete | partial | duplicate passed; rename race fixed and installed, final refresh confirmation pending; destructive delete awaits explicit confirmation |
| PNG export | n/a | passed; generated PNG opened and contained all live elements |
| PSD/AI/SVG/PDF fallback | passed | Photoshop 2022 and Illustrator 2022 endpoint launches returned `ok: true`; source-file fallback remains safe |
| Image engine degradation and retry | partial | dsh-codex is installed/authenticated/ready; fallback API remains unconfigured and retry path is covered by static checks |
| 去背景 / 转矢量 | passed | rembg generated transparent PNG; ImageTracerJS generated valid SVG; Windows venv transition fixed |
| 编辑图片文字 OCR | passed | Tesseract.js runtime installed on first use; selected and full-image WebP OCR returned HTTP 200 with CJK/English text and unique multi-region IDs |
| PowerShell 5.1 installer parsing | passed | passed |
| Programmatic mutation persistence | passed | passed across reload |
| Windows managed asset containment | passed | passed; no recursive growth after repair |
| Cross-chat A→B→A shared state | partial | exposed WIN-005; post-fix confirmation pending after local-page refresh |
| Windows Explorer open/reveal | passed | project open and file reveal both returned HTTP 200 in the real local page |
| Project-folder new-file sync | passed | new file surfaced in about 10 seconds without auto-importing into the canvas |

## WIN-008 手动指定 Photoshop/Illustrator 可执行文件

- Severity: compatibility enhancement
- Expected: users with custom drives, multiple Adobe versions, or non-default install directories can choose the exact `Photoshop.exe` / `Illustrator.exe` used by the canvas
- Fix: add a renderer-native executable picker to 图像引擎设置 (the DSH host subprocess is headless, so WinForms is not used); persist `photoshopPath` and `illustratorPath` in the per-user settings file; use the selected executable first and fall back to registry/file-association detection when a saved path is missing
- Safety: the picker only accepts an existing file, settings are local to the user profile, and API/OAuth credentials remain separate
- Verification: settings GET/POST round-trip passed; Photoshop 2022 and Illustrator 2022 launch endpoints returned `ok: true` after saving their explicit paths; the old headless picker path was reproduced as stuck and removed from the UI; the page picker now returns Electron's absolute `File.path` (with a paste-path fallback in ordinary browsers)
- Status: fixed and installed; DSH restarted with the active proxy environment

## WIN-009 编辑图片文字 OCR 缺依赖、选区串入相邻文字

- Severity: serious functional failure / precision issue
- Minimal reproduction: 打开“编辑图片文字”，框选包装标题并点击“识别选区”
- Expected: 识别成功，只返回框选区域内的文字候选，候选可以逐条校正
- Actual: UI 显示 `OCR 失败：No module named 'pytesseract'`；旧版本地路径还依赖系统 `tesseract.exe`，未安装时无法启动。选区边缘轻微相交时也可能把相邻文字带入。
- Root cause: Windows 仅检测到了 Python 3.12，但系统没有 pytesseract 和 Tesseract 可执行文件；旧 OCR 路径没有自包含运行时。模型/本地结果的命中判断只要有任意面积相交，导致紧邻行被误选。
- Fix: 增加用户目录隔离的 Tesseract.js 5.1.1 运行时和训练数据缓存，首次识别按需安装，不需要管理员权限；npm 通过真实 node.exe 调用，避开 DSH 子进程直接启动 `.cmd` 的 EINVAL。选区识别增加少量上下文但按原始选区以 35% 覆盖率或文字框中心过滤；Python 样式推测改用 UTF-8 临时 JSON 文件，避免 Windows argv/代码页损坏中文；多选结果重新编号，避免重复 React key。
- Modified files: `canvas-workbench/lib/ocr-engine.js`, `canvas-workbench/lib/index.js`, `canvas-workbench/lib/client.js`, `canvas-workbench/scripts/infer_text_style.py`, `canvas-workbench/scripts/ocr_image.py`
- Automatic check: `node --check` (index/client/ocr-engine), `node tests/check-portability.mjs` passed
- Real API regression: DSH restarted on port 3080; 2048×2048 WebP with Chinese+English title returned HTTP 200, `engine: tesseract.js`, two in-selection candidates, Chinese text preserved (no `���`); full-image and two-region requests also returned HTTP 200 with unique IDs. First-run runtime and `chi_sim`/`eng` traineddata were cached under the user DSH directory.
- Status: fixed, installed, and service regression passed; please refresh the DSH page once before UI click verification

## WIN-010 文字编辑 PSD 草稿依赖缺失/API 版本不兼容

- Severity: serious functional failure
- Minimal reproduction: OCR 成功后点击“清理背景并生成 PSD”（关闭背景清理时也可复现）
- Actual: 原路径直接报 `No module named 'psd_tools'`；首次加入依赖时旧版 1.10.8 又不提供当前脚本使用的 `create_pixel_layer` API。
- Fix: `export_text_psd.py` 现在按需创建用户目录隔离的 `psd-runtime`，安装并校验 `psd-tools 1.18.0`，原地激活 site-packages 避免 Windows `os.execv`/EINVAL；PSD blocks 改用 UTF-8 临时 JSON 文件传递，避免中文文字层乱码。
- Verification: 在实际 Windows Python 3.12 上生成 15.8MB PSD 草稿成功；DSH 重启后 OCR→PSD 连续请求均返回 HTTP 200，测试项目写入 `金鱼缓沉型鱼食-500g-文字编辑.psd`，未调用 Photoshop 时保留原图与候选预览层。
- Status: fixed, installed, and end-to-end service regression passed

## WIN-011 Windows 打开项目文件夹/定位文件返回失败

- Severity: serious functional failure
- Minimal reproduction: 在“项目管理”中点击“打开项目文件夹”，或对项目图片点击“在文件夹中显示”
- Expected: Windows 资源管理器打开项目目录，或选中指定文件
- Actual: 两个接口均返回 HTTP 500（“资源管理器打开失败/定位失败”），即使目标路径存在
- Root cause: `explorer.exe` 是 Shell 进程，直接交给 DSH 同步子进程宿主时会返回非零状态；定位文件还使用了拆开的 `'/select,'`、`path` 两个参数，Explorer 在 Windows 上不会稳定解析这种形式。
- Fix: Windows 分支改用 PowerShell 5.1-safe 的 `Start-Process explorer.exe` 异步启动；路径以字面量传入，定位参数合并为单个 `/select,<完整路径>`；无 PowerShell 时保留修正后的 Explorer 直接启动回退。
- Automatic check: `node --check`、可移植性检查、diff 检查通过；web/desktop 运行副本哈希一致。
- Real UI regression: 本地 DSH 页面打开 `TEST` 项目后点击“打开项目文件夹”，反馈变为“已在系统文件管理器中打开项目目录”；项目图片定位接口返回 HTTP 200。
- Status: fixed, installed, and real UI regression passed

## WIN-012 项目目录新增文件没有可见的实时反馈

- Severity: normal functional clarity / Windows path compatibility
- Minimal reproduction: 保持画布处于设计模式并打开项目目录，在 `<project>\\assets` 放入一张新图片，等待一次目录同步轮询。
- Expected: 画布在不误导入的前提下及时反映目录变化；已链接源文件仍能刷新。
- Actual: 旧实现只更新内部文件集合，不向用户提示新文件；Windows 反斜杠与 `/assets/` 前缀混用时，项目内源文件还可能被误判为外部源。
- Root cause: 目录同步只对已在画布中的源元素做刷新，新增文件没有 UI 状态；项目归属判断使用大小写/分隔符敏感的 `startsWith`。
- Fix: 用统一的 Windows 路径归一化（分隔符和大小写）识别项目内源；轮询在首轮建立基线，后续检测到新增图片时显示文件名和“不会自动加入画布”的明确提示，同时保留产品契约（只有用户拖入、粘贴或点击聊天卡片“加入画布”才上板）。
- Automatic check: `node --check`、可移植性检查、diff 检查通过；web/desktop 运行副本哈希一致。
- Real UI regression: 在实际 `TEST/assets` 复制 `__windows-realtime-probe.png` 后，约 10 秒内页面反馈显示“检测到项目目录新增文件…”，画布元素数量保持 5（没有未经用户确认的自动导入）；测试副本已清理。
- Status: fixed, installed, and real UI regression passed

## WIN-013 Windows 助手输出的 PSD/SVG 等文档没有进入图片输出卡片

- Severity: serious functional visibility issue
- Minimal reproduction: 让助手或工具输出 `D:\\…\\文件.psd`、`.svg`、`.pdf` 或 `.ai` 路径，观察消息下方的图片输出区域。
- Expected: 本地文档路径被识别为可预览的输出，显示缩略图，并可“加入画布”。
- Actual: PSD 路径完全未被前端路径提取器识别；盘符/UNC 纯文本路径也不符合旧版仅 POSIX 的正则，消息中只剩普通文字。
- Root cause: `IMAGE_EXT_RE` 及代码块/XML/纯文本路径表达式漏掉 `psd`，绝对路径表达式只接受 `/…` 或 `~/…`。
- Fix: 所有文档路径表达式加入 `psd`；新增 Windows 盘符/UNC 路径提取，保留路径中的空格；预览显示继续统一走 `/dsh-canvas/preview`，不把 PSD 原始二进制直接交给浏览器。
- Automatic check: `node --check`、可移植性检查、diff 检查通过；web/desktop 运行副本 SHA-256 一致。
- Real API regression: 实际 PSD 与 SVG 文件的预览接口均返回 HTTP 200、`image/svg+xml` 且内容非空；项目扫描返回 `kind: psd/svg` 和可用预览 URL。
- Status: fixed, installed, and preview regression passed

## WIN-014 精确打开目录、用户授权同步与真实 PSD 预览

- Severity: serious functional regression
- Actual: “打开项目文件夹”会落到“我的文档”；项目目录中的现有/新增文件没有进入画布；Windows PSD 只显示占位 SVG。
- Root cause: PowerShell `Start-Process -ArgumentList` 会重新拼接 Explorer 命令行并拆坏含空格/中文的路径；目录轮询只有提示逻辑；PSD 预览代码在非 macOS 平台明确直接返回占位图。
- Fix: 用 `Invoke-Item -LiteralPath` 精确交给 Windows Shell；将“打开并同步项目文件夹”作为本次项目会话的明确同步授权，立即补齐未关联文件并持续同步新增文件，同时强制刷新旧 PSD/SVG 占位；新增隔离 Python 运行时的 PSD 合成预览器。
- Automatic check: JavaScript 语法、可移植性检查和实际 PSD 合成脚本均通过。
- Real regression: 实际 `TEST` 项目扫描识别 11 个支持文件；两个 PSD 预览均返回 HTTP 200、`image/jpeg`、185811 bytes；网页点击同步后，缺失的 PSD、SVG、WebP 均出现在画布元素列表。
- Status: fixed, installed, and real UI/API regression passed

## WIN-015 聊天 imagegen 路由与删除源文件未进画布回收站

- Severity: serious functional mismatch / data-safety regression
- Root cause (chat route): DSH 自带 `dsh-codex` 的 `imagegen` 工具独立于画布图像引擎设置；聊天工具固定调用 Codex 图像端点和 `gpt-image-2`，当前聊天模型只负责判断是否支持图像输入。画布中选择的 `api` 仅影响画布编辑、去背景和文字清理，不能改变聊天模型路由。
- Root cause (delete): `deleted-selection` 消息先更新了“删除后”快照，常规变更处理随后无法找出被删图片；Windows 端归档接口还用 POSIX `/` 连接符比较路径，盘符路径因此被跳过。
- Fix: 删除事件现在使用删除前快照立即归档源文件；服务端统一盘符/UNC 路径的分隔符、大小写和项目目录边界判断。聊天图片输出继续支持 `dsh-attachment` 持久附件，并保留当前聊天 provider/model 作为文字识别上下文；未把画布 API 设置错误地耦合到 DSH 核心 imagegen。
- Automatic check: `node --check`（client/index/image-engine）、`node tests/check-portability.mjs`、四个已安装运行副本 SHA-256 一致。
- Route regression: API 引擎模拟 HTML、空 data、有效 PNG 三种响应，分别得到可读失败、空图失败和成功返回；聊天 dsh-codex 源码确认 `imagegen` 使用 `gpt-image-2`、`/images/generations|edits`，且非 Codex 模型受 `imagegen-other-models` 开关及图像输入能力检查约束。
- Archive regression: 通过真实 host 路由处理测试项目，Windows 反斜杠和 `/` 混合路径均成功把 PNG 移入“画布回收站”。
- Real Desktop UI: 待完全退出并重新打开 DSH Desktop 后验证；当前进程早于最新插件安装启动，且无有效窗口/监听端口，不能把静态/接口结果冒充真实 UI 通过。
- Status: 修复已安装，待重启后的真实 UI 回归
