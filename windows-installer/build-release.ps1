param(
  [string]$DshInstallRoot = '',
  [string]$DshHome = '',
  [string]$OutputRoot = '',
  [switch]$SkipRuntimeAssets,
  [switch]$SkipIExpress,
  [switch]$KeepStage,
  [switch]$AllowMissingCodex
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$DshInstallRoot = if ($DshInstallRoot) { $DshInstallRoot } else { Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness' }
$DshHome = if ($DshHome) { $DshHome } elseif ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$OutputRoot = if ($OutputRoot) { $OutputRoot } else { Join-Path $RepoRoot 'dist' }
$appManifestPath = Join-Path $DshInstallRoot 'resources\app\package.json'
if (-not (Test-Path -LiteralPath $appManifestPath)) { throw "未找到 DSH Desktop：$DshInstallRoot。请先安装一个可运行的 DSH Desktop。" }

$appManifest = Get-Content -LiteralPath $appManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$dshVersion = [string]$appManifest.version
if (-not $dshVersion) { $dshVersion = 'unknown' }
$canvasManifest = Get-Content -LiteralPath (Join-Path $RepoRoot 'canvas-workbench\package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$homeManifest = Get-Content -LiteralPath (Join-Path $RepoRoot 'home-explorer\package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$safeVersion = $dshVersion -replace '[^A-Za-z0-9._-]', '-'
$releaseName = 'DSH-Setup-x64-v' + $safeVersion
$stageRoot = Join-Path $env:TEMP ('dsh-release-' + [Guid]::NewGuid().ToString('N'))
$payloadRoot = Join-Path $stageRoot 'payload'
$appStage = Join-Path $payloadRoot 'app'
$supportStage = Join-Path $payloadRoot 'support'
$bundleRoot = Join-Path $stageRoot 'iexpress'
$zipPath = Join-Path $bundleRoot 'payload.zip'
$bootstrapSource = Join-Path $PSScriptRoot 'bootstrap.ps1'
$installSource = Join-Path $PSScriptRoot 'install-release.ps1'
$doctorSource = Join-Path $PSScriptRoot 'doctor.ps1'
$uninstallSource = Join-Path $PSScriptRoot 'uninstall-release.ps1'
$launcherPatchSource = Join-Path $PSScriptRoot 'patch-launcher-diagnostics.ps1'
$codexImagePatchSource = Join-Path $PSScriptRoot 'patch-dsh-codex-image-fixes.ps1'

function Copy-Contents([string]$Source, [string]$Destination) {
  if (-not (Test-Path -LiteralPath $Source)) { throw "缺少构建源：$Source" }
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  Get-ChildItem -LiteralPath $Source -Force | Copy-Item -Destination $Destination -Recurse -Force
}
function Read-Json([string]$Path) { Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json }
function Resolve-RealPath([string]$Path) {
  try { return (Resolve-Path -LiteralPath $Path -ErrorAction Stop).Path } catch { return $Path }
}
function Copy-Optional([string]$Source, [string]$Destination, [string]$Label) {
  if (-not (Test-Path -LiteralPath $Source)) { Write-Warning "未找到 $Label，跳过：$Source"; return $false }
  Copy-Contents (Resolve-RealPath $Source) $Destination
  Write-Output "已打包 $Label"
  return $true
}
function Remove-ReleasePrivateArtifacts([string]$Root) {
  $privateNames = @(
    '.credentials.yaml', '.openai-codex-auth.json', '.openai-codex-trusted-origins.json',
    'auth.json', 'cookies.json', 'session.json', 'settings.local.json', '.env', '.env.local',
    'debug.log'
  )
  Get-ChildItem -LiteralPath $Root -Recurse -Force -File -ErrorAction SilentlyContinue |
    Where-Object { $privateNames -contains $_.Name -or $_.Extension -in @('.log', '.map', '.pyc', '.pyo') } |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction Stop }
  Get-ChildItem -LiteralPath $Root -Recurse -Force -Directory -Filter '__pycache__' -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction Stop }
}
function Scrub-ReleaseText([string]$Root) {
  $textExtensions = @('.js', '.mjs', '.cjs', '.json', '.yml', '.yaml', '.txt', '.md', '.html', '.css', '.xml', '.ini', '.cmd', '.bat', '.py', '.pyi')
  $tokens = @($env:USERPROFILE, 'C:/Users/Elan', 'C:\Users\Elan', 'C:/Users/elan', 'C:\Users\elan') | Where-Object { $_ }
  Get-ChildItem -LiteralPath $Root -Recurse -Force -File -ErrorAction SilentlyContinue |
    Where-Object { $textExtensions -contains $_.Extension.ToLowerInvariant() } |
    ForEach-Object {
      try {
        $text = [IO.File]::ReadAllText($_.FullName)
        $next = $text
        foreach ($token in $tokens) { $next = $next.Replace($token, '%USERPROFILE%') }
        if ($next -ne $text) { [IO.File]::WriteAllText($_.FullName, $next, [Text.UTF8Encoding]::new($false)) }
      } catch { Write-Warning ('跳过无法作为文本读取的文件：' + $_.FullName) }
    }
}
function Assert-ReleasePrivateDataAbsent([string]$Root) {
  $privateNames = @('.credentials.yaml', '.openai-codex-auth.json', '.openai-codex-trusted-origins.json', 'auth.json', 'cookies.json', 'session.json', 'settings.local.json', '.env', '.env.local', 'debug.log')
  $foundNames = @(Get-ChildItem -LiteralPath $Root -Recurse -Force -File -ErrorAction SilentlyContinue | Where-Object { $privateNames -contains $_.Name })
  if ($foundNames.Count) { throw ('发布包包含个人配置文件：' + (($foundNames | Select-Object -ExpandProperty FullName) -join '; ')) }
  $textExtensions = @('.js', '.mjs', '.cjs', '.json', '.yml', '.yaml', '.txt', '.md', '.html', '.css', '.xml', '.ini', '.cmd', '.bat', '.py', '.pyi')
  $leaks = New-Object System.Collections.Generic.List[string]
  Get-ChildItem -LiteralPath $Root -Recurse -Force -File -ErrorAction SilentlyContinue |
    Where-Object { $textExtensions -contains $_.Extension.ToLowerInvariant() } |
    ForEach-Object {
      try {
        $text = [IO.File]::ReadAllText($_.FullName)
        if ($text -match '(?i)(C:/Users/Elan|C:\\Users\\Elan|D:/无限画布|D:\\无限画布|sk-[A-Za-z0-9]{20,})') { $leaks.Add($_.FullName) }
      } catch {}
    }
  if ($leaks.Count) { throw ('发布包文本仍包含个人路径或疑似 API Key：' + ($leaks -join '; ')) }
}
function Copy-PortablePython([string]$Destination, [string]$RuntimeSource) {
  $basePython = if ($env:DSH_PYTHON_HOME -and (Test-Path -LiteralPath (Join-Path $env:DSH_PYTHON_HOME 'python.exe'))) { $env:DSH_PYTHON_HOME } else {
    $command = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($command) { Split-Path -Parent $command.Source } else { '' }
  }
  if (-not $basePython -or -not (Test-Path -LiteralPath (Join-Path $basePython 'python.exe'))) {
    Write-Warning '未找到构建机 Python，跳过内置 Python；Release 仍可运行基础画布。'
    return $false
  }
  $rembgSite = Join-Path $RuntimeSource 'rembg-runtime\Lib\site-packages'
  $psdSite = Join-Path $RuntimeSource 'psd-runtime\Lib\site-packages'
  if (-not (Test-Path -LiteralPath $rembgSite)) { Write-Warning '未找到 rembg 运行时，跳过 Python 运行时打包。'; return $false }
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  foreach ($name in @('python.exe','pythonw.exe','python3.dll','python312.dll','vcruntime140.dll','vcruntime140_1.dll')) {
    $source = Join-Path $basePython $name
    if (Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination $Destination -Force }
  }
  foreach ($directory in @('DLLs','libs')) {
    $source = Join-Path $basePython $directory
    if (Test-Path -LiteralPath $source) { Copy-Contents $source (Join-Path $Destination $directory) }
  }
  $libSource = Join-Path $basePython 'Lib'
  $libDestination = Join-Path $Destination 'Lib'
  New-Item -ItemType Directory -Force -Path $libDestination | Out-Null
  Get-ChildItem -LiteralPath $libSource -Force | Where-Object { $_.Name -ne 'site-packages' } | Copy-Item -Destination $libDestination -Recurse -Force
  Copy-Contents $rembgSite (Join-Path $libDestination 'site-packages')
  if (Test-Path -LiteralPath $psdSite) {
    $targetSite = Join-Path $libDestination 'site-packages'
    foreach ($item in Get-ChildItem -LiteralPath $psdSite -Force) {
      $target = Join-Path $targetSite $item.Name
      if (-not (Test-Path -LiteralPath $target)) { Copy-Item -LiteralPath $item.FullName -Destination $target -Recurse -Force }
    }
  }
  # Compiled Python bytecode embeds the build machine's absolute source paths
  # (including the Windows user name). It is unnecessary for runtime startup;
  # remove it so the portable runtime contains no developer identity data.
  Get-ChildItem -LiteralPath $Destination -Recurse -Force -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -in @('.pyc', '.pyo') } |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction Stop }
  Get-ChildItem -LiteralPath $Destination -Recurse -Force -Directory -Filter '__pycache__' -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction Stop }
  [IO.File]::WriteAllText((Join-Path $Destination 'runtime-manifest.txt'), "Python 3.12 portable runtime`r`nPillow/numpy/scipy/rembg/psd-tools packages merged at build time.`r`n", [Text.UTF8Encoding]::new($false))
  return $true
}
function Build-SelfExtractingInstaller([string]$Archive, [string]$Output, [string]$SourceRoot) {
  $stubSource = Join-Path $SourceRoot 'sfx-stub.cs'
  if (-not (Test-Path -LiteralPath $stubSource)) { throw "缺少自解压引导源文件：$stubSource" }
  $csc = Get-ChildItem -LiteralPath (Join-Path $env:WINDIR 'Microsoft.NET') -Recurse -Filter 'csc.exe' -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match 'Framework64\\v4\\.0\\.30319\\csc\.exe$' } |
    Select-Object -First 1
  if (-not $csc) { throw '当前 Windows 没有 .NET Framework 4.x 编译器，无法生成自解压安装包。' }
  $stubExe = Join-Path $stageRoot 'dsh-sfx-stub.exe'
  $compression = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\System.IO.Compression.dll'
  $compressionFs = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\System.IO.Compression.FileSystem.dll'
  $forms = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\System.Windows.Forms.dll'
  & $csc.FullName /nologo /target:exe /optimize+ /out:$stubExe /reference:$compression /reference:$compressionFs /reference:$forms $stubSource
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $stubExe)) { throw "自解压引导编译失败，退出码：$LASTEXITCODE" }
  if (Test-Path -LiteralPath $Output) { Remove-Item -LiteralPath $Output -Force }
  $marker = [Text.Encoding]::ASCII.GetBytes("DSH_PAYLOAD_V1`n")
  $input = [IO.File]::OpenRead($Archive)
  $outputStream = [IO.File]::Open($Output, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try {
    $stub = [IO.File]::OpenRead($stubExe)
    try { $stub.CopyTo($outputStream, 1024 * 1024) } finally { $stub.Dispose() }
    $outputStream.Write($marker, 0, $marker.Length)
    $input.CopyTo($outputStream, 1024 * 1024)
  } finally {
    $input.Dispose()
    $outputStream.Dispose()
  }
}
function Append-CodexPatch([string]$HostPatch, [string]$ProfileHome) {
  if (-not (Test-Path -LiteralPath $HostPatch)) { return $false }
  $content = Get-Content -LiteralPath $HostPatch -Raw -Encoding UTF8
  $profileHasCodex = $false
  $profileManifest = Join-Path $ProfileHome 'profiles\web\package.json'
  if (Test-Path -LiteralPath $profileManifest) {
    try {
      $profile = Read-Json $profileManifest
      $profileHasCodex = ($profile.dependencies.PSObject.Properties.Name -contains 'dsh-codex') -or (@($profile.dsh.profile.bundles) -contains 'dsh-codex')
    } catch { Write-Warning "无法读取 Profile 清单，保留 Codex 兼容补丁：$profileManifest" }
  }
  $codexPatch = @'

# Bundled dsh-codex route. Credentials are still supplied by the user.
- id: agent-default-model
  config:
    provider: openai-codex
    model: gpt-5.6-sol

- id: web
  config:
    searchProvider: openai-codex

- insert:
    - id: llm-openai-codex
      name: dsh-codex
'@
  $normalizedContent = $content -replace "`r`n", "`n"
  $normalizedCodexPatch = ($codexPatch.TrimEnd() -replace "`r`n", "`n")
  if ($profileHasCodex) {
    # dsh-codex's profile bundle already registers llm-openai-codex.  Keeping
    # the generated compatibility block would register it a second time.
    $withoutDuplicate = [regex]::Replace($normalizedContent, "(?ms)\n\s*- insert:\s*\n\s*- id:\s*llm-openai-codex\s*\n\s*name:\s*dsh-codex\s*\n?", "`n")
    if ($withoutDuplicate -ne $normalizedContent) {
      $content = $withoutDuplicate.TrimEnd() + "`r`n"
      [IO.File]::WriteAllText($HostPatch, $content, [Text.UTF8Encoding]::new($false))
    }
    return $true
  }
  if ($normalizedContent.Contains('llm-openai-codex')) { return $true }
  [IO.File]::WriteAllText($HostPatch, $normalizedContent.TrimEnd() + ($codexPatch -replace "`r`n", "`n") + "`r`n", [Text.UTF8Encoding]::new($false))
  return $true
}

New-Item -ItemType Directory -Force -Path $stageRoot, $payloadRoot, $bundleRoot, $OutputRoot | Out-Null
try {
  Copy-Contents $DshInstallRoot $appStage
  if (-not (Test-Path -LiteralPath $launcherPatchSource)) { throw "缺少 Launcher 启动诊断补丁：$launcherPatchSource" }
  & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $launcherPatchSource -AppRoot $appStage
  if ($LASTEXITCODE -ne 0) { throw "Launcher 启动诊断补丁失败，退出码：$LASTEXITCODE" }
  Remove-ReleasePrivateArtifacts $appStage
  Scrub-ReleaseText $appStage
  $appNodeModules = Join-Path $appStage 'resources\app\node_modules'
  $appLocal = Join-Path $appNodeModules '@local'
  New-Item -ItemType Directory -Force -Path $appLocal | Out-Null
  Copy-Contents (Join-Path $RepoRoot 'canvas-workbench') (Join-Path $appLocal 'canvas-workbench')
  Copy-Contents (Join-Path $RepoRoot 'home-explorer') (Join-Path $appLocal 'home-explorer')

  $codexSource = Join-Path $DshHome 'profiles\web\node_modules\dsh-codex'
  $codexStage = Join-Path $appStage 'resources\app\runtime\plugins\dsh-codex'
  $codexCopied = Copy-Optional $codexSource $codexStage 'dsh-codex'
  if ($codexCopied) {
    if (-not (Test-Path -LiteralPath $codexImagePatchSource)) { throw "缺少 dsh-codex 图片兼容补丁：$codexImagePatchSource" }
    & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $codexImagePatchSource -PluginRoot $codexStage
    if ($LASTEXITCODE -ne 0) { throw "dsh-codex 图片兼容补丁失败，退出码：$LASTEXITCODE" }
  }
  if (-not $codexCopied) {
    if (-not $AllowMissingCodex) { throw '未找到 dsh-codex。请先在当前 DSH 中安装 dsh-codex，或使用 -AllowMissingCodex 构建仅 API 路线。' }
  }

  $appPackageStage = Join-Path $appStage 'resources\app\package.json'
  $stagedManifest = Read-Json $appPackageStage
  if (-not $stagedManifest.dshElectron) { $stagedManifest | Add-Member -NotePropertyName dshElectron -NotePropertyValue ([pscustomobject]@{}) }
  $ecosystem = @($stagedManifest.dshElectron.ecosystemPlugins)
  foreach ($pluginName in @('@local/canvas-workbench','@local/home-explorer')) { if ($ecosystem -notcontains $pluginName) { $ecosystem += $pluginName } }
  $stagedManifest.dshElectron.ecosystemPlugins = $ecosystem
  [IO.File]::WriteAllText($appPackageStage, ($stagedManifest | ConvertTo-Json -Depth 100), [Text.UTF8Encoding]::new($false))
  Append-CodexPatch (Join-Path $appStage 'resources\app\runtime\host.patch.yml') $DshHome | Out-Null

  New-Item -ItemType Directory -Force -Path (Join-Path $supportStage 'canvas-workbench') | Out-Null
  # Installer entry points live at payload root so bootstrap can invoke them
  # and the script's sibling app/support paths remain valid after extraction.
  Copy-Item -LiteralPath $installSource -Destination (Join-Path $payloadRoot 'install-release.ps1') -Force
  Copy-Item -LiteralPath $doctorSource -Destination (Join-Path $payloadRoot 'doctor.ps1') -Force
  Copy-Item -LiteralPath $uninstallSource -Destination (Join-Path $payloadRoot 'uninstall-release.ps1') -Force

  $runtimeSource = Join-Path $DshHome 'canvas-workbench'
  $runtimeStage = Join-Path $supportStage 'canvas-workbench'
  if (-not $SkipRuntimeAssets) {
    Copy-PortablePython (Join-Path $runtimeStage 'python-runtime') $runtimeSource | Out-Null
    Copy-Optional (Join-Path $runtimeSource 'rembg-models') (Join-Path $runtimeStage 'rembg-models') 'rembg 模型' | Out-Null
    Copy-Optional (Join-Path $runtimeSource 'imagetracer-runtime') (Join-Path $runtimeStage 'imagetracer-runtime') 'ImageTracerJS 运行时' | Out-Null
    Copy-Optional (Join-Path $runtimeSource 'tesseract-runtime') (Join-Path $runtimeStage 'tesseract-runtime') 'Tesseract.js 运行时' | Out-Null
    Copy-Optional (Join-Path $runtimeSource 'tesseract-cache') (Join-Path $runtimeStage 'tesseract-cache') 'Tesseract 语言包' | Out-Null
  }
  Remove-ReleasePrivateArtifacts $payloadRoot
  Scrub-ReleaseText $payloadRoot
  Assert-ReleasePrivateDataAbsent $payloadRoot

  $gitCommit = ''
  try { $gitCommit = (& git -C $RepoRoot rev-parse HEAD 2>$null).Trim() } catch {}
  $runtimeEntries = @()
  foreach ($relative in @('python-runtime','rembg-models','imagetracer-runtime','tesseract-runtime','tesseract-cache')) {
    $path = Join-Path $runtimeStage $relative
    if (Test-Path -LiteralPath $path) {
      $files = Get-ChildItem -LiteralPath $path -Recurse -File -ErrorAction SilentlyContinue
      $size = ($files | Measure-Object Length -Sum).Sum
      $runtimeEntries += [pscustomobject]@{ name = $relative; sizeBytes = [int64]$size; files = @($files).Count }
    }
  }
  $modelPath = Join-Path $runtimeStage 'rembg-models\isnet-general-use.onnx'
  $modelHash = if (Test-Path -LiteralPath $modelPath) { (Get-FileHash -LiteralPath $modelPath -Algorithm SHA256).Hash.ToLowerInvariant() } else { '' }
  $releaseManifest = [ordered]@{
    version = $dshVersion
    build = (Get-Date -Format 'yyyyMMdd.HHmmss')
    arch = 'x64'
    runtime = [ordered]@{ electron = $dshVersion; bundledPython = (Test-Path -LiteralPath (Join-Path $runtimeStage 'python-runtime\python.exe')); assets = $runtimeEntries }
    plugins = [ordered]@{ canvasWorkbench = $canvasManifest.version; homeExplorer = $homeManifest.version; dshCodex = if (Test-Path -LiteralPath $codexStage) { [string](Read-Json (Join-Path $codexStage 'package.json')).version } else { $null } }
    models = [ordered]@{ rembgIsnetGeneralUse = if ($modelHash) { [ordered]@{ sha256 = $modelHash; bundled = $true } } else { [ordered]@{ bundled = $false } } }
    privacy = [ordered]@{ personalDataIncluded = $false; excluded = @('.credentials.yaml', '.openai-codex-auth.json', 'auth.json', 'cookies.json', 'session.json', '*.log', '*.map', '*.pyc') }
    gitCommit = $gitCommit
    builtAt = (Get-Date).ToUniversalTime().ToString('o')
    installer = 'Custom self-extracting per-user installer (Windows .NET Framework stub)'
  }
  $manifestPath = Join-Path $payloadRoot 'release-manifest.json'
  [IO.File]::WriteAllText($manifestPath, ($releaseManifest | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))
  Copy-Item -LiteralPath $bootstrapSource -Destination (Join-Path $bundleRoot 'bootstrap.ps1') -Force

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
  [IO.Compression.ZipFile]::CreateFromDirectory($payloadRoot, $zipPath, [IO.Compression.CompressionLevel]::Fastest, $false)
  $exePath = Join-Path $OutputRoot ($releaseName + '.exe')
  $sedPath = Join-Path $bundleRoot 'release.sed'
  $sed = @"
[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=1
HideExtractAnimation=1
UseLongFileName=1
InsideCompressed=0
MaxDiskSize=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=%InstallPrompt%
DisplayLicense=%DisplayLicense%
FinishMessage=%FinishMessage%
TargetName=%TargetName%
FriendlyName=%FriendlyName%
AppLaunched=%AppLaunched%
PostInstallCmd=%PostInstallCmd%
AdminQuietInstCmd=%AdminQuietInstCmd%
UserQuietInstCmd=%UserQuietInstCmd%
SourceFiles=SourceFiles
[Strings]
InstallPrompt=
DisplayLicense=
FinishMessage=DSH Desktop 安装完成后会自动启动。
TargetName=$exePath
FriendlyName=DSH Desktop + Canvas Suite
AppLaunched=powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File bootstrap.ps1 -Payload payload.zip
PostInstallCmd=<None>
AdminQuietInstCmd=
UserQuietInstCmd=
FILE0="payload.zip"
FILE1="bootstrap.ps1"
[SourceFiles]
SourceFiles0=$bundleRoot\
[SourceFiles0]
%FILE0%=
%FILE1%=
"@
  [IO.File]::WriteAllText($sedPath, $sed, [Text.UTF8Encoding]::new($false))
  if (-not $SkipIExpress) {
    Build-SelfExtractingInstaller $zipPath $exePath $PSScriptRoot
    if (-not (Test-Path -LiteralPath $exePath)) { throw '自解压安装包构建失败：未生成 EXE。' }
    $hash = (Get-FileHash -LiteralPath $exePath -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText(($exePath + '.sha256'), ($hash + '  ' + (Split-Path -Leaf $exePath) + "`r`n"), [Text.UTF8Encoding]::new($false))
    Write-Output "已生成：$exePath"
    Write-Output "SHA-256：$hash"
  } else {
    Write-Output "已生成 payload：$zipPath"
  }
  if (-not $KeepStage) { Remove-Item -LiteralPath $stageRoot -Recurse -Force }
} catch {
  if (-not $KeepStage -and (Test-Path -LiteralPath $stageRoot)) { Remove-Item -LiteralPath $stageRoot -Recurse -Force -ErrorAction SilentlyContinue }
  throw
}
