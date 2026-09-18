// 共享的 API 回归请求清单：基线采样（CDP 走真实 DSH）与独立 Host 基座（假 ctx）共用同一份，
// 保证「重构前 / 重构后」比较的是完全相同的请求。
//
// 所有请求只读或可自我还原（materials/tag 先标记再清除），不触碰用户项目与凭据。

import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';

export function buildRequests(fixtureDir) {
  const root = dirname(fixtureDir);
  const assets = join(fixtureDir, 'assets');
  const enc = encodeURIComponent;
  return [
    { name: 'health', method: 'GET', path: '/dsh-canvas/health' },
    { name: 'system-appearance', method: 'GET', path: '/dsh-canvas/system-appearance' },
    { name: 'image-settings', method: 'GET', path: '/dsh-canvas/image-settings' },
    { name: 'state-get', method: 'GET', path: `/dsh-canvas/state?cwd=${enc(root)}&project=${enc(fixtureDir)}` },
    { name: 'projects', method: 'GET', path: `/dsh-canvas/projects?cwd=${enc(root)}` },
    { name: 'materials', method: 'GET', path: `/dsh-canvas/materials?dir=${enc(assets)}` },
    { name: 'materials-tags-before', method: 'GET', path: `/dsh-canvas/materials/tags?dir=${enc(assets)}` },
    { name: 'materials-tag-set', method: 'POST', path: '/dsh-canvas/materials/tag', body: { dir: assets, names: ['a-small-red.png'], color: 'red' } },
    { name: 'materials-tags-after-set', method: 'GET', path: `/dsh-canvas/materials/tags?dir=${enc(assets)}` },
    { name: 'materials-tag-clear', method: 'POST', path: '/dsh-canvas/materials/tag', body: { dir: assets, names: ['a-small-red.png'], color: '' } },
    { name: 'materials-tags-after-clear', method: 'GET', path: `/dsh-canvas/materials/tags?dir=${enc(assets)}` },
    { name: 'materials-tag-bad-color', method: 'POST', path: '/dsh-canvas/materials/tag', body: { dir: assets, names: ['a-small-red.png'], color: 'pink' } },
    { name: 'image-png', method: 'GET', path: `/dsh-canvas/image?path=${enc(join(assets, 'a-small-red.png'))}`, binary: true },
    { name: 'image-bad-path', method: 'GET', path: `/dsh-canvas/image?path=${enc('/etc/hosts')}` },
    { name: 'image-status-ok', method: 'GET', path: `/dsh-canvas/image-status?path=${enc(join(assets, 'b-wide-green.png'))}` },
    { name: 'image-status-missing', method: 'GET', path: `/dsh-canvas/image-status?path=${enc(join(assets, 'nope.png'))}` },
    { name: 'image-status-bad', method: 'GET', path: '/dsh-canvas/image-status?path=relative.png' },
    { name: 'preview-svg', method: 'GET', path: `/dsh-canvas/preview?path=${enc(join(assets, 'd-vector.svg'))}`, binary: true },
    { name: 'preview-bad', method: 'GET', path: `/dsh-canvas/preview?path=${enc('/etc/hosts')}` },
    { name: 'list-directories', method: 'GET', path: `/dsh-canvas/list-directories?path=${enc(root)}` },
    { name: 'project-files', method: 'POST', path: '/dsh-canvas/project-files', body: { cwd: root, project: fixtureDir } },
    { name: 'check-sources', method: 'POST', path: '/dsh-canvas/check-sources', body: { sources: [join(assets, 'a-small-red.png'), join(assets, 'missing.png')] } },
    { name: 'photoshop-outputs', method: 'POST', path: '/dsh-canvas/photoshop-outputs', body: { cwd: root, project: fixtureDir, directory: join(fixtureDir, 'outputs'), baseline: [] } },
    { name: 'remove-background-progress-unknown', method: 'GET', path: `/dsh-canvas/remove-background-progress?cwd=${enc(root)}&project=${enc(fixtureDir)}&jobId=nope` },
    { name: 'vendor-react', method: 'GET', path: '/dsh-canvas/vendor/react.js', binary: true },
    { name: 'vendor-missing', method: 'GET', path: '/dsh-canvas/vendor/nope.js' },
    { name: 'unknown-route', method: 'GET', path: '/dsh-canvas/definitely-not-a-route' },
    { name: 'options-preflight', method: 'OPTIONS', path: '/dsh-canvas/health' },
    { name: 'projects-missing-cwd', method: 'GET', path: '/dsh-canvas/projects' },
    { name: 'materials-tag-missing-dir', method: 'POST', path: '/dsh-canvas/materials/tag', body: { names: ['x.png'], color: 'red' } },

    // ---- 有状态的写路由（只作用于临时 fixture 项目；顺序敏感） ----
    { name: 'state-post', method: 'POST', path: `/dsh-canvas/state?cwd=${enc(root)}&project=${enc(fixtureDir)}`, body: { elements: [], appState: { theme: 'light' }, files: {}, dshMeta: { revision: 2, savedAt: 2, baseRevision: 1 } } },
    { name: 'state-get-after-post', method: 'GET', path: `/dsh-canvas/state?cwd=${enc(root)}&project=${enc(fixtureDir)}` },
    { name: 'state-post-stale', method: 'POST', path: `/dsh-canvas/state?cwd=${enc(root)}&project=${enc(fixtureDir)}`, body: { elements: [], appState: {}, files: {}, dshMeta: { revision: 1, savedAt: 1, baseRevision: 1 } } },
    { name: 'state-bad-method', method: 'PUT', path: `/dsh-canvas/state?cwd=${enc(root)}&project=${enc(fixtureDir)}`, body: {} },
    { name: 'materials-save', method: 'POST', path: '/dsh-canvas/materials/save', body: { dir: assets, name: 'saved-by-test.png', dataURL: TINY_PNG } },
    { name: 'materials-after-save', method: 'GET', path: `/dsh-canvas/materials?dir=${enc(assets)}` },
    { name: 'materials-delete', method: 'POST', path: '/dsh-canvas/materials/delete', body: { dir: assets, name: 'saved-by-test.png' } },
    { name: 'materials-delete-missing', method: 'POST', path: '/dsh-canvas/materials/delete', body: { dir: assets, name: 'nope.png' } },
    { name: 'import-file', method: 'POST', path: '/dsh-canvas/import-file', body: { cwd: root, project: fixtureDir, name: 'imported.png', dataURL: TINY_PNG, kind: 'image' } },
    { name: 'materialize-image', method: 'POST', path: '/dsh-canvas/materialize-image', body: { cwd: root, project: fixtureDir, name: 'materialized.png', dataURL: TINY_PNG } },
    { name: 'rename-image', method: 'POST', path: '/dsh-canvas/rename-image', body: { cwd: root, project: fixtureDir, oldName: 'materialized.png', newName: 'materialized-renamed', ext: 'png', sourcePath: join(assets, 'materialized.png'), fileId: 'f1' } },
    { name: 'archive-images', method: 'POST', path: '/dsh-canvas/archive-images', body: { cwd: root, project: fixtureDir, paths: [join(assets, 'imported.png')] } },
    { name: 'restore-image', method: 'POST', path: '/dsh-canvas/restore-image', body: { cwd: root, project: fixtureDir, archived: join(fixtureDir, '画布回收站', 'imported.png'), original: join(assets, 'imported.png') } },
    { name: 'project-files-after-writes', method: 'POST', path: '/dsh-canvas/project-files', body: { cwd: root, project: fixtureDir } },
    { name: 'backup-canvas', method: 'POST', path: '/dsh-canvas/backup-canvas', body: { cwd: root, project: fixtureDir, snapshot: { elements: [], appState: {}, files: {} } } },
    { name: 'chat-context-post', method: 'POST', path: '/dsh-canvas/chat-context', body: { cwd: root, project: fixtureDir, designMode: true, sessionId: 'parity-session' } },
    { name: 'chat-context-bad', method: 'POST', path: '/dsh-canvas/chat-context', body: {} },
    { name: 'open-project', method: 'POST', path: '/dsh-canvas/open-project', body: { cwd: root, project: fixtureDir } },
    { name: 'ocr-no-llm', method: 'POST', path: '/dsh-canvas/ocr-image', body: { imageData: TINY_PNG, crops: [{ x: 0, y: 0, width: 8, height: 8 }] } },
    { name: 'export-psd-bad', method: 'POST', path: '/dsh-canvas/export-text-psd', body: { cwd: root, project: fixtureDir, blocks: [] } },
    { name: 'import-project-missing', method: 'POST', path: '/dsh-canvas/import-project', body: { path: join(root, 'does-not-exist') } },
    { name: 'rename-project', method: 'POST', path: '/dsh-canvas/rename-project', body: { cwd: root, project: fixtureDir, name: 'renamed-project' } },
    { name: 'projects-after-rename', method: 'GET', path: `/dsh-canvas/projects?cwd=${enc(root)}` },
    { name: 'delete-project', method: 'POST', path: '/dsh-canvas/delete-project', body: { cwd: root, project: join(root, 'renamed-project') } },
    { name: 'projects-after-delete', method: 'GET', path: `/dsh-canvas/projects?cwd=${enc(root)}` }
  ];
}

// 1×1 透明 PNG
export const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const SECRET_KEY = /(apiKey|token|secret|authorization|password)/i;

/** 把响应归一化成可跨运行比较的形状：抹平时间戳、二进制转哈希、脱敏密钥。 */
export function normalizeResponse(res, { fixtureDir, fixtureRoot } = {}) {
  const out = { status: res.status, contentType: (res.contentType || '').split(';')[0].trim() };
  if (res.binary) {
    out.byteLength = res.byteLength;
    out.sha256 = res.sha256;
    return out;
  }
  out.body = normalizeValue(res.body, fixtureDir, fixtureRoot);
  return out;
}

export function normalizeValue(value, fixtureDir, fixtureRoot) {
  if (Array.isArray(value)) return value.map((v) => normalizeValue(v, fixtureDir, fixtureRoot));
  if (value && typeof value === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY.test(k) && v) { o[k] = '<redacted>'; continue; }
      o[k] = normalizeValue(v, fixtureDir, fixtureRoot);
    }
    return o;
  }
  if (typeof value === 'number' && value > 1e12) return '<ts>';
  if (typeof value === 'string') {
    let s = value;
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s)) return '<iso>';
    if (fixtureDir) {
      s = s.split(fixtureDir).join('<fixture>');
      s = s.split(encodeURIComponent(fixtureDir)).join('<fixture>');
    }
    if (fixtureRoot) {
      for (const r of [fixtureRoot, '/private' + fixtureRoot]) { s = s.split(r).join('<root>'); s = s.split(encodeURIComponent(r)).join('<root>'); }
    }
    s = s.replace(/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z/g, '<stamp>');
    s = s.replace(/\/(?:private\/)?var\/folders\/[^\s"']+?\/T\/dsh-[a-zA-Z-]+-[A-Za-z0-9]+/g, '<tmp>');
    s = s.replace(/([?&]v=)\d{10,}/g, '$1<v>');
    s = s.replace(/\/Users\/[^/\s"']+/g, '<home>');
    s = s.replace(/%2FUsers%2F[^%\s"']+/g, '<home-enc>');
    return s;
  }
  return value;
}

export function sha256(buf) { return createHash('sha256').update(buf).digest('hex'); }
