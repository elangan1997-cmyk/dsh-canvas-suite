param(
  [string]$DshHome = '',
  [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$BundleRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Source = if (Test-Path -LiteralPath (Join-Path $BundleRoot 'canvas-workbench')) {
  Join-Path $BundleRoot 'canvas-workbench'
} else {
  Join-Path (Split-Path -Parent $BundleRoot) 'canvas-workbench'
}
$DshRoot = if ($DshHome) { $DshHome } elseif ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$LogRoot = Join-Path $DshRoot 'logs'
$LogFile = Join-Path $LogRoot 'dsh-canvas-workbench-install.log'
$BackupRoot = Join-Path $DshRoot 'canvas-suite\plugin-backups'

New-Item -ItemType Directory -Force -Path $LogRoot | Out-Null
function Write-Status([string]$Message) {
  $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
  Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8
  Write-Host $Message
}
function Fail([string]$Message) {
  Write-Status ('错误：' + $Message)
  throw $Message
}
function Assert-Source {
  foreach ($relative in @('package.json', 'lib\index.js', 'lib\client.js', 'lib\image-engine.js', 'lib\platform.js')) {
    if (-not (Test-Path -LiteralPath (Join-Path $Source $relative))) {
      Fail ('独立插件包不完整，缺少 ' + $relative)
    }
  }
}
function Copy-Filtered([string]$From, [string]$To) {
  New-Item -ItemType Directory -Force -Path $To | Out-Null
  Get-ChildItem -LiteralPath $From -Force -File -Recurse | Where-Object {
    $_.Extension -notin @('.pyc', '.pyo', '.log', '.map') -and
    $_.FullName -notmatch '\\(__pycache__|node_modules\\\.cache)(\\|$)'
  } | ForEach-Object {
    $relative = $_.FullName.Substring($From.Length).TrimStart('\')
    $destination = Join-Path $To $relative
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
    Copy-Item -LiteralPath $_.FullName -Destination $destination -Force
  }
}
function Replace-Plugin([string]$Target) {
  $parent = Split-Path -Parent $Target
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  $stage = Join-Path $parent ('.canvas-workbench.stage-' + [Guid]::NewGuid().ToString('N'))
  $backup = Join-Path $BackupRoot ((Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8) + '\' + ($Target -replace '[:\\/]', '_'))
  try {
    Copy-Filtered $Source $stage
    if (Test-Path -LiteralPath $Target) {
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $backup) | Out-Null
      Move-Item -LiteralPath $Target -Destination $backup -Force
    }
    Move-Item -LiteralPath $stage -Destination $Target -Force
    Write-Status ('已安装到：' + $Target)
  } catch {
    if (Test-Path -LiteralPath $Target) { Remove-Item -LiteralPath $Target -Recurse -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $backup) { Move-Item -LiteralPath $backup -Destination $Target -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
    throw
  }
}
function Add-ProfileEntry([string]$Profile) {
  if ([string]::IsNullOrWhiteSpace($Profile)) { return }
  $patch = Join-Path $DshRoot ('profiles\' + $Profile + '\cordis.patch.yml')
  if (-not (Test-Path -LiteralPath $patch)) { return }
  $content = Get-Content -LiteralPath $patch -Raw -Encoding UTF8
  if ($content.Contains("name: '@local/canvas-workbench'")) { return }
  $entry = "- insert:`r`n    - id: canvas-workbench`r`n      name: '@local/canvas-workbench'`r`n"
  $next = if ($content.Trim() -eq '[]') { $entry } else { $content.TrimEnd() + "`r`n" + $entry }
  $temporary = $patch + '.canvas-workbench.tmp'
  [IO.File]::WriteAllText($temporary, $next, [Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $temporary -Destination $patch -Force
  Write-Status ('已注入 Profile：' + $Profile)
}
function Add-ElectronEntry {
  $patch = Join-Path $DshRoot 'electron\plugins.cordis.yml'
  if (-not (Test-Path -LiteralPath $patch)) { return }
  $content = Get-Content -LiteralPath $patch -Raw -Encoding UTF8
  if ($content.Contains("name: '@local/canvas-workbench'")) { return }
  $entry = "- id: canvas-workbench`r`n  name: '@local/canvas-workbench'`r`n"
  $temporary = $patch + '.canvas-workbench.tmp'
  [IO.File]::WriteAllText($temporary, $content.TrimEnd() + "`r`n" + $entry, [Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $temporary -Destination $patch -Force
  Write-Status '已注入 DSH Desktop Electron 插件清单'
}
function Test-DesktopLauncher {
  $candidates = @(
    $(if ($env:DSH_INSTALL_DIR) { Join-Path $env:DSH_INSTALL_DIR 'DeepSeek Harness.exe' }),
    (Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\DeepSeek Harness.exe'),
    $(if ($env:ProgramFiles) { Join-Path $env:ProgramFiles 'DeepSeek Harness\DeepSeek Harness.exe' })
  ) | Where-Object { $_ }
  return @($candidates | Where-Object { Test-Path -LiteralPath $_ }).Count -gt 0
}
function Test-Target([string]$Target) {
  foreach ($relative in @('package.json', 'lib\index.js', 'lib\client.js')) {
    if (-not (Test-Path -LiteralPath (Join-Path $Target $relative))) { throw ('缺少：' + (Join-Path $Target $relative)) }
  }
}

Assert-Source
if (-not (Test-Path -LiteralPath (Join-Path $DshRoot 'profiles'))) {
  Fail ('未找到 DSH profiles：' + (Join-Path $DshRoot 'profiles') + '。请先安装并启动一次 DSH Desktop。')
}
$targets = @(
  (Join-Path $DshRoot 'profiles\node_modules\@local\canvas-workbench'),
  (Join-Path $DshRoot 'profiles\web\node_modules\@local\canvas-workbench'),
  (Join-Path $DshRoot 'profiles\desktop\node_modules\@local\canvas-workbench'),
  (Join-Path $DshRoot 'electron\node_modules\@local\canvas-workbench')
) | Select-Object -Unique

if (-not $CheckOnly) {
  $running = Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue
  if ($running) { Fail 'DSH Desktop 正在运行，请先完全退出（包括系统托盘）再安装。' }
  foreach ($target in $targets) { Replace-Plugin $target }
  if (Test-DesktopLauncher) {
    Write-Status '检测到 DSH Desktop；跳过 web/desktop Profile 注入，避免与 Electron 插件清单重复加载。'
  } else {
    foreach ($profile in @('web', 'desktop')) { Add-ProfileEntry $profile }
  }
  Add-ElectronEntry
}
foreach ($target in $targets) { Test-Target $target }
Write-Status 'DSH画布工作台安装检查通过。项目、登录和 API 凭据未修改。'
Write-Host '请完全退出并重新打开 DSH Desktop。'
