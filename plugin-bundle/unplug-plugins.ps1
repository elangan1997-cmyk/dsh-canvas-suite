# ============================================================
# DSH plugin bundle UNPLUG  (canvas-workbench + dsh-codex)
# - OFFICIAL DSH (dsh-desktop.exe): removes both plugins from the
#   web profile (module + dependencies + bundles).
# - LEGACY CUSTOM SHELL (DeepSeek Harness.exe): removes the canvas
#   ecosystem plugin (body + declaration + link) and dsh-codex.
# - Removed files are MOVED to %LOCALAPPDATA%\DSH\unplugged\ (reversible)
# - Idempotent: safe to run repeatedly
# Usage: dsh-unplug (npm) or double-click unplug-plugins.bat
# ============================================================
$ErrorActionPreference = 'Stop'
$script:Failed = $false

function Ok($msg)   { Write-Output "[OK] $msg" }
function Skip($msg) { Write-Output "[SKIP] $msg" }
function Fail($msg) { Write-Output "[X] $msg"; $script:Failed = $true }

function Find-AppRoot {
  $candidates = @()
  $receipt = Join-Path $env:LOCALAPPDATA 'DSH\install.json'
  if (Test-Path -LiteralPath $receipt) {
    try { $candidates += (Get-Content -LiteralPath $receipt -Raw | ConvertFrom-Json).appRoot } catch {}
  }
  $candidates += (Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness')
  $candidates += 'C:\DSH\app'
  foreach ($c in $candidates) {
    if ($c -and (Test-Path -LiteralPath (Join-Path $c 'DeepSeek Harness.exe'))) { return $c }
  }
  return $null
}

# --- 0. detect environment ---
function Find-OfficialDsh {
  $nodeDir = Join-Path $env:LOCALAPPDATA 'Programs\YottaMeta\Nodejs'
  $nodeExe = Join-Path $nodeDir 'node.exe'
  if (-not (Test-Path -LiteralPath $nodeExe)) {
    $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $cmd) { return $null }
    $nodeExe = $cmd.Source; $nodeDir = Split-Path -Parent $nodeExe
  }
  $binCandidates = @(
    (Join-Path $env:USERPROFILE '.dsh\profiles\node_modules\@deepseek-ai\dsh\lib\bin.js'),
    (Join-Path $env:LOCALAPPDATA 'YottaMeta\dsh-runtime\node_modules\@deepseek-ai\dsh\lib\bin.js')
  )
  foreach ($b in $binCandidates) {
    if (Test-Path -LiteralPath $b) { return @{ Node = $nodeExe; NodeDir = $nodeDir; BinJs = $b } }
  }
  return $null
}

$official = Find-OfficialDsh
if ($official) {
  if (Get-Process -Name 'dsh-desktop' -ErrorAction SilentlyContinue) {
    Fail 'Official DSH (dsh-desktop) is running. Exit it completely (including system tray) first.'
  }
}
elseif (Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue) {
  Fail 'DSH is running. Exit it completely (including system tray) first.'
}

if ($official) {
  # ============================================================
  # OFFICIAL DSH FLOW - profile-only unplug (canvas + codex)
  # ============================================================
  Write-Output "Official DSH runtime detected: $($official.BinJs)"
  $profDir = Join-Path $env:USERPROFILE '.dsh\profiles\web'
  $profPkg = Join-Path $profDir 'package.json'
  $unplugged = Join-Path $env:LOCALAPPDATA 'DSH\unplugged'
  New-Item -ItemType Directory -Force -Path $unplugged | Out-Null
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)

  foreach ($name in @('dsh-canvas-workbench', 'dsh-codex')) {
    $modDir = Join-Path $profDir ('node_modules\' + $name)
    if (Test-Path -LiteralPath $modDir) {
      $dst = Join-Path $unplugged ($name + '-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
      Move-Item -LiteralPath $modDir -Destination $dst
      Ok "$name module moved out -> $dst"
    } else { Skip "$name module already absent" }

    if (Test-Path -LiteralPath $profPkg) {
      $ptxt = [IO.File]::ReadAllText($profPkg)
      $changed = $false
      if ($ptxt -match ('"' + $name + '"\s*:')) {
        $new = [regex]::Replace($ptxt, ('\r?\n\s*"' + $name + '"\s*:\s*"[^"]*"\s*,?'), '')
        if ($new -ne $ptxt) { $ptxt = $new; $changed = $true }
      }
      if ($ptxt -match ('"bundles"\s*:\s*\[[^\]]*"' + $name + '"')) {
        $new = [regex]::Replace($ptxt, ('\r?\n\s*"' + $name + '"\s*,'), '')
        if ($new -eq $ptxt) {
          $new = [regex]::Replace($ptxt, (',(\r?\n)\s*"' + $name + '"\r?\n(?=\s*\])'), '$1')
        }
        if ($new -ne $ptxt) { $ptxt = $new; $changed = $true }
      }
      if ($changed) {
        [IO.File]::WriteAllText($profPkg, $ptxt, $utf8NoBom)
        try {
          Get-Content -LiteralPath $profPkg -Raw | ConvertFrom-Json | Out-Null
          Ok "$name unregistered from web profile"
        } catch { Fail "profile package.json became invalid JSON: $($_.Exception.Message)" }
      } else { Skip "$name registration already absent" }
    }
  }
}
else {
  $appRoot = Find-AppRoot
  if (-not $appRoot) { Fail 'DSH installation not found.' }
  else {
    Write-Output "DSH app root: $appRoot"
    $unplugged = Join-Path $env:LOCALAPPDATA 'DSH\unplugged'
    New-Item -ItemType Directory -Force -Path $unplugged | Out-Null
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)

    # --- 2. canvas-workbench: declaration + body + junction ---
    $appPkgJs = Join-Path $appRoot 'resources\app\package.json'
    $txt = [IO.File]::ReadAllText($appPkgJs)
    if ($txt -match '"@local/canvas-workbench"') {
      $new = [regex]::Replace($txt, '\r?\n\s*"@local/canvas-workbench"\s*,', '')
      if ($new -eq $txt) { Fail 'failed to remove canvas declaration (pattern not found)' }
      else {
        [IO.File]::WriteAllText($appPkgJs, $new, $utf8NoBom)
        Ok 'canvas declaration removed from app package.json'
      }
    } else { Skip 'canvas declaration already absent' }

    if (-not $script:Failed) {
      $cwTarget = Join-Path $appRoot 'resources\app\node_modules\@local\canvas-workbench'
      if (Test-Path -LiteralPath $cwTarget) {
        $dst = Join-Path $unplugged ('canvas-workbench-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
        Move-Item -LiteralPath $cwTarget -Destination $dst
        Ok "canvas plugin body moved out -> $dst"
      } else { Skip 'canvas plugin body already absent' }

      $jn = Join-Path $env:USERPROFILE '.dsh\electron\node_modules\@local\canvas-workbench'
      if (Test-Path -LiteralPath $jn) {
        [System.IO.Directory]::Delete($jn, $false)
        Ok 'canvas junction link removed'
      } else { Skip 'canvas junction link already absent' }
    }

    # --- 3. dsh-codex: module + registration ---
    if (-not $script:Failed) {
      $profDir = Join-Path $env:USERPROFILE '.dsh\profiles\web'
      $profPkg = Join-Path $profDir 'package.json'
      $cxTarget = Join-Path $profDir 'node_modules\dsh-codex'
      if (Test-Path -LiteralPath $cxTarget) {
        $dst = Join-Path $unplugged ('dsh-codex-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
        Move-Item -LiteralPath $cxTarget -Destination $dst
        Ok "dsh-codex module moved out -> $dst"
      } else { Skip 'dsh-codex module already absent' }

      if ((-not $script:Failed) -and (Test-Path -LiteralPath $profPkg)) {
        $ptxt = [IO.File]::ReadAllText($profPkg)
        $changed = $false
        if ($ptxt -match '"dsh-codex"\s*:') {
          $new = [regex]::Replace($ptxt, '\r?\n\s*"dsh-codex"\s*:\s*"[^"]*"\s*,?', '')
          if ($new -ne $ptxt) { $ptxt = $new; $changed = $true }
        }
        if ($ptxt -match '"bundles"\s*:\s*\[[^\]]*"dsh-codex"') {
          # entry with trailing comma (middle of list): remove the whole line
          $new = [regex]::Replace($ptxt, '\r?\n\s*"dsh-codex"\s*,', '')
          # entry without trailing comma (last in list): remove it together with the previous line's comma
          if ($new -eq $ptxt) {
            $new = [regex]::Replace($ptxt, ',(\r?\n)\s*"dsh-codex"\r?\n(?=\s*\])', '$1')
          }
          if ($new -ne $ptxt) { $ptxt = $new; $changed = $true }
        }
        if ($changed) {
          [IO.File]::WriteAllText($profPkg, $ptxt, $utf8NoBom)
          try {
            Get-Content -LiteralPath $profPkg -Raw | ConvertFrom-Json | Out-Null
            Ok 'dsh-codex unregistered from web profile'
          } catch { Fail "profile package.json became invalid JSON: $($_.Exception.Message)" }
        } else { Skip 'dsh-codex registration already absent' }
      }
    }
  }
}

Write-Output ''
if ($script:Failed) { Write-Output 'UNPLUG FAILED - see [X] lines above.' }
else {
  Write-Output 'UNPLUG DONE. Start DSH to verify degraded mode (canvas + codex route gone).'
  Write-Output 'To restore, run plug-plugins.bat'
}
