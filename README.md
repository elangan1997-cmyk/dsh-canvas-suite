# DSH画布工作台

DSH画布工作台是面向设计工作的 DSH Desktop 画布插件：把聊天中的图片生成、项目文件、画布排版和图片处理放在同一个工作区。插件按能力检测运行，缺少某个外部工具时只关闭对应增强功能，不会阻断画布打开。

## 先看功能

- 无限画布：拖入、粘贴、缩放、平移、多选、对齐、图层管理和 PNG 导出。
- 项目与文件夹：项目独立保存，图片、PSD、SVG、PDF、AI 等资产实时刷新；可在“更多”中直接打开项目文件夹。
- 聊天协作：把聊天生成的图片明确加入画布，画布设置中的 Codex/API 图像路由与聊天图片生成保持一致。
- 图片编辑：编辑图片、智能擦除、去除背景、转矢量；支持原图尺寸/比例保留、局部选区、模型提示词和失败日志。
- 文字重建：框选后由当前视觉模型返回结构化文字信息，生成背景修复图，并把文字作为 PSD/画布文字层继续编辑。
- 文件预览与外部编辑：PNG/JPEG/WebP/SVG/PDF/AI/PSD 优先生成预览；Photoshop/Illustrator 可按系统安装位置打开。
- 可诊断：操作日志记录最近的加载、同步、模型请求、落盘和失败步骤，便于设计人员反馈问题。

## 选哪个下载

### 完整安装包（没有 DSH Desktop 的电脑）

适合不熟悉 Agent 或插件安装的设计同事。Windows x64 单文件安装包会带上 DSH Desktop、画布插件、文件浏览器和画布所需的本地运行时；安装时不会带入开发者账号、OAuth、API Key、项目或画布快照。

1. 从 GitHub Releases 下载 `DSH-Setup-x64-*.exe` 和同名 `.sha256`。
2. 双击 EXE，按提示等待解压和安装完成。
3. 启动桌面的 DSH，登录自己的账号，或在画布“更多 → 图像引擎设置”填写自己的 API。

环境：Windows 10/11 64 位；不要求预装 Node.js、Python、Git 或管理员权限。Photoshop/Illustrator 属于可选外部软件。

### 独立画布插件包（已经有 DSH Desktop 的电脑）

下载 `DSH-Canvas-Workbench-*.zip`。解压后：

- Windows：双击 `install-windows.cmd`。
- macOS：在终端运行 `bash install-macos.sh`。

安装脚本只更新 `@local/canvas-workbench` 的运行副本，并备份旧副本到 `.dsh/canvas-suite/plugin-backups`；不会删除或覆盖 DSH 登录、API 凭据、项目文件和画布快照。安装前请完全退出 DSH Desktop（包括托盘）。

详细环境要求和故障排查：

- [Windows 完整安装说明](windows-installer/INSTALL-WINDOWS.md)
- [Windows 独立插件说明](docs/DSH-CANVAS-WORKBENCH-WINDOWS.md)
- [macOS 独立插件说明](docs/DSH-CANVAS-WORKBENCH-MACOS.md)
- [发布与校验说明](docs/RELEASE-DISTRIBUTION.md)

## macOS 状态

插件源码同时声明支持 `darwin` 和 `win32`。当前仓库已提供 macOS 独立插件安装脚本；macOS 完整 DSH Desktop 安装包会在对应构建产物完成后单独上传 Release，不与 Windows 安装包混用。

## 安全与隐私

仓库和发布包不包含 API Key、OAuth Token、用户项目、画布内容或 DSH 私人配置。发布构建会移除凭据、日志、source map、Python 字节码和开发者路径；API 凭据只从使用者自己的本机读取。

## 开发与检查

源码位于 `canvas-workbench/`。已有 DSH 的开发机可以运行 `sync-local-plugins.sh` 同步两层运行副本；Windows 安装包的环境检查入口是 `windows-installer/health-check.cmd`。发布前请按 [Windows 验收清单](WINDOWS-TEST-CHECKLIST.md) 检查。
