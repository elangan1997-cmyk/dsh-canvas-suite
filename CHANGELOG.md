# Changelog

## Release catalog correction (2026-09-07)

- Restored `v1.4.0-windows-preview.4` (custom 20260906) as the verified Windows baseline.
- Keep the verified full Windows ZIP and standalone canvas ZIP with their published SHA-256 values.
- Only Windows packages older than the r5 baseline are candidates for removal.

## 1.6.1

- **关键修复**：画布文件表丢失向量根治——onChange/hydrate 完成路径的 serialize 改用 api.getFiles()（Excalidraw 0.17 onChange 不传第三参数，原实现恒得空文件表）；父层合并增加"防清空守卫"：存活图片元素引用的 fileId 缺失时自动从已有文件表补齐，文件表只允许因元素删除而收缩。
- 图片还原失败不再静默，会经画布错误通道上报具体原因。
- 离线复现台（Chrome+CDP 协议回放）验证：切换/水合/增量全链路文件表稳定。

## 1.6.0

- **性能**：Excalidraw onChange 600ms 尾沿防抖 + changed 快照 files 增量协议（usedFileIds + 变化文件），大画布（25 图 / 54MB 场景）交互传输量从每帧全量降至约 0.1MB。
- **存储治本**：canvas.json 落盘剥离图片 base64——有 customData.dshSourcePath 的文件条目只存 dshPath 引用，运行时按需经 /dsh-canvas/image 还原；项目文件从 54.4MB 降至约 23KB。旧内嵌格式项目可正常加载，首次保存自动瘦身。**新格式项目需 1.6.0+ 插件打开，勿回退旧版。**
- **数据完整性**：
  - 场景令牌：load 换发新令牌，跨项目迟到的 changed 一律丢弃；
  - 水合守卫：场景渐进恢复期间抑制 onChange，杜绝"半场景快照"砍掉完整文件表（曾致 15 图项目丢 9 个文件表条目并误触图片回收）；
  - 备份与主存剥离逻辑一致，且服务端 access() + mimeOf() 双验证后剥离，保证备份可还原。
- **修复**：rename-project 项目改名后同步改写 canvas.json 及画布备份内的绝对路径引用（JSON 转义安全替换，兼容 Windows）。
- **数据恢复工具**：scripts/rebuild-canvas-files.js 可从元素 dshSourcePath 重建文件表；psd/pdf/ai 文档源自动经 sips 生成 jpeg 预览（文件表内文档源必须是栅格预览，不能是文档字节）。

## 1.5.9

## 1.5.9

- 修复 DSH 更新或 Profile 重建后 Codex 聊天模型消失：同步脚本会把 `dsh-codex` 同时注入 Web 与当前活动 Profile，并在健康检查中强制验证。
- npm 独立画布包纳入内置 `vendor/` 资源，确保无公网 CDN 时 Excalidraw 仍可加载。
- macOS 安装前备份、卸载流程覆盖 Web 及任意命名活动 Profile 的画布与 `dsh-codex` 副本，避免卸载后残留。

## 1.5.8

- 修复聊天生图成功但图片卡片消失：最终回复中的裸文件名不再覆盖工具结果里同名的持久化附件或绝对路径。
- 忽略 `*.png` 等通配路径，避免批量产物的真实图片被一个不可读的 glob 占位覆盖。
- 最终回复只写文件名时，会按当前画布项目的 `DSH聊天生成图片/` 目录解析，不再错误地到聊天工作目录根下查找。
- 历史会话附件 ID 失效时，自动回退到画布项目中的同名归档原图。
- DSH 重启或切换会话时，图片卡片会等待 `conversation` 附件服务就绪后再解析，避免新生成图片被启动时序误判为加载失败。

## 1.5.7

- 画布运行库改为随插件内置的 React 18.3.1、ReactDOM 18.3.1 和 Excalidraw 0.17.6，不再依赖 jsDelivr，避免 DSH/Electron 策略或国内网络使 iframe 永久停在“加载中”。
- 增加画布本地资源失败与初始化超时的可见错误提示，不再无限空白等待。

## 1.5.6

- 修复没有记录源路径的 PNG 重命名：同步回传实际 `assets/` 新路径，避免下一轮轮询重复物化并触发同名冲突。
- 重命名成功后先更新父页面快照再落盘，并保留短暂竞态保护，确保画布内容与项目文件夹一致。
- 补齐 Windows 文件名大小写比较和项目扫描的跨平台 `assets` 路径判断。

## 1.5.5

- 修复 PNG/SVG 改名时磁盘二次扫描造成的“同名文件”误报和画布源文件消失。
- 改名期间暂缓项目轮询删除，改名完成后同步更新画布中的源路径与项目快照。
- 画布文件标签隐藏扩展名，并随缩放同步字号、尺寸和标签宽度；补齐 Windows 路径匹配。
- 修复首次同步脚本在 macOS 自带 awk 下无法注入 profile 的问题。

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
