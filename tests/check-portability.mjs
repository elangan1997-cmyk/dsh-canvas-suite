import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const required = [
  'canvas-workbench/package.json',
  'canvas-workbench/lib/index.js',
  'canvas-workbench/lib/client.js',
  'canvas-workbench/lib/ocr-engine.js',
  'canvas-workbench/lib/text-reconstruction.js',
  'canvas-workbench/lib/reconstruction-model.js',
  'canvas-workbench/lib/font-matcher.js',
  'canvas-workbench/lib/image-engine.js',
  'canvas-workbench/lib/platform.js',
  'canvas-workbench/scripts/render_psd_preview.py',
  'canvas-workbench/scripts/prepare_codex_masked_input.py',
  'home-explorer/package.json',
  'home-explorer/lib/index.js',
  'home-explorer/lib/client.js',
  'windows-installer/install.ps1',
  'windows-installer/health-check.ps1',
  'windows-installer/uninstall.ps1',
  'windows-installer/build-release.ps1',
  'windows-installer/build-release.cmd',
  'windows-installer/bootstrap.ps1',
  'windows-installer/install-release.ps1',
  'windows-installer/doctor.ps1',
  'windows-installer/uninstall-release.ps1',
  'windows-installer/sfx-stub.cs',
  'package.json',
  'WINDOWS_PACKAGING_AUDIT.md',
  'WINDOWS_DEPENDENCY_MATRIX.md',
  'WINDOWS_COMPATIBILITY_MATRIX.md',
  'INTERNET_CAFE_TEST_CHECKLIST.md',
  'RELEASE_NOTES.md',
  'THIRD_PARTY_DEPENDENCIES.md',
  'KNOWN_ISSUES.md',
  'PACKAGING_PROGRESS.md'
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
if (!host.includes('buildReconstructionPlan') || !host.includes('geometryDetector')) {
  throw new Error('text recognition must expose traceable reconstruction and detector-fusion metadata');
}
if (!host.includes('windowsFontInventory') || !host.includes('fontCandidates')) {
  throw new Error('PSD export must expose installed-font candidates for typography calibration');
}
const imageEngine = await readFile(resolve(root, 'canvas-workbench/lib/image-engine.js'), 'utf8');
if (!imageEngine.includes('inputImages.push(mask)') || !imageEngine.includes('alpha=0')) {
  throw new Error('Codex image route must forward the edit mask as an explicit reference');
}
if (!host.includes("'--blocks-file'")) throw new Error('text tools must pass CJK JSON through UTF-8 files on Windows');
if (!host.includes("pathname === '/dsh-canvas/pick-adobe'")) throw new Error('host lacks native Adobe executable picker endpoint');
if (!host.includes('photoshopPath') || !host.includes('illustratorPath')) throw new Error('host does not persist manual Adobe executable paths');
if (!host.includes("pathname === '/dsh-canvas/reconcile-assets'") || !host.includes('assetCount') || !host.includes('pendingPaths') || !host.includes('liveImageCount') || !host.includes('isPathInside(item.path, assetsDir)') || !host.includes("'cache-control': 'no-store'")) {
  throw new Error('host lacks live-canvas asset reconciliation and in-flight protection');
}
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
if (!client.includes('打开项目文件夹') || client.includes('打开并同步项目文件夹')) {
  throw new Error('project folder entry point still exposes the removed manual sync action');
}
const openFolderStart = client.indexOf('const openProjectFolder = () =>');
const openFolderEnd = client.indexOf('const openImageSettings = () =>', openFolderStart);
const openFolderBlock = openFolderStart >= 0 && openFolderEnd > openFolderStart ? client.slice(openFolderStart, openFolderEnd) : '';
if (!openFolderBlock || openFolderBlock.includes("'/api/dsh-canvas/project-files'")) {
  throw new Error('opening the project folder must not trigger a second manual project scan');
}
if (!client.includes('已自动加入项目目录新增文件')) {
  throw new Error('project folder polling is not configured to import new files automatically');
}
if (!client.includes('DSH_CANVAS_HTML_FALLBACK') || !client.includes("fetchCanvasJson('/api/dsh-canvas/projects")) {
  throw new Error('recent projects does not guard against the DSH HTML fallback during plugin restart');
}
if (!client.includes('photoshopWheel') || !client.includes('Alt + 滚轮缩放 · 空格拖动画布')) {
  throw new Error('canvas lacks Photoshop-style wheel zoom controls');
}
if (!client.includes('重试选区') || !client.includes("data.status === 'partial_error'")) {
  throw new Error('text rebuild UI lacks independent region retry/partial failure state');
}
if (!client.includes('projectPrefixLower') || !client.includes('normalizeProjectPath')) {
  throw new Error('project polling lacks Windows separator/case normalization');
}
if (!client.includes('scheduleAssetReconciliation') || !client.includes("dsh-canvas:assets-changed") || !client.includes('deletedLiveIds') || !client.includes("scheduleAssetReconciliation(latestSnapshot.current, 'load')")) {
  throw new Error('client does not reconcile assets immediately for add/delete/undo/redo');
}
if (!client.includes('windowsAbsRe') || !client.includes('svg|pdf|ai|psd')) {
  throw new Error('assistant image-path extraction lacks Windows document formats');
}
if (!host.includes('render_psd_preview.py')) throw new Error('Windows PSD preview lacks a real composite renderer');
if (!host.includes('画布局部编辑系统约束') || !host.includes('透明遮罩区域是唯一可写区域') || !host.includes('禁止上下错位、重复叠字')) {
  throw new Error('masked image edit must include the host-owned alignment and duplicate-text guard');
}

const installer = await readFile(resolve(root, 'windows-installer/install.ps1'), 'utf8');
for (const marker of ['profiles', 'node_modules\\@local', 'desktop\\node_modules\\@local', 'cordis.patch.yml']) {
  if (!installer.includes(marker)) throw new Error(`installer missing marker: ${marker}`);
}
const releaseBuilder = await readFile(resolve(root, 'windows-installer/build-release.ps1'), 'utf8');
for (const marker of ['Remove-ReleasePrivateArtifacts', 'Scrub-ReleaseText', 'Assert-ReleasePrivateDataAbsent', '.openai-codex-auth.json', 'Compiled Python bytecode embeds']) {
  if (!releaseBuilder.includes(marker)) throw new Error(`release builder missing privacy guard: ${marker}`);
}
const releaseInstaller = await readFile(resolve(root, 'windows-installer/install-release.ps1'), 'utf8');
for (const marker of ['Prepare-ManagedPluginLinks', 'plugin-link-backups', '@local/canvas-workbench', 'electron\\node_modules']) {
  if (!releaseInstaller.includes(marker)) throw new Error(`release installer missing stale plugin-link repair: ${marker}`);
}
for (const relative of required.filter((item) => item.endsWith('.ps1'))) {
  const bytes = await readFile(resolve(root, relative));
  if (bytes[0] !== 0xef || bytes[1] !== 0xbb || bytes[2] !== 0xbf) {
    throw new Error(`PowerShell 5.1 requires a UTF-8 BOM for localized script: ${relative}`);
  }
}

console.log('portability checks passed');
