import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const required = [
  'canvas-workbench/package.json',
  'canvas-workbench/lib/index.js',
  'canvas-workbench/lib/client.js',
  'canvas-workbench/lib/ocr-engine.js',
  'canvas-workbench/lib/image-engine.js',
  'canvas-workbench/lib/platform.js',
  'canvas-workbench/scripts/render_psd_preview.py',
  'home-explorer/package.json',
  'home-explorer/lib/index.js',
  'home-explorer/lib/client.js',
  'windows-installer/install.ps1',
  'windows-installer/health-check.ps1',
  'windows-installer/uninstall.ps1'
];

for (const relative of required) {
  const info = await stat(resolve(root, relative));
  if (!info.isFile() || info.size <= 0) throw new Error(`missing: ${relative}`);
}

const host = await readFile(resolve(root, 'canvas-workbench/lib/index.js'), 'utf8');
if (host.includes("if (!path.startsWith('/')) throw")) throw new Error('POSIX-only absolute path gate remains');
if (host.includes("resolveExecutable('python3')")) throw new Error('unabstracted python3 lookup remains');
if (!host.includes('platformCapabilities()')) throw new Error('health endpoint lacks platform capabilities');
if (!host.includes('recognizeWithTesseractJs')) throw new Error('OCR route lacks self-contained Tesseract.js fallback');
if (!host.includes('schemaVersion: 1, erasePrompt') || !host.includes('body.provider && body.model')) {
  throw new Error('text recognition must prefer the current chat model and return structured dynamic cleanup JSON');
}
if (!host.includes("'--blocks-file'")) throw new Error('text tools must pass CJK JSON through UTF-8 files on Windows');
if (!host.includes("pathname === '/dsh-canvas/pick-adobe'")) throw new Error('host lacks native Adobe executable picker endpoint');
if (!host.includes('photoshopPath') || !host.includes('illustratorPath')) throw new Error('host does not persist manual Adobe executable paths');
const platform = await readFile(resolve(root, 'canvas-workbench/lib/platform.js'), 'utf8');
if (!platform.includes('Start-Process -FilePath') || !platform.includes('-ArgumentList @(')) throw new Error('Windows Adobe launcher does not pass the selected executable explicitly');
if (!platform.includes("Invoke-Item -LiteralPath")) throw new Error('Windows project folder opener does not preserve the exact literal path');
if (!platform.includes("return runProcess(explorer, ['/select,' + path], cwd);") || !platform.includes("const literalPath = \"'/select,\" + String(path || '').replace")) {
  throw new Error('Windows Explorer reveal must use a single /select,<path> argument');
}

const client = await readFile(resolve(root, 'canvas-workbench/lib/client.js'), 'utf8');
if (!client.includes('[A-Za-z]:[\\\\/]')) throw new Error('client lacks Windows drive path support');
if (/[><=!]=?\s*\d+\?\.\d/.test(client)) {
  throw new Error('iframe source contains an ambiguous numeric ternary that parses as optional chaining');
}
if (!client.includes('function publishCanvasChange(')) {
  throw new Error('programmatic iframe mutations are not explicitly published for persistence');
}
if (!client.includes("replace(/\\\\/g, '/')") || !client.includes('normalizedPath.startsWith(assetsPrefix)')) {
  throw new Error('managed asset path checks are not normalized for Windows separators');
}
if ((client.match(/publishCanvasChange\(nextElements/g) || []).length < 2) {
  throw new Error('add and duplicate mutations must publish their constructed target element arrays');
}
if (!client.includes('pickAdobeExecutable') || !client.includes('选择程序')) throw new Error('client lacks manual Adobe executable controls');
if (!client.includes('folderSyncEnabled') || !client.includes('打开并同步项目文件夹')) {
  throw new Error('project folder synchronization lacks an explicit user-controlled entry point');
}
if (!client.includes('DSH_CANVAS_HTML_FALLBACK') || !client.includes("fetchCanvasJson('/dsh-canvas/projects")) {
  throw new Error('recent projects does not guard against the DSH HTML fallback during plugin restart');
}
if (!client.includes('photoshopWheel') || !client.includes('Alt + 滚轮缩放 · 空格拖动画布')) {
  throw new Error('canvas lacks Photoshop-style wheel zoom controls');
}
if (!client.includes('projectPrefixLower') || !client.includes('normalizeProjectPath')) {
  throw new Error('project polling lacks Windows separator/case normalization');
}
if (!client.includes('windowsAbsRe') || !client.includes('svg|pdf|ai|psd')) {
  throw new Error('assistant image-path extraction lacks Windows document formats');
}
if (!host.includes('render_psd_preview.py')) throw new Error('Windows PSD preview lacks a real composite renderer');

const installer = await readFile(resolve(root, 'windows-installer/install.ps1'), 'utf8');
for (const marker of ['profiles', 'node_modules\\@local', 'desktop\\node_modules\\@local', 'cordis.patch.yml']) {
  if (!installer.includes(marker)) throw new Error(`installer missing marker: ${marker}`);
}
for (const relative of required.filter((item) => item.endsWith('.ps1'))) {
  const bytes = await readFile(resolve(root, relative));
  if (bytes[0] !== 0xef || bytes[1] !== 0xbb || bytes[2] !== 0xbf) {
    throw new Error(`PowerShell 5.1 requires a UTF-8 BOM for localized script: ${relative}`);
  }
}

console.log('portability checks passed');
