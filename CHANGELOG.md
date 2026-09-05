# Changelog

## 1.5.4 npm packaging

- 新增 `dsh-canvas-workbench` npm 发布构建器；生成包带有 DSH `cordis.patch.yml` 自动挂载配置。
- npm 包与现有 `@local/canvas-workbench` 本地安装身份隔离，不影响 DMG/PKG/ZIP 和本机同步流程。
- 发布清单仅包含插件运行文件、说明和许可证，并排除凭据、日志、缓存和 Python 字节码。

## 1.5.4

- 基于 `origin/main` 重新发布跨平台画布插件与 macOS 完整安装包。
- 修复聊天结果中已失效本地图片路径导致的破图卡片，并增加本地图片状态检查。
- 为 DSH 2.0.4 的 Codex 图片请求补齐尺寸、像素和文件大小预算。
- 修复 Profile loader 重复注入问题，避免更新后出现重复插件入口。
- Windows r5 下载入口与校验说明同步到最新 Release 资产。

## 1.5.3

- 将最新 `canvas-workbench` 源码与聊天图片路由纳入跨平台仓库。
- 聊天生图与画布编辑统一使用画布引擎选择的 `dsh-codex` 或 API 路由；生成原图归档到当前画布项目中、与 `assets/` 同级，并仍需用户明确加入画布。
- SVG/AI/PDF 发送聊天前仅在附件边界转为 PNG，源文件和画布项目数据不变；移除重复的“打开画布”按钮。
- 移除独立 `home-explorer` 文件浏览器及其注入，保留画布自身的项目目录操作。
- 纳入 Mac 完整安装器工程、双架构运行时准备脚本、健康检查、回滚说明和可选 `dsh-codex` 兼容构建。
- 大型运行时/模型改为 GitHub Release 资产，不进入 Git 源码历史。

## 1.4.0-windows-preview.1

- 新增 Windows PowerShell 安装、卸载、健康检查和登录自动恢复任务。
- 新增跨平台系统适配层，支持 Windows 文件夹选择器、资源管理器打开和文件定位。
- 本地图片路由接受 Windows 盘符和 UNC 绝对路径。
- 客户端识别 Windows 盘符、反斜杠和 Windows 上级目录。
- Python 调用支持 `python.exe`、`python` 和 `py -3`，缺少 Python 时明确降级。
- PSD、AI 在 Windows 通过系统文件关联打开；原生 Photoshop 文字层自动化保留 macOS 路径。
- Windows 缺少 PSD/PDF/AI 转换器时显示占位预览，不阻断画布。
- 健康接口新增平台能力矩阵，并修复写死的旧版本号。
