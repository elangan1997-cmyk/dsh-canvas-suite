# Changelog

## 1.8.0（未发布 — 分支 refactor/v1.8，Architecture Refactor）

> 架构版本，不新增大型业务能力；用户可见行为与 1.7.0 一致（真实 DSH 回归：DOM 结构 0 差异、30 条 API 样例仅 1 处预期修复差异、Codex 端到端生成通过）。发布前仍需 Windows 实机回归（执行文档 §40）。

- **Adobe 桥接（Photoshop / Illustrator ⇄ 画布，未真机验收）**：PS/AI 内的 ExtendScript 面板把选中图层/对象（透明 PNG，裁到边界，记录文档坐标）或整个文档（PSD/.ai 副本）送进项目 `ADOBE桥接/来自Photoshop|Illustrator/`，画布 3s 内自动上画布；画布选中工具栏新增「→Ps」「→Ai」，把图片/分层 PSD/.ai 原样放进 `ADOBE桥接/发件箱/`（序号永不覆盖），面板「置入为图层」可缩放/平移**归位到出发位置**，或「打开为新文档」。传输只靠文件夹 + `~/.dsh/canvas-workbench/adobe-bridge/bridge.json` 握手心跳，无端口无网络，CS6→2026 通用。「更多 → 🔗 安装 Adobe 桥接脚本」/ `npm run install:adobe-bridge` 装脚本（PS 用户级目录免 sudo；AI 给出 sudo 命令或用「其它脚本…」）。契约 `canvas-workbench/adobe-bridge/PROTOCOL.md`；新增 `check-adobe-bridge-jsx.mjs`（BOM/ES3 守卫）与 5 项单测。
- **Host 拆分**：`lib/index.js` 2,256 行的单个 `apply()` 拆为 `src/host/`（routes 9 文件 / services / server / jobs / adapters）与 `src/shared/utils/`，handler 逐字迁移，`lib/index.js` 成薄壳；API 对等测试 55 条请求 0 差异。
- **Provider Registry**：`image-engine.js` 拆为 dsh-codex / openai-compatible 两个 Provider + 注册表 + 门面（签名与行为不变）；设置与 API Key 存储路径不变（本地 0600）。
- **Job Manager**：Job 契约与状态机、内存 Store、事件总线；edit-image / remove-background / vectorize / ocr / export-psd 自动登记，新增只读 `GET /dsh-canvas/jobs`、`/jobs/get`、`POST /jobs/cancel`。
- **Client 构建管线**：`client.js` 切成分段源码（`src/client/**` + `build-manifest.json`），`npm run build` 拼接为 `lib/client.js`（首构建与原文件逐字节一致）；**删除 tldraw 时代死链**（`TLDR_BUNDLE` 等，无引用），`lib/client.js` 2,344,322 → 426,932 bytes（−81.8%），启动少做一次 1.9MB 字符串处理。
- **Command / History**：共享 Command 基类、CommandBus、HistoryManager（undo/redo 双栈）；构建期内联进 bundle，挂 `window.__dshCanvas`。
- **契约层**：CanvasObject（含 Excalidraw element 双向 adapter）、Asset（稳定 assetId、类型/来源推断）、Job、Feature；`project.json` schemaVersion 2（v1→v2 只加字段、幂等、旧插件可读）。
- **Feature Registry / Capability**：12 项内置 Feature 声明，按 `/health` 推导 capability 启用；新增只读 `GET /dsh-canvas/capabilities`、`/assets`、`/python-tools`（§28 统一 `{ok,data}` 形状）。
- **Python Tool Registry**：10 个脚本按 id 注册解析（物理目录重组待路由改经注册表后进行）。
- **文字重建新增 AI（Illustrator）导出**：识别确认后面板提供「生成 AI（Illustrator）」，与 PSD 的「草稿 + 原生脚本」同构——先出 SVG 草稿，再由 Illustrator ExtendScript 建文档、放置并内嵌底图、逐块创建**原生点文字**（字体按本机 PostScript 名解析），saveAs 为**原生 .ai**（PDF 兼容）并自动加入画布。脚本不可用（未装 AI / 非 macOS / 权限）时退回可编辑 SVG 草稿（内嵌背景 + `<text>`，字体映射家族名+字重；背景清理成功时文字组可见，未清理时隐藏避免与原图重叠）。
- **PSD 图层编辑同标准加固**：预检自动保存关闭开在 Photoshop 里的文件（保存失败不关，绝不丢未保存工作；realpath 归一与 activeDocument 前置都有实测依据）；脚本收尾只关自己打开的文档（废除会误关用户稿件的无差别清场）；写回对齐 .ai 语义——**原文件就地更新**（改前自动备份到「画布备份/」）、原图层保留、修改版作为新层叠加其上（itemIndex 自检）。
- **PSD / AI 图层级编辑（新）**：画布选中 .psd/.ai → 工具栏「编辑图层」→ 列出图层（PSD 纯 Python 读层树；AI 经 Illustrator 脚本）→ 选定图层 + 描述修改 → 引擎只编辑该图层（整幅上下文提取，临时文件不进画布）→ Adobe 脚本**原位写回**（保留图层名、z 序与所有其它图层，含你手动排的文字层），另存新版本 `-图层编辑.psd/.ai` 加入画布。模型输出自动规范化（WEBP/JPEG→PNG）并缩放回画布尺寸；Adobe 交互全部走 ASCII 临时目录（规避中文目录 app.open 失败）；脚本禁用模态弹窗（规避错误弹窗卡死 AppleEvent）。
- **SVG 也支持图层级编辑**：「编辑图层」对 .svg 同样可用——列出背景位图与各文字对象，选中背景位图描述修改后引擎编辑并**原位替换内嵌位图**（纯 Python，不需要 Adobe），文字对象原样保留。**三种格式统一写回原文件**（inplace + 画布备份），不再产生 `-图层编辑` 版本文件堆积；项目新文件自动上画布的基线持久化（重启不丢，重启前生成的新文件重启后仍会自动加入画布）。
- **图层编辑升级为可视化两步式**：图层列表改为**缩略图网格**（PSD 逐层渲染预览、AI 位图项低分辨率截屏、SVG 解码内嵌位图；文字对象显示为文字卡）；点选图层后自动提取到画布并**打开与「编辑图片」完全相同的编辑器**（提示词 / 框选 / 擦除笔刷蒙版），提交后原位写回——蒙版走膨胀+羽化+合成保护管线，未选区域逐像素不变。
- **修复 .ai 生成后的“两个文件”与画布不同步**：根因一，Illustrator 2026 的 ExtendScript 没有 `CloseOptions`，脚本里的 `doc.close()` 两种写法都抛错——每次生成的**临时文档都留在 AI 里没关**，用户误把临时文件当正式文件编辑；根因二，脚本成功后跳过了“打开正式文件”步骤。修复：所有 Illustrator/Photoshop 脚本收尾统一用 AppleScript `close every document saving no` 清场（ExtendScript 关不掉的兜底），生成后**总是打开画布正式文件**（与交付到画布的是同一份），在 AI 里保存后画布按 mtime 轮询自动刷新预览。
- **聊天图片输出回退链重做**：附件/本地条目改为**逐级尝试**的候选链（主机按名找回 → 原路径/条目 sourcePath → 当前项目归档同名 → 附件 blob），本地文件优先即时显示；DSH 旧会话附件解析悬而不决时 6 秒超时降级；新增 `GET /dsh-canvas/resolve-image` 按文件名在项目/工作区（含兄弟项目的 DSH聊天生成图片/、assets/）找回原图，`-N` 副本名回落原名；彻底找不到才显示整洁的失败卡（不再渲染浏览器碎图）。
- **动态加载界面**：图片修改 / 去背景占位从静态 SVG 改为 iframe 内跟随位置与缩放的 DOM 覆盖层——转圈、流动斜纹、扫光进度条、引擎提示、已用时长；去背景显示真实百分比与阶段；小尺寸自动紧凑模式。
- **擦除合成痕迹修复**：有蒙版时不再"整图缩到 1024 再放大贴回"，改为按选区裁剪原生分辨率窗口（边距在预算内自适应）送模型、结果贴回原位；羽化环 14–48px 并在羽化环内做源图/生成图色调匹配，消除擦除区发虚与矩形补丁感。
- **修复**：`/dsh-canvas/system-appearance` 把布尔常量 `isMac`/`isWindows` 当函数调用导致永远 `known:false`（「画布背景跟随系统」主机探测在 1.7.0 从未生效）。
- **测试与工具**：`npm test`（unit 32 + migration 3）、`npm run test:integration`（git 基线 vs 工作树 API 对等）、`npm run check`（portability + 递归语法 + 构建漂移守卫）；`tests/smoke/` CDP 客户端（页面内 fetch 绕过 DSH 网关 403、DOM 真值快照）；`tests/fixtures/` 零个人数据样例项目；npm 打包白名单加入 `src/`。
- **生成脚本语法检查（新）**：`npm run check` 增加 `scripts/check-generated-jsx.mjs`——把 host 路由里用字符串拼出来的 Illustrator/Photoshop 脚本抽出来做独立 `node --check`，并检查 iframe 的 srcdoc 内联脚本（求值模板字面量后截取 `<script>`）。这类错误整文件 `node --check` 查不出来，本轮两个致命 bug（缩略图整段 JSX 解析失败、`/edit-layer` 提取必失败）都是这么漏掉的。

### 图层编辑（.ai / .psd / .svg）修复与语义调整 — 未提交

- **修复 .ai 缩略图全空**：拼接 JSX 时生成了 `new File("…-""+i+".png")`（语法错误），整段脚本解析失败、一张都没截到，且错误被三层 try/catch 吞掉。重写为单次遍历同时产出图层清单与逐层缩略图，**文字对象也截屏**、`it.contents` 作为兜底名。
- **只读流程不再打扰用户**：列图层/缩略图/提取改为打开 **ASCII 临时副本**、**不激活 Illustrator**、收尾按文件精确关闭。此前会打开用户正式文件并 `close every document saving no`（既闪一下又可能关掉用户自己打开的稿）。
- **读取提速**：缩略图只渲染该元素自身 `visibleBounds`（±2pt）而非整块画板；`ImageCaptureOptions.resolution` 有下限（24 被拒），改为档位自适应 24→36→72→无参，并把实际生效档位记入诊断。
- **修复点图层没反应**：`post({type:'add-image'})` 缺 `explicit: true`，被 iframe 守卫拒绝并连带把画布状态置为「加载失败」。
- **修复编辑器不自动打开**：`openImageEditorById` 作用域写错（声明在 `Main()` 内）、`add-image` 两个监听器中带 `openEditor` 的那个是死代码、捕获阶段不透传 `customData`（`dshLayerEdit` 标记丢失）。现改为模块级桥接 + 透传 + 等元素真正进场景再打开。
- **修复「原图已不在画布中」**：临时提取图落在 `outputs/` 而项目素材扫描在 depth 0 跳过 `outputs/`，被 2 秒一次的"访达删除对账"误判为已删除。新增 `dshScratch` 标记并同时跳过对账与归档两条路径。
- **修复结果图丢失/占位图残留**：图层写回改用与「编辑图片」相同的**原子消息** `image-edit-result`（一次 `updateScene` 把占位图换成结果图），不再用"先删后加"两条消息竞态。
- **修复写回后文字被盖住**：文字对象与字体一直在文件里，是 `pi.move(prev, PLACEAFTER)` 语义用错且不检查结果，把新图放到整叠最前面盖住了 7 个文字层。改为「锚点 + 索引读回自检」，四种 move 语义逐个试，只认索引真的到位；结果写入诊断。
- **.ai 写回语义改为「直接写回原文件」**（用户选定）：原图层保留，修改结果作为**新的一层叠加在原图层正上方**，画布上那份 .ai 就地刷新；覆盖前自动备份到 `<项目>/画布备份/<名>-图层编辑前-<时间戳>.ai`。`.psd/.svg` 维持另存 `-图层编辑` 新版本（响应 `mode` 字段区分）。
- **图层编辑前弹窗提醒**：`.ai` 在对话框顶部常驻提示 + 点图层那一刻确认「已在 Illustrator 里关闭这份稿」（同一文档确认过一次不再重复拦）——规避"AI 里开着旧稿，保存时反向覆盖写回结果"。
- **占位图超时自愈**：「图片修改中…」此前没有超时且会被写进 `canvas.json`（重启后恢复出来继续转），现由 30 秒轮询把超过 25 分钟的占位图标成失败；`/edit-layer`、`/edit-image` 请求亦加 20 分钟超时。
- **新增排查通道**：只读/写回流程的关键结果（关闭方式、实际档位、缩略图成败、耗时、层叠自检 `z=实际/期望`）追加到 `$TMPDIR/dsh-canvas-ai-diag.json`（保留最近 8 条）。

## 1.7.0

- 素材库多维整理：可按修改时间、文件类型、图片尺寸、文件大小、文件名称排序（选择本地记忆），卡片与预览显示宽高/大小/时间。
- 素材库 Mac 式七色标记：卡片角标、多选批量标记、按颜色筛选；标记集中存放于插件数据目录，删除素材自动清理。
- 画布图片颜色标记与整理升级：选中图片可设七色标记（随 canvas.json 持久化、可撤销）；「整理图片」支持 类型/时间/尺寸/大小/名称 排序与按颜色/未标记范围筛选，文件类型按扩展名分块布局。
- 聊天图片输出全链路修复：去掉 9 张显示上限；本轮旧图引用按文件修改时间过滤；归档撞名（-2 后缀）与最终回复名字自动配对；最终文本引用改为合并而非整体替换；<output_path> 归档路径纳入提取；缩略图/大图/全部加入画布/文件夹定位统一三级回退（条目源文件→项目归档→附件解析），不再依赖画布项目绑定。
- 生成图归档层级：DSH聊天生成图片/<会话标题>/<日期>/<时段>（5 小时分段）；文件夹名与会话标题同步改名；未绑定项目时归档到聊天工作目录，始终有落盘路径。
- 画布 imagegen 未绑定项目不再报错阻断（此前会把 agent 逼向旁路技能）；归档失败写入 writeError 不中断生成。
- 文字识别/重建字体改用免费商用字体：阿里巴巴普惠体 3.0 全系列、思源黑体 SC 全系列、Inter/Montserrat/Poppins/Source Sans Pro；默认普惠体 55/85，导出数据层归一，PSD 光栅化按所选字体渲染。
- UI 与 DSH 风格统一：去除画布/素材库阴影；画布容器、顶栏、素材库、整理弹层改用 DSH 设计令牌；画布背景与选区工具栏跟随 DSH 主题，并支持「跟随系统外观」模式（主机进程读取真实系统外观，规避 Electron 媒体查询覆盖）。

## Release catalog correction (2026-09-07)

- Restored `v1.4.0-windows-preview.4` (custom 20260906) as the verified Windows baseline.
- Keep the verified full Windows ZIP and standalone canvas ZIP with their published SHA-256 values.
- Only Windows packages older than the r5 baseline are candidates for removal.

## 1.6.6

- 素材库顶部目录区默认折叠为单行，只保留当前目录、切换和展开入口；完整路径、最近访问及拖拽说明按需展开，释放更多素材浏览空间。
- 拖拽进入素材库时即使目录区处于折叠状态，也会自动显示落点提示。

## 1.6.5

- 修复素材库显式“多选”模式只能保留一项的问题；现在普通点击即可逐项勾选或取消，无需按住 Command、Ctrl 或 Shift。
- 修复高清画布图片快速拖入素材库时跨 iframe 数据尚未到达导致保存失败的问题；“加入素材库”按钮同时成为明确的拖拽入口。

## 1.6.4

- 素材库目录与画布项目彻底解耦，可通过系统原生文件夹选择器自定义任意独立目录。
- 当前素材库和最近访问的 8 个素材库目录保存在本机，切换项目或重启 DSH 后保持不变。
- 素材侧栏增加当前目录卡片与“最近访问”快速切换；首次升级自动沿用旧工作区的“画布素材库”目录。

## 1.6.3

- 素材库改为画布右侧侧拉栏，打开时画布仍可查看和操作；素材卡片改成双列瀑布流。
- 增加双向拖拽：素材可拖到画布落点，画布已选图片或本地图片可拖入当前素材库。
- 默认卡片右上角显示放大预览；进入“多选”后才显示勾选框和底部批量操作。
- 画布右键“添加到素材库中”和选中工具栏“加入素材库”统一保存到当前画布项目对应的素材库，并立即刷新侧栏。

## 1.6.2

- 重新设计素材库交互：卡片单击选择、Command/Ctrl/Shift 多选、双击加入画布，移除每张卡片重复的三组操作按钮。
- 增加文件名搜索、素材计数、刷新、跨平台打开素材目录，以及固定的批量操作栏。
- 支持把画布中选中的一张或多张图片批量存入素材库；支持素材批量加入画布、一次附加到聊天及确认后删除。
- 优化素材库明暗主题、窄窗口响应式布局、空状态、载入状态和错误反馈。

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
