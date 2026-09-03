# DSH Canvas Suite

面向 DSH Desktop 的可插拔设计画布套件，当前版本 `1.5.3`，包括：

- `canvas-workbench`：无限画布、项目持久化、聊天图片交互和渐进增强图片工具。
- 独立文件浏览器已移除；项目目录选择与“在文件夹中显示”由画布插件自身提供。
- macOS 安装工程。
- Windows 10/11 初级版 PowerShell 安装、恢复、卸载和健康检查。
- 可选的内置 `dsh-codex` 兼容构建，用于在支持的 DSH Profile 中使用 Codex OAuth 路由。

## Windows 快速安装

如果希望由本地 Agent 全自动下载安装，请把 [AGENT-INSTALL-WINDOWS.md](AGENT-INSTALL-WINDOWS.md) 发给 Agent。

如果 Windows 安装后需要由 Codex 接手现场调试，请使用 [WINDOWS-CODEX-HANDOFF.md](WINDOWS-CODEX-HANDOFF.md)。

1. 安装并启动一次 DSH Desktop，然后完全退出。
2. 从 Releases 下载 `DSH-Canvas-Suite-*-Windows-preview.zip` 并完整解压。
3. 双击 `windows-installer/install.cmd`。也可以在解压目录打开 PowerShell：

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\windows-installer\install.ps1
```

4. 重新打开 DSH Desktop。

详细能力边界见 [Windows 安装说明](windows-installer/INSTALL-WINDOWS.md)，测试反馈请按 [验收清单](WINDOWS-TEST-CHECKLIST.md) 提供。

## Windows Preview 能力

稳定目标：画布、项目、拖入/粘贴、聊天图片明确加入画布、多选发送聊天、PNG 导出、资源管理器打开/定位。

渐进增强：本地 OCR、去背景、转矢量、PSD/AI/PDF 预览依赖 Python 或外部转换器；缺少环境时不会阻断基础画布。Windows Adobe 第一版通过系统文件关联打开，Photoshop 原生文字层自动化仍是 macOS 专属。

## macOS

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

仓库不包含 API Key、OAuth Token、用户项目、画布内容或 DSH 私人配置。API 凭据只从用户本机读取。不要把 `%USERPROFILE%\.codex-pixel\auth.json` 或 `~/.codex-pixel/auth.json` 提交到 Issue。

## 当前状态

`1.5.3` 是当前跨平台画布源码版本；Windows 仍是初级分发版，使用前请按验收清单验证本机 DSH、Python/Adobe 等可选能力。

## 更新与回滚

- 普通用户：下载最新 Release 的对应平台安装包，重新安装即可；安装器会先备份插件副本和 Profile patch。
- 开发/本机同步：在仓库根目录执行 `./sync-local-plugins.sh`，再执行 `./sync-local-plugins.sh --check`。
- 卸载：macOS 使用 `/Library/Application Support/DSH Canvas Suite/uninstall.sh`；Windows 使用 `windows-installer/uninstall.ps1`。
- 仓库不提交 API Key、OAuth、聊天记录、画布项目、模型缓存或 DSH 私人配置。
