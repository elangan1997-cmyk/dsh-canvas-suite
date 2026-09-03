# DSH 画布套件：交给 Agent 的安装说明

> 使用方式：把本说明和 GitHub Release 中的 `DSH-Canvas-Suite-1.5.3-macOS-Complete.dmg` 一起交给本机 Agent，并告诉它：“请严格按说明完成安装、配置和验证。”

## 给 Agent 的任务

请在当前 macOS 电脑上安装并配置 **DSH Desktop + DSH 画布套件**。你需要实际执行安装、完成健康检查并汇报结果，不要只给用户讲步骤。

必须遵守：

1. 不读取、复制、上传或回显用户已有的 API Key、OAuth token、聊天记录、画布项目和钥匙串内容。
2. 不修改 DMG 内的 `DSH Desktop.app`，保持官方签名与 Apple 公证有效。
3. 安装画布插件前备份现有 DSH Profile 和同名插件；安装器会自动备份，不要删除备份。
4. Dockyard Codex 推理是可选组件。只有用户明确要求使用 Codex 会员额度时才安装；浏览器 OAuth 必须由用户本人完成。
5. 如果系统中已有更新版本的 DSH Desktop，不要用 DMG 内较旧版本覆盖；保留较新官方版本，只安装画布插件。
6. 不得把静态检查当成完整 UI 验收。最后必须启动 DSH，确认画布按钮和基本交互可见。

## 一、定位安装包

用户通常会提供以下文件之一：

- `DSH-Canvas-Suite-1.5.3-macOS-Complete.dmg`
- 已挂载 DMG 中的 `DSH 完整安装包.pkg`

先确认文件存在，并记录绝对路径。不要假设它在“下载”目录。

如果用户同时提供了 `.sha256` 文件，执行完整性校验：

```bash
cd "/安装包所在目录"
shasum -a 256 -c "DSH-Canvas-Suite-1.5.3-macOS-Complete.dmg.sha256"
```

显示 `OK` 才继续。如果没有 `.sha256` 文件，可以继续安装，但必须在最终报告中注明“未提供独立校验文件”。如果校验不一致，停止安装并请用户重新取得安装包。不要为了国内网络而擅自修改用户的代理、DNS 或 hosts。

## 二、安装前检查

执行只读检查：

```bash
sw_vers
uname -m
ls -ld "/Applications/DSH Desktop.app" 2>/dev/null || true
```

要求：

- 系统必须是 macOS。
- Apple Silicon 与 Intel Mac 均可；DMG 内 DSH Desktop 是 universal 应用。
- 如果 `/Applications/DSH Desktop.app` 已存在，读取版本：

```bash
/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' \
  "/Applications/DSH Desktop.app/Contents/Info.plist"
```

DMG 内版本为 2.0.4。现有版本高于 2.0.4 时不得覆盖。

## 三、挂载 DMG

```bash
DMG_PATH="/实际路径/DSH-Canvas-Suite-1.5.3-macOS-Complete.dmg"
MOUNT_PATH="$(hdiutil attach "$DMG_PATH" -nobrowse -readonly | awk '/\/Volumes\// {sub(/^.*\/Volumes\//,"/Volumes/"); print; exit}')"
printf 'DMG 已挂载：%s\n' "$MOUNT_PATH"
```

如果无法自动取得挂载路径，使用：

```bash
hdiutil info
```

找到卷名以“DSH 画布套件”开头的挂载点。

## 四、安装完整套件

PKG 同时安装 DSH Desktop、画布、兼容版 dsh-codex、双架构图像运行时、ISNet 模型和转矢量程序。全新电脑无需预先安装 Python、Node.js、rembg 或 VTracer。

```bash
sudo installer -pkg "$MOUNT_PATH/DSH 完整安装包.pkg" -target /
```

验证官方签名：

```bash
codesign --verify --deep --strict "/Applications/DSH Desktop.app"
spctl -a -vv "/Applications/DSH Desktop.app"
```

`spctl` 应显示 `accepted`，来源应为 `Notarized Developer ID`。

### 已有 DSH

- 版本高于 2.0.4：保留现有版本。
- 版本等于 2.0.4：无需覆盖。
- 版本低于 2.0.4：先退出 DSH，再由用户确认后升级。

首次安装后先启动一次 DSH，让它创建 `~/.dsh/profiles`：

```bash
open -a "DSH Desktop"
```

等待界面出现。若需要初始化或登录，让用户完成。确认 `~/.dsh/profiles` 已生成后，完整退出 DSH：

```bash
osascript -e 'tell application "DSH Desktop" to quit' 2>/dev/null || true
```

## 五、首次启动与自动注入

成功时应看到 `installer: The install was successful.`。如果安装时还没有 `~/.dsh/profiles`，这不是失败；启动 DSH 并创建 Profile 后，LaunchAgent 会自动注入。

插件会：

- 安装独立源码到 `/Library/Application Support/DSH Canvas Suite/`；
- 同步 `canvas-workbench` 到 DSH 两层运行目录，并按需注入内置 `dsh-codex`；
- 给 web、desktop 和当前活动 Profile 注入画布；
- 在安装前备份旧插件与 Profile patch；
- 安装 `ai.deepseek.dsh.canvas-suite.sync` LaunchAgent，在登录时和每 5 分钟轻量检查一次，防止 DSH 更新后插件副本丢失。

## 六、安装后健康检查

以当前桌面用户身份运行：

```bash
"/Library/Application Support/DSH Canvas Suite/health-check.sh"
```

必须检查：

```bash
test -f "$HOME/.dsh/profiles/node_modules/@local/canvas-workbench/package.json"
test -f "$HOME/.dsh/profiles/desktop/node_modules/@local/canvas-workbench/package.json"
test -f "$HOME/.dsh/profiles/node_modules/dsh-codex/package.json"
```

检查自动恢复任务：

```bash
launchctl print "gui/$(id -u)/ai.deepseek.dsh.canvas-suite.sync" | head -40
```

若 DSH 尚未启动，HTTP 检查显示连接失败不算插件文件安装失败；启动 DSH 后需再次检查。

## 七、可选：安装 Dockyard Codex 会员推理

先询问用户：

> 是否要在 DSH 聊天中使用 Codex 会员额度进行推理？这会安装第三方 MIT 开源插件 Dockyard DSH，并需要你在官方浏览器页面亲自完成 Codex OAuth 登录。

只有用户明确同意时，运行：

```bash
open "$MOUNT_PATH/安装 Dockyard Codex 推理.command"
```

该脚本固定到已检查的 Dockyard commit：

```text
7af23286c2a4a1083af9a8ea7d25767d7d94d894
```

注意：

- Dockyard 和 DSH 都仍处于 developer preview。
- 如果电脑没有全局 `dsh` CLI，脚本会停止并提示，不影响基础画布。
- 不要为了消除依赖警告而覆盖 DSH Desktop 自带依赖。
- 安装完成后重启 DSH，在聊天输入：

```text
/dockyard login codex
```

让用户在打开的官方浏览器页面完成登录。随后输入：

```text
/dockyard status
/dockyard models codex
```

确认 Codex 状态与模型目录可读取。

Dockyard 用于聊天推理；画布的图片编辑引擎仍在“更多 → 图像引擎设置”中选择 `dsh-codex` 或 `API`。

## 八、启动与真实 UI 验收

启动 DSH：

```bash
open -a "DSH Desktop"
```

等待服务启动后检查：

```bash
curl -sS -o /dev/null --max-time 5 -w '%{http_code}\n' http://127.0.0.1:43120/
```

HTTP `200`、`401` 或 `403` 都说明服务已经监听；`401/403` 表示需要桌面会话授权。

在真实 DSH 界面确认：

1. 会话中能看到“设计模式”入口。
2. 打开后右侧显示“无限画布”。
3. 能新建或选择画布项目。
4. 外部拖入一张普通 PNG/JPG，只出现一张图片。
5. 剪贴板粘贴图片可以加入画布。
6. 选中画布图片时出现操作菜单；不会因为 agent 扫描目录而自动把图片全部加入画布。
7. 切换聊天再切回时，画布项目和内容可以恢复。

不要在没有完成以上 UI 验收时声称“全部功能已验证”。Photoshop、Illustrator、去背景、转矢量和图片模型功能依赖外部软件、网络或用户配置，可分别标为“未配置/未测试”。

## 九、图像引擎配置

如果用户需要智能擦除、编辑图片或文字背景清理：

1. 打开画布。
2. 进入“更多 → 图像引擎设置”。
3. 让用户选择：
   - `dsh-codex`：使用用户自己的 Codex 登录；或
   - `API`：由用户本人填写 OpenAI 兼容图片 API 地址、模型和 API Key。
4. 执行“保存并检测连接”。

不得要求用户把 API Key 发到聊天里。不得在日志或最终报告中回显密钥。

## 十、失败处理与回滚

日志位置：

```text
~/.dsh/logs/dsh-local-plugins-sync.log
```

安装备份位置：

```text
~/Library/Application Support/DSH Canvas Suite/Backups/
```

卸载画布插件：

```bash
"/Library/Application Support/DSH Canvas Suite/uninstall.sh"
```

卸载后重启 DSH。不要删除用户画布项目、聊天记录或整个 `~/.dsh`。

## 十一、Agent 最终回报格式

请向用户简洁报告：

```text
安装结果：成功 / 部分成功 / 失败
macOS 与架构：
DSH Desktop 版本：
DSH 官方签名：通过 / 未通过
画布插件版本：1.5.3
两层插件副本：通过 / 未通过
活动 Profile 注入：通过 / 未通过
自动恢复任务：已安装 / 未安装
DSH HTTP：状态码或连接情况
真实 UI：已验证哪些项目
Dockyard Codex：未安装 / 已安装未登录 / 已登录并验证
图像引擎：未配置 / dsh-codex / API
未完成项与原因：
备份位置：
```

不得把“文件已复制”“语法通过”写成“完整 UI 功能全部通过”。
