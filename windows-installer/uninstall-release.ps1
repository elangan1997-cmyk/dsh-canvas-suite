param([switch]$RemoveUserData)

$ErrorActionPreference = 'Stop'
$AppRoot = if ($env:DSH_INSTALL_DIR) { $env:DSH_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness' }
$DataRoot = Join-Path $env:LOCALAPPDATA 'DSH'
$DshRoot = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$logRoot = Join-Path $DataRoot 'Logs'
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null
$log = Join-Path $logRoot 'uninstall.log'
function Log([string]$value) { Add-Content -LiteralPath $log -Value ('[' + (Get-Date -Format s) + '] ' + $value) -Encoding UTF8 }

$running = Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue
if ($running) { Write-Error '请先完全退出 DSH Desktop（包括系统托盘），再运行卸载。'; exit 2 }

if (Test-Path -LiteralPath $AppRoot) {
  Remove-Item -LiteralPath $AppRoot -Recurse -Force
  Log ('已删除程序目录：' + $AppRoot)
}
foreach ($shortcut in @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'DSH.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'DSH Environment Doctor.lnk'),
  (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\DSH.lnk'),
  (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\DSH Environment Doctor.lnk')
)) { Remove-Item -LiteralPath $shortcut -Force -ErrorAction SilentlyContinue }

if ($RemoveUserData) {
  if (Test-Path -LiteralPath $DataRoot) { Remove-Item -LiteralPath $DataRoot -Recurse -Force }
  if (Test-Path -LiteralPath (Join-Path $DshRoot 'canvas-workbench')) { Remove-Item -LiteralPath (Join-Path $DshRoot 'canvas-workbench') -Recurse -Force }
  Log '已按请求删除 DSH 诊断数据和画布运行时；项目与 .dsh 其余内容保留。'
} else {
  Log '已保留用户配置、项目、日志和模型运行时。'
}
Write-Output 'DSH Desktop 已卸载；用户数据默认保留。'
