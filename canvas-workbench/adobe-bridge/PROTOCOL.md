# Adobe 桥接协议（Photoshop / Illustrator ⇄ DSH 画布）

> 本文是桥接功能的**唯一契约**。改任何一端（host / 客户端 / .jsx 脚本）之前先读它；
> 改了字段一定同步改这里。协议版本号 `protocol: 1`，不兼容变更时递增并在脚本里做兼容判断。

## 0. 一句话架构

传输层只有**文件夹**：没有网络、没有端口、没有 UXP。Adobe 脚本把文件写进项目目录，
画布轮询发现后自动上画布；画布把返回件写进发件箱，Adobe 面板点一下置入。
握手/心跳靠一个固定位置的 `bridge.json`。

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
| POST | `/dsh-canvas/adobe-bridge/return` | `{cwd, project, app, items:[{sourcePath?, dataURL?, name, kind, bridge?}]}` → 写发件箱 |
| GET | `/dsh-canvas/adobe-bridge/status` | 桥接根路径、脚本是否安装、最近日志 20 条（排障面板用） |
| POST | `/dsh-canvas/adobe-bridge/install-scripts` | 把 `adobe-bridge/*.jsx` 拷进本机 PS/AI 的 Scripts 目录 |

所有响应 `{ ok: boolean, error?: string, ... }`。

## 6. 脚本安装

安装 = 把 `adobe-bridge/dsh-bridge-core.jsx`、`DSH画布桥接-Photoshop.jsx`、`DSH画布桥接-Illustrator.jsx`
三个文件拷进 Adobe 会扫描的 Scripts 目录。入口两个，逻辑只有一处（`installScripts()`，
`src/host/services/adobe-bridge.js`）：画布「更多 → 🔗 安装 Adobe 桥接脚本」，或 `npm run install:adobe-bridge`
（`node scripts/install-adobe-bridge.mjs`，`--list` 只看不装）。

安装顺序与目标：

1. **用户副本**（永远成功）：`~/.dsh/canvas-workbench/adobe-bridge/scripts/`。任何时候都能用
   Photoshop「文件 → 脚本 → 浏览…」/ Illustrator「文件 → 脚本 → 其它脚本…」直接打开，它也是 sudo 命令的来源。
2. **Photoshop 用户级**（macOS `~/Library/Application Support/Adobe/Adobe Photoshop <年>/Presets/Scripts`，
   Windows `%APPDATA%\Adobe\Adobe Photoshop <年>\Presets\Scripts`）：普通权限可写，PS 会扫描 → 菜单里出现。
   只对 /Applications（Program Files）里真实存在的版本安装，忽略残留的旧版本目录。
3. **应用目录**（macOS `/Applications/Adobe Photoshop <年>/Presets/Scripts`、
   `/Applications/Adobe Illustrator <年>/Presets.localized/<每个 locale>/Scripts`；Windows 对应 Program Files）：
   通常 root/管理员权限，写不进时返回 `errors[].hint` —— macOS 是可直接粘贴的 `sudo cp` / `sudo sh -c 'for …'`
   命令，Windows 是「以管理员身份运行」。Illustrator 一个版本合并为一条（所有 locale 一条命令装完）。

- Illustrator **没有用户级脚本目录**：要么 sudo 一次，要么每次用「其它脚本…」打开用户副本。
- 安装后需**重启** PS/AI，菜单 `文件 → 脚本 → DSH画布桥接-…` 打开面板。
- `#include "dsh-bridge-core.jsx"` 按脚本所在目录解析，所以三个文件必须在同一目录。
- `scripts-installed.json` 记录版本、时间、成功目录与失败目录；握手文件的 `scriptsInstalled` = 至少装进了一个
  Adobe 会扫描的目录（用户副本不算）。
- 面板偏好（合并/归位/分辨率）存 `~/.dsh/canvas-workbench/adobe-bridge/panel-prefs.json`。

### 面板形态（两端相同）

| | Photoshop | Illustrator |
|---|---|---|
| 窗口类型 | `dialog`（模态） | `dialog`（模态） |
| 为什么不是常驻 palette | **实测 PS 2025**：palette 在脚本结束时被 Photoshop 立即关闭，`#targetengine` 也留不住（PS 不支持 ExtendScript 常驻面板，InDesign 才支持） | AI 的 ExtendScript 同样不支持常驻 palette |
| 发件箱检测 | 打开面板时自动读一次；之后点「刷新」 | 同左 |
| 使用节奏 | 选好图层 → 菜单打开面板 → 点按钮 → 「关闭」；返回时再开一次 | 同左 |
| 无界面测试 | `$.global.DSH_BRIDGE_HEADLESS = true` 后 `$.evalFile`，调 `DSH_BRIDGE.ps.*` | 同左，`DSH_BRIDGE.ai.*` |

面板打开时会阻塞该应用（模态），不影响 DSH 与另一款 Adobe 应用。真机验收记录见 AGENT-HANDOFF §16。

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
