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
    { name: 'materials-tag-missing-dir', method: 'POST', path: '/dsh-canvas/materials/tag', body: { names: ['x.png'], color: 'red' } }
  ];
}

const SECRET_KEY = /(apiKey|token|secret|authorization|password)/i;

/** 把响应归一化成可跨运行比较的形状：抹平时间戳、二进制转哈希、脱敏密钥。 */
export function normalizeResponse(res, { fixtureDir } = {}) {
  const out = { status: res.status, contentType: (res.contentType || '').split(';')[0].trim() };
  if (res.binary) {
    out.byteLength = res.byteLength;
    out.sha256 = res.sha256;
    return out;
  }
  out.body = normalizeValue(res.body, fixtureDir);
  return out;
}

export function normalizeValue(value, fixtureDir) {
  if (Array.isArray(value)) return value.map((v) => normalizeValue(v, fixtureDir));
  if (value && typeof value === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY.test(k) && v) { o[k] = '<redacted>'; continue; }
      o[k] = normalizeValue(v, fixtureDir);
    }
    return o;
  }
  if (typeof value === 'number' && value > 1e12) return '<ts>';
  if (typeof value === 'string') {
    let s = value;
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s)) return '<iso>';
    if (fixtureDir) s = s.split(fixtureDir).join('<fixture>');
    s = s.replace(/\/Users\/[^/\s"']+/g, '<home>');
    return s;
  }
  return value;
}

export function sha256(buf) { return createHash('sha256').update(buf).digest('hex'); }
