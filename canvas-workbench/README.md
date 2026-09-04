# DSH画布工作台

`@local/canvas-workbench` 是 DSH Desktop 的设计工作台插件，提供无限画布、项目资产、聊天图片加入画布、图片编辑/擦除/去背景/转矢量、文字识别与 PSD 重建、PNG/PDF/AI/PSD/SVG 预览，以及 Photoshop/Illustrator 外部编辑入口。

插件采用能力检测：`webServer`、`subprocess`、`llm`、`attachments`、`slots` 等宿主能力缺失时，只关闭相应增强按钮，不阻止画布渲染。Windows 和 macOS 共用同一套插件代码，系统差异集中在 `lib/platform.js`。

## 图像路由

在画布“更多 → 图像引擎设置”中选择 Codex 或 API。画布内图片生成和从聊天加入画布的图片使用同一套选择；两种路由不会静默互相切换。用户的 OAuth/API 凭据只从自己的 DSH 配置读取，不写入项目或插件目录。

## 独立安装

已有 DSH Desktop 的用户应使用仓库 `standalone-plugin/` 生成的 `DSH-Canvas-Workbench-*.zip`：Windows 运行 `install-windows.cmd`，macOS 运行 `bash install-macos.sh`。安装脚本会备份旧副本并记录日志，不覆盖项目、登录或 API 凭据。

## 开发同步

开发机可从仓库根目录运行 `sync-local-plugins.sh`，将插件同步到 DSH 的 node/desktop 两层运行副本；Windows 用户也可以使用 `windows-installer/install.ps1`。详细发布说明见仓库 `docs/`。
