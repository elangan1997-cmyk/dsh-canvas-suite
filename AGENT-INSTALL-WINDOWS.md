# 交给 Agent 的 DSH 画布插件自动安装说明（Windows）

> 用户只需把本文件发给能够操作 Windows 终端和本地文件的 Agent。以下正文是给 Agent 的执行指令，不是让用户手工照做的教程。

## 给 Agent 的任务

请在当前 Windows 10/11 电脑上安装并验证 DSH Canvas Suite。除非遇到需要用户登录 DSH、安装 DSH Desktop 或系统权限确认，否则不要只给出命令，请实际执行到健康检查通过。

### 固定安装源

- GitHub 仓库：`https://github.com/elangan1997-cmyk/dsh-canvas-suite`
- Release：`v1.4.0-windows-preview.2`
- ZIP：`https://github.com/elangan1997-cmyk/dsh-canvas-suite/releases/download/v1.4.0-windows-preview.2/DSH-Canvas-Suite-1.4.0-Windows-preview.2.zip`
- SHA-256：`fccf3ffa53a2dd8e8a18ce9a17f6b41992600a9b644090d259ada51b2890f936`

### 执行原则

1. 不读取、输出或上传用户的 API Key、OAuth Token、聊天记录和画布项目内容。
2. 不要求管理员权限；默认安装到当前用户的 `%USERPROFILE%\.dsh`。
3. 保留现有 DSH Profile、画布项目和用户配置；不要删除 `%USERPROFILE%\.dsh`。
4. 使用临时目录下载和解压，不要直接在 ZIP 内执行脚本。
5. 如果 DSH 正在运行，先请用户保存工作并完全退出 DSH，再继续安装。
6. 安装完成后必须运行健康检查，并报告真实结果；不能把下载成功当成安装成功。

## 自动执行步骤

在 PowerShell 中执行以下流程。可以把命令拆开运行，以便在失败点停止并诊断。

```powershell
$ErrorActionPreference = 'Stop'
$releaseUrl = 'https://github.com/elangan1997-cmyk/dsh-canvas-suite/releases/download/v1.4.0-windows-preview.2/DSH-Canvas-Suite-1.4.0-Windows-preview.2.zip'
$expectedSha256 = 'fccf3ffa53a2dd8e8a18ce9a17f6b41992600a9b644090d259ada51b2890f936'
$workRoot = Join-Path $env:TEMP ('dsh-canvas-install-' + [Guid]::NewGuid().ToString('N'))
$zipPath = Join-Path $workRoot 'dsh-canvas-suite.zip'
$extractRoot = Join-Path $workRoot 'extracted'
New-Item -ItemType Directory -Force -Path $workRoot, $extractRoot | Out-Null

Invoke-WebRequest -UseBasicParsing -Uri $releaseUrl -OutFile $zipPath
$actualSha256 = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualSha256 -ne $expectedSha256) {
  throw "安装包校验失败：期望 $expectedSha256，实际 $actualSha256"
}

Expand-Archive -LiteralPath $zipPath -DestinationPath $extractRoot -Force
$installer = Get-ChildItem -LiteralPath $extractRoot -Filter 'install.ps1' -File -Recurse |
  Where-Object { $_.Directory.Name -eq 'windows-installer' } |
  Select-Object -First 1
if (-not $installer) { throw '安装包中未找到 windows-installer\install.ps1' }

$profilesRoot = if ($env:DSH_HOME) {
  Join-Path $env:DSH_HOME 'profiles'
} else {
  Join-Path $HOME '.dsh\profiles'
}
if (-not (Test-Path -LiteralPath $profilesRoot)) {
  throw '未找到 DSH Profiles。请用户先安装并启动一次 DSH Desktop，然后完全退出，再重新执行本说明。'
}

& powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $installer.FullName
if ($LASTEXITCODE -ne 0) { throw "画布安装器退出码：$LASTEXITCODE" }

$healthCheck = Join-Path $installer.Directory.FullName 'health-check.ps1'
& powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $healthCheck
if ($LASTEXITCODE -ne 0) { throw "健康检查退出码：$LASTEXITCODE" }
```

## 安装器应完成的工作

- 同步 `canvas-workbench` 和 `home-explorer` 到：
  - `%USERPROFILE%\.dsh\profiles\node_modules\@local\*`
  - `%USERPROFILE%\.dsh\profiles\desktop\node_modules\@local\*`
- 向 web、desktop 和检测到的活动 Profile 写入插件声明。
- 保存独立恢复源到 `%USERPROFILE%\.dsh\canvas-suite\distribution`。
- 尝试创建登录恢复任务 `DSH Canvas Suite Sync`，用于 DSH 更新后重新同步插件。
- 写入日志 `%USERPROFILE%\.dsh\logs\dsh-canvas-windows.log`。

## 成功标准

以下条件全部满足后，才向用户报告安装完成：

1. 两层目录中都存在：
   - `canvas-workbench\package.json`
   - `canvas-workbench\lib\index.js`
   - `canvas-workbench\lib\client.js`
   - `home-explorer\package.json`
   - `home-explorer\lib\index.js`
   - `home-explorer\lib\client.js`
2. `health-check.ps1` 没有报告缺文件。
3. 告知用户重新启动 DSH Desktop。
4. 用户在 DSH 中能看到设计模式和画布入口后，再进行基础 UI 验收。

## 最小 UI 验收

请引导用户依次验证：

1. 新建画布项目。
2. 外部拖入一张图片，只出现一张。
3. 连续粘贴两张图片，两张都出现。
4. 删除或移动图片，切换聊天再回来，不恢复旧内容。
5. 多选两张图片发送至聊天，输入框显示两张附件。
6. 导出 PNG，并确认文件可以打开。
7. 打开项目文件夹和“在文件夹中显示”能够调用 Windows 资源管理器。

PSD、AI、OCR、去背景和转矢量属于渐进增强能力，不应作为基础安装成功的前置条件。缺少 Python 或 Adobe 软件时，只需明确报告对应能力不可用，不能判定基础画布安装失败。

## 失败处理

- 下载失败：确认 Windows 能访问 GitHub Release，再重试一次；不要改用来历不明的镜像。
- SHA-256 不一致：立即停止，不执行安装，并向用户报告。
- 找不到 Profiles：让用户先安装并启动一次 DSH Desktop；不要擅自创建伪造 Profile。
- DSH 更新后入口消失：重新运行 `%USERPROFILE%\.dsh\canvas-suite\distribution\windows-installer\install.ps1`。
- 其他失败：读取 `%USERPROFILE%\.dsh\logs\dsh-canvas-windows.log` 最后 100 行，并把错误、Windows 版本、DSH 版本及失败步骤一起反馈。

## 向用户回报格式

```text
DSH Canvas Suite 安装结果：成功 / 未完成
Windows 版本：
DSH 版本：
安装版本：v1.4.0-windows-preview.2
双层插件文件：通过 / 失败
Profile 注入：通过 / 失败
健康检查：通过 / 失败
登录恢复任务：已创建 / 未创建（不阻断基础功能）
基础 UI 验收：通过项 / 未测试项 / 失败项
日志位置：%USERPROFILE%\.dsh\logs\dsh-canvas-windows.log
需要用户处理：无 / 具体事项
```
