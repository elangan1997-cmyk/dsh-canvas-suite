import { homedir, platform } from 'node:os';
import { isAbsolute, join, win32 } from 'node:path';

export const platformName = platform();
export const isWindows = platformName === 'win32';
export const isMac = platformName === 'darwin';

export function userHome() {
  return homedir() || process.env.USERPROFILE || process.env.HOME || process.cwd();
}

export function expandUserPath(value) {
  const input = String(value || '').trim();
  if (input === '~') return userHome();
  if (/^~[\\/]/.test(input)) return join(userHome(), input.slice(2));
  return input;
}

export function isAbsolutePath(value) {
  const expanded = expandUserPath(value);
  return isAbsolute(expanded) || win32.isAbsolute(expanded);
}

async function resolveFirst(ctx, names) {
  for (const name of names) {
    try {
      const executable = await ctx.subprocess.resolveExecutable(name);
      if (executable) return executable;
    } catch {}
  }
  return '';
}

export async function resolvePython(ctx) {
  const managed = isWindows
    ? join(userHome(), '.dsh', 'canvas-workbench', 'python-runtime', 'Scripts', 'python.exe')
    : join(userHome(), '.dsh', 'canvas-workbench', 'python-runtime', 'bin', 'python');
  try {
    const { access } = await import('node:fs/promises');
    await access(managed);
    return { executable: managed, prefixArgs: [], managed: true };
  } catch {}
  const executable = await resolveFirst(ctx, isWindows ? ['python.exe', 'python', 'py.exe', 'py'] : ['python3', 'python']);
  if (!executable) throw new Error(isWindows
    ? '未检测到 Python。基础画布仍可使用；本地去背景、OCR、PSD 和转矢量需要先安装 Python 3.11。'
    : '未检测到 Python 3');
  const lower = executable.toLowerCase();
  return { executable, prefixArgs: isWindows && /(^|[\\/])py(?:\.exe)?$/.test(lower) ? ['-3'] : [], managed: false };
}

export async function pickFolder(ctx, runProcess, prompt = '选择画布项目文件夹') {
  if (isWindows) {
    const powershell = await resolveFirst(ctx, ['powershell.exe', 'powershell']);
    if (!powershell) throw new Error('未找到 Windows PowerShell，无法打开文件夹选择器');
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
      '$dialog.Description = $args[0]',
      '$dialog.ShowNewFolderButton = $true',
      'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::OutputEncoding = [Text.UTF8Encoding]::UTF8; Write-Output $dialog.SelectedPath; exit 0 }',
      'exit 2'
    ].join('; ');
    const result = await runProcess(powershell, ['-NoLogo', '-NoProfile', '-STA', '-Command', script, prompt], userHome());
    if (result.exitCode !== 0 || !result.stdout.trim()) throw new Error('已取消选择文件夹');
    return result.stdout.trim().replace(/[\\/]+$/, '');
  }
  if (isMac) {
    const osascript = await resolveFirst(ctx, ['osascript']);
    const result = await runProcess(osascript, ['-e', 'tell application "Finder" to activate', '-e', 'POSIX path of (choose folder with prompt ' + JSON.stringify(prompt) + ')'], userHome());
    if (result.exitCode !== 0 || !result.stdout.trim()) throw new Error('已取消选择文件夹');
    return result.stdout.trim().replace(/[\\/]+$/, '');
  }
  throw new Error('当前系统暂不支持原生文件夹选择器，请粘贴项目路径');
}

/**
 * Open a native executable picker.  The selected path is returned as-is and
 * is persisted by the canvas settings endpoint; cancelling is represented by
 * an empty string so the caller can keep the dialog open without an error.
 */
export async function openFolder(ctx, runProcess, path) {
  if (isWindows) {
    // Invoke-Item passes the path to the Windows shell as one literal value.
    // Start-Process -ArgumentList rebuilds a command line and can split paths
    // containing spaces/non-ASCII characters, which makes Explorer fall back
    // to the user's Documents folder.
    const powershell = await resolveFirst(ctx, ['powershell.exe', 'powershell']);
    const literalPath = "'" + String(path || '').replace(/'/g, "''") + "'";
    if (powershell) {
      const script = 'Invoke-Item -LiteralPath ' + literalPath;
      return runProcess(powershell, ['-NoLogo', '-NoProfile', '-Command', script], path);
    }
    const explorer = await resolveFirst(ctx, ['explorer.exe', 'explorer']);
    if (!explorer) throw new Error('未找到 Windows 资源管理器');
    return runProcess(explorer, [path], path);
  }
  if (isMac) {
    const opener = await resolveFirst(ctx, ['open']);
    return runProcess(opener, [path], path);
  }
  const opener = await resolveFirst(ctx, ['xdg-open']);
  if (!opener) throw new Error('未找到系统文件管理器');
  return runProcess(opener, [path], path);
}

export async function revealFile(ctx, runProcess, path, cwd) {
  if (isWindows) {
    const powershell = await resolveFirst(ctx, ['powershell.exe', 'powershell']);
    const literalPath = "'/select," + String(path || '').replace(/'/g, "''") + "'";
    if (powershell) {
      const script = 'Start-Process -FilePath \'explorer.exe\' -ArgumentList @(' + literalPath + ')';
      return runProcess(powershell, ['-NoLogo', '-NoProfile', '-Command', script], cwd);
    }
    const explorer = await resolveFirst(ctx, ['explorer.exe', 'explorer']);
    if (!explorer) throw new Error('未找到 Windows 资源管理器');
    // `/select,` and the target must remain one argv item; Explorer does not
    // parse the two-item form reliably on Windows.
    return runProcess(explorer, ['/select,' + path], cwd);
  }
  if (isMac) {
    const opener = await resolveFirst(ctx, ['open']);
    return runProcess(opener, ['-R', path], cwd);
  }
  return openFolder(ctx, runProcess, cwd);
}

export async function openWithSystem(ctx, runProcess, path, cwd, executable = '') {
  if (isWindows) {
    const powershell = await resolveFirst(ctx, ['powershell.exe', 'powershell']);
    if (!powershell) throw new Error('未找到 Windows PowerShell');
    // PowerShell -Command 后追加的 argv 在受限子进程中不会稳定进入
    // $args，表现为“文件已经打开但接口返回 FilePath 为 Null”。把路径
    // 作为字面量写入脚本，避免变量绑定和特殊字符解析竞态。
    const literal = "'" + String(path || '').replace(/'/g, "''") + "'";
    const executableLiteral = String(executable || '').trim()
      ? "'" + String(executable).replace(/'/g, "''") + "'"
      : '';
    // Windows PowerShell 5.1 没有 Start-Process -LiteralPath 参数；
    // -FilePath 配合单引号字面量同样能安全处理空格、中文和盘符路径。
    // When a manually selected Adobe executable is supplied, pass the source
    // file explicitly so Windows file associations cannot route it to another
    // installed version.  Without an executable we retain the normal system
    // association behavior used by the other “open” actions.
    const script = executableLiteral
      ? 'Start-Process -FilePath ' + executableLiteral + ' -ArgumentList @(' + literal + ')'
      : 'Start-Process -FilePath ' + literal;
    return runProcess(powershell, ['-NoLogo', '-NoProfile', '-Command', script], cwd);
  }
  if (isMac) {
    const opener = await resolveFirst(ctx, ['open']);
    // `open -a` accepts either an application name or an absolute .app path,
    // allowing macOS users to pin a particular Adobe release as well.
    return runProcess(opener, executable ? ['-a', executable, path] : [path], cwd);
  }
  const opener = await resolveFirst(ctx, ['xdg-open']);
  if (!opener) throw new Error('未找到系统打开程序');
  return runProcess(opener, [path], cwd);
}

export function platformCapabilities() {
  return {
    platform: platformName,
    windows: isWindows,
    macOS: isMac,
    nativeFolderPicker: isWindows || isMac,
    revealFile: true,
      adobeNativeTextLayers: isMac || isWindows,
    adobeOpenByFileAssociation: isWindows,
    localPythonFeatures: 'requires-python'
  };
}
