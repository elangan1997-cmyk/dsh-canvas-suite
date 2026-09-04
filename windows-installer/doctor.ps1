param(
  [switch]$Json,
  [string]$OutputPath = ''
)

$ErrorActionPreference = 'Stop'
$DshRoot = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$AppRoot = if ($env:DSH_INSTALL_DIR) { $env:DSH_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness' }
$RuntimeRoot = Join-Path $DshRoot 'canvas-workbench'
$LogRoot = Join-Path $env:LOCALAPPDATA 'DSH\Logs'
$checks = New-Object System.Collections.Generic.List[object]

function Add-Check([string]$Id, [string]$Label, [string]$Status, [string]$Detail, [string]$Advice = '') {
  $checks.Add([pscustomobject]@{ id = $Id; label = $Label; status = $Status; detail = $Detail; advice = $Advice })
}

function Test-Writable([string]$Directory) {
  try {
    New-Item -ItemType Directory -Force -Path $Directory | Out-Null
    $probe = Join-Path $Directory ('.doctor-' + [Guid]::NewGuid().ToString('N'))
    [IO.File]::WriteAllText($probe, 'ok', [Text.UTF8Encoding]::new($false))
    Remove-Item -LiteralPath $probe -Force
    return $true
  } catch { return $false }
}

try {
  $os = Get-CimInstance Win32_OperatingSystem
  Add-Check 'OS-001' 'Windows' 'PASS' ($os.Caption + ' ' + $os.Version)
} catch {
  Add-Check 'OS-001' 'Windows' 'WARN' ([Environment]::OSVersion.VersionString)
}
if ([Environment]::Is64BitOperatingSystem) { Add-Check 'OS-002' 'Architecture' 'PASS' 'x64' }
else { Add-Check 'OS-002' 'Architecture' 'FAIL' '仅支持 Windows x64' '请使用 64 位 Windows。' }

try {
  $memory = Get-CimInstance Win32_ComputerSystem
  $ram = [math]::Round([double]$memory.TotalPhysicalMemory / 1GB, 1)
  Add-Check 'HW-001' '内存' ($(if ($ram -ge 8) { 'PASS' } else { 'WARN' })) ($ram.ToString('0.0') + ' GB') '8 GB 以下可能无法稳定运行大型图片任务。'
} catch { Add-Check 'HW-001' '内存' 'WARN' '无法读取' }

try {
  $drive = Get-PSDrive -Name ([IO.Path]::GetPathRoot($AppRoot).TrimEnd('\').TrimEnd(':'))
  $free = [math]::Round([double]$drive.Free / 1GB, 1)
  Add-Check 'HW-002' '磁盘空间' ($(if ($free -ge 5) { 'PASS' } else { 'WARN' })) ($free.ToString('0.0') + ' GB 可用') '大型模型和临时图片建议至少保留 5 GB。'
} catch { Add-Check 'HW-002' '磁盘空间' 'WARN' '无法读取' }

if (Test-Path -LiteralPath (Join-Path $AppRoot 'DeepSeek Harness.exe')) {
  Add-Check 'RUNTIME-001' 'DSH Desktop' 'PASS' $AppRoot
} else {
  Add-Check 'RUNTIME-001' 'DSH Desktop' 'FAIL' '未找到安装文件' '请重新运行 DSH 安装包进行 Repair。'
}

$python = Join-Path $RuntimeRoot 'python-runtime\python.exe'
if (Test-Path -LiteralPath $python) {
  Add-Check 'RUNTIME-002' '内置 Python' 'PASS' $python
} else {
  $legacy = Join-Path $RuntimeRoot 'rembg-runtime\Scripts\python.exe'
  if (Test-Path -LiteralPath $legacy) { Add-Check 'RUNTIME-002' '内置 Python' 'PASS' $legacy }
  else { Add-Check 'RUNTIME-002' '内置 Python' 'WARN' '未安装；画布仍可用，部分本地图像功能不可用' }
}

foreach ($plugin in @('@local\canvas-workbench', '@local\home-explorer')) {
  $package = Join-Path $AppRoot ('resources\app\node_modules\' + $plugin + '\package.json')
  if (Test-Path -LiteralPath $package) { Add-Check 'PLUGIN-001' $plugin 'PASS' $package }
  else { Add-Check 'PLUGIN-001' $plugin 'FAIL' '缺少 package.json' '请运行 Repair。' }
}
$codex = Join-Path $AppRoot 'resources\app\runtime\plugins\dsh-codex\package.json'
if (Test-Path -LiteralPath $codex) { Add-Check 'PLUGIN-002' 'dsh-codex' 'PASS' $codex }
else { Add-Check 'PLUGIN-002' 'dsh-codex' 'WARN' '未内置；不影响 API 图片路线' '需要 ChatGPT/Codex 路线时重新运行 Repair。' }

if (Test-Writable (Join-Path $env:LOCALAPPDATA 'DSH')) { Add-Check 'FILES-001' '用户数据写入' 'PASS' (Join-Path $env:LOCALAPPDATA 'DSH') }
else { Add-Check 'FILES-001' '用户数据写入' 'FAIL' '无法写入 LOCALAPPDATA' }
if (Test-Writable $env:TEMP) { Add-Check 'FILES-002' '临时目录写入' 'PASS' $env:TEMP }
else { Add-Check 'FILES-002' '临时目录写入' 'FAIL' '无法写入 TEMP' }

$proxy = @($env:HTTP_PROXY, $env:HTTPS_PROXY, $env:ALL_PROXY) | Where-Object { $_ }
Add-Check 'NET-001' '代理' ($(if ($proxy.Count) { 'INFO' } else { 'INFO' })) ($(if ($proxy.Count) { '已发现环境代理设置（值已隐藏）' } else { '未发现环境变量代理；DSH 将使用系统代理' }))
try {
  $response = Invoke-WebRequest -UseBasicParsing -Uri 'https://api.deepseek.com' -Method Head -TimeoutSec 8
  Add-Check 'NET-002' 'HTTPS 网络' 'PASS' ('HTTP ' + [string]$response.StatusCode)
} catch {
  Add-Check 'NET-002' 'HTTPS 网络' 'WARN' '当前网络不可达或需要代理' '检查系统代理、DNS 或 API 地址；这不会阻止离线画布启动。'
}

$photoshop = Get-ChildItem -LiteralPath (Join-Path $env:ProgramFiles 'Adobe') -Directory -Filter 'Adobe Photoshop*' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($photoshop) { Add-Check 'PS-001' 'Photoshop' 'INFO' $photoshop.FullName }
else { Add-Check 'PS-001' 'Photoshop' 'INFO' '未检测到；DSH 主体仍可使用' }

$failed = @($checks | Where-Object { $_.status -eq 'FAIL' }).Count
$overall = if ($failed -gt 0) { 'NOT_READY' } elseif (@($checks | Where-Object { $_.status -eq 'WARN' }).Count -gt 0) { 'READY_WITH_LIMITATIONS' } else { 'READY' }
$checkArray = @($checks.ToArray())
$report = [pscustomobject]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  overall = $overall
  appRoot = $AppRoot
  dshHome = $DshRoot
  checks = $checkArray
}

New-Item -ItemType Directory -Force -Path $LogRoot | Out-Null
$jsonText = $report | ConvertTo-Json -Depth 8
$jsonFile = Join-Path $LogRoot 'environment.json'
[IO.File]::WriteAllText($jsonFile, $jsonText, [Text.UTF8Encoding]::new($false))
if ($OutputPath) { [IO.File]::WriteAllText($OutputPath, $jsonText, [Text.UTF8Encoding]::new($false)) }
if ($Json) { Write-Output $jsonText; exit $(if ($failed -gt 0) { 1 } else { 0 }) }

Write-Output ('DSH Environment Doctor: ' + $overall)
foreach ($check in $checks) { Write-Output ('[' + $check.status + '] ' + $check.label + ' — ' + $check.detail) }
Write-Output ('报告：' + $jsonFile)
exit $(if ($failed -gt 0) { 1 } else { 0 })
