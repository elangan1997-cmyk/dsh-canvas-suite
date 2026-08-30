param([switch]$KeepSettings)
$ErrorActionPreference = 'Stop'
$DshRoot = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }
$ProfilesRoot = Join-Path $DshRoot 'profiles'
foreach ($name in @('canvas-workbench', 'home-explorer')) {
  foreach ($target in @(
    (Join-Path $ProfilesRoot "node_modules\@local\$name"),
    (Join-Path $ProfilesRoot "desktop\node_modules\@local\$name")
  )) {
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force; Write-Host "已删除 $target" }
  }
}
schtasks.exe /Delete /F /TN 'DSH Canvas Suite Sync' 2>$null | Out-Null

# 同时移除各 Profile 中由安装器写入的插件声明，避免卸载后留下失效入口。
if (Test-Path -LiteralPath $ProfilesRoot) {
  Get-ChildItem -LiteralPath $ProfilesRoot -Filter 'cordis.patch.yml' -File -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
    $content = Get-Content -LiteralPath $_.FullName -Raw
    $pluginPattern = @'
(?ms)^\s*- insert:\s*\r?\n\s+- id:\s*(?:canvas-workbench|home-explorer)\s*\r?\n\s+name:\s*['"]?@local/(?:canvas-workbench|home-explorer)['"]?\s*\r?\n?
'@
    $updated = [regex]::Replace($content, $pluginPattern.Trim(), '')
    if ($updated -ne $content) {
      Set-Content -LiteralPath $_.FullName -Value $updated -Encoding UTF8
      Write-Host "已清理 Profile 配置 $($_.FullName)"
    }
  }
}

if (-not $KeepSettings) {
  $settings = Join-Path $DshRoot 'canvas-workbench'
  if (Test-Path -LiteralPath $settings) { Remove-Item -LiteralPath $settings -Recurse -Force }
}
Write-Host '画布插件、资源浏览器及 Profile 配置已卸载。'
