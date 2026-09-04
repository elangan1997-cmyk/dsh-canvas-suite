param(
  [switch]$NoScheduledTask,
  [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$SuiteRoot = Split-Path -Parent $PSScriptRoot
$DshRoot = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }
$ProfilesRoot = Join-Path $DshRoot 'profiles'
$ManagedRoot = Join-Path $DshRoot 'canvas-suite\distribution'
$LogRoot = Join-Path $DshRoot 'logs'
$LogFile = Join-Path $LogRoot 'dsh-canvas-windows.log'
$TaskName = 'DSH Canvas Suite Sync'

New-Item -ItemType Directory -Force -Path $LogRoot | Out-Null

function Write-Status([string]$Message) {
  $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
  Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8
  Write-Host $Message
}

function Assert-Source([string]$Name) {
  $source = Join-Path $SuiteRoot $Name
  foreach ($relative in @('package.json', 'lib\index.js', 'lib\client.js')) {
    if (-not (Test-Path -LiteralPath (Join-Path $source $relative))) {
      throw "安装包不完整：$Name\$relative"
    }
  }
}

function Copy-PluginAtomic([string]$Name) {
  $source = Join-Path $SuiteRoot $Name
  $targets = @(
    (Join-Path $ProfilesRoot "node_modules\@local\$Name"),
    (Join-Path $ProfilesRoot "desktop\node_modules\@local\$Name"),
    (Join-Path $ProfilesRoot "web\node_modules\@local\$Name"),
    (Join-Path $DshRoot "electron\node_modules\@local\$Name")
  )
  foreach ($target in $targets) {
    $parent = Split-Path -Parent $target
    $stage = Join-Path $parent ('.{0}.stage-{1}' -f $Name, [Guid]::NewGuid().ToString('N'))
    $backup = Join-Path $parent ('.{0}.backup-{1}' -f $Name, [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $parent, $stage | Out-Null
    Get-ChildItem -LiteralPath $source -Force | Copy-Item -Destination $stage -Recurse -Force
    if (Test-Path -LiteralPath $target) { Move-Item -LiteralPath $target -Destination $backup -Force }
    try {
      Move-Item -LiteralPath $stage -Destination $target -Force
      if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Recurse -Force }
    } catch {
      if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
      if (Test-Path -LiteralPath $backup) { Move-Item -LiteralPath $backup -Destination $target -Force }
      throw
    }
    Write-Status "已同步 $Name -> $target"
  }
}

function Add-ProfileEntry([string]$Profile, [string]$Id, [string]$PackageName) {
  if ([string]::IsNullOrWhiteSpace($Profile)) { return }
  $patch = Join-Path $ProfilesRoot "$Profile\cordis.patch.yml"
  if (-not (Test-Path -LiteralPath $patch)) { return }
  $content = Get-Content -LiteralPath $patch -Raw -Encoding UTF8
  if ($content.Contains("name: '$PackageName'")) { return }
  $entry = "- insert:`r`n    - id: $Id`r`n      name: '$PackageName'`r`n"
  if ($content.Trim() -eq '[]') { $content = $entry } else { $content = $content.TrimEnd() + "`r`n" + $entry }
  $temporary = "$patch.tmp"
  [IO.File]::WriteAllText($temporary, $content, [Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $temporary -Destination $patch -Force
  Write-Status "已注入 Profile：$Profile / $PackageName"
}

function Add-ElectronEcosystemEntry([string]$Id, [string]$PackageName) {
  $patch = Join-Path $DshRoot 'electron\plugins.cordis.yml'
  if (-not (Test-Path -LiteralPath $patch)) { return }
  $content = Get-Content -LiteralPath $patch -Raw -Encoding UTF8
  if ($content.Contains("name: '$PackageName'")) { return }
  $entry = "- id: $Id`r`n  name: '$PackageName'`r`n"
  $temporary = "$patch.tmp"
  [IO.File]::WriteAllText($temporary, ($content.TrimEnd() + "`r`n" + $entry), [Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $temporary -Destination $patch -Force
  Write-Status "已注入 Electron：$PackageName"
}

function Repair-ElectronHostOverlay {
  # DeepSeek Harness Desktop 0.1.1-rc.2 bundles both the Web official brand
  # and a Desktop brand adapter.  Both register the same single slots at
  # priority 0, which aborts the complete client-plugin load before Canvas is
  # mounted.  Patch the packaged template (the userData copy is regenerated
  # from this file on every start) and keep the operation idempotent.
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources\app\runtime\host.patch.yml'),
    (Join-Path $env:ProgramFiles 'DeepSeek Harness\resources\app\runtime\host.patch.yml'),
    $(if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} 'DeepSeek Harness\resources\app\runtime\host.patch.yml' })
  ) | Where-Object { $_ }
  foreach ($template in $candidates | Select-Object -Unique) {
    if (-not (Test-Path -LiteralPath $template)) { continue }
    $content = Get-Content -LiteralPath $template -Raw -Encoding UTF8
    if ($content -match '(?ms)^- id:\s*ui-brand-official\s*\r?\n\s+disabled:\s*true\s*$') {
      Write-Status "桌面启动冲突已处理：$template"
      continue
    }
    $anchor = "- id: directory-picker`r`n  disabled: true"
    $normalized = $content -replace "`r?`n", "`r`n"
    if (-not $normalized.Contains($anchor)) {
      Write-Warning "未识别桌面 Host 模板，跳过品牌冲突修复：$template"
      continue
    }
    $replacement = $anchor + "`r`n`r`n# Avoid duplicate registration of Desktop/Web brand single slots.`r`n- id: ui-brand-official`r`n  disabled: true"
    $temporary = "$template.canvas-suite.tmp"
    [IO.File]::WriteAllText($temporary, $normalized.Replace($anchor, $replacement), [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $template -Force
    Write-Status "已修复桌面启动插件冲突：$template"
  }
}

function Get-ActiveProfile {
  $candidates = @(
    (Join-Path $env:APPDATA 'DSH Desktop\profile-selection\state.json'),
    (Join-Path $env:LOCALAPPDATA 'DSH Desktop\profile-selection\state.json')
  )
  foreach ($candidate in $candidates) {
    if (-not (Test-Path -LiteralPath $candidate)) { continue }
    try {
      $value = Get-Content -LiteralPath $candidate -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($value.active) { return [string]$value.active }
    } catch {}
  }
  return ''
}

function Test-DesktopLauncher {
  $candidates = @(
    $(if ($env:DSH_INSTALL_DIR) { Join-Path $env:DSH_INSTALL_DIR 'DeepSeek Harness.exe' }),
    (Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\DeepSeek Harness.exe'),
    $(if ($env:ProgramFiles) { Join-Path $env:ProgramFiles 'DeepSeek Harness\DeepSeek Harness.exe' })
  ) | Where-Object { $_ }
  return @($candidates | Where-Object { Test-Path -LiteralPath $_ }).Count -gt 0
}

function Test-Install {
  foreach ($name in @('canvas-workbench', 'home-explorer')) {
    foreach ($target in @(
      (Join-Path $ProfilesRoot "node_modules\@local\$name"),
      (Join-Path $ProfilesRoot "desktop\node_modules\@local\$name"),
      (Join-Path $ProfilesRoot "web\node_modules\@local\$name"),
      (Join-Path $DshRoot "electron\node_modules\@local\$name")
    )) {
      foreach ($relative in @('package.json', 'lib\index.js', 'lib\client.js')) {
        if (-not (Test-Path -LiteralPath (Join-Path $target $relative))) { throw "健康检查失败：$target\$relative" }
      }
    }
  }
  $python = Get-Command python.exe -ErrorAction SilentlyContinue
  if (-not $python) { $python = Get-Command py.exe -ErrorAction SilentlyContinue }
  if ($python) { Write-Status "Python：已检测到 $($python.Source)" }
  else { Write-Warning '未检测到 Python；基础画布可用，本地 OCR/去背景/转矢量暂不可用。' }
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:43120/' -TimeoutSec 3
    Write-Status "DSH 服务已监听：HTTP $($response.StatusCode)"
  } catch {
    $status = try { [int]$_.Exception.Response.StatusCode } catch { 0 }
    if ($status -in @(401, 403)) { Write-Status "DSH 服务已监听：HTTP $status（需要桌面授权）" }
    else { Write-Warning 'DSH 当前未启动；安装完成后请启动或重启 DSH Desktop。' }
  }
  Write-Status 'Windows 初级版健康检查完成'
}

Assert-Source 'canvas-workbench'
Assert-Source 'home-explorer'
if (-not (Test-Path -LiteralPath $ProfilesRoot)) { throw "未找到 DSH Profiles：$ProfilesRoot。请先安装并启动一次 DSH Desktop。" }

if (-not $CheckOnly) {
  Repair-ElectronHostOverlay
  Copy-PluginAtomic 'canvas-workbench'
  Copy-PluginAtomic 'home-explorer'
  $active = Get-ActiveProfile
  if (Test-DesktopLauncher) {
    Write-Status '检测到 DSH Desktop；跳过 web/desktop Profile 注入，避免与 Electron 插件清单重复加载。'
  } else {
    foreach ($profile in @('web', 'desktop', $active) | Select-Object -Unique) {
      Add-ProfileEntry $profile 'canvas-workbench' '@local/canvas-workbench'
    }
    foreach ($profile in @('web', 'desktop')) {
      Add-ProfileEntry $profile 'home-explorer' '@local/home-explorer'
    }
  }
  # Electron Desktop 不读取 web/desktop profile 的 patch；它通过
  # plugins.cordis.yml 的 ecosystem include 单独装载本地插件。
  Add-ElectronEcosystemEntry 'canvas-workbench' '@local/canvas-workbench'
  Add-ElectronEcosystemEntry 'home-explorer' '@local/home-explorer'
  # 保存一份与 DSH 分离的恢复源，用户删除下载目录后计划任务仍能工作。
  if ([IO.Path]::GetFullPath($SuiteRoot) -ne [IO.Path]::GetFullPath($ManagedRoot)) {
    if (Test-Path -LiteralPath $ManagedRoot) { Remove-Item -LiteralPath $ManagedRoot -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $ManagedRoot | Out-Null
    foreach ($name in @('canvas-workbench', 'home-explorer', 'windows-installer')) {
      Copy-Item -LiteralPath (Join-Path $SuiteRoot $name) -Destination $ManagedRoot -Recurse -Force
    }
    Write-Status "已保存独立恢复源：$ManagedRoot"
  }
  if (-not $NoScheduledTask) {
    $managedInstaller = Join-Path $ManagedRoot 'windows-installer\install.ps1'
    $command = "powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$managedInstaller`" -NoScheduledTask"
    try {
      schtasks.exe /Create /F /SC ONLOGON /TN $TaskName /TR $command /RL LIMITED | Out-Null
      Write-Status "已安装登录自动恢复任务：$TaskName"
    } catch { Write-Warning '无法创建计划任务；不影响当前安装，DSH 更新后请重新运行 install.ps1。' }
  }
}

Test-Install
Write-Host ''
Write-Host '安装完成。请完全退出并重新打开 DSH Desktop。' -ForegroundColor Green
Write-Host '基础版支持：画布、项目、拖入/粘贴、聊天发送、持久化、PNG 导出、资源管理器打开/定位。'
Write-Host '本地模型和 Adobe 自动化属于渐进增强，缺少环境时不会阻断画布。'
