import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const required = [
  'canvas-workbench/package.json',
  'canvas-workbench/lib/index.js',
  'canvas-workbench/lib/client.js',
  'canvas-workbench/lib/image-engine.js',
  'canvas-workbench/lib/platform.js',
  'canvas-workbench/lib/chat-image-router.js',
  'dsh-codex/package.json',
  'dsh-codex/lib/index.js',
  'dsh-codex/lib/client.js',
  'mac-installer/build-macos-installer.sh',
  'mac-installer/prepare-macos-bundle.sh',
  'mac-installer/scripts/postinstall',
  'mac-installer/health-check.sh',
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

const macBuild = await readFile(resolve(root, 'mac-installer/build-macos-installer.sh'), 'utf8');
if (macBuild.includes('dsh-codex-dsh2')) throw new Error('Mac installer still references a private checkout path');
if (!macBuild.includes('$WORKSPACE_DIR/dsh-codex/lib')) throw new Error('Mac installer does not bundle dsh-codex');
const sync = await readFile(resolve(root, 'sync-local-plugins.sh'), 'utf8');
if (!sync.includes('sync_codex_compat')) throw new Error('sync script lacks dsh-codex compatibility sync');
if (!sync.includes('remove_legacy_home_explorer')) throw new Error('sync script lacks legacy file-browser cleanup');

const installer = await readFile(resolve(root, 'windows-installer/install.ps1'), 'utf8');
for (const marker of ['profiles', 'node_modules\\@local', 'desktop\\node_modules\\@local', 'cordis.patch.yml']) {
  if (!installer.includes(marker)) throw new Error(`installer missing marker: ${marker}`);
}

console.log('portability checks passed');
