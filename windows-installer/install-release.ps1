param(
  [string]$InstallDir = '',
  [switch]$NoLaunch,
  [switch]$Repair
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$PayloadRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppSource = Join-Path $PayloadRoot 'app'
$SupportSource = Join-Path $PayloadRoot 'support'
$AppTarget = if ($InstallDir) { $InstallDir } elseif ($env:DSH_INSTALL_DIR) { $env:DSH_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness' }
$DshRoot = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$DataRoot = Join-Path $env:LOCALAPPDATA 'DSH'
$LogRoot = Join-Path $DataRoot 'Logs'
$LogFile = Join-Path $LogRoot 'installer.log'

New-Item -ItemType Directory -Force -Path $LogRoot | Out-Null
function Log([string]$Message) {
  $line = '[' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '] ' + $Message
  Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8
  Write-Output $Message
}
function Fail([string]$Message, [int]$Code = 1) {
  Log ('ERROR ' + $Message)
  Write-Error $Message
  exit $Code
}
function Copy-DirectoryContents([string]$Source, [string]$Destination) {
  if (-not (Test-Path -LiteralPath $Source)) { Fail ('安装包缺少目录：' + $Source) }
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  Get-ChildItem -LiteralPath $Source -Force | Copy-Item -Destination $Destination -Recurse -Force
}
function Replace-Directory([string]$Source, [string]$Destination) {
  $parent = Split-Path -Parent $Destination
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  $stage = Join-Path $parent ('.dsh-release-stage-' + [Guid]::NewGuid().ToString('N'))
  $backup = Join-Path $parent ('.dsh-release-backup-' + [Guid]::NewGuid().ToString('N'))
  Copy-DirectoryContents $Source $stage
  try {
    if (Test-Path -LiteralPath $Destination) { Move-Item -LiteralPath $Destination -Destination $backup -Force }
    Move-Item -LiteralPath $stage -Destination $Destination -Force
    if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Recurse -Force }
  } catch {
    if (Test-Path -LiteralPath $Destination) { Remove-Item -LiteralPath $Destination -Recurse -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $backup) { Move-Item -LiteralPath $backup -Destination $Destination -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
    throw
  }
}
function Get-ManagedPluginNames {
  $names = @('@local/canvas-workbench', '@local/home-explorer', 'dsh-codex')
  $appPackage = Join-Path $AppSource 'resources\app\package.json'
  if (Test-Path -LiteralPath $appPackage) {
    try {
      $manifest = Get-Content -LiteralPath $appPackage -Raw -Encoding UTF8 | ConvertFrom-Json
      $names += @($manifest.dshElectron.ecosystemPlugins)
    } catch { Log ('WARN 无法读取应用插件清单：' + $_.Exception.Message) }
  }
  $runtimePlugins = Join-Path $AppSource 'resources\app\runtime\plugins'
  if (Test-Path -LiteralPath $runtimePlugins) {
    foreach ($pluginDir in Get-ChildItem -LiteralPath $runtimePlugins -Directory -Force -ErrorAction SilentlyContinue) {
      $packagePath = Join-Path $pluginDir.FullName 'package.json'
      if (-not (Test-Path -LiteralPath $packagePath)) { continue }
      try {
        $package = Get-Content -LiteralPath $packagePath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($package.name) { $names += [string]$package.name }
      } catch { Log ('WARN 无法读取运行时插件清单：' + $packagePath) }
    }
  }
  return @($names | Where-Object { $_ } | Select-Object -Unique)
}
function Prepare-ManagedPluginLinks {
  $backupRoot = Join-Path $DshRoot ('plugin-link-backups\installer-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
  $roots = @(
    @{ Label = 'profiles'; Path = (Join-Path $DshRoot 'profiles\node_modules') },
    @{ Label = 'electron'; Path = (Join-Path $DshRoot 'electron\node_modules') }
  )
  foreach ($name in Get-ManagedPluginNames) {
    $relative = ([string]$name).Replace('/', '\')
    foreach ($root in $roots) {
      $link = Join-Path $root.Path $relative
      $item = Get-Item -LiteralPath $link -Force -ErrorAction SilentlyContinue
      if (-not $item) { continue }
      $isLink = (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)
      if ($isLink) {
        Remove-Item -LiteralPath $link -Force -ErrorAction Stop
        Log ('已清理旧插件链接：' + $link)
        continue
      }
      $backup = Join-Path $backupRoot (Join-Path $root.Label $relative)
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $backup) | Out-Null
      Move-Item -LiteralPath $link -Destination $backup -Force -ErrorAction Stop
      Log ('旧插件目录已备份：' + $link + ' -> ' + $backup)
    }
  }
}
function Repair-ElectronProfilePatch {
  # A standalone plugin install may have placed Canvas/Home in the web Profile
  # while Electron also manages them through its generated include.  Remove
  # only those exact installer blocks and keep a recoverable backup; this is a
  # targeted duplicate-registration repair, not a profile reset.
  $profiles = @('web')
  foreach ($profile in $profiles) {
    $patch = Join-Path $DshRoot ("profiles\$profile\cordis.patch.yml")
    if (-not (Test-Path -LiteralPath $patch)) { continue }
    $lines = @(Get-Content -LiteralPath $patch -Encoding UTF8)
    $result = New-Object System.Collections.Generic.List[string]
    $changed = $false
    for ($index = 0; $index -lt $lines.Count; $index++) {
      if ($index + 2 -lt $lines.Count -and
          $lines[$index].Trim() -eq '- insert:' -and
          $lines[$index + 1].Trim() -match '^[-] id:\s*(canvas-workbench|home-explorer)\s*$' -and
          $lines[$index + 2].Trim() -match "^name:\s*'@local/(canvas-workbench|home-explorer)'\s*$") {
        $index += 2
        $changed = $true
        continue
      }
      [void]$result.Add($lines[$index])
    }
    if (-not $changed) { continue }
    $yamlEntries = @($result | Where-Object { $trimmed = $_.Trim(); $trimmed -and -not $trimmed.StartsWith('#') })
    if ($yamlEntries.Count -eq 0) { [void]$result.Add('[]') }
    $backupRoot = Join-Path $DshRoot 'canvas-suite\plugin-backups\launcher-startup'
    New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
    $backup = Join-Path $backupRoot ((Split-Path -Leaf $patch) + '.' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.bak')
    Copy-Item -LiteralPath $patch -Destination $backup -Force
    [IO.File]::WriteAllText($patch, (($result -join "`r`n") + "`r`n"), [Text.UTF8Encoding]::new($false))
    Log ("已修复 Desktop 重复 Profile 条目：$patch（备份：$backup）")
  }
}

if (-not (Test-Path -LiteralPath $AppSource)) { Fail '安装包不完整：缺少 DSH Desktop 应用文件。' }
$running = Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue
if ($running) { Fail 'DSH Desktop 正在运行。请先完全退出（包括系统托盘），再运行安装或 Repair。' 2 }

try {
  Prepare-ManagedPluginLinks
} catch {
  Fail ('处理旧插件链接失败：' + $_.Exception.Message)
}
try {
  Repair-ElectronProfilePatch
} catch {
  Fail ('修复 Desktop Profile 重复条目失败：' + $_.Exception.Message)
}

Log ('开始安装 DSH Desktop 到：' + $AppTarget)
try {
  Replace-Directory $AppSource $AppTarget
} catch {
  Fail ('写入 DSH 程序目录失败：' + $_.Exception.Message)
}

if (Test-Path -LiteralPath (Join-Path $SupportSource 'canvas-workbench')) {
  $runtimeTarget = Join-Path $DshRoot 'canvas-workbench'
  New-Item -ItemType Directory -Force -Path $runtimeTarget | Out-Null
  Copy-DirectoryContents (Join-Path $SupportSource 'canvas-workbench') $runtimeTarget
  Log ('已安装画布内置运行时：' + $runtimeTarget)
}

$manifestSource = Join-Path $PayloadRoot 'release-manifest.json'
if (Test-Path -LiteralPath $manifestSource) {
  Copy-Item -LiteralPath $manifestSource -Destination (Join-Path $AppTarget 'release-manifest.json') -Force
  Copy-Item -LiteralPath $manifestSource -Destination (Join-Path $DataRoot 'release-manifest.json') -Force
}
foreach ($script in @('doctor.ps1', 'uninstall-release.ps1')) {
  $source = Join-Path $PayloadRoot $script
  if (Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination (Join-Path $DataRoot $script) -Force }
}

$doctorCmd = Join-Path $DataRoot 'DSH Environment Doctor.cmd'
$doctorBody = '@echo off' + "`r`n" + 'chcp 65001 >nul' + "`r`n" + 'powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0doctor.ps1"' + "`r`n" + 'pause' + "`r`n"
[IO.File]::WriteAllText($doctorCmd, $doctorBody, [Text.UTF8Encoding]::new($false))
$uninstallCmd = Join-Path $DataRoot 'DSH Uninstall.cmd'
$uninstallBody = '@echo off' + "`r`n" + 'chcp 65001 >nul' + "`r`n" + 'powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall-release.ps1"' + "`r`n" + 'pause' + "`r`n"
[IO.File]::WriteAllText($uninstallCmd, $uninstallBody, [Text.UTF8Encoding]::new($false))

try {
  $shell = New-Object -ComObject WScript.Shell
  $desktop = [Environment]::GetFolderPath('Desktop')
  $start = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
  New-Item -ItemType Directory -Force -Path $start | Out-Null
  foreach ($entry in @(
    @{ Path = (Join-Path $desktop 'DSH.lnk'); Target = (Join-Path $AppTarget 'DeepSeek Harness.exe'); Args = ''; Work = $AppTarget; Description = 'DeepSeek Harness Desktop' },
    @{ Path = (Join-Path $desktop 'DSH Environment Doctor.lnk'); Target = $doctorCmd; Args = ''; Work = $DataRoot; Description = '检查 DSH 运行环境' },
    @{ Path = (Join-Path $start 'DSH.lnk'); Target = (Join-Path $AppTarget 'DeepSeek Harness.exe'); Args = ''; Work = $AppTarget; Description = 'DeepSeek Harness Desktop' },
    @{ Path = (Join-Path $start 'DSH Environment Doctor.lnk'); Target = $doctorCmd; Args = ''; Work = $DataRoot; Description = '检查 DSH 运行环境' }
  )) {
    $shortcut = $shell.CreateShortcut($entry.Path)
    $shortcut.TargetPath = $entry.Target
    $shortcut.Arguments = $entry.Args
    $shortcut.WorkingDirectory = $entry.Work
    $shortcut.Description = $entry.Description
    $shortcut.Save()
  }
} catch { Log ('WARN 无法创建快捷方式：' + $_.Exception.Message) }

$receipt = [pscustomobject]@{
  installedAt = (Get-Date).ToUniversalTime().ToString('o')
  appRoot = $AppTarget
  dshHome = $DshRoot
  architecture = 'x64'
  releaseManifest = (Join-Path $AppTarget 'release-manifest.json')
}
[IO.File]::WriteAllText((Join-Path $DataRoot 'install.json'), ($receipt | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
Log '安装完成。用户配置、项目和 API 凭据目录均未修改。'

$exe = Join-Path $AppTarget 'DeepSeek Harness.exe'
if (-not $NoLaunch) {
  try { Start-Process -FilePath $exe -WorkingDirectory $AppTarget | Out-Null; Log '已启动 DSH Desktop。' }
  catch { Log ('WARN 启动 DSH 失败，请从桌面快捷方式重试：' + $_.Exception.Message) }
}
exit 0
