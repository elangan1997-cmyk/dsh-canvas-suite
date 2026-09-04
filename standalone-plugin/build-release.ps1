param(
  [string]$OutputRoot = ''
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Source = Join-Path $RepoRoot 'canvas-workbench'
$OutputRoot = if ($OutputRoot) { $OutputRoot } else { Join-Path $RepoRoot 'dist' }
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'release-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$version = [string]$manifest.version
$name = 'DSH-Canvas-Workbench-' + ($version -replace '[^A-Za-z0-9._-]', '-')
$stage = Join-Path $env:TEMP ('dsh-canvas-workbench-' + [Guid]::NewGuid().ToString('N'))
$pluginStage = Join-Path $stage 'canvas-workbench'
$zip = Join-Path $OutputRoot ($name + '.zip')

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

if (-not (Test-Path -LiteralPath (Join-Path $Source 'package.json'))) { throw "缺少插件源码：$Source" }
New-Item -ItemType Directory -Force -Path $stage, $OutputRoot | Out-Null
try {
  foreach ($item in @('README.md', 'LICENSE', 'install-windows.ps1', 'install-windows.cmd', 'install-macos.sh', 'release-manifest.json')) {
    $from = if ($item -eq 'LICENSE') { Join-Path $RepoRoot $item } else { Join-Path $PSScriptRoot $item }
    Copy-Item -LiteralPath $from -Destination (Join-Path $stage $item) -Force
  }
  New-Item -ItemType Directory -Force -Path (Join-Path $stage 'docs') | Out-Null
  foreach ($doc in @('DSH-CANVAS-WORKBENCH-WINDOWS.md', 'DSH-CANVAS-WORKBENCH-MACOS.md')) {
    Copy-Item -LiteralPath (Join-Path $RepoRoot ('docs\' + $doc)) -Destination (Join-Path $stage ('docs\' + $doc)) -Force
  }
  Copy-Filtered $Source $pluginStage
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
  [IO.Compression.ZipFile]::CreateFromDirectory($stage, $zip, [IO.Compression.CompressionLevel]::Optimal, $false)
  $hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
  [IO.File]::WriteAllText($zip + '.sha256', ($hash + '  ' + (Split-Path -Leaf $zip) + "`r`n"), [Text.UTF8Encoding]::new($false))
  Write-Output ('已生成：' + $zip)
  Write-Output ('SHA-256：' + $hash)
} finally {
  if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
}
