param(
  [Parameter(Mandatory = $true)]
  [string]$AppRoot
)

$ErrorActionPreference = 'Stop'
$libRoot = Join-Path $AppRoot 'resources\app\lib'
$mainPath = Join-Path $libRoot 'main.js'
$modulePath = Join-Path $PSScriptRoot 'launcher-startup-diagnostics.mjs'
if (-not (Test-Path -LiteralPath $mainPath)) { throw "未找到 Launcher 主文件：$mainPath" }
if (-not (Test-Path -LiteralPath $modulePath)) { throw "未找到启动诊断模块：$modulePath" }
New-Item -ItemType Directory -Force -Path $libRoot | Out-Null
Copy-Item -LiteralPath $modulePath -Destination (Join-Path $libRoot 'launcher-startup-diagnostics.mjs') -Force

$source = Get-Content -LiteralPath $mainPath -Raw -Encoding UTF8
if ($source.Contains('DSH_STARTUP_DIAGNOSTICS_V1')) {
  Write-Output "Launcher 启动诊断已存在：$mainPath"
  exit 0
}

$source = $source.Replace(
  "import { app, BrowserWindow, dialog, Menu, nativeImage, nativeTheme, screen, session, Tray, } from 'electron';",
  "import { app, BrowserWindow, dialog, Menu, nativeImage, nativeTheme, screen, session, shell, Tray, } from 'electron';"
)
$source = $source.Replace(
  'import { createUpdater } from "./updater.js";',
  'import { createUpdater } from "./updater.js";' + "`r`n" + 'import { appendStartupLog, startupFailure, startupLogPath, summarizeEnvironment, tailLines, } from "./launcher-startup-diagnostics.mjs";' + "`r`n" + '// DSH_STARTUP_DIAGNOSTICS_V1'
)
$start = $source.IndexOf('async function startHarness')
$end = $source.IndexOf('function logPlugins', $start)
if ($start -lt 0 -or $end -lt 0) { throw 'Launcher startHarness structure was not recognized; no changes made.' }
$startHarness = @'
async function startHarness(dshBin, harnessHome, hostPatch) {
    const proxyEnvironment = await harnessProxyEnvironment();
    const args = harnessArguments(dshBin, hostPatch);
    const cwd = app.getPath('home');
    const env = {
        ...process.env,
        ...proxyEnvironment,
        DSH_HOME: harnessHome,
        ELECTRON_RUN_AS_NODE: '1',
    };
    const resources = {
        executable: { path: process.execPath, exists: existsSync(process.execPath) },
        dshBin: { path: dshBin, exists: existsSync(dshBin) },
        hostPatch: hostPatch === undefined ? null : { path: hostPatch, exists: existsSync(hostPatch) },
        harnessHome: { path: harnessHome, exists: existsSync(harnessHome) },
    };
    const logPath = startupLogPath(env);
    appendStartupLog('spawn', {
        executable: process.execPath,
        args,
        cwd,
        env: summarizeEnvironment(env),
        resources,
    }, env);
    let child;
    try {
        child = spawn(process.execPath, args, {
            cwd,
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
    }
    catch (error) {
        const spawnError = { name: error instanceof Error ? error.name : 'Error', message: String(error), stack: error instanceof Error ? error.stack : undefined };
        appendStartupLog('spawn-error', { executable: process.execPath, args, cwd, env: summarizeEnvironment(env), resources, spawnError }, env);
        throw startupFailure(`DeepSeek Harness spawn failed: ${spawnError.message}`, {
            executable: process.execPath,
            args,
            cwd,
            env: summarizeEnvironment(env),
            resources,
            stdout: '',
            stderr: '',
            exitCode: null,
            signal: null,
            spawnError,
            stderrTail: '',
            logPath,
        });
    }
    return await new Promise((resolve, reject) => {
        let output = '';
        let stderr = '';
        let settled = false;
        let ready = false;
        const describeError = (error) => ({
            name: error instanceof Error ? error.name : 'Error',
            message: String(error),
            stack: error instanceof Error ? error.stack : undefined,
        });
        const currentDetails = (extra = {}) => ({
            executable: process.execPath,
            args,
            cwd,
            env: summarizeEnvironment(env),
            resources,
            stdout: output,
            stderr,
            exitCode: child.exitCode,
            signal: child.signalCode,
            logPath,
            ...extra,
            stderrTail: tailLines(extra.stderr ?? stderr, 10),
        });
        const timer = setTimeout(() => {
            if (settled || ready)
                return;
            const timeoutMessage = `DeepSeek Harness did not become ready within ${String(HARNESS_START_TIMEOUT_MS / 1000)} seconds.`;
            appendStartupLog('timeout', currentDetails(), env);
            void stopHarness(child).then(() => {
                if (settled)
                    return;
                settled = true;
                const details = currentDetails({ reason: 'startup-timeout' });
                appendStartupLog('failure', details, env);
                reject(startupFailure(`${timeoutMessage}\n\nstderr (last 10 lines):\n${details.stderrTail}\n\n日志：${logPath}`, details));
            }, (cleanupError) => {
                if (settled)
                    return;
                settled = true;
                const details = currentDetails({ reason: 'startup-timeout', cleanupError: describeError(cleanupError) });
                appendStartupLog('failure', details, env);
                reject(startupFailure(`${timeoutMessage}\n\n清理 Harness 进程失败：${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}\n\nstderr (last 10 lines):\n${details.stderrTail}\n\n日志：${logPath}`, details));
            });
        }, HARNESS_START_TIMEOUT_MS);
        const fail = (message, extra = {}) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            const details = currentDetails(extra);
            appendStartupLog('failure', details, env);
            reject(startupFailure(`${message}\n\nstderr (last 10 lines):\n${details.stderrTail}\n\n日志：${logPath}`, details));
        };
        child.once('error', (error) => {
            const details = currentDetails({ spawnError: describeError(error) });
            appendStartupLog('spawn-error', details, env);
            fail(`DeepSeek Harness spawn error: ${error instanceof Error ? error.message : String(error)}`, { spawnError: details.spawnError });
        });
        child.once('close', (code, signal) => {
            const details = currentDetails({ exitCode: code, signal });
            appendStartupLog('close', details, env);
            if (!ready) {
                fail(`DeepSeek Harness exited before startup (code ${String(code)}, signal ${String(signal)}).`, { exitCode: code, signal });
            }
        });
        child.stdout.on('data', (chunk) => {
            const text = chunk.toString('utf8');
            process.stdout.write(text);
            output += text;
            appendStartupLog('stdout', { chunk: text }, env);
            const url = parseHarnessReadyUrl(output);
            if (url === undefined || settled)
                return;
            ready = true;
            settled = true;
            clearTimeout(timer);
            appendStartupLog('ready', { url }, env);
            resolve({ child, url });
        });
        child.stderr.on('data', (chunk) => {
            const text = chunk.toString('utf8');
            process.stderr.write(text);
            stderr += text;
            appendStartupLog('stderr', { chunk: text }, env);
        });
    });
}
'@
$source = $source.Substring(0, $start) + $startHarness + $source.Substring($end)
$catchOld = @'
    }).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        dialog.showErrorBox(`${app.name} failed to start`, message);
        requestQuit();
    });
'@
$catchNew = @'
    }).catch(async (error) => {
        const message = error instanceof Error ? error.message : String(error);
        const details = error?.startupDetails;
        if (details !== undefined) {
            const logPath = details.logPath ?? startupLogPath();
            const stderrTail = details.stderrTail ?? tailLines(details.stderr ?? '', 10) ?? '(empty)';
            const result = await dialog.showMessageBox({
                type: 'error',
                title: `${app.name} failed to start`,
                message: 'DeepSeek Harness failed to start',
                detail: `${message}\n\nexecutable: ${String(details.executable ?? '')}\nargs: ${JSON.stringify(details.args ?? [])}\ncwd: ${String(details.cwd ?? '')}\n\nstderr (last 10 lines):\n${stderrTail || '(empty)'}\n\n日志：${logPath}`,
                buttons: ['打开启动日志', '关闭'],
                defaultId: 0,
                cancelId: 1,
                noLink: true,
            });
            if (result.response === 0)
                void shell.openPath(logPath);
        }
        else {
            dialog.showErrorBox(`${app.name} failed to start`, message);
        }
        requestQuit();
    });
'@
if (-not $source.Contains($catchOld)) { throw 'Launcher startup dialog structure was not recognized; no changes made.' }
$source = $source.Replace($catchOld, $catchNew)
[IO.File]::WriteAllText($mainPath, $source, [Text.UTF8Encoding]::new($false))
Write-Output "已安装 Launcher 启动诊断：$mainPath"
