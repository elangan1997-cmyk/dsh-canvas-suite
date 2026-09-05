# DSH画布工作台

面向 DSH Desktop 的可插拔设计画布套件，当前版本 `1.5.4`，包括：

- `canvas-workbench`：无限画布、项目持久化、聊天图片交互和渐进增强图片工具。
- 独立文件浏览器已移除；项目目录选择与“在文件夹中显示”由画布插件自身提供。
- macOS 安装工程。
- Windows 10/11 初级版 PowerShell 安装、恢复、卸载和健康检查。
- 可选的内置 `dsh-codex` 兼容构建，用于在支持的 DSH Profile 中使用 Codex OAuth 路由。
## 先从设计师的工作开始看

DSH 画布工作台不是把网页工具搬到桌面上，而是把设计师每天反复做的几件事连起来：找素材、生成图片、挑选区域、修改、确认效果、保留原图、交给 Photoshop/Illustrator 继续细化。

你可以把它理解为一个“项目文件夹 + 无限画布 + 当前聊天模型 + 本地设计软件”的工作台：
- 不必为了让模型看图而反复上传和下载；项目里的素材、聊天原图和画布元素有明确的落盘位置。
- 不必在多个网页之间复制提示词；图片生成、编辑、识别和加入画布都围绕当前项目完成。
- 不必猜测失败在哪里；操作日志会告诉你是选区、模型请求、响应解析、预览转换还是落盘阶段出错。
- 不必牺牲后期编辑；文字重建可以输出 PSD 背景和可编辑文字层，原图尺寸和比例尽量保持。

## 设计师最容易感受到的便利

| 设计工作 | DSH 画布工作台的做法 |
| --- | --- |
| 找图和整理 | 打开项目文件夹即可看到实时更新的素材，画布和文件夹保持同一项目关系 |
| 试几个方案 | 聊天生成的原图保留在项目目录，加入画布只是建立一个可排版的副本 |
| 局部修改 | 框选后编辑、擦除或去字，未选区域作为“保持不变”的约束 |
| 做交付文件 | 背景修复图、文字层和原图分开保留，可继续进 PSD 或 Adobe 软件 |
| 处理失败 | “更多 → 操作日志”记录每一步，不需要把整段聊天或账号信息发给别人 |
| 日常操作 | Alt + 滚轮缩放、拖拽平移、多选对齐，习惯接近 Photoshop |

## 和网页第三方设计 Agent 的区别

网页第三方工具适合临时试用、快速做一张图；DSH 更适合长期项目、批量素材和需要交付源文件的设计工作。主要差异在于：
- **本地项目优先**：素材和生成原图在自己的项目文件夹中管理，不依赖网页会话是否还在、网页链接是否过期。
- **模型路由可选择**：设计模式开启时统一走画布设置的 Codex 或 API；没有 Codex 会员时仍可以使用自己的 API。
- **从生成到交付连贯**：网页工具通常停在一张扁平图片，DSH 可以继续做选区编辑、文字识别、PSD 分层、文件夹归档和 Adobe 衔接。
- **对原始素材更友好**：编辑器使用原始分辨率，结果保留原图和独立文件，减少网页预览压缩、重复下载和版本混乱。
- **更容易追责和复现**：项目路径、模型路由、失败步骤和输出文件都能在本机核对，便于团队复盘。
- **隐私边界更清楚**：登录、API 凭据、项目内容和聊天原图留在使用者自己的电脑；只有调用所选模型服务时才发送必要的图片请求。

这并不意味着网页工具没有价值：网页服务通常免安装、适合快速试用或协作展示；如果你需要长期保留设计资产、可编辑交付和稳定的本地工作流，DSH 画布工作台会更合适。

## 推荐的设计工作流

1. **生成方向**：在当前聊天中描述方向，选择画布图像引擎，生成图片后点击“加入画布”。
2. **整理方案**：在无限画布中排列多个版本，使用文件夹实时刷新的素材补充版面。
3. **局部修改**：选中需要调整的区域，调用编辑图片、智能擦除或去除背景；未选区域保持原样。
4. **文字重建**：框选文字，让视觉模型返回 JSON 和背景修复提示词，确认后输出背景图和 PSD 文字层。
5. **交付和归档**：保留原图、修复背景、PSD 和操作日志；需要精修时从画布直接交给 Photoshop/Illustrator。

## 快速选择下载包

- **新电脑、没有 DSH Desktop**：下载完整 Windows 安装包，安装后登录自己的账号。
- **已经有 DSH Desktop，只想更新画布**：下载独立插件 ZIP，退出 DSH 后运行安装脚本。
- **已经有 DSH，偏好包管理更新**：安装 `dsh-canvas-workbench` npm 包；它不包含桌面端和本地大模型环境。
- **macOS 用户**：已有 DSH 可用 `install-canvas-plugin.sh` 更新画布；全新电脑使用 Release 中的 `macOS-Complete` DMG/PKG。


面向设计人员的 DSH Desktop 画布工作台，把图片生成、项目文件、无限画布、图片处理和 Photoshop/Illustrator 协作集中在一个工作区。你不需要先了解 Agent：按下面的下载说明安装后，就可以像使用普通设计工具一样开始工作。

> 当前 Mac 完整版：`v1.5.4-macos-complete` ｜ [下载 DMG/PKG/插件 ZIP](https://github.com/elangan1997-cmyk/dsh-canvas-suite/releases/tag/v1.5.4-macos-complete)  ｜ Windows Preview：`v1.4.0-windows-preview.3`

## 画布插件能做什么

### 1. 无限画布与项目管理
- 拖入、粘贴、缩放、平移、多选、对齐、复制、删除和 PNG 导出。
- 项目独立保存，切换项目后可以继续编辑；打开项目文件夹后，图片资产会实时刷新。
- “更多”菜单提供打开项目文件夹、图像引擎设置和操作日志，方便日常使用与排查。
- 画布删除只影响画布内容；聊天生成的原图保存在项目根目录的 `TUPIAN/<项目名>/DSH聊天生成图片`，不会因为删除画布元素而丢失。

### 2. 图片生成与聊天协作
- 在设计模式开启时，图片生成统一读取画布的图像引擎设置：选择 Codex 就走 Codex，选择 API 就走配置的 API 路由。
- 设计模式关闭时，聊天继续使用 DSH 自己的图片生成通道。
- 聊天生成图片会显示“加入画布”和“在文件夹中显示”，加入画布后仍保留独立原图。
- API 请求包含超时、空响应和 HTML 响应检测，并在操作日志中记录失败步骤。

### 3. 图片编辑、智能擦除和去除背景
- 编辑图片：输入自然语言要求，可选框选区域；未框选时按整图编辑。
- 智能擦除：只处理选区内容，尽量保持主体、比例、尺寸和其他区域不变。
- 去除背景：按原图比例和尺寸输出，支持透明背景；选区会自动扩展并羽化，减少明显矩形边界。
- 连续编辑以原图母版合成，避免多次蒙版叠加造成重影、错位或画质下降。
- 生成结果会落盘到项目目录，并保留原图，不覆盖用户已有文件。

### 4. 文字识别与 PSD 分层
- 框选后会把“整张原图 + 蓝色选区框”交给当前视觉模型理解，而不是只裁剪小图。
- 模型返回结构化 JSON：文字内容、位置、颜色、字号、字体建议、对齐方式和置信度。
- 同时生成“只移除选中文字、其余区域保持一致”的背景修复提示词。
- PSD 输出包含背景修复图和可编辑文字层；文字层的位置、字号和颜色按原图坐标换算。
- 识别结果默认全部勾选，可逐项取消或修改后再生成。

### 5. 文件预览与外部编辑
- 支持 PNG、JPG/JPEG、WebP、SVG、PSD、PDF、AI 等常见资产。
- PDF/AI 优先尝试本机转换器生成预览；转换器不可用时仍保留文件卡片，并提示可用 Illustrator/系统应用打开。
- Photoshop 和 Illustrator 可按本机安装位置检测；也可在设置中手动指定可执行文件。
- 画布缩放支持 Alt + 滚轮，更接近 Photoshop 的操作习惯；编辑图片时使用原始分辨率，放大不会主动压缩预览源。

### 6. 操作日志
“更多 → 操作日志”会记录最近的项目加载、文件刷新、图片落盘、模型请求、响应解析、预览转换、PSD 生成和失败原因。反馈问题时可以复制日志中的步骤和错误，不需要上传账号或 API Key。

## 应该下载哪个？

### A. 完整安装包：给没有 DSH Desktop 的电脑
适合设计同事和新电脑。Windows x64 单文件安装包包含 DSH Desktop、画布插件和本地运行时；独立文件浏览器已移除。

1. 打开 [Windows Release](https://github.com/elangan1997-cmyk/dsh-canvas-suite/releases/tag/v1.4.0-windows-preview.3)。
2. 下载 `DSH-Setup-x64-*.exe` 和同名 `.sha256`。
3. 双击 EXE，按安装提示等待完成。
4. 启动 DSH Desktop，登录自己的账号，或在画布“更多 → 图像引擎设置”填写自己的 API。

当前推荐直接下载：

- [Windows 完整安装包 r5（635,694,537 字节，约 606 MiB）](https://github.com/elangan1997-cmyk/dsh-canvas-suite/releases/download/v1.4.0-windows-preview.3/DSH-Setup-x64-v0.1.1-rc.2-installer-r5.exe)
- [r5 SHA-256 校验文件](https://github.com/elangan1997-cmyk/dsh-canvas-suite/releases/download/v1.4.0-windows-preview.3/DSH-Setup-x64-v0.1.1-rc.2-installer-r5.exe.sha256)

本地构建输出在仓库根目录的 `dist/`；该目录被 Git 忽略，不会进入源码提交。

环境要求：Windows 10/11 64 位；不要求预装 Node.js、Python、Git 或管理员权限。Photoshop/Illustrator 是可选外部软件。

### B. 独立画布插件：给已经有 DSH Desktop 的电脑
这是更新画布能力的轻量包，不带完整 DSH Desktop，不能脱离 DSH 单独启动。

macOS 直接下载 [1.5.4 插件 ZIP](https://github.com/elangan1997-cmyk/dsh-canvas-suite/releases/tag/v1.5.4-macos-complete)，解压后运行 `bash install-canvas-plugin.sh`；全新电脑则优先使用同一 Release 的 `macOS-Complete` DMG。

1. 下载 `DSH-Canvas-Workbench-*.zip` 和同名 `.sha256`。
2. 完全退出 DSH Desktop（包括系统托盘）。
3. 解压后 Windows 双击 `install-windows.cmd`；macOS 在仓库目录运行 `bash install-canvas-plugin.sh`。
4. 重新打开 DSH Desktop，若插件未更新，再运行 `install-windows.cmd -CheckOnly` 检查。

安装脚本只更新 `@local/canvas-workbench` 的运行副本，并把旧副本备份到 `.dsh/canvas-suite/plugin-backups`；不会删除登录、API 凭据、项目文件或画布快照。

## 更新策略：以后不必每次重打 EXE

- 画布功能、预览、擦除、文字重建等迭代：只发布新的独立插件 ZIP，体积小、更新快。
- DSH Desktop、内置运行时或安装器发生变化：才重新构建完整 EXE。
- Windows 和 macOS 可分别发布，互不覆盖；已有 DSH 的用户直接安装对应系统插件。
- 旧版本 Release 会保留，方便回滚和问题对比。

## npm 轻量插件

画布插件可生成标准 npm 包，并通过 `dsh.bundle.patch` 自动注入 DSH：

```bash
dsh plugin --profile web add dsh-canvas-workbench
```

npm 包只适合已经安装 DSH 的电脑。它不捆绑 DSH Desktop、Python 运行时、模型文件、账号或 API Key；完整新电脑部署仍应使用 DMG/PKG/EXE。构建、离线 `.tgz` 安装及发布步骤见 [npm 独立插件分发](docs/NPM-DISTRIBUTION.md)。

## 安装环境和详细说明

- [Windows 完整安装说明](windows-installer/INSTALL-WINDOWS.md)
- [Windows 独立插件说明](docs/DSH-CANVAS-WORKBENCH-WINDOWS.md)
- [macOS 独立插件说明](docs/DSH-CANVAS-WORKBENCH-MACOS.md)
- [发布、校验和版本策略](docs/RELEASE-DISTRIBUTION.md)
- [npm 独立插件分发](docs/NPM-DISTRIBUTION.md)
- [Windows 验收清单](WINDOWS-TEST-CHECKLIST.md)

## 常见问题

**启动时黑窗口/蓝窗口一闪而过**
先确认 DSH Desktop 已完全退出，再重新运行安装器；如果是已有 DSH 的电脑，优先使用独立插件安装脚本。安装日志和环境检查入口见 Windows 安装说明。

**没有 VPN/API 显示连接不上**
画布核心和项目文件可以本地打开；图片生成、视觉识别等 API 能力需要对应服务可访问。请在“更多 → 图像引擎设置”检查路由、地址、超时和代理配置。

**插件安装后仍显示旧版本**
退出 DSH（包括托盘）后重新运行安装脚本，再用 `-CheckOnly` 检查四层运行副本。

**PDF/AI 没有预览**
文件仍可加入画布；安装本机 Poppler 或使用 Illustrator 打开可获得更完整预览。

## 安全与隐私

发布包不包含开发者账号、OAuth Token、API Key、个人项目、聊天记录或画布快照。构建时会移除日志、source map、Python 字节码和开发者路径；API 凭据只从使用者自己的本机读取。

## 已验证项目

- Windows 完整安装包 payload ZIP：27,983 项，完整读取校验通过。
- Windows 隔离安装模拟：应用、manifest、receipt 和四层插件副本创建成功，重复检查通过。
- 独立插件安装模拟：Windows 四层运行副本和 Cordis 配置注入通过；Node.js 语法检查通过。

## 目录结构

```text
canvas-workbench/       画布插件源码
install-canvas-plugin.sh  macOS 独立插件同步入口
windows-installer/      Windows 完整安装器和环境检查
docs/                   Windows/macOS 安装与发布说明
dist/                   本地构建产物（不提交个人配置）
```

## 开发与反馈

源码位于 `canvas-workbench/`。报告问题时请附：操作步骤、系统版本、插件版本、操作日志中的失败步骤，以及是否使用 Codex 或 API 路由。请不要粘贴 API Key、OAuth Token 或个人项目文件。


---

# DSH Canvas Workbench (English)

DSH Canvas Workbench is a design-focused canvas plugin for DSH Desktop. It brings image generation, project files, an infinite canvas, image editing, and Photoshop/Illustrator handoff into one workspace. You can use it without learning Agent concepts first.

从 GitHub Releases 下载带有 `macOS-Complete` 的 DMG，交给 Agent 按 [Mac 安装说明](mac-installer/交给Agent的安装说明.md) 安装。完整安装包包含：

- 画布插件与画布项目持久化；
- 与 `assets/` 同级的聊天生成图片归档和明确“加入画布”流程；
- PSD/PDF/SVG/AI 预览、图片编辑、去背景与转矢量所需的双架构本地运行时；
- 可选的 dsh-codex 兼容构建和 Dockyard 安装入口。

源码构建：

```bash
./mac-installer/build-macos-installer.sh
```

构建脚本会自动准备并校验运行时缓存。缓存约 1GB，故不进入 Git；DMG、PKG 和 SHA-256 文件作为 GitHub Release 资产发布。DSH Desktop.app 保持官方原始签名，不写入应用包内部。

## 安全
> Current macOS complete release: `v1.5.4-macos-complete` | [Download DMG/PKG/plugin ZIP](https://github.com/elangan1997-cmyk/dsh-canvas-suite/releases/tag/v1.5.4-macos-complete) | Windows preview: `v1.4.0-windows-preview.3`

## What the canvas plugin does

### Infinite canvas and project management
- Drag and drop or paste assets, zoom, pan, multi-select, align, duplicate, delete, manage layers, and export PNG.
- Projects are saved independently. Open the project folder from More and file assets refresh as the folder changes.
- The More menu provides project-folder access, image-engine settings, and an operation log for troubleshooting.
- Deleting an item from the canvas does not delete the chat original. Chat-generated originals stay under `TUPIAN/<project-name>/DSH聊天生成图片`.

### Image generation and chat routing
- With Design Mode enabled, image generation follows the canvas image-engine setting: Codex uses the Codex route; API uses the configured API route.
- With Design Mode disabled, chat uses DSH’s normal image-generation channel.
- Chat-generated images expose Add to canvas and Show in folder while keeping an independent original file.
- API calls detect timeouts, empty responses, and HTML responses and write the failed step to the operation log.

### Image editing, erase, and background removal
- Edit Image accepts a natural-language request and an optional selection. Without a selection, the whole image is edited.
- Smart Erase processes the selected region while preserving the subject, dimensions, proportions, and unselected areas as much as possible.
- Background removal preserves the source dimensions and aspect ratio, supports transparency, expands and feathers selections to reduce rectangular seams.
- Repeated edits use the original master as the composition source to reduce ghosting, misalignment, and quality loss from stacked masks.
- Generated results are saved into the project while the original file remains untouched.

### Text recognition and layered PSD output
- The model receives the full source image together with the blue selection outline, rather than only a small crop.
- The vision model returns structured JSON with text, position, color, font-size estimate, font suggestion, alignment, and confidence.
- It also returns a repair prompt that removes only the selected text and keeps every other area consistent.
- PSD output contains the repaired background and editable text layers with coordinates converted from the source image.
- Recognized text items are selected by default and can be edited or unchecked before generation.

### Preview and external editing
- Supports common PNG, JPG/JPEG, WebP, SVG, PSD, PDF, and AI assets.
- PDF/AI preview first tries a local converter. If unavailable, the file card remains usable and can be opened in Illustrator or the system viewer.
- Photoshop and Illustrator can be detected from common installation locations or selected manually in settings.
- Alt + mouse wheel zoom follows a Photoshop-like workflow. Image editing keeps the original-resolution source instead of shrinking it for the editor.

### Operation log
More → Operation Log records project loading, file refresh, disk writes, model requests, response parsing, preview conversion, PSD generation, and failure reasons. Logs are safe to share after removing any user-specific paths; never include API keys.

## Choose the right download

### Full installer — for computers without DSH Desktop
Use the Windows x64 single-file installer for a new computer or a design teammate who does not already have DSH Desktop. It includes DSH Desktop, the canvas plugin, and the required local runtime; the removed standalone file-browser plugin is not included.

1. Open the [Windows Release](https://github.com/elangan1997-cmyk/dsh-canvas-suite/releases/tag/v1.4.0-windows-preview.3).
2. Download `DSH-Setup-x64-*.exe` and its matching `.sha256` file.
3. Double-click the EXE and wait for the installation to finish.
4. Start DSH Desktop, sign in with your own account, or configure your own API under More → Image Engine Settings.

Recommended direct download:

- [Windows full installer r5 (635,694,537 bytes, about 606 MiB)](https://github.com/elangan1997-cmyk/dsh-canvas-suite/releases/download/v1.4.0-windows-preview.3/DSH-Setup-x64-v0.1.1-rc.2-installer-r5.exe)
- [r5 SHA-256 checksum](https://github.com/elangan1997-cmyk/dsh-canvas-suite/releases/download/v1.4.0-windows-preview.3/DSH-Setup-x64-v0.1.1-rc.2-installer-r5.exe.sha256)

Local build outputs are written to the repository `dist/` directory, which is ignored by Git.

Requirements: Windows 10 or Windows 11, 64-bit. Node.js, Python, Git, and administrator rights are not required. Photoshop and Illustrator are optional.

### Standalone canvas plugin — for computers that already have DSH Desktop
This is the lightweight canvas update package. It does not include DSH Desktop and cannot run by itself.

1. Download `DSH-Canvas-Workbench-*.zip` and its matching `.sha256` file.
2. Fully quit DSH Desktop, including the system tray process.
3. Extract the ZIP. On Windows run `install-windows.cmd`; on macOS run `bash install-canvas-plugin.sh`.
4. Restart DSH Desktop. If needed, run `install-windows.cmd -CheckOnly` to verify the installation.

The installer updates only the `@local/canvas-workbench` runtime copies and backs up the previous copy under `.dsh/canvas-suite/plugin-backups`. It does not remove sign-in data, API credentials, project files, or canvas snapshots.

## Environment and compatibility

**Windows full installer**
- Windows 10/11 x64.
- No preinstalled Node.js, Python, Git, or admin account required.
- Network access is needed only for online sign-in and remote image/vision APIs; the canvas and project files remain local.

**Windows standalone plugin**
- Existing DSH Desktop installation that has been started at least once.
- DSH must be closed during installation.
- Optional local capabilities (OCR, background removal, vector conversion, PDF/AI preview, Adobe automation) are enabled according to the tools available on the computer.

**macOS standalone plugin**
- macOS with DSH Desktop already installed and started once.
- `~/.dsh/profiles` must exist; quit DSH before running the installer.
- The canvas core does not require Python or Node.js. Optional conversion and Adobe capabilities depend on local tools.

## Updating without rebuilding the EXE

- Canvas feature iterations: publish a new standalone plugin ZIP only. This is the fast update path.
- DSH Desktop, bundled runtime, or installer changes: rebuild and publish a new full EXE.
- Windows and macOS can be released independently. Existing releases remain available for rollback and comparison.

## API, proxy, and image-engine notes

The canvas itself opens locally. Image generation and vision recognition require the selected service to be reachable. Check the route, endpoint, timeout, and proxy under More → Image Engine Settings. If a response is slow or empty, the operation log records the exact stage.

## Troubleshooting

**The installer flashes a black or blue window and exits**
On a computer without DSH, retry the full installer. On a computer with DSH, quit DSH including the tray and use the standalone plugin installer. Use the Windows environment check and installation log when the problem persists.

**The plugin still looks old after installation**
Quit DSH completely, run the installer again, then run the check-only option and restart DSH.

**PDF or AI preview is unavailable**
The file can still be placed on the canvas. Install a local PDF converter or open the file with Illustrator for the richest preview.

## Release documentation

- [Windows full-install guide](windows-installer/INSTALL-WINDOWS.md)
- [Windows standalone-plugin guide](docs/DSH-CANVAS-WORKBENCH-WINDOWS.md)
- [macOS standalone-plugin guide](docs/DSH-CANVAS-WORKBENCH-MACOS.md)
- [Release, checksums, and version policy](docs/RELEASE-DISTRIBUTION.md)

## Privacy and security

Release packages do not contain developer accounts, OAuth tokens, API keys, personal projects, chat history, or canvas snapshots. Build outputs remove logs, source maps, Python bytecode, and developer paths. API credentials are read only from the user’s own computer.

## Validation

- Windows installer payload ZIP: 27,983 entries, fully read and verified.
- Isolated Windows installation simulation: application, manifest, receipt, and four plugin runtime layers created successfully; repeat check passed.
- Standalone plugin simulation: Windows runtime layers and Cordis configuration injection passed; Node.js syntax checks passed.

## Repository layout

```text
canvas-workbench/       Canvas plugin source
install-canvas-plugin.sh  macOS standalone plugin sync entry
windows-installer/      Windows full installer and health checks
docs/                   Windows/macOS installation and release notes
dist/                   Local build outputs (no personal configuration)
```

## Feedback

When reporting a problem, include the steps, OS version, plugin version, selected Codex/API route, and the relevant operation-log step. Do not paste API keys, OAuth tokens, or personal project files.


`1.5.4` 是当前跨平台画布源码版本；Windows 仍是初级分发版，使用前请按验收清单验证本机 DSH、Python/Adobe 等可选能力。

## 更新与回滚

- 普通用户：下载最新 Release 的对应平台安装包，重新安装即可；安装器会先备份插件副本和 Profile patch。
- 开发/本机同步：在仓库根目录执行 `./sync-local-plugins.sh`，再执行 `./sync-local-plugins.sh --check`。
- 卸载：macOS 使用 `/Library/Application Support/DSH Canvas Suite/uninstall.sh`；Windows 使用 `windows-installer/uninstall.ps1`。
- 仓库不提交 API Key、OAuth、聊天记录、画布项目、模型缓存或 DSH 私人配置。
