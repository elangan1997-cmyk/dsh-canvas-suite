# DSH画布工作台：Windows 独立插件安装

此包给已经安装并能打开 DSH Desktop 的 Windows 用户使用。它不是完整 DSH 安装包，只替换 `@local/canvas-workbench`，适合只想更新画布功能的设计人员。

## 环境要求

- Windows 10 或 Windows 11，64 位。
- 已安装 DSH Desktop，并至少启动过一次，使 `%USERPROFILE%\\.dsh\\profiles` 存在。
- 安装时完全退出 DSH Desktop（包括系统托盘）。
- 不要求 Node.js、Python、Git 或管理员权限；去背景、OCR、转矢量和 PSD/AI/PDF 预览会按本机已安装的运行时启用。

## 安装

1. 从 GitHub Release 下载 `DSH-Canvas-Workbench-*.zip`。
2. 解压到一个不会被自动清理的目录。
3. 双击 `install-windows.cmd`，或在 PowerShell 中执行：

   ```powershell
   Set-ExecutionPolicy -Scope Process Bypass
   .\\install-windows.ps1
   ```

脚本会检查并更新以下可能存在的 DSH 运行层：

- `%USERPROFILE%\\.dsh\\profiles\\node_modules\\@local\\canvas-workbench`
- `%USERPROFILE%\\.dsh\\profiles\\web\\node_modules\\@local\\canvas-workbench`
- `%USERPROFILE%\\.dsh\\profiles\\desktop\\node_modules\\@local\\canvas-workbench`
- `%USERPROFILE%\\.dsh\\electron\\node_modules\\@local\\canvas-workbench`

每次替换前会把旧副本移动到 `%USERPROFILE%\\.dsh\\canvas-suite\\plugin-backups\\`，失败时自动恢复。安装完成后重新打开 DSH Desktop。

## 验证

```powershell
.\\install-windows.ps1 -CheckOnly
```

日志位于 `%USERPROFILE%\\.dsh\\logs\\dsh-canvas-workbench-install.log`。画布内还可从“更多 → 操作日志”查看最近一次加载、项目同步和图像请求。

## 常见问题

- **提示找不到 profiles**：先打开一次 DSH Desktop 后退出，再运行安装脚本。
- **提示 DSH 正在运行**：退出主窗口和系统托盘中的 DSH，再重试。
- **安装后入口仍旧**：完全退出并重新打开 DSH；若 DSH 更新覆盖了运行副本，再运行一次脚本。
- **某个图片功能不可用**：基础画布不依赖该功能。按“更多 → 图像引擎设置”检查 API/Codex 路由和本机运行时状态。

## 不会被修改的内容

安装脚本不会读取或提交账号密码、OAuth Token、API Key、项目文件、画布快照或聊天记录；这些内容仍由 DSH 本机目录独立管理。
