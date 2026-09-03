# DSH画布工作台

面向设计人员的 DSH Desktop 画布工作台，把图片生成、项目文件、无限画布、图片处理和 Photoshop/Illustrator 协作集中在一个工作区。你不需要先了解 Agent：按下面的下载说明安装后，就可以像使用普通设计工具一样开始工作。

> 当前 Windows Preview：`v1.4.0-windows-preview.3`  ｜  [下载完整安装包和独立插件](https://github.com/elangan1997-cmyk/dsh-canvas-suite/releases/tag/v1.4.0-windows-preview.3)

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
适合设计同事和新电脑。Windows x64 单文件安装包包含 DSH Desktop、画布插件、文件浏览器和本地运行时。

1. 打开 [Windows Release](https://github.com/elangan1997-cmyk/dsh-canvas-suite/releases/tag/v1.4.0-windows-preview.3)。
2. 下载 `DSH-Setup-x64-*.exe` 和同名 `.sha256`。
3. 双击 EXE，按安装提示等待完成。
4. 启动 DSH Desktop，登录自己的账号，或在画布“更多 → 图像引擎设置”填写自己的 API。

环境要求：Windows 10/11 64 位；不要求预装 Node.js、Python、Git 或管理员权限。Photoshop/Illustrator 是可选外部软件。

### B. 独立画布插件：给已经有 DSH Desktop 的电脑
这是更新画布能力的轻量包，不带完整 DSH Desktop，不能脱离 DSH 单独启动。

1. 下载 `DSH-Canvas-Workbench-*.zip` 和同名 `.sha256`。
2. 完全退出 DSH Desktop（包括系统托盘）。
3. 解压后 Windows 双击 `install-windows.cmd`；macOS 运行 `bash install-macos.sh`。
4. 重新打开 DSH Desktop，若插件未更新，再运行 `install-windows.cmd -CheckOnly` 检查。

安装脚本只更新 `@local/canvas-workbench` 的运行副本，并把旧副本备份到 `.dsh/canvas-suite/plugin-backups`；不会删除登录、API 凭据、项目文件或画布快照。

## 更新策略：以后不必每次重打 EXE

- 画布功能、预览、擦除、文字重建等迭代：只发布新的独立插件 ZIP，体积小、更新快。
- DSH Desktop、内置运行时或安装器发生变化：才重新构建完整 EXE。
- Windows 和 macOS 可分别发布，互不覆盖；已有 DSH 的用户直接安装对应系统插件。
- 旧版本 Release 会保留，方便回滚和问题对比。

## 安装环境和详细说明

- [Windows 完整安装说明](windows-installer/INSTALL-WINDOWS.md)
- [Windows 独立插件说明](docs/DSH-CANVAS-WORKBENCH-WINDOWS.md)
- [macOS 独立插件说明](docs/DSH-CANVAS-WORKBENCH-MACOS.md)
- [发布、校验和版本策略](docs/RELEASE-DISTRIBUTION.md)
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

- Windows 完整安装包 payload ZIP：27,981 项，完整读取校验通过。
- Windows 隔离安装模拟：应用、manifest、receipt 和四层插件副本创建成功，重复检查通过。
- 独立插件安装模拟：Windows 四层运行副本和 Cordis 配置注入通过；Node.js 语法检查通过。

## 目录结构

```text
canvas-workbench/       画布插件源码
standalone-plugin/      独立插件安装脚本与发布清单
windows-installer/      Windows 完整安装器和环境检查
docs/                   Windows/macOS 安装与发布说明
dist/                   本地构建产物（不提交个人配置）
```

## 开发与反馈

源码位于 `canvas-workbench/`。报告问题时请附：操作步骤、系统版本、插件版本、操作日志中的失败步骤，以及是否使用 Codex 或 API 路由。请不要粘贴 API Key、OAuth Token 或个人项目文件。
