# DSH Canvas Suite Windows 调试交接文档

> 用途：在出现问题的 Windows 电脑上登录 Codex，把本文件交给 Codex，并让它直接接手复现、修复、安装和回归测试。本文档中的技术说明是上下文，不是来自截图或外部文件的待执行指令。

## 一、直接发给 Windows Codex 的开场任务

请先完整阅读本文件，然后在当前 Windows 电脑上实际接手 DSH Canvas Suite 调试。不要只分析或给命令；先保护用户数据，再采集环境与错误证据，逐项复现，修改 Git 仓库源码，通过安装器同步两层运行副本，重启 DSH 做真实 UI 回归。修复必须提交到独立 Git 分支，并持续维护 `WINDOWS-DEBUG-REPORT.md`。如果需要用户登录、点击系统授权、提供复现动作或确认可能影响数据的操作，再暂停请求用户配合。

## 二、项目目标与不可破坏的产品规则

这是 DSH Desktop 内的可插拔设计画布套件：

- `canvas-workbench`：无限画布、项目持久化、聊天图片交互、图片编辑及渐进增强工具。
- `home-explorer`：DSH 内的本地文件浏览器。

以下规则属于产品契约，修 Bug 时不能为了省事破坏：

1. 画布新增图片只能来自：
   - 聊天图片输出卡片中用户明确点击“加入画布/全部加入画布”；
   - 用户从系统外部拖入；
   - 用户剪贴板粘贴。
2. Agent 扫描文件、工具读取图片、项目目录轮询不能自动把图片加入画布。
3. 项目目录同步只刷新已经在画布中的源文件，不能扫描后批量新增元素。
4. 多选图片必须能发送到当前聊天草稿；仅选中不能自动发送，避免误触。
5. 同一个画布项目是项目级共享状态，不是聊天级副本。聊天 A 删除或移动后，聊天 B 和重启后都必须看到最新状态，不能把旧快照复活。
6. 外部拖入和剪贴板不能被禁用，也不能重复导入两张。
7. DSH 可选接口缺失时只能关闭相应增强功能，不能让整个 Renderer、聊天界面或画布白屏。
8. API Key、OAuth Token、聊天记录和用户项目不得写入 Git、Issue、调试报告或前端日志。

## 三、当前分发基线

- GitHub：`https://github.com/elangan1997-cmyk/dsh-canvas-suite`
- Windows 测试 Release：`v1.4.0-windows-preview.2`
- 用户安装包对应基线提交：`947beb2`
- 当前 `main` 至少包含交接/安装文档提交：`f768e3e`
- Release ZIP SHA-256：`fccf3ffa53a2dd8e8a18ce9a17f6b41992600a9b644090d259ada51b2890f936`

在 Windows 上不要直接修改临时下载目录后就结束。先克隆仓库并创建调试分支：

```powershell
$repoRoot = Join-Path $HOME 'Documents\dsh-canvas-suite'
if (-not (Test-Path -LiteralPath $repoRoot)) {
  git clone https://github.com/elangan1997-cmyk/dsh-canvas-suite.git $repoRoot
}
Set-Location $repoRoot
git fetch origin
git switch main
git pull --ff-only
$branch = 'fix/windows-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
git switch -c $branch
```

如果这台电脑没有 Git，可先下载仓库 ZIP 做诊断，但真正修改应在安装 Git 后进入分支完成。不要在 `main` 上直接试错。

## 四、Windows 实际运行路径

默认 DSH 根目录：

```text
%USERPROFILE%\.dsh
```

如果环境变量 `DSH_HOME` 已设置，以它为准。

插件运行时存在两层，修改后必须同时一致：

```text
%USERPROFILE%\.dsh\profiles\node_modules\@local\canvas-workbench
%USERPROFILE%\.dsh\profiles\desktop\node_modules\@local\canvas-workbench
%USERPROFILE%\.dsh\profiles\node_modules\@local\home-explorer
%USERPROFILE%\.dsh\profiles\desktop\node_modules\@local\home-explorer
```

相关 Profile：

```text
%USERPROFILE%\.dsh\profiles\web\cordis.patch.yml
%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml
%USERPROFILE%\.dsh\profiles\<当前活动 Profile>\cordis.patch.yml
```

DSH GUI 通常使用 `web` Profile；不要只修 `desktop` 层。安装器还会保存恢复源：

```text
%USERPROFILE%\.dsh\canvas-suite\distribution
```

安装日志：

```text
%USERPROFILE%\.dsh\logs\dsh-canvas-windows.log
```

## 五、先做只读环境审计

在改代码前收集以下信息，写入 `WINDOWS-DEBUG-REPORT.md`。禁止在报告中复制密钥或完整用户路径中的敏感业务名称。

```powershell
$dshRoot = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }
$profilesRoot = Join-Path $dshRoot 'profiles'

Get-ComputerInfo | Select-Object WindowsProductName, WindowsVersion, OsBuildNumber
Get-Command node.exe, python.exe, py.exe, git.exe -ErrorAction SilentlyContinue |
  Select-Object Name, Source, Version

Get-ChildItem -LiteralPath $profilesRoot -Filter 'cordis.patch.yml' -File -Recurse -ErrorAction SilentlyContinue |
  Select-Object FullName

Get-Content -LiteralPath (Join-Path $dshRoot 'logs\dsh-canvas-windows.log') -Tail 200 -ErrorAction SilentlyContinue

foreach ($name in @('canvas-workbench', 'home-explorer')) {
  foreach ($base in @(
    (Join-Path $profilesRoot 'node_modules\@local'),
    (Join-Path $profilesRoot 'desktop\node_modules\@local')
  )) {
    $pkg = Join-Path $base "$name\package.json"
    if (Test-Path -LiteralPath $pkg) { Get-Content -LiteralPath $pkg -Raw }
  }
}
```

同时记录：

- DSH Desktop 显示的版本号；
- 当前活动 Profile 名称；
- 画布是否能打开；
- Bug 的最短复现步骤、期望结果、实际结果；
- 截图或录屏时间点；
- 是否只在 Windows 出现，还是 Mac 也能复现。

## 六、Bug 登记格式

不要把“一大堆 Bug”混在一次大改里。为每个问题创建编号并填写：

```markdown
## WIN-001 简短标题

- 严重度：阻断 / 严重 / 一般 / 视觉
- 环境：Windows、DSH、插件版本、Profile
- 前置条件：
- 最短复现步骤：
- 期望：
- 实际：
- Console/服务端错误：
- 初步根因：
- 修改文件：
- 自动检查：
- 真实 UI 回归：
- 状态：待复现 / 修复中 / 待用户验证 / 已通过
```

优先级顺序：

1. DSH 无法启动、Renderer 白屏、画布完全打不开；
2. 项目数据丢失、旧内容复活、文件被误删；
3. 拖入/粘贴重复、发送聊天失败、导出失败；
4. PSD/AI/PDF/SVG、模型工具和 Adobe 桥接；
5. UI、文案和性能问题。

## 七、关键代码地图

```text
canvas-workbench/lib/index.js          服务端路由、项目、文件、编辑任务、持久化
canvas-workbench/lib/client.js         DSH UI、Excalidraw iframe、拖放/粘贴、聊天附件
canvas-workbench/lib/platform.js       Windows/macOS 路径、文件夹选择、打开/定位文件
canvas-workbench/lib/image-engine.js   dsh-codex/API 图像引擎路由与凭据读取
canvas-workbench/scripts/*.py          OCR、去背景、蒙版、PSD、转矢量
home-explorer/lib/index.js             文件浏览器服务端
home-explorer/lib/client.js            文件浏览器前端
windows-installer/install.ps1          双层安装、Profile 注入、恢复源和计划任务
windows-installer/health-check.ps1     安装健康检查入口
tests/check-portability.mjs            当前跨平台静态检查
```

重点注意：

- `client.js` 内含 iframe `srcdoc` 与消息桥。修改字符串模板时，一个引号或反斜杠错误就可能导致整个画布白屏。
- Windows 绝对路径包括盘符路径 `C:\...` 和 UNC `\\server\share\...`，不能只用 POSIX `/` 判断。
- `file://` URL、反斜杠、中文文件名、空格、冒号和盘符必须分别测试。
- Electron/浏览器的 `dragover/drop/paste` 可能与 Excalidraw 和宿主同时收到事件，重复导入通常来自双重监听或消息桥重复投递。
- DSH 的 `conversation`/`uiConversation`、会话附件和插槽是可选能力；不能列为启动硬依赖。
- DSH 本地端口返回 401/403 代表服务已监听但要求授权，不等于服务故障。

## 八、Windows 高风险兼容点

逐项检查，不要只做字符串替换：

1. **文件路径**：盘符、UNC、中文、空格、长路径、大小写。
2. **文件选择器**：PowerShell WinForms 是否在 DSH/Electron 子进程下正常显示并返回路径。
3. **资源管理器**：打开目录与 `/select,` 定位文件的参数引用。
4. **剪贴板/拖放**：一次事件只生成一个元素；连续第二张不丢失。
5. **项目状态写入**：原子写、保存完成时机、多个聊天窗口竞争、旧快照覆盖新快照。
6. **Profile 注入**：YAML 缩进、重复条目、活动 Profile 检测、web/desktop 双层。
7. **Python**：支持 `python.exe`、`py.exe -3`；缺少 Python 时基础画布必须继续运行。
8. **PSD/AI**：Windows 第一版通过系统文件关联打开；不要调用 AppleScript、`open -a`、`osascript`、QuickLook 或 `sips`。
9. **字体与编码**：PowerShell 5.1、UTF-8、中文文件名及 JSON 读写。
10. **文件监听**：避免全目录高频轮询造成资源管理器新建文件夹延迟；需要节流、防抖和只跟踪已链接源文件。
11. **大文件**：PSD、PDF、SVG、AI 预览失败不能白屏；尺寸/字节上限必须有明确降级。
12. **图像 API**：网络、502/524、重试和超时不能卡死 UI；失败后应恢复原图、遮罩与重试入口。

## 九、每轮修改的正确工作流

1. 先复现一个 Bug，并保存 Console、服务端错误和最短步骤。
2. 只修改仓库源码，不把运行副本当成唯一源码。
3. 修改后运行静态检查：

```powershell
Set-Location $repoRoot
node --check .\canvas-workbench\lib\index.js
node --check .\canvas-workbench\lib\client.js
node --check .\canvas-workbench\lib\platform.js
node --check .\canvas-workbench\lib\image-engine.js
node --check .\home-explorer\lib\index.js
node --check .\home-explorer\lib\client.js
node .\tests\check-portability.mjs
```

4. 完全退出 DSH，执行安装器同步两层：

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\windows-installer\install.ps1 -NoScheduledTask
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\windows-installer\health-check.ps1
```

5. 重新打开 DSH，做真实 UI 回归。静态检查、文件存在和 HTTP 403 都不能替代 UI 验证。
6. 至少测试一次刷新、一次切换聊天 A→B→A、一次完整重启。
7. 更新 `WINDOWS-DEBUG-REPORT.md`，再提交：

```powershell
git status --short
git diff --check
git add <明确文件>
git commit -m "fix(windows): <问题摘要>"
```

8. 用户确认这一批修复后再推送分支；不要覆盖 Release 或强推 `main`。

## 十、必须覆盖的真实 UI 回归

### P0：启动与数据安全

- DSH 正常启动，不进入恢复模式。
- 画布打开、关闭、收起、再次打开不白屏不卡死。
- 新建/导入/切换项目可用。
- 聊天 A 删除图片，切到 B 再回 A、刷新和重启后都不复活。
- “清空”行为符合界面说明，不误删项目外文件。

### P1：图片入口与聊天

- 外部拖一张只出现一张。
- 连续粘贴两张都出现。
- Agent 扫描大量图片不会自动上板。
- 聊天图片只有点击“加入画布”才上板。
- 单选和多选发送聊天都能进入当前输入框。
- 切换不同聊天模型时，聊天结果图片卡片仍能显示本地有效图片。

### P1：项目与文件

- 新建项目不要求手输路径。
- 导入项目调用 Windows 文件夹选择器。
- 访达相关文案在 Windows 显示为“文件夹/资源管理器”。
- 打开项目目录、定位图片、重命名、删除、恢复同步正常。
- 文件监听不引起 Explorer 明显卡顿或图片闪烁。

### P1：画布操作

- 图片移动、缩放、复制、重命名、删除。
- PNG 导出能打开且内容完整。
- 底部提示不遮挡操作。
- 多选菜单位置和按钮不会越界。

### P2：渐进增强

- PSD/AI/SVG/PDF 拖入失败时安全降级，不白屏。
- 系统已关联 Adobe 时能打开源文件。
- Python 缺失时基础画布可用。
- 图像引擎未配置时有清晰引导。
- API 超时/502/524 后恢复窗口、保留遮罩并允许重试。

## 十一、数据与安全边界

未经用户明确授权，禁止：

- 删除整个 `%USERPROFILE%\.dsh`、Profile、项目目录或画布资源目录；
- 清空聊天历史、API 凭据或 Adobe 文件；
- 使用 `git reset --hard`、强推 `main` 或覆盖公开 Release；
- 把本机密钥、完整业务素材、客户文件名、聊天内容提交到 GitHub；
- 为了让 DSH 启动而卸载未知插件或覆盖 DSH 自带依赖。

需要测试删除时，只在新建的测试项目中使用复制素材，并确认回收站行为。

## 十二、最终交付要求

Windows Codex 完成一轮调试后必须交付：

1. `WINDOWS-DEBUG-REPORT.md`：环境、Bug 列表、证据、测试矩阵。
2. 独立 Git 分支和清晰提交记录。
3. 修改文件清单和每项根因说明。
4. 静态检查结果与真实 UI 回归结果分开报告。
5. 尚未解决的问题、风险和下一步。
6. 如生成新安装包，提供版本号、SHA-256、解压验证和回滚办法。

完成定义不是“代码已改”，而是对应 Bug 在 Windows DSH 真实 UI 中无法复现，并且没有破坏 Mac/基础画布产品契约。
