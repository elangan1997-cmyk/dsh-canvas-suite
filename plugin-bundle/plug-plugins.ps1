# ============================================================
# DSH plugin bundle PLUG  (canvas-workbench + dsh-codex)
# - OFFICIAL DSH (dsh-desktop.exe): installs both plugins into the
#   web profile via the official CLI (dsh plugin --profile web add).
#   dsh-codex is auto-installed when missing (registry first,
#   offline copy as fallback).
# - LEGACY CUSTOM SHELL (DeepSeek Harness.exe): restores the canvas
#   ecosystem plugin (body + declaration + link) and installs
#   dsh-codex into the web profile ONLY if missing (offline copy).
# - Idempotent: safe to run repeatedly
# Usage: dsh-plug (npm) or double-click plug-plugins.bat
# ============================================================
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$script:Failed = $false
$pkgRoot = if ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path } else { (Get-Location).Path }

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

# --- 0. detect environment: official runtime vs legacy custom shell ---
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
  # OFFICIAL DSH FLOW - everything goes through the official CLI
  # ============================================================
  Write-Output "Official DSH runtime detected: $($official.BinJs)"
  $profDir = Join-Path $env:USERPROFILE '.dsh\profiles\web'
  $profPkg = Join-Path $profDir 'package.json'
  if (-not (Test-Path -LiteralPath $profPkg)) {
    Fail 'web profile not found. Launch official DSH once (it creates the profile), then run plug again.'
  }
  else {
    $env:PATH = "$($official.NodeDir);$env:PATH"
    if (-not $env:npm_config_registry) { $env:npm_config_registry = 'https://registry.npmmirror.com' }
    $dshNode = $official.Node
    $dshBin  = $official.BinJs

    # ---- canvas plugin ----
    $cwInstalled = Test-Path -LiteralPath (Join-Path $profDir 'node_modules\dsh-canvas-workbench\package.json')
    if ($cwInstalled) {
      Skip 'canvas plugin already installed'
    }
    else {
      $tgz = Get-ChildItem -LiteralPath $pkgRoot -Filter 'dsh-canvas-workbench-*.tgz' -ErrorAction SilentlyContinue |
             Where-Object { $_.Name -notmatch 'plugin-' } | Sort-Object Name -Descending | Select-Object -First 1
      if (-not $tgz) { Fail "bundled dsh-canvas-workbench tgz not found in $pkgRoot" }
      else {
        Write-Output "Installing canvas plugin via official CLI: $($tgz.Name)"
        & $dshNode $dshBin plugin --profile web add $tgz.FullName
        if ($LASTEXITCODE -ne 0) { Fail 'canvas plugin add failed (see output above)' }
        elseif (-not (Test-Path -LiteralPath (Join-Path $profDir 'node_modules\dsh-canvas-workbench\package.json'))) {
          Fail 'canvas plugin add reported success but package is missing'
        }
        else { Ok 'canvas plugin installed (official CLI)' }
      }
    }

    # ---- self-heal: 1.5.4 tgz URL in lockfile breaks any later `plugin add` ----
    # (asset content changed under the same name -> pnpm integrity mismatch)
    if (-not $script:Failed) {
      $staleTxt = [IO.File]::ReadAllText($profPkg)
      if ($staleTxt -match 'dsh-canvas-workbench-1\.5\.4\.tgz') {
        $tgz = Get-ChildItem -LiteralPath $pkgRoot -Filter 'dsh-canvas-workbench-*.tgz' -ErrorAction SilentlyContinue |
               Where-Object { $_.Name -notmatch 'plugin-' } | Sort-Object Name -Descending | Select-Object -First 1
        if ($tgz) {
          Write-Output 'Stale 1.5.4 URL dependency detected - refreshing canvas via bundled tgz...'
          & $dshNode $dshBin plugin --profile web add $tgz.FullName
          if (($LASTEXITCODE -eq 0) -and (-not ([IO.File]::ReadAllText($profPkg) -match 'dsh-canvas-workbench-1\.5\.4\.tgz'))) {
            Ok 'canvas dependency refreshed (lockfile integrity fixed)'
          } else { Write-Output '[WARN] could not refresh stale canvas dependency automatically' }
        }
      }
    }

    # ---- dsh-codex (auto-install when missing) ----
    if (-not $script:Failed) {
      $cxInstalled = Test-Path -LiteralPath (Join-Path $profDir 'node_modules\dsh-codex\package.json')
      $ptxt = [IO.File]::ReadAllText($profPkg)
      $needDeps    = $ptxt -notmatch '"dsh-codex"\s*:'
      $needBundles = $ptxt -notmatch '"bundles"\s*:\s*\[[^\]]*"dsh-codex"'
      if ($cxInstalled -and -not $needDeps -and -not $needBundles) {
        Skip 'dsh-codex already installed'
      }
      else {
        $addOk = $false
        if (-not $cxInstalled) {
          Write-Output 'Installing dsh-codex via official CLI (npmmirror registry)...'
          & $dshNode $dshBin plugin --profile web add 'dsh-codex'
          if (($LASTEXITCODE -eq 0) -and (Test-Path -LiteralPath (Join-Path $profDir 'node_modules\dsh-codex\package.json'))) {
            $addOk = $true; Ok 'dsh-codex installed (official CLI)'
          }
          else { Write-Output '[WARN] registry install failed - falling back to offline copy' }
        }
        if (-not $addOk) {
          # offline fallback: pure tar copy (dsh-codex has zero runtime deps), then register
          $codexTgz = Get-ChildItem -LiteralPath $pkgRoot -Filter 'dsh-codex-*.tgz' -ErrorAction SilentlyContinue | Select-Object -First 1
          if (-not $codexTgz) { Fail "dsh-codex tgz not found in $pkgRoot (offline fallback unavailable)" }
          else {
            $tar = Join-Path $env:WinDir 'System32\tar.exe'
            if (-not (Test-Path -LiteralPath $tar)) { Fail 'Windows tar.exe not found' }
            else {
              $tmp2 = Join-Path $env:TEMP 'dsh-plug-tmp2'
              if (Test-Path -LiteralPath $tmp2) { Remove-Item -LiteralPath $tmp2 -Recurse -Force }
              New-Item -ItemType Directory -Force -Path $tmp2 | Out-Null
              & $tar -xzf $codexTgz.FullName -C $tmp2
              if ($LASTEXITCODE -ne 0) { Fail 'dsh-codex tgz extraction failed' }
              else {
                $cxTarget = Join-Path $profDir 'node_modules\dsh-codex'
                if (Test-Path -LiteralPath $cxTarget) { Remove-Item -LiteralPath $cxTarget -Recurse -Force }
                Move-Item -LiteralPath (Join-Path $tmp2 'package') -Destination $cxTarget
                Remove-Item -LiteralPath $tmp2 -Recurse -Force -ErrorAction SilentlyContinue
                Ok "dsh-codex installed (offline copy) -> $cxTarget"
              }
            }
          }
        }
        if ((-not $script:Failed) -and ((Test-Path -LiteralPath (Join-Path $profDir 'node_modules\dsh-codex\package.json')))) {
          # ensure registration (independent of install method)
          $ptxt = [IO.File]::ReadAllText($profPkg)
          $dirty = $false
          if ($ptxt -notmatch '"dsh-codex"\s*:') {
            $new = [regex]::Replace($ptxt, '("dependencies"\s*:\s*\{)\s*(\})', ('$1' + "`r`n" + '    "dsh-codex": "^0.2.6"' + "`r`n" + '  $2'))
            if ($new -eq $ptxt) { $new = [regex]::Replace($ptxt, '("dependencies"\s*:\s*\{)', ('$1' + "`r`n" + '    "dsh-codex": "^0.2.6",')) }
            if ($new -ne $ptxt) { $ptxt = $new; $dirty = $true }
          }
          if ($ptxt -notmatch '"bundles"\s*:\s*\[[^\]]*"dsh-codex"') {
            $new = [regex]::Replace($ptxt, '("bundles"\s*:\s*\[)', ('$1' + "`r`n" + '        "dsh-codex",'))
            if ($new -ne $ptxt) { $ptxt = $new; $dirty = $true }
          }
          if ($dirty) {
            [IO.File]::WriteAllText($profPkg, $ptxt, (New-Object System.Text.UTF8Encoding($false)))
            try {
              Get-Content -LiteralPath $profPkg -Raw | ConvertFrom-Json | Out-Null
              Ok 'dsh-codex registered in web profile (dependencies + bundles)'
            } catch { Fail "profile package.json became invalid JSON: $($_.Exception.Message)" }
          } else { Skip 'dsh-codex registration already present' }
        }
      }
    }
  }
}
else {
  # ============================================================
  # LEGACY CUSTOM SHELL FLOW (DeepSeek Harness.exe)
  # ============================================================
  # --- 1. locate DSH app root ---
  $appRoot = Find-AppRoot
  if (-not $appRoot) { Fail 'DSH installation not found (no DeepSeek Harness.exe). Install DSH first.' }
  else {
    Write-Output "DSH app root: $appRoot"
    $tar = Join-Path $env:WinDir 'System32\tar.exe'
    if (-not (Test-Path -LiteralPath $tar)) { Fail 'Windows built-in tar.exe not found (need Win10 1803+).' }
    else {
      $utf8NoBom = New-Object System.Text.UTF8Encoding($false)

      # --- 2. canvas-workbench (ecosystem plugin) ---
      $canvasTgz = Get-ChildItem -LiteralPath $pkgRoot -Filter 'dsh-canvas-workbench-plugin-*.tgz' -ErrorAction SilentlyContinue | Select-Object -First 1
      if (-not $canvasTgz) { Fail "canvas plugin tgz not found in $pkgRoot" }
      else {
        $appRes   = Join-Path $appRoot 'resources\app'
        $cwTarget = Join-Path $appRes 'node_modules\@local\canvas-workbench'
        $appPkgJs = Join-Path $appRes 'package.json'

        if (Test-Path -LiteralPath (Join-Path $cwTarget 'package.json')) {
          Skip 'canvas plugin body already present'
          # ensure the login-popup fix is applied even on a stock (official) install
          $clientJs = Join-Path $cwTarget 'lib\client.js'
          if (Test-Path -LiteralPath $clientJs) {
            $cj = [IO.File]::ReadAllText($clientJs)
            if ($cj.Contains('window.open(result.data.url')) {
              Skip 'login-popup fix already applied'
            } elseif (-not $cj.Contains("window.open('about:blank', '_blank')")) {
              Write-Output '[WARN] canvas client.js layout unknown (different version?) - login fix NOT applied'
            } else {
              Copy-Item -LiteralPath $clientJs -Destination ($clientJs + '.bak-loginfix') -Force
              $cj = $cj.Replace("        const popup = window.open('about:blank', '_blank');`r`n        if (popup) popup.opener = null;`r`n        setImageSettingsBusy(true);", '        setImageSettingsBusy(true);')
              $cj = $cj.Replace("            if (!popup) throw new Error('浏览器阻止了登录窗口，请允许 DSH 弹出窗口后重试');`r`n            popup.location.replace(result.data.url);", "            window.open(result.data.url, '_blank');")
              $cj = $cj.Replace('.catch((err) => { if (popup) popup.close(); setImageSettings', '.catch((err) => { setImageSettings')
              if ($cj.Contains('window.open(result.data.url')) {
                [IO.File]::WriteAllText($clientJs, $cj, (New-Object System.Text.UTF8Encoding($false)))
                Ok 'login-popup fix applied to existing canvas body (backup: client.js.bak-loginfix)'
              } else {
                Copy-Item -LiteralPath ($clientJs + '.bak-loginfix') -Destination $clientJs -Force
                Write-Output '[WARN] login fix did not match - client.js restored from backup'
              }
            }
          }
        } else {
          $tmp = Join-Path $env:LOCALAPPDATA 'DSH\plug-tmp'
          if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force }
          New-Item -ItemType Directory -Force -Path $tmp | Out-Null
          & $tar -xzf $canvasTgz.FullName -C $tmp
          if ($LASTEXITCODE -ne 0) { Fail 'canvas tgz extraction failed' }
          else {
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $cwTarget) | Out-Null
            Move-Item -LiteralPath (Join-Path $tmp 'package') -Destination $cwTarget
            Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
            Ok "canvas plugin installed -> $cwTarget"
          }
        }

        if (-not $script:Failed) {
          # junction link (re-created by DSH at startup, but create it if missing)
          $jn = Join-Path $env:USERPROFILE '.dsh\electron\node_modules\@local\canvas-workbench'
          if (-not (Test-Path -LiteralPath $jn)) {
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $jn) | Out-Null
            New-Item -ItemType Junction -Path $jn -Target $cwTarget -ErrorAction SilentlyContinue | Out-Null
            if (Test-Path -LiteralPath $jn) { Ok 'canvas junction link created' }
            else { Write-Output '[WARN] junction creation failed (DSH will re-link at next startup)' }
          } else { Skip 'canvas junction link already present' }

          # declaration in app package.json
          $decl = '"@local/canvas-workbench"'
          $txt = [IO.File]::ReadAllText($appPkgJs)
          if ($txt.Contains($decl)) { Skip 'canvas declaration already present' }
          else {
            $new = [regex]::Replace($txt, '("ecosystemPlugins"\s*:\s*\[)', ('$1' + "`r`n" + '        ' + $decl + ','))
            if ($new -eq $txt) { Fail 'failed to patch ecosystemPlugins (pattern not found)' }
            else {
              [IO.File]::WriteAllText($appPkgJs, $new, $utf8NoBom)
              Ok 'canvas declaration added to app package.json'
            }
          }
        }

        # --- 3. dsh-codex (profile plugin, offline copy install) ---
        if (-not $script:Failed) {
          $codexTgz = Get-ChildItem -LiteralPath $pkgRoot -Filter 'dsh-codex-*.tgz' | Select-Object -First 1
          if (-not $codexTgz) { Fail "dsh-codex tgz not found in $pkgRoot" }
          else {
            $profDir = Join-Path $env:USERPROFILE '.dsh\profiles\web'
            $profPkg = Join-Path $profDir 'package.json'
            if (-not (Test-Path -LiteralPath $profPkg)) {
              Write-Output '[WARN] web profile not found (run DSH once first). Run plug again after first launch.'
            } else {
              $cxInstalled = Test-Path -LiteralPath (Join-Path $profDir 'node_modules\dsh-codex\package.json')
              $ptxt = [IO.File]::ReadAllText($profPkg)
              $needDeps    = $ptxt -notmatch '"dsh-codex"\s*:'
              $needBundles = $ptxt -notmatch '"bundles"\s*:\s*\[[^\]]*"dsh-codex"'
              if ($cxInstalled -and -not $needDeps -and -not $needBundles) {
                Skip 'dsh-codex already installed'
              } else {
                if (-not $cxInstalled) {
                  $cxTarget = Join-Path $profDir 'node_modules\dsh-codex'
                  $tmp2 = Join-Path $env:LOCALAPPDATA 'DSH\plug-tmp2'
                  if (Test-Path -LiteralPath $tmp2) { Remove-Item -LiteralPath $tmp2 -Recurse -Force }
                  New-Item -ItemType Directory -Force -Path $tmp2 | Out-Null
                  & $tar -xzf $codexTgz.FullName -C $tmp2
                  if ($LASTEXITCODE -ne 0) { Fail 'dsh-codex tgz extraction failed' }
                  else {
                    if (Test-Path -LiteralPath $cxTarget) { Remove-Item -LiteralPath $cxTarget -Recurse -Force }
                    Move-Item -LiteralPath (Join-Path $tmp2 'package') -Destination $cxTarget
                    Remove-Item -LiteralPath $tmp2 -Recurse -Force -ErrorAction SilentlyContinue
                    Ok "dsh-codex installed (offline copy) -> $cxTarget"
                  }
                }
                if (-not $script:Failed) {
                  # register in profile package.json: dependencies + bundles (independent checks)
                  $ptxt = [IO.File]::ReadAllText($profPkg)
                  if ($needDeps) {
                    # empty object: insert without trailing comma; non-empty: insert as first entry with comma
                    $new = [regex]::Replace($ptxt, '("dependencies"\s*:\s*\{)\s*(\})', ('$1' + "`r`n" + '    "dsh-codex": "0.2.6"' + "`r`n" + '  $2'))
                    if ($new -eq $ptxt) {
                      $new = [regex]::Replace($ptxt, '("dependencies"\s*:\s*\{)', ('$1' + "`r`n" + '    "dsh-codex": "0.2.6",'))
                    }
                    if ($new -eq $ptxt) { Fail 'failed to patch profile dependencies' } else { $ptxt = $new }
                  }
                  if ((-not $script:Failed) -and $needBundles) {
                    $new = [regex]::Replace($ptxt, '("bundles"\s*:\s*\[)', ('$1' + "`r`n" + '        "dsh-codex",'))
                    if ($new -eq $ptxt) { Fail 'failed to patch profile bundles' } else { $ptxt = $new }
                  }
                  if (-not $script:Failed) {
                    [IO.File]::WriteAllText($profPkg, $ptxt, $utf8NoBom)
                    try {
                      Get-Content -LiteralPath $profPkg -Raw | ConvertFrom-Json | Out-Null
                      Ok 'dsh-codex registered in web profile (dependencies + bundles)'
                    } catch { Fail "profile package.json became invalid JSON: $($_.Exception.Message)" }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}

Write-Output ''
if ($script:Failed) { Write-Output 'PLUG FAILED - see [X] lines above.' }
else { Write-Output 'PLUG DONE. Start DSH and verify: canvas entry back + image engine shows codex route.' }
