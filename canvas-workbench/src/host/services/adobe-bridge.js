// Adobe 桥接 Host 服务：握手文件、收件清单校验、发件箱写入、出处解析、脚本安装、日志。
// 协议契约见 adobe-bridge/PROTOCOL.md；纯函数在 ../../shared/utils/adobe-bridge.js（有单测）。
// 本文件只做文件系统 I/O，不依赖 DSH ctx（便于 tests/unit 用临时目录直接测）。
import { access, appendFile, copyFile, mkdir, readdir, readFile, rename, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { isWindows, platformName, userHome } from '../../../lib/platform.js';
import {
  ADOBE_BRIDGE_APPS, ADOBE_BRIDGE_DIR, ADOBE_BRIDGE_INBOX, ADOBE_BRIDGE_OUTBOX, ADOBE_BRIDGE_PROTOCOL,
  bridgeExtOf, buildOutboundManifest, isPendingBridgeManifest, isReturnableBridgeFile, nextOutboxSeq, outboxFileName, validateInboundManifest
} from '../../shared/utils/adobe-bridge.js';

const HANDSHAKE_FILE = 'bridge.json';
const LOG_FILE = 'bridge-log.jsonl';
const INSTALLED_FILE = 'scripts-installed.json';
const SCRIPT_FILES = ['dsh-bridge-core.jsx', 'DSH画布桥接-Photoshop.jsx', 'DSH画布桥接-Illustrator.jsx'];
// 心跳：客户端 3s 一次 activate；握手文件最多 20s 重写一次（项目变化时立即写）。
const HANDSHAKE_REWRITE_MS = 20000;
// 收件文件写完 ≥ 1s 才算稳定（脚本用 .part+rename，这里再兜一层）。
const INBOUND_STABLE_MS = 1000;
const LOG_ROTATE_BYTES = 2 * 1024 * 1024;

function bridgeRootDir(home) {
  return join(home || userHome(), '.dsh', 'canvas-workbench', 'adobe-bridge');
}

/** 项目内桥接目录集合。 */
function bridgeDirsFor(projectDir) {
  const root = join(projectDir, ADOBE_BRIDGE_DIR);
  return {
    root,
    inbox: { photoshop: join(root, ADOBE_BRIDGE_INBOX.photoshop), illustrator: join(root, ADOBE_BRIDGE_INBOX.illustrator) },
    outbox: join(root, ADOBE_BRIDGE_OUTBOX)
  };
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writeJsonAtomic(path, value) {
  const temporary = path + '.hosttmp';
  const text = JSON.stringify(value, null, 2);
  try {
    await writeFile(temporary, text, 'utf8');
    await rename(temporary, path);
  } catch {
    await writeFile(path, text, 'utf8');
  }
}

/**
 * @param {object} options
 * @param {string} [options.pluginVersion] 不传则懒读 pluginRoot/package.json
 * @param {string} options.pluginRoot 插件根目录（找 adobe-bridge/*.jsx）
 * @param {(path: string, mtimeMs: number) => string} [options.previewUrl]
 * @param {string} [options.home] 测试注入用户目录
 * @param {(exe: string, args: string[], cwd: string, timeoutMs: number) => Promise<{exitCode:number, stdout:string, stderr:string, timedOut?:boolean}>} [options.runProcess] 远程驱动用（host 传 runProcessWithTimeout）
 * @param {(name: string) => Promise<string>} [options.resolveExecutable] 远程驱动用（host 传 ctx.subprocess.resolveExecutable）
 */
export function createAdobeBridge({ pluginVersion, pluginRoot, previewUrl, home, runProcess, resolveExecutable }) {
  const root = bridgeRootDir(home);
  const active = { projectDir: '', projectName: '', sessionId: '', at: 0, writtenAt: 0 };
  let versionCache = String(pluginVersion || '');
  const version = async () => {
    if (!versionCache) {
      try { versionCache = String(JSON.parse(await readFile(join(pluginRoot, 'package.json'), 'utf8')).version || ''); } catch { versionCache = '?'; }
    }
    return versionCache;
  };

  const log = async (event, detail) => {
    try {
      await mkdir(root, { recursive: true });
      const path = join(root, LOG_FILE);
      try { const info = await stat(path); if (info.size > LOG_ROTATE_BYTES) await rename(path, path + '.1'); } catch {}
      await appendFile(path, JSON.stringify({ at: new Date().toISOString(), event, ...(detail || {}) }) + '\n', 'utf8');
    } catch {}
  };

  /* 「已安装」= 至少装进了一个 Adobe 会扫描的目录（用户副本不算：那只是给「浏览…」用的） */
  const scriptsInstalled = async () => {
    try { const record = await readJson(join(root, INSTALLED_FILE)); return Array.isArray(record.installed) && record.installed.length > 0; } catch { return false; }
  };

  const writeHandshake = async () => {
    await mkdir(root, { recursive: true });
    const dirs = active.projectDir ? bridgeDirsFor(active.projectDir) : null;
    if (dirs) {
      await mkdir(dirs.inbox.photoshop, { recursive: true });
      await mkdir(dirs.inbox.illustrator, { recursive: true });
      await mkdir(dirs.outbox, { recursive: true });
    }
    const payload = {
      protocol: ADOBE_BRIDGE_PROTOCOL,
      plugin: 'canvas-workbench',
      pluginVersion: await version(),
      platform: platformName,
      updatedAt: Date.now(),
      canvasVisible: true,
      project: dirs ? { dir: active.projectDir, name: active.projectName || basename(active.projectDir) } : null,
      inbox: dirs ? { photoshop: dirs.inbox.photoshop, illustrator: dirs.inbox.illustrator } : null,
      outbox: dirs ? dirs.outbox : null,
      scriptsInstalled: await scriptsInstalled()
    };
    await writeJsonAtomic(join(root, HANDSHAKE_FILE), payload);
    active.writtenAt = Date.now();
    return payload;
  };

  /** 客户端心跳：项目变化立即重写握手，否则最多 20s 一次。 */
  const activate = async ({ projectDir, projectName, sessionId }) => {
    const nextDir = String(projectDir || '');
    const changed = nextDir !== active.projectDir;
    active.projectDir = nextDir;
    active.projectName = String(projectName || '');
    active.sessionId = String(sessionId || '');
    active.at = Date.now();
    if (changed || Date.now() - active.writtenAt > HANDSHAKE_REWRITE_MS) {
      const payload = await writeHandshake();
      if (changed) await log('activate', { projectDir: nextDir, sessionId: active.sessionId });
      return payload;
    }
    return null;
  };

  /** 列出某项目所有收件清单（含已处理），供出处解析。 */
  const readInboundManifests = async (projectDir, { pendingOnly } = {}) => {
    const dirs = bridgeDirsFor(projectDir);
    const found = [];
    for (const app of ADOBE_BRIDGE_APPS) {
      const directory = dirs.inbox[app];
      let entries;
      try { entries = await readdir(directory, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        if (!entry.isFile() || !/\.json$/i.test(entry.name) || entry.name.startsWith('.')) continue;
        const pending = isPendingBridgeManifest(entry.name);
        if (pendingOnly && !pending) continue;
        const manifestPath = join(directory, entry.name);
        let raw;
        try { raw = await readJson(manifestPath); } catch (err) {
          if (pending) await log('inbound-manifest-invalid', { manifestPath, error: String(err && err.message || err) });
          continue;
        }
        const checked = validateInboundManifest(raw);
        if (!checked.ok) {
          if (pending) {
            await log('inbound-manifest-rejected', { manifestPath, error: checked.error });
            await rename(manifestPath, manifestPath.replace(/\.json$/i, '.failed.json')).catch(() => {});
          }
          continue;
        }
        found.push({ app, directory, manifestPath, manifestName: entry.name, pending, manifest: raw });
      }
    }
    return found;
  };

  /** 待处理收件：校验文件存在、非空、稳定；返回客户端可直接 add-image 的 items。 */
  const listInbound = async (projectDir) => {
    const manifests = await readInboundManifests(projectDir, { pendingOnly: true });
    const results = [];
    const now = Date.now();
    for (const entry of manifests) {
      const items = [];
      let ready = true;
      for (const item of entry.manifest.items) {
        const path = join(entry.directory, item.file);
        let info;
        try { info = await stat(path); } catch { ready = false; break; }
        if (!info.isFile() || info.size <= 0 || now - info.mtimeMs < INBOUND_STABLE_MS) { ready = false; break; }
        items.push({
          path, name: item.file, kind: bridgeExtOf(item.file) || 'png', mtime: info.mtimeMs, size: info.size,
          url: previewUrl ? previewUrl(path, info.mtimeMs) : '',
          layer: item.layer || null, bounds: item.bounds || null, artboard: item.artboard || null
        });
      }
      if (!ready) continue;
      results.push({
        app: entry.app, jobId: entry.manifest.jobId, manifestName: entry.manifestName, manifestPath: entry.manifestPath,
        document: entry.manifest.document || null, merged: !!entry.manifest.merged, createdAt: Number(entry.manifest.createdAt) || 0, items
      });
    }
    return results;
  };

  /** 客户端已把收件放上画布：清单改名 .done.json（保留，供返回时查出处）。 */
  const ackInbound = async (projectDir, manifestName) => {
    const name = basename(String(manifestName || ''));
    if (!isPendingBridgeManifest(name)) throw new Error('无效的清单名：' + name);
    const dirs = bridgeDirsFor(projectDir);
    for (const app of ADOBE_BRIDGE_APPS) {
      const source = join(dirs.inbox[app], name);
      if (!(await exists(source))) continue;
      const target = source.replace(/\.json$/i, '.done.json');
      await rename(source, target);
      await log('inbound-ack', { app, manifest: name });
      return { ok: true, app, manifest: basename(target) };
    }
    throw new Error('清单不存在或已处理：' + name);
  };

  /**
   * 出处解析：bridge.jobId → 清单；否则按文件名匹配清单 items。
   * 返回 PROTOCOL §4 的 origin 结构或 null。
   */
  const resolveOrigin = async (projectDir, { jobId, sourcePath }) => {
    let manifests;
    try { manifests = await readInboundManifests(projectDir); } catch { return null; }
    const fileName = basename(String(sourcePath || ''));
    const pick = (entry, item) => ({
      app: entry.app, jobId: entry.manifest.jobId, document: entry.manifest.document || null,
      layer: item ? item.layer || null : null, bounds: item ? item.bounds || null : null, artboard: item ? item.artboard || null : null
    });
    if (jobId) {
      const entry = manifests.find((m) => m.manifest.jobId === jobId);
      if (entry) {
        const item = entry.manifest.items.find((it) => it.file === fileName) || entry.manifest.items[0];
        return pick(entry, item);
      }
    }
    if (fileName) {
      for (const entry of manifests) {
        const item = entry.manifest.items.find((it) => it.file === fileName);
        if (item) return pick(entry, item);
      }
    }
    return null;
  };

  /**
   * 写发件箱：复制文件（永不覆盖）+ 最后写清单。
   * items: [{ path, name, bridge?: { jobId } }] —— path 已由路由解析为真实文件。
   */
  const createReturn = async (projectDir, { app, items }) => {
    const targetApp = ADOBE_BRIDGE_APPS.includes(app) ? app : 'photoshop';
    const list = Array.isArray(items) ? items.filter((it) => it && it.path) : [];
    if (!list.length) throw new Error('没有可返回的文件');
    const dirs = bridgeDirsFor(projectDir);
    await mkdir(dirs.outbox, { recursive: true });
    const existing = await readdir(dirs.outbox).catch(() => []);
    const seq = nextOutboxSeq(existing);
    const files = [];
    for (const item of list) {
      const name = String(item.name || basename(item.path));
      if (!isReturnableBridgeFile(name)) throw new Error('不支持返回该类型：' + name);
      const info = await stat(item.path);
      if (!info.isFile() || info.size <= 0) throw new Error('源文件不存在或为空：' + name);
      const file = outboxFileName(seq, name, bridgeExtOf(name));
      await copyFile(item.path, join(dirs.outbox, file));
      files.push({ file, name, kind: bridgeExtOf(name) });
    }
    const first = list[0];
    const origin = await resolveOrigin(projectDir, { jobId: first.bridge && first.bridge.jobId, sourcePath: first.path });
    const manifest = buildOutboundManifest({ seq, targetApp, files, origin });
    const manifestPath = join(dirs.outbox, String(seq).padStart(4, '0') + '.json');
    await writeJsonAtomic(manifestPath, manifest);
    await log('return', { app: targetApp, seq, files: files.map((f) => f.file), origin: origin ? origin.jobId : null });
    return { outbox: dirs.outbox, seq, files, manifestPath, origin, jobId: manifest.jobId };
  };

  const recentLog = async (limit) => {
    try {
      const text = await readFile(join(root, LOG_FILE), 'utf8');
      const lines = text.trim().split('\n');
      return lines.slice(-Math.max(1, Number(limit) || 20)).map((line) => { try { return JSON.parse(line); } catch { return { raw: line }; } });
    } catch { return []; }
  };

  const status = async () => {
    let handshake = null;
    try { handshake = await readJson(join(root, HANDSHAKE_FILE)); } catch {}
    let installed = null;
    try { installed = await readJson(join(root, INSTALLED_FILE)); } catch {}
    return { root, handshakePath: join(root, HANDSHAKE_FILE), handshake, scriptsInstalled: await scriptsInstalled(), installed, active: { ...active }, recentLog: await recentLog(20), scriptFiles: SCRIPT_FILES };
  };

  /**
   * 找本机 PS/AI 的 Scripts 目录。返回 [{ app, level:'app'|'user', name, dirs:[…], presets? }]。
   *   macOS  PS：/Applications/Adobe Photoshop <年>/Presets/Scripts（root 权限）
   *              ~/Library/Application Support/Adobe/Adobe Photoshop <年>/Presets/Scripts（用户级，PS 会扫描；只列已安装的版本）
   *          AI：/Applications/Adobe Illustrator <年>/Presets.localized/<每个 locale>/Scripts（root 权限；一个版本合并为一条）
   *   Windows PS：%ProgramFiles%\Adobe\Adobe Photoshop <年>\Presets\Scripts；%APPDATA%\Adobe\Adobe Photoshop <年>\Presets\Scripts
   *          AI：%ProgramFiles%\Adobe\Adobe Illustrator <年>\Presets\<每个 locale>\Scripts
   * Illustrator 没有用户级脚本目录：装不进系统目录时用「文件 → 脚本 → 其它脚本…」指向用户副本。
   */
  const listDirs = async (directory) => {
    try { return (await readdir(directory, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort(); } catch { return []; }
  };
  const findAdobeScriptDirs = async () => {
    const found = [];
    const homeDir = home || userHome();
    const appsRoot = isWindows ? join(process.env.ProgramFiles || 'C:\\Program Files', 'Adobe') : '/Applications';
    const userRoot = isWindows ? join(process.env.APPDATA || join(homeDir, 'AppData', 'Roaming'), 'Adobe') : join(homeDir, 'Library', 'Application Support', 'Adobe');
    const installedNames = [];
    for (const entry of await listDirs(appsRoot)) {
      const appDir = join(appsRoot, entry);
      if (/^Adobe Photoshop/i.test(entry)) {
        if (!(await exists(join(appDir, 'Presets')))) continue;
        installedNames.push(entry);
        found.push({ app: 'photoshop', level: 'app', name: entry, dirs: [join(appDir, 'Presets', 'Scripts')] });
      } else if (/^Adobe Illustrator/i.test(entry)) {
        for (const presetsName of ['Presets.localized', 'Presets']) {
          const presets = join(appDir, presetsName);
          const locales = await listDirs(presets);
          if (!locales.length) continue;
          found.push({ app: 'illustrator', level: 'app', name: entry + '（' + locales.length + ' 个语言目录）', presets, dirs: locales.map((locale) => join(presets, locale, 'Scripts')) });
          break;
        }
      }
    }
    for (const entry of await listDirs(userRoot)) {
      if (!/^Adobe Photoshop/i.test(entry) || !installedNames.includes(entry)) continue;
      found.push({ app: 'photoshop', level: 'user', name: entry + '（用户级）', dirs: [join(userRoot, entry, 'Presets', 'Scripts')] });
    }
    return found;
  };

  /**
   * 安装：① 永远先复制一份用户副本到 <桥接根>/scripts/（供「浏览 / 其它脚本…」与 sudo 命令使用）；
   * ② 再尝试每个 Adobe 目录，权限不足的给出可直接执行的命令。host 路由与 CLI 共用。
   */
  const installScripts = async () => {
    const sourceDir = join(pluginRoot, 'adobe-bridge');
    for (const file of SCRIPT_FILES) if (!(await exists(join(sourceDir, file)))) throw new Error('插件缺少脚本文件：' + file);
    const userCopyDir = join(root, 'scripts');
    await mkdir(userCopyDir, { recursive: true });
    for (const file of SCRIPT_FILES) await copyFile(join(sourceDir, file), join(userCopyDir, file));
    const targets = await findAdobeScriptDirs();
    const installed = [];
    const errors = [];
    const allScriptsPresent = async (dir) => {
      for (const file of SCRIPT_FILES) { try { await access(join(dir, file)); } catch { return false; } }
      return true;
    };
    const sudoHint = (target) => {
      if (isWindows) return '以管理员身份运行：node scripts/install-adobe-bridge.mjs，或手动把 ' + userCopyDir + ' 下三个 .jsx 复制到 ' + target.dirs[0];
      if (target.presets) return "终端执行：sudo sh -c 'for d in \"" + target.presets + "\"/*/; do mkdir -p \"$d/Scripts\" && cp \"" + userCopyDir + "/\"*.jsx \"$d/Scripts/\"; done'";
      return '终端执行：sudo cp "' + userCopyDir + '/"*.jsx "' + target.dirs[0] + '/"';
    };
    for (const target of targets) {
      const done = [];
      let failure = null;
      for (const dir of target.dirs) {
        try {
          await mkdir(dir, { recursive: true });
          await access(dir, fsConstants.W_OK);
          for (const file of SCRIPT_FILES) await copyFile(join(sourceDir, file), join(dir, file));
          done.push(dir);
        } catch (err) {
          // 目录不可写但三个脚本已在（之前用管理员装过）→ 视为已安装，不算失败
          if (await allScriptsPresent(dir)) { done.push(dir); continue; }
          failure = err;
        }
      }
      if (done.length) installed.push({ app: target.app, level: target.level, name: target.name, dir: done[0], dirs: done });
      if (failure) {
        const denied = failure.code === 'EACCES' || failure.code === 'EPERM';
        errors.push({ app: target.app, level: target.level, name: target.name, dir: target.dirs[0], error: denied ? '没有写入权限' : String(failure.message || failure), hint: denied ? sudoHint(target) : '' });
      }
    }
    const manualHint = 'Photoshop：文件 → 脚本 → 浏览… ；Illustrator：文件 → 脚本 → 其它脚本… ，选择 ' + userCopyDir + ' 下对应的 .jsx';
    const record = { version: await version(), installedAt: new Date().toISOString(), platform: platformName, files: SCRIPT_FILES, userCopyDir, installed, errors };
    await writeJsonAtomic(join(root, INSTALLED_FILE), record);
    await log('install-scripts', { installed: installed.map((i) => i.dirs), errors: errors.map((e) => e.dir) });
    if (!targets.length) errors.push({ app: '', level: '', name: '', dir: '', error: '未找到已安装的 Photoshop / Illustrator', hint: manualHint });
    return { installed, errors, sourceDir, userCopyDir, manualHint, scriptFiles: SCRIPT_FILES };
  };

  /* ===================== 远程驱动（DSH → Adobe，用户不必打开面板） =====================
     原理：面板脚本支持无头模式（$.global.DSH_BRIDGE_HEADLESS=true 时只挂 DSH_BRIDGE.ps/.ai 函数），
     host 写一段驾驭脚本 → macOS 用 osascript `do javascript`（只接受文本，所以脚本里 $.evalFile 绝对路径）、
     Windows 用 PowerShell COM `DoJavaScriptFile` → 解析 "OK:<值>" / "ERR:<消息>"。
     依赖 createAdobeBridge({ runProcess, resolveExecutable })；测试环境不传则报「当前环境不支持」。 */
  const APP_BUNDLE = { photoshop: 'com.adobe.Photoshop', illustrator: 'com.adobe.Illustrator' };
  const APP_COM = { photoshop: 'Photoshop.Application', illustrator: 'Illustrator.Application' };
  const APP_SCRIPT = { photoshop: 'DSH画布桥接-Photoshop.jsx', illustrator: 'DSH画布桥接-Illustrator.jsx' };
  const APP_LABEL = { photoshop: 'Photoshop', illustrator: 'Illustrator' };
  const remoteWorkDir = () => join(tmpdir(), 'dsh-canvas-bridge');

  /** 用户副本永远与插件内脚本同步（远程驱动从这里 evalFile，面板「浏览…」也用它） */
  const ensureUserCopy = async () => {
    const sourceDir = join(pluginRoot, 'adobe-bridge');
    const userCopyDir = join(root, 'scripts');
    await mkdir(userCopyDir, { recursive: true });
    for (const file of SCRIPT_FILES) {
      const source = join(sourceDir, file);
      const target = join(userCopyDir, file);
      let same = false;
      try { const [a, b] = await Promise.all([stat(source), stat(target)]); same = a.size === b.size && Math.abs(a.mtimeMs - b.mtimeMs) < 1; } catch {}
      if (!same) { await copyFile(source, target); try { const info = await stat(source); await utimes(target, info.atime, info.mtime); } catch {} }
    }
    return userCopyDir;
  };

  const requireRemote = () => {
    if (typeof runProcess !== 'function' || typeof resolveExecutable !== 'function') throw new Error('当前环境不支持远程驱动 Adobe');
  };

  /** 目标应用是否在运行（不在运行时不去驱动，避免 AppleScript 把它拉起来）。 */
  const appRunning = async (app) => {
    requireRemote();
    const label = APP_LABEL[app];
    if (!label) return false;
    try {
      if (isWindows) {
        const powershell = await resolveExecutable('powershell');
        const result = await runProcess(powershell, ['-NoProfile', '-Command', '(Get-Process -Name ' + (app === 'photoshop' ? 'Photoshop' : 'Illustrator') + ' -ErrorAction SilentlyContinue | Measure-Object).Count'], remoteWorkDir(), 15000);
        return Number(String(result.stdout || '').trim()) > 0;
      }
      const osascript = await resolveExecutable('osascript');
      const result = await runProcess(osascript, ['-e', 'tell application "System Events" to exists (first process whose bundle identifier is "' + APP_BUNDLE[app] + '")'], remoteWorkDir(), 15000);
      return /true/i.test(String(result.stdout || ''));
    } catch { return false; }
  };

  /** 在 PS/AI 里无头执行一个桥接脚本调用（call 形如 "B.ps.sendSelection(false)"），返回脚本输出字符串。 */
  const remoteEval = async (app, call, timeoutMs) => {
    requireRemote();
    if (!APP_SCRIPT[app]) throw new Error('未知应用：' + app);
    const limit = Math.max(15000, Number(timeoutMs) || 120000);
    const scriptPath = join(await ensureUserCopy(), APP_SCRIPT[app]);
    const workDir = remoteWorkDir();
    await mkdir(workDir, { recursive: true });
    const stamp = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    const jsxPath = join(workDir, 'drive-' + app + '-' + stamp + '.jsx');
    const jsx = [
      '$.global.DSH_BRIDGE_HEADLESS = true;',
      '$.evalFile(new File(' + JSON.stringify(scriptPath) + '));',
      'var __dshResult;',
      'try { __dshResult = "OK:" + String((function () { var B = DSH_BRIDGE; return (' + call + '); })()); }',
      'catch (e) { __dshResult = "ERR:" + String(e && e.message ? e.message : e); }',
      '__dshResult;'
    ].join('\n');
    await writeFile(jsxPath, '\uFEFF' + jsx, 'utf8');
    let result;
    const cleanup = [jsxPath];
    try {
      if (isWindows) {
        const powershell = await resolveExecutable('powershell');
        const ps1 = '$a = New-Object -ComObject ' + JSON.stringify(APP_COM[app]) + '; Write-Output ([string]$a.DoJavaScriptFile(' + JSON.stringify(jsxPath) + '))';
        result = await runProcess(powershell, ['-NoProfile', '-Command', ps1], workDir, limit);
      } else {
        const osascript = await resolveExecutable('osascript');
        const applescriptPath = jsxPath + '.applescript';
        cleanup.push(applescriptPath);
        await writeFile(applescriptPath, 'with timeout of ' + Math.ceil(limit / 1000) + ' seconds\ntell application id "' + APP_BUNDLE[app] + '"\ndo javascript (read POSIX file ' + JSON.stringify(jsxPath) + ' as «class utf8»)\nend tell\nend timeout\n', 'utf8');
        result = await runProcess(osascript, [applescriptPath], workDir, limit + 5000);
      }
    } finally {
      for (const path of cleanup) await unlink(path).catch(() => {});
    }
    const out = String(result && result.stdout || '').trim();
    if (out.startsWith('OK:')) return out.slice(3);
    if (out.startsWith('ERR:')) throw new Error(out.slice(4));
    if (result && result.timedOut) throw new Error(APP_LABEL[app] + ' 响应超时（是否有弹窗挡住了？）');
    throw new Error(String(result && result.stderr || '').trim().split('\n').pop() || (APP_LABEL[app] + ' 没有返回结果'));
  };

  /** 画布「取 Ps 图层 / 取 Ai 对象」：让运行中的 PS/AI 把当前选区送进收件箱（随后客户端轮询上画布）。 */
  const pullSelection = async (app, projectDir, { merged, dpi } = {}) => {
    if (!(await appRunning(app))) throw new Error(APP_LABEL[app] + ' 没有在运行，请先打开它并选中要发送的内容');
    active.projectDir = String(projectDir || active.projectDir);
    await writeHandshake();
    const call = app === 'photoshop' ? 'B.ps.sendSelection(' + (merged ? 'true' : 'false') + ')' : 'B.ai.sendSelection(' + (Math.max(36, Number(dpi) || 150)) + ')';
    const count = Number(await remoteEval(app, call, 180000)) || 0;
    await log('pull', { app, count, projectDir: active.projectDir });
    return { count };
  };

  /** 画布「→Ps / →Ai」之后：直接让运行中的 PS/AI 置入（或打开）发件箱里的待处理返回件。 */
  const placePending = async (app, mode) => {
    if (!(await appRunning(app))) return { placed: 0, running: false };
    const method = mode === 'open' ? 'open' : 'place';
    const call = (app === 'photoshop' ? 'B.ps' : 'B.ai') + '.importPending(' + JSON.stringify(method) + ')';
    const placed = Number(await remoteEval(app, call, 180000)) || 0;
    await log('remote-place', { app, mode: method, placed });
    return { placed, running: true };
  };

  /** DSH 启动时静默调用：版本一致且文件在位就跳过，否则重装（不弹任何窗口、不提权）。 */
  const ensureInstalled = async () => {
    try {
      await ensureUserCopy();
      let record = null;
      try { record = await readJson(join(root, INSTALLED_FILE)); } catch {}
      if (record && record.version === await version() && Array.isArray(record.installed) && record.installed.length) {
        const first = record.installed[0];
        const dir = Array.isArray(first.dirs) && first.dirs.length ? first.dirs[0] : first.dir;
        if (dir && await exists(join(dir, SCRIPT_FILES[0]))) return { skipped: true, installed: record.installed };
      }
      const result = await installScripts();
      return { skipped: false, installed: result.installed, errors: result.errors };
    } catch (err) {
      await log('ensure-installed-failed', { error: String(err && err.message || err) });
      return { skipped: false, error: String(err && err.message || err) };
    }
  };

  /** macOS：对没有写权限的目录用系统管理员密码弹窗（osascript with administrator privileges）完成安装。
      密码由 macOS 自己的对话框收集，插件全程接触不到；必须由用户点按钮触发。 */
  const installScriptsElevated = async () => {
    requireRemote();
    if (isWindows) throw new Error('Windows 请以管理员身份运行：npm run install:adobe-bridge');
    const userCopyDir = await ensureUserCopy();
    const targets = await findAdobeScriptDirs();
    const denied = [];
    for (const target of targets) {
      for (const dir of target.dirs) {
        try { await mkdir(dir, { recursive: true }); await access(dir, fsConstants.W_OK); } catch (err) { if (err && (err.code === 'EACCES' || err.code === 'EPERM')) denied.push(dir); }
      }
    }
    if (!denied.length) return { elevated: false, ...(await installScripts()) };
    const shell = denied.map((dir) => 'mkdir -p ' + shellQuote(dir) + ' && cp ' + shellQuote(userCopyDir + '/') + '*.jsx ' + shellQuote(dir + '/')).join(' && ');
    const osascript = await resolveExecutable('osascript');
    const result = await runProcess(osascript, ['-e', 'do shell script ' + JSON.stringify(shell) + ' with administrator privileges'], remoteWorkDir(), 180000);
    if (result.exitCode !== 0) {
      const message = String(result.stderr || '').trim();
      throw new Error(/-128|取消|cancel/i.test(message) ? '已取消授权' : (message || '授权安装失败'));
    }
    await log('install-scripts-elevated', { dirs: denied });
    return { elevated: true, ...(await installScripts()) };
  };
  const shellQuote = (value) => "'" + String(value).replace(/'/g, "'\\''") + "'";

  return { root, bridgeDirsFor, activate, writeHandshake, listInbound, ackInbound, resolveOrigin, createReturn, status, installScripts, installScriptsElevated, ensureInstalled, ensureUserCopy, findAdobeScriptDirs, appRunning, remoteEval, pullSelection, placePending, log };
}

export { bridgeRootDir, bridgeDirsFor, SCRIPT_FILES as ADOBE_BRIDGE_SCRIPT_FILES };
