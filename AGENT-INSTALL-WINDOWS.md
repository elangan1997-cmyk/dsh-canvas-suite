# 交给 Agent 的 DSH 画布插件自动安装说明（Windows）

> 用户只需把本文件发给能够操作 Windows 终端和本地文件的 Agent。以下正文是给 Agent 的执行指令，不是让用户手工照做的教程。

## 给 Agent 的任务

请在当前 Windows 10/11 电脑上安装并验证 DSH Canvas Suite（Windows 定制版）。除非遇到需要用户登录 DSH、系统权限确认，否则不要只给出命令，请实际执行到健康检查通过。

### 固定安装源

- GitHub 仓库：`https://github.com/elangan1997-cmyk/dsh-canvas-suite`
- Release：`v1.4.0-windows-preview.4`（custom 20260906）
- 完整安装包（推荐，含 DSH Desktop + 画布定制层）：
  `https://github.com/elangan1997-cmyk/dsh-canvas-suite/releases/download/v1.4.0-windows-preview.4/DSH-Setup-Fixed-v1.4.1-20260906.zip`
- SHA-256：`a6d5e1a984af4bacfb64ef8aa5628fb97a569b6bb6cf08334130027725c5a683`
- 仅画布插件包（已有可用 DSH Desktop 时）：
  `https://github.com/elangan1997-cmyk/dsh-canvas-suite/releases/download/v1.4.0-windows-preview.4/DSH-Canvas-Workbench-1.4.0-windows-custom-20260906.zip`
- SHA-256：`332fac1c8359ea470958dc0e26d7fea6b7b0b8cbe6ce663769a693068f0b8a9b`

### 执行原则

1. 不读取、输出或上传用户的 API Key、OAuth Token、聊天记录和画布项目内容。
2. 不要求管理员权限；默认安装到当前用户的 `%LOCALAPPDATA%` 与 `%USERPROFILE%\.dsh`。
3. 保留现有 DSH Profile、画布项目和用户配置；不要删除 `%USERPROFILE%\.dsh`。
4. 使用临时目录下载和解压，不要直接在 ZIP 内执行脚本。
5. 如果 DSH 正在运行，先请用户保存工作并完全退出 DSH，再继续安装。
6. 安装完成后必须运行脚本内置校验（全部 True 才算成功），并报告真实结果。

## 自动执行步骤（完整安装包，推荐）

```powershell
$ErrorActionPreference = 'Stop'
$releaseUrl = 'https://github.com/elangan1997-cmyk/dsh-canvas-suite/releases/download/v1.4.0-windows-preview.4/DSH-Setup-Fixed-v1.4.1-20260906.zip'
$expectedSha256 = 'a6d5e1a984af4bacfb64ef8aa5628fb97a569b6bb6cf08334130027725c5a683'
$workRoot = Join-Path $env:TEMP ('dsh-canvas-install-' + [Guid]::NewGuid().ToString('N'))
$zipPath = Join-Path $workRoot 'dsh-setup-fixed.zip'
$extractRoot = Join-Path $workRoot 'extracted'
New-Item -ItemType Directory -Force -Path $workRoot, $extractRoot | Out-Null

Invoke-WebRequest -UseBasicParsing -Uri $releaseUrl -OutFile $zipPath
$actualSha256 = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualSha256 -ne $expectedSha256) {
  throw "安装包校验失败：期望 $expectedSha256，实际 $actualSha256"
}

Expand-Archive -LiteralPath $zipPath -DestinationPath $extractRoot -Force
$pkgRoot = Join-Path $extractRoot 'DSH-Setup-Fixed-v1.3'
if (-not (Test-Path -LiteralPath (Join-Path $pkgRoot 'install-dsh.bat'))) {
  throw '安装包中未找到 install-dsh.bat'
}

# 关闭正在运行的 DSH
Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue | Stop-Process -Force

# 一键安装（含定制层：登录修复、置顶选择框、重命名锁后缀、标签缩放）
& powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $pkgRoot 'install-fixed-v1.4.ps1')
if ($LASTEXITCODE -ne 0) { throw "安装器退出码：$LASTEXITCODE" }
```

安装脚本会自检并输出：DeepSeek Harness.exe / canvas runtime / python runtime / [] patch files / custom layer / profile node_modules，全部 True 才是 INSTALL SUCCESS。

## 安装器已完成的工作

- 部署 DSH Desktop（官方 payload + 登录修复）到 `%LOCALAPPDATA%\Programs\DeepSeek Harness`
- 应用画布定制层（custom-overrides）到程序内置包与 `%USERPROFILE%\.dsh\canvas-workbench`
- 内置 `@local/canvas-workbench`、`@local/home-explorer` 写入 `[]` cordis.patch.yml
- web profile 注册 `dsh-codex` 与画布插件依赖（含 3 次重试与兜底）
- 创建桌面快捷方式 DSH.lnk

## 首次启动引导

1. 双击桌面 `DSH.lnk` 启动 DSH
2. 进入画布 → 更多 … → 图像生成引擎 → 「登录 ChatGPT」
   （需要代理在线；登录后弹窗自动检测状态）
3. 导入项目：管理项目 → 「导入项目」→ 系统文件夹选择框（强制置顶）选中即导入
4. 图片重命名：双击图片上方文件名，只输入名字（后缀自动锁定）
5. 已知行为：文件名标签为纯文字并跟随缩放；管理项目面板无「浏览其他文件夹」按钮（已移除）

## 最小 UI 验收

1. 新建画布项目。
2. 外部拖入一张图片，只出现一张。
3. 双击图片文件名：输入框不含扩展名，改名后文件后缀不变。
4. 缩小画布：文件名标签等比缩小，不遮挡图片。
5. 多选图片发送至聊天，输入框显示附件。
6. 导入项目弹出文件夹选择框并可完成导入。

PSD、AI、OCR、去背景和转矢量属于渐进增强能力，不应作为基础安装成功的前置条件。

## 失败处理

- 下载失败：确认 Windows 能访问 GitHub Release，再重试一次；不要改用来历不明的镜像。
- SHA-256 不一致：立即停止，不执行安装，并向用户报告。
- INSTALL FAILED：读取安装窗口日志最后 50 行；最常见原因是 DSH 进程未退出干净。
- 其他失败：读取 `%LOCALAPPDATA%\DSH\Logs\startup.log` 与安装窗口日志，把错误、Windows 版本、失败步骤一起反馈。

## 向用户回报格式

```text
DSH Canvas Suite 安装结果：成功 / 未完成
Windows 版本：
安装版本：v1.4.0-windows-preview.4 (custom 20260906)
定制层：通过 / 失败
[] patch 文件：通过 / 失败
profile node_modules：通过 / 失败
ChatGPT 登录：待用户完成 / 已完成
基础 UI 验收：通过项 / 未测试项 / 失败项
需要用户处理：无 / 具体事项
```
