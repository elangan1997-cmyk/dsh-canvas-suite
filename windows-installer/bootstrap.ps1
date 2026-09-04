param([string]$Payload = 'payload.zip')

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$archive = Join-Path $root $Payload
$extract = Join-Path $root ('payload-' + [Guid]::NewGuid().ToString('N'))
try {
  if (-not (Test-Path -LiteralPath $archive)) { throw '安装包缺少 payload.zip' }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [IO.Compression.ZipFile]::ExtractToDirectory($archive, $extract)
  $installer = Join-Path $extract 'install-release.ps1'
  if (-not (Test-Path -LiteralPath $installer)) { throw '安装包缺少发布安装脚本' }
  & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $installer
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} catch {
  $logRoot = Join-Path $env:LOCALAPPDATA 'DSH\Logs'
  New-Item -ItemType Directory -Force -Path $logRoot | Out-Null
  $log = Join-Path $logRoot 'installer.log'
  Add-Content -LiteralPath $log -Value ('[' + (Get-Date -Format s) + '] ERROR ' + $_.Exception.Message) -Encoding UTF8
  Write-Error $_.Exception.Message
  exit 1
} finally {
  if (Test-Path -LiteralPath $extract) { Remove-Item -LiteralPath $extract -Recurse -Force -ErrorAction SilentlyContinue }
}
