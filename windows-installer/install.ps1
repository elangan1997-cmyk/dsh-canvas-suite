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
    (Join-Path $ProfilesRoot "desktop\node_modules\@local\$Name")
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

function Remove-LegacyHomeExplorer {
  foreach ($target in @(
    (Join-Path $ProfilesRoot 'node_modules\@local\home-explorer'),
    (Join-Path $ProfilesRoot 'desktop\node_modules\@local\home-explorer')
  )) {
    if (Test-Path -LiteralPath $target) {
      Remove-Item -LiteralPath $target -Recurse -Force
      Write-Status "已移除旧文件浏览器：$target"
    }
  }
  Get-ChildItem -LiteralPath $ProfilesRoot -Filter cordis.patch.yml -File -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
    $content = Get-Content -LiteralPath $_.FullName -Raw -Encoding UTF8
    $updated = [regex]::Replace($content, "(?ms)^\s*- insert:\s*\r?\n\s+- id:\s*home-explorer\s*\r?\n\s+name:\s*['\"]?@local/home-explorer['\"]?\s*\r?\n?", '')
    if ($updated -ne $content) {
      [IO.File]::WriteAllText($_.FullName, $updated, [Text.UTF8Encoding]::new($false))
      Write-Status "已清理旧文件浏览器注入：$($_.FullName)"
    }
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

function Test-Install {
  foreach ($name in @('canvas-workbench')) {
    foreach ($target in @(
      (Join-Path $ProfilesRoot "node_modules\@local\$name"),
      (Join-Path $ProfilesRoot "desktop\node_modules\@local\$name")
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
if (-not (Test-Path -LiteralPath $ProfilesRoot)) { throw "未找到 DSH Profiles：$ProfilesRoot。请先安装并启动一次 DSH Desktop。" }

if (-not $CheckOnly) {
  Remove-LegacyHomeExplorer
  Copy-PluginAtomic 'canvas-workbench'
  $active = Get-ActiveProfile
  foreach ($profile in @('web', 'desktop', $active) | Select-Object -Unique) {
    Add-ProfileEntry $profile 'canvas-workbench' '@local/canvas-workbench'
  }
  # 保存一份与 DSH 分离的恢复源，用户删除下载目录后计划任务仍能工作。
  if ([IO.Path]::GetFullPath($SuiteRoot) -ne [IO.Path]::GetFullPath($ManagedRoot)) {
    if (Test-Path -LiteralPath $ManagedRoot) { Remove-Item -LiteralPath $ManagedRoot -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $ManagedRoot | Out-Null
    foreach ($name in @('canvas-workbench', 'windows-installer')) {
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
