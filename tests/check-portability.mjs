import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const required = [
  'canvas-workbench/package.json',
  'canvas-workbench/lib/index.js',
  'canvas-workbench/lib/client.js',
  'canvas-workbench/lib/image-engine.js',
  'canvas-workbench/lib/platform.js',
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
