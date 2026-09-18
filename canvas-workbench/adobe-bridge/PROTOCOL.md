# Adobe 桥接协议（Photoshop / Illustrator ⇄ DSH 画布）

> 本文是桥接功能的**唯一契约**。改任何一端（host / 客户端 / .jsx 脚本）之前先读它；
> 改了字段一定同步改这里。协议版本号 `protocol: 1`，不兼容变更时递增并在脚本里做兼容判断。

## 0. 一句话架构

传输层只有**文件夹**：没有网络、没有端口、没有 UXP。Adobe 脚本把文件写进项目目录，
画布轮询发现后自动上画布；画布把返回件写进发件箱，脚本置入回 Adobe。
握手/心跳靠一个固定位置的 `bridge.json`。
**两个入口共用同一套脚本**：日常主路径是画布里的按钮远程驱动 PS/AI（「取 Ps 图层」「→Ps」，用户不进 Adobe 点任何东西，§9）；
PS/AI 里的「文件 → 脚本 → DSH画布桥接」面板是备用入口（应用没开、想从 Adobe 侧发起时用）。

```
Photoshop / Illustrator（ExtendScript 面板）          DSH 画布插件（host + 客户端）
 ┌──────────────────────┐   ① 写 PNG(+PSD) + 清单   ┌─────────────────────────────┐
 │ 「发送选中图层→画布」 │ ─────────────────────────▶│ <项目>/ADOBE桥接/来自Photoshop│
 │                      │                           │   客户端 3s 轮询 inbound     │
 │                      │                           │   → 上画布 + 打 dshBridge 印 │
 │ 「置入为图层/打开」   │ ◀─────────────────────────│ <项目>/ADOBE桥接/发件箱      │
 └──────────────────────┘   ② 读清单 + 置入/打开     │   ← 画布「返回 Ps/Ai」按钮   │
           ▲                                        └─────────────────────────────┘
           │ ③ 读 ~/.dsh/canvas-workbench/adobe-bridge/bridge.json（握手：项目在哪、DSH 是否在线）
```

## 1. 目录约定

### 1.1 固定桥接根（与项目无关）

```
~/.dsh/canvas-workbench/adobe-bridge/
  bridge.json              host 写、脚本读：当前项目、收/发件目录、心跳（§2）
  bridge-log.jsonl         host 侧日志（追加；每行一个 JSON；排障先看这里；超 2MB 滚动为 .1）
  script-log.txt           脚本侧日志（PS/AI 面板追加；文本）
  scripts-installed.json   安装器写：脚本版本、安装到了哪些目录、失败原因（§6）
  scripts/                 三个 .jsx 的用户副本（「浏览…/其它脚本…」入口；sudo 命令的来源）
  panel-prefs.json         面板偏好（PS：合并/归位；AI：分辨率/归位）
```

Windows 下 `~` = `%USERPROFILE%`。ExtendScript 用 `Folder("~")` 在两个平台都能解析到用户目录。

### 1.2 项目内桥接目录

```
<画布项目目录>/ADOBE桥接/
  来自Photoshop/     PS 面板写入；文件 + 清单
  来自Illustrator/   AI 面板写入；文件 + 清单
  发件箱/            host 写入返回件 + 清单；脚本处理后把清单改名 .done.json
```

- 三个子目录**都在项目目录内**，因此素材库能看到、`project-files` 扫描也能看到。
- 项目扫描（`scanProjectImages`）不排除 `ADOBE桥接`，但客户端的**通用自动上画布**会跳过
  `ADOBE桥接/` 下的路径（`isAdobeBridgePath`），由桥接轮询器专门处理——否则会重复上画布。
- 清单 `.json`、临时 `.part` 不是图片扩展名，扫描天然忽略。

## 2. 握手文件 `bridge.json`（host → 脚本）

```json
{
  "protocol": 1,
  "plugin": "canvas-workbench",
  "pluginVersion": "1.8.0",
  "platform": "darwin",
  "updatedAt": 1789000000000,
  "canvasVisible": true,
  "project": { "dir": "/Users/me/项目A", "name": "项目A" },
  "inbox": {
    "photoshop": "/Users/me/项目A/ADOBE桥接/来自Photoshop",
    "illustrator": "/Users/me/项目A/ADOBE桥接/来自Illustrator"
  },
  "outbox": "/Users/me/项目A/ADOBE桥接/发件箱",
  "scriptsInstalled": true
}
```

- `updatedAt` 毫秒时间戳。脚本判定 **在线** = `now - updatedAt < 60000` 且 `project != null`。
- 写入时机：客户端每 3s POST `/dsh-canvas/adobe-bridge/activate`（画布可见且已绑项目）；
  host 在项目变化时立即重写，否则每 20s 心跳重写一次（减少磁盘写）。
- 画布不可见/DSH 退出 → 文件停更 → 脚本显示离线并禁用发送（避免文件送进黑洞）。
- 路径为**原生路径**（mac POSIX / Windows 反斜杠）。ExtendScript `new File(path)` 两种都接受。

## 3. 收件清单（脚本 → 画布）`<jobId>.json`

写入顺序（脚本必须遵守）：先在系统临时目录导出 → 整体复制进收件箱（最终文件名）→ **最后**写清单。
host 只认清单，且要求清单里列出的每个文件都存在、非空、mtime 距今 ≥ 1s（稳定）。

```json
{
  "protocol": 1,
  "jobId": "ps-20260917-231501-k3f9",
  "app": "photoshop",
  "appVersion": "26.5.0",
  "createdAt": 1789000000000,
  "document": {
    "name": "海报.psd", "path": "/Users/me/海报.psd",
    "width": 3000, "height": 2000, "resolution": 300, "units": "px", "colorMode": "RGB"
  },
  "merged": false,
  "items": [
    {
      "file": "ps-20260917-231501-k3f9-01-标题.png",
      "kind": "png",
      "layer": { "name": "标题", "id": 12, "type": "text" },
      "bounds": { "left": 100, "top": 200, "right": 900, "bottom": 500 },
      "artboard": null
    }
  ]
}
```

- `jobId` 格式：`<ps|ai>-<yyyymmdd>-<hhmmss>-<4位随机>`；文件名以 jobId 为前缀，天然不重名。
- `items[].bounds` 一律**文档坐标、y 向下、单位 px**（PS 原生如此）。
- Illustrator 特殊：AI 原生坐标 y 向上、单位 pt。**脚本负责换算**成"以所在画板左上角为原点、
  y 向下、pt"后再写清单，并附 `artboard: { index, left, top, right, bottom }`（同样换算后，
  即 `left=0, top=0`，right/bottom = 画板宽高）。host/客户端永远不处理 y 向上。
- `layer.type`：PS `text | pixel | group | smartobject | shape | other`；AI `pathitem | group | text | placed | other`；
  两端「发送整个文档/画板」时为 `document`（此时 `kind` 是 `psd` / `ai`，bounds 为整幅尺寸）。
- `merged: true` 表示多图层合并成一张（此时 items 只有一项，`layer.name` 为 "合并·N层"）。
- host 处理后把清单改名 `<jobId>.done.json`（保留，供返回时查出处）。
- 脚本先把文件导出到系统临时目录（`Folder.temp/dsh-canvas-bridge/`），再整体复制进收件箱——避免 Adobe
  `saveAs/exportFile` 对扩展名的自动改写把 `.part` 变成 `.part.png`。

## 4. 发件清单（画布 → 脚本）`<seq>.json`

```json
{
  "protocol": 1,
  "jobId": "out-20260917-231900-0007",
  "seq": 7,
  "targetApp": "photoshop",
  "createdAt": 1789000000000,
  "files": [
    { "file": "0007-标题-画布.psd", "name": "标题-画布.psd", "kind": "psd" }
  ],
  "origin": {
    "app": "photoshop", "jobId": "ps-20260917-231501-k3f9",
    "document": { "name": "海报.psd", "path": "/Users/me/海报.psd", "width": 3000, "height": 2000 },
    "layer": { "name": "标题", "id": 12, "type": "text" },
    "bounds": { "left": 100, "top": 200, "right": 900, "bottom": 500 },
    "artboard": null
  },
  "placement": "auto"
}
```

- `seq` 由 host 扫描发件箱现有 `NNNN-*` 前缀取最大值 +1，**永不覆盖**，历史全留。
- 文件 `kind`：`png | jpg | webp | psd | ai | svg | pdf`，原样返回（图片就是图片，分层就是分层）。
- `origin` 可能为 `null`（画布里新生成的、与 Adobe 无出处关系的图）。
  出处解析顺序：元素 `customData.dshBridge.jobId` → 读 `来自*/<jobId>.done.json`；
  找不到再按文件名与清单 items 匹配；都没有 → `null`。
- 脚本处理结果：成功改名 `<seq>.done.json`；失败改名 `<seq>.failed.json` 并把 `error` 字段写进去。
- `placement: auto` 语义（脚本实现）：
  - **置入为图层**：以智能对象/置入对象放进当前文档。若 `origin.document.name` 与当前文档名一致
    （或用户勾选"总是归位"），则缩放到 `origin.bounds` 尺寸并移动到该位置；否则居中。
    图层命名 `"<origin.layer.name> ← 画布"`，无出处则用文件名。
  - **打开为新文档**：`app.open(file)`，分层 PSD/AI 直接可编辑。

## 5. HTTP 路由（客户端 ⇄ host，仅本机 127.0.0.1:43120）

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/dsh-canvas/adobe-bridge/activate` | 心跳：`{cwd, project, sessionId}` → 更新活动项目、按需重写 bridge.json |
| GET | `/dsh-canvas/adobe-bridge/inbound?cwd&project` | 列出未处理收件清单（已校验文件稳定），附预览 url |
| POST | `/dsh-canvas/adobe-bridge/ack` | `{cwd, project, manifest}` → 清单改名 `.done.json` |
| POST | `/dsh-canvas/adobe-bridge/return` | `{cwd, project, app, items:[{sourcePath?, dataURL?, name, kind, bridge?}], auto?, mode?}` → 写发件箱；`auto !== false` 时随即远程置入运行中的应用，响应带 `remote:{attempted, running, placed, error}`（§9） |
| POST | `/dsh-canvas/adobe-bridge/pull` | `{cwd, project, sessionId, app, merged?, dpi?}` → 远程让运行中的 PS/AI 把当前选区送进收件箱（§9），响应 `{count}` |
| GET | `/dsh-canvas/adobe-bridge/status` | 桥接根路径、脚本是否安装、最近日志 20 条（排障面板用） |
| POST | `/dsh-canvas/adobe-bridge/install-scripts` | `{elevate?}`：普通安装（PS 用户级目录免密码）；`elevate:true` 走 macOS 管理员密码弹窗装进 root 目录（§6） |

所有响应 `{ ok: boolean, error?: string, ... }`。

## 6. 脚本安装

安装 = 把 `adobe-bridge/dsh-bridge-core.jsx`、`DSH画布桥接-Photoshop.jsx`、`DSH画布桥接-Illustrator.jsx`
三个文件拷进 Adobe 会扫描的 Scripts 目录。逻辑只有一处（`installScripts()` / `installScriptsElevated()`，
`src/host/services/adobe-bridge.js`）；入口：画布「更多 → 🔐 安装 PS / AI 菜单面板（需 Mac 密码）」「🔗 刷新桥接脚本副本」，
或 `npm run install:adobe-bridge`（`node scripts/install-adobe-bridge.mjs`，`--list` 只看不装；root 目录会给出 sudo 命令）。

### 常驻面板（CEP 扩展，推荐；PS/AI CC 2014+ 通用）

`adobe-bridge/cep/`（`CSXS/manifest.xml` + `index.html` + `main.js`，ES5）是一个 CEP HTML 面板：可停靠、非模态、每 3s 自动检测发件箱，
**一个扩展同时声明 PHXS/PHSP（Photoshop）与 ILST（Illustrator）**。它没有业务逻辑——按钮通过 `evalScript` 调用用户副本里的
`DSH_BRIDGE.ps/.ai.*`（无头模式），状态和发件箱用 `cep.fs` 直接读文件夹协议，所以改 bug 只改 `.jsx`。

- 安装（`installCep()`，DSH 启动时 `ensureInstalled()` 自动做，画布「更多 → 🧩 安装常驻面板」可手动）：整目录复制到用户级扩展目录
  macOS `~/Library/Application Support/Adobe/CEP/extensions/com.dsh.canvasbridge/`、Windows `%APPDATA%\Adobe\CEP\extensions\com.dsh.canvasbridge\`，
  **不需要管理员**；并为 CSXS 6~12 设置用户级开关 `PlayerDebugMode=1`（macOS `defaults write com.adobe.CSXS.N PlayerDebugMode 1`，
  Windows `HKCU\Software\Adobe\CSXS.N`），否则未签名扩展不加载。
- 入口：重启应用后 Photoshop「窗口 → 扩展（旧版）→ DSH 画布桥接」、Illustrator「窗口 → 扩展功能 → DSH 画布桥接」（应用只在启动时扫描扩展目录）。
- 真机（2026-09-18，Illustrator 2026）：菜单出现、面板加载、读到真实 DSH 心跳（项目名正确）、按钮 → evalScript → jsx → 错误回显链路通。
  PS 2025 内置 `CEPHtmlEngine.app`，同一扩展重启后可用。
- 为什么不是 UXP：用户要求"什么版本都可以"，UXP 只覆盖 PS 2022+；CEP 覆盖 CC 2014 → 2025/2026（Adobe 已宣布未来移除，届时再迁 UXP，
  面板逻辑仍在 jsx 里不受影响）。CS6 没有 CEP，用下面的模态面板 / 一键脚本兜底。
- 面板 `main.js` 必须 **ES5 + 回调**（CEP 5 的 Chromium 27 没有 Promise/箭头函数）；`check-adobe-bridge-jsx.mjs` 会拦。

### 菜单脚本（ExtendScript：模态面板 + 一键脚本，任何有 ExtendScript 的版本）

安装顺序与目标：

1. **用户副本**（永远成功，DSH 启动时 `ensureInstalled()` 自动同步）：`~/.dsh/canvas-workbench/adobe-bridge/scripts/`。
   远程驱动（§9）从这里 `evalFile`——所以**日常主路径完全不需要下面的菜单安装**。任何时候也能用
   Photoshop「文件 → 脚本 → 浏览…」/ Illustrator「文件 → 脚本 → 其它脚本…」直接打开它。
2. **应用目录 = 菜单入口**（macOS `/Applications/Adobe Photoshop <年>/Presets/Scripts`、
   `/Applications/Adobe Illustrator <年>/Presets.localized/<每个 locale>/Scripts`；Windows 对应 Program Files）：
   **两款应用都只扫描这里，且都是 root/管理员权限。** 走 `installScriptsElevated()`（画布「更多 → 🔐 安装 PS / AI 菜单面板」
   → macOS 管理员密码弹窗，一次即可）；普通 `installScripts()` 写不进时返回 `errors[].hint`（可粘贴的 `sudo` 命令）。
   Illustrator 一个版本合并为一条（所有 locale 一条命令装完；Scripts 子目录不存在的 locale 会一并创建，中文 UI 的 zh_CN 也在内）。

> **纠错记录（2026-09-18）**：早先误以为 Photoshop 会扫描用户级目录 `~/Library/Application Support/Adobe/Adobe Photoshop <年>/Presets/Scripts`
> （因为那里有用户自装的 BiRefNet 脚本且菜单里能看到）。真机证明：菜单里那份来自 /Applications 的副本；用户级目录里的
> `BiRefNet-Remove-BG_副本.jsx` 和我们的三个脚本从未出现。**PS 2025 不扫描用户级 Scripts 目录**，不要再往那里装。

- 安装后需**重启** PS/AI（它们只在启动时扫描 Scripts），菜单 `文件 → 脚本 → DSH画布桥接-…` 打开面板。
- `#include "dsh-bridge-core.jsx"` 按脚本所在目录解析，所以三个文件必须在同一目录。
- `scripts-installed.json` 记录版本、时间、成功目录与失败目录；握手文件的 `scriptsInstalled` = 至少装进了一个应用目录（用户副本不算）。
  `installScripts` 把"目录不可写但三个脚本已在"视为已安装（管理员装过之后普通重装不会误报失败）。
- 插件升级后菜单里的脚本不会自动更新（root 目录）：远程驱动不受影响（用用户副本）；面板若报「协议版本不匹配」就再点一次「🔐 安装」。
- 面板偏好（合并/归位/分辨率）存 `~/.dsh/canvas-workbench/adobe-bridge/panel-prefs.json`。

### 面板形态（两端相同）

| | Photoshop | Illustrator |
|---|---|---|
| 窗口类型 | `dialog`（模态） | `dialog`（模态） |
| 为什么不是常驻 palette | **实测 PS 2025**：palette 在脚本结束时被 Photoshop 立即关闭，`#targetengine` 也留不住（PS 不支持 ExtendScript 常驻面板，InDesign 才支持） | AI 的 ExtendScript 同样不支持常驻 palette |
| 发件箱检测 | 打开面板时自动读一次；之后点「刷新」 | 同左 |
| 使用节奏 | 选好图层 → 菜单打开面板 → 点按钮 → 「关闭」；返回时再开一次 | 同左 |
| 无界面测试 | `$.global.DSH_BRIDGE_HEADLESS = true` 后 `$.evalFile`，调 `DSH_BRIDGE.ps.*` | 同左，`DSH_BRIDGE.ai.*` |
| 成功后 | 自动关闭对话框（用户反馈模态窗挡住应用） | 同左 |
| 一键脚本 | `DSH桥接-发送选中图层-Photoshop.jsx` / `DSH桥接-置入返回件-Photoshop.jsx`：无界面，只在失败时弹一句；可在「动作」面板录成 F 键 | `DSH桥接-发送选中对象-Illustrator.jsx` / `DSH桥接-置入返回件-Illustrator.jsx` |
| 常驻替代 | **CEP 面板**（上一节）——可停靠、不挡应用、自动检测 | 同左 |

模态面板打开时会阻塞该应用；日常请用 CEP 常驻面板或 DSH 画布按钮。真机验收记录见 AGENT-HANDOFF §16。

## 7. 状态机与时序

```
收件：脚本写 .part → rename → 写 <jobId>.json
      → 客户端 GET inbound（3s）→ host 校验稳定 → 返回 items
      → 客户端 add-image（带 bridge 元数据）→ POST ack → host 改名 .done.json
发件：画布选中 → 「返回 Ps/Ai」→ 父页面解析源文件（无源文件则先落盘 dataURL）
      → POST return → host 复制到发件箱 + 写 <seq>.json
      → 脚本面板「刷新」（打开面板时自动读一次）→ 置入/打开 → 改名 .done.json
```

防重复：客户端只添加画布上尚未链接该路径（`dshSourcePath`）的文件；host 只返回未 ack 的清单。
防半截文件：脚本先导出到临时目录再整体复制；host 要求 mtime ≥ 1s。
防误判离线：心跳 60s 容忍（客户端 3s 心跳、通用轮询 8s 都远小于它）；面板离线时只禁用「发送」，
「置入/打开」仍可用（发件箱里已有的返回件不需要 DSH 在线）。

## 8. 排障速查

| 现象 | 看哪里 |
|---|---|
| 面板显示"离线" | `bridge.json` 是否存在、`updatedAt` 是否在更新（DSH 开着？画布可见？项目已绑？） |
| 发送了但画布没长出来 | `来自Photoshop/` 里有没有 `.json`（没有 = 脚本导出失败，看 `script-log.txt`）；有 `.json` 但没变 `.done.json` = 客户端没轮询到（画布可见？`bridge-log.jsonl` 有 inbound 记录？） |
| 返回后面板没反应 | `发件箱/` 有没有新的 `NNNN.json`；面板是模态的、不会自己刷新——点「刷新」或关掉重开 |
| 置入位置不对 | 清单 `origin.bounds` 是否 y 向下；AI 画板换算见 §3；文档名不一致会居中而不归位 |
| 脚本菜单里没有 | 三个 .jsx 是否在同一 Scripts 目录；是否重启了 PS/AI；`scripts-installed.json` 记录了哪些目录 |
| 「取 Ps 图层」报「没有在运行」 | 目标应用确实没开（host 不会替用户拉起 Adobe）；开着却误报时看 `osascript -e 'tell application "System Events" to exists (first process whose bundle identifier is "com.adobe.Photoshop")'` |
| 「→Ps」提示自动置入失败 | 看 `remote.error`：常见是 PS 没有打开的文档（返回件仍在发件箱、清单保持待处理，打开文档后面板「置入」即可）；PS 有弹窗挡着会超时 |

## 9. 远程驱动（DSH → Adobe；日常主路径，用户不必打开面板）

面板脚本支持**无头模式**：`$.global.DSH_BRIDGE_HEADLESS = true` 时只把函数挂到 `DSH_BRIDGE.ps` / `DSH_BRIDGE.ai`、不开窗口。
host（`services/adobe-bridge.js` 的 `remoteEval`）据此从外面驾驭运行中的 PS/AI：

```
写驾驭脚本（ASCII 临时目录）：
  $.global.DSH_BRIDGE_HEADLESS = true;
  $.evalFile(new File("<用户副本>/DSH画布桥接-Photoshop.jsx"));   ← 其内部 #include 按该文件目录解析
  try { "OK:" + (B.ps.sendSelection(false)) } catch (e) { "ERR:" + e.message }
执行：
  macOS   osascript → tell application id "com.adobe.Photoshop" to do javascript (read POSIX file … as «class utf8»)
          （PS 2025 的 do javascript 只接受文本、不接受文件引用；外层 with timeout 防 AppleEvent -1712）
  Windows powershell → (New-Object -ComObject Photoshop.Application).DoJavaScriptFile(路径)  ← 尚未实机验证
解析：stdout 以 OK:/ERR: 开头；否则视为执行失败（stderr 最后一行）。
```

- **取图层**（画布顶栏「取 Ps 图层 / 取 Ai 对象」→ `POST /pull`）：`appRunning` 为真才驱动（AppleScript 会拉起未运行的应用，
  所以必须先查）；写握手 → `B.ps.sendSelection(merged)` / `B.ai.sendSelection(dpi)` → 文件进收件箱 → 客户端轮询 3s 内上画布。
- **返回**（选中工具栏「→Ps / →Ai」→ `POST /return`）：写发件箱后立即 `B.*.importPending('place')`；应用未运行或失败时
  返回件留在发件箱、清单保持待处理，用户之后在面板「置入」。**脚本在改任何清单前先检查有无打开的文档**——
  否则会把清单标成 `.failed`（2026-09-18 真机发现并修复）。
- 实测（PS 2025 / AI 2026）：取图层 ≈2s，返回并置入 ≈2s，全程零次进 Adobe 点击；归位精确到像素。
- 已知怪癖：通过 `do javascript` 关闭 Illustrator 的**当前**文档，文档会关但 AppleEvent 回执不返回（超时）。
  产品流程不关用户文档，只有测试清理会碰到。
- 启动即用：`ensureInstalled()` 在 host `apply()` 时静默运行（版本一致且文件在位就跳过），用户副本随插件版本自动同步。
