# Windows installation

## 给其他电脑使用（傻瓜安装）

发布目录中的 `dist\DSH-Setup-x64-v*.exe` 是单文件 Windows x64 安装器。把 EXE 复制到目标电脑后双击即可，默认安装到当前用户的 LocalAppData，不需要 Node.js、Python、Git、npm 或管理员权限。安装完成会自动创建 DSH 和“环境医生”快捷方式。

安装器默认保留目标电脑已有的 `%USERPROFILE%\.dsh` 项目、登录状态和 API 配置；需要清除这些数据时再单独运行“DSH Uninstall”。首次启动后如遇功能不可用，可打开“DSH Environment Doctor”查看 `%LOCALAPPDATA%\DSH\Logs\environment.json`。

## 从本机重新构建发布包

在已经安装并能正常启动 DSH Desktop 的 Windows x64 机器上，双击 `build-release.cmd`，或运行：

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\build-release.ps1
```

构建器会把当前 DSH、Canvas/Home、dsh-codex 以及本机已检测到的便携运行时打进 `dist`。如果只想验证打包链路，可加 `-SkipRuntimeAssets -SkipIExpress`；正式发布不要跳过运行时资源。

安装包是未签名构建，正式对外发布前应使用组织证书签名并按 `INTERNET_CAFE_TEST_CHECKLIST.md` 在干净电脑验收。

## Launcher 启动失败诊断

Launcher 每次启动都会记录实际 child process 的 executable、args、cwd、脱敏环境摘要、打包资源存在性、stdout、stderr、退出码和信号：

`%LOCALAPPDATA%\DSH\Logs\startup.log`

如果 Harness 在启动阶段退出，错误弹窗会显示 stderr 的最后 10 行，并提供“打开启动日志”按钮。不要先删除 `%USERPROFILE%\.dsh` 或重装；先根据日志中的 `plugin tree`、`ENOENT`、`EPERM`、端口或 DLL 信息定位具体原因。

## 旧版插件注入（开发机兼容）

1. Install and launch DSH Desktop once, then fully quit DSH.
2. Extract the complete ZIP to a normal local folder. Do not run it inside the ZIP preview.
3. Double-click `install.cmd` in this folder.
4. Restart DSH Desktop, enable Design Mode, and open Canvas.

The installer copies both DSH runtime layers, updates detected profiles, stores a recoverable distribution under `%USERPROFILE%\.dsh\canvas-suite\distribution`, and registers a login repair task for DSH updates.

If the canvas entry disappears after a DSH update, run `install.cmd` again. Run `health-check.cmd` to collect a health report.

Logs: `%USERPROFILE%\.dsh\logs\dsh-canvas-windows.log`

See the repository `README.md` for the Chinese overview and `WINDOWS-TEST-CHECKLIST.md` for the acceptance checklist.
