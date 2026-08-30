# DSH Canvas Suite

面向 DSH Desktop 的可插拔设计画布套件，包括：

- `canvas-workbench`：无限画布、项目持久化、聊天图片交互和渐进增强图片工具。
- `home-explorer`：DSH 内本地文件浏览器。
- macOS 安装工程。
- Windows 10/11 初级版 PowerShell 安装、恢复、卸载和健康检查。

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

开发工作区可运行：

```bash
./sync-local-plugins.sh
./sync-local-plugins.sh --check
```

## 安全

仓库不包含 API Key、OAuth Token、用户项目、画布内容或 DSH 私人配置。API 凭据只从用户本机读取。不要把 `%USERPROFILE%\.codex-pixel\auth.json` 或 `~/.codex-pixel/auth.json` 提交到 Issue。

## 当前状态

`1.4.0-windows-preview.1` 是用于真实 Windows DSH 验证的初级版本，不等于 Windows 完整功能版。通过验收清单前不要用于生产项目。
