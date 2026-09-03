# DSH画布工作台：macOS 独立插件安装

此包给已经安装 DSH Desktop 的 macOS 用户使用。它只同步 `@local/canvas-workbench`，不携带完整 DSH Desktop，也不会覆盖个人登录或项目数据。

## 环境要求

- macOS，已安装并至少启动过一次 DSH Desktop。
- `~/.dsh/profiles` 已存在。
- 安装时退出 DSH Desktop。
- 画布核心不要求 Python 或 Node.js；去背景、OCR、转矢量和 Adobe 自动化按本机能力启用。

## 安装

1. 从 Release 下载 `DSH-Canvas-Workbench-*.zip` 并解压。
2. 在终端进入解压目录，执行：

   ```bash
   bash install-canvas-plugin.sh
   ```

脚本会同步 profiles、web、desktop 和 electron 运行层，并在存在时补入对应的 DSH 插件清单。旧副本会保存在 `~/.dsh/canvas-suite/plugin-backups/`。

## 验证和日志

日志：`~/.dsh/logs/dsh-canvas-workbench-install.log`。重新打开 DSH Desktop 后，在画布“更多 → 操作日志”确认项目加载、文件同步和图像操作。

## macOS 完整安装包

全新电脑或需要一次恢复全部运行时的用户，下载 Release 中带 `macOS-Complete` 的 DMG（或 PKG）。它包含 DSH Desktop、画布插件、可选的 `dsh-codex` 兼容组件、双架构图像运行时、去背景模型和转矢量程序；不需要预装 Python、Node.js、rembg 或 VTracer。安装后仍需用户自己登录 DSH/Codex 或在画布设置中填写 API。

当前测试包未使用 Developer ID Installer 公证签名，macOS 可能需要在“系统设置 → 隐私与安全性”允许打开。不要把 Windows EXE 用在 macOS 上，也不要把个人的 `.dsh` 配置复制给其他用户。
