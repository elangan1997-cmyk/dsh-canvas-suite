// 新增端点集成测试：/dsh-canvas/assets、/capabilities、/python-tools（v1.8 加法接口）。
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { startHost } from './host-harness.mjs';
import { makeSampleProject } from '../fixtures/make-sample-project.mjs';

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const root = await mkdtemp(join(tmpdir(), 'dsh-contracts-it-'));
const fixture = await makeSampleProject(join(root, 'sample-project'));
const host = await startHost({ pluginDir: pluginRoot, workspaceRoot: root });
try {
  const getJson = async (path) => { const r = await fetch(host.baseUrl + path); return { status: r.status, body: await r.json() }; };
  const assets = await getJson('/dsh-canvas/assets?dir=' + encodeURIComponent(join(fixture.dir, 'assets')));
  assert.equal(assets.status, 200);
  assert.equal(assets.body.ok, true);
  assert.equal(assets.body.data.total, fixture.assets.length, '7 个合成资产全部识别');
  const byName = Object.fromEntries(assets.body.data.assets.map((a) => [a.fileName, a]));
  assert.deepEqual([byName['b-wide-green.png'].width, byName['b-wide-green.png'].height], [320, 120], 'PNG header 尺寸');
  assert.deepEqual([byName['c-square-blue.bmp'].width, byName['c-square-blue.bmp'].height], [200, 200], 'BMP header 尺寸');
  assert.equal(byName['d-vector.svg'].mimeType, 'image/svg+xml');
  assert.match(byName['a-small-red.png'].id, /^asset_[0-9a-f]{8}$/);
  assert.equal(byName['a-small-red.png'].source.type, 'imported');
  const bad = await getJson('/dsh-canvas/assets?dir=relative');
  assert.equal(bad.status, 400); assert.equal(bad.body.error.code, 'INVALID_REQUEST');
  const missing = await getJson('/dsh-canvas/assets?dir=' + encodeURIComponent(join(root, 'nope')));
  assert.equal(missing.status, 404); assert.equal(missing.body.error.code, 'ASSET_NOT_FOUND');

  const caps = await getJson('/dsh-canvas/capabilities');
  assert.equal(caps.status, 200);
  assert.equal(caps.body.data.capabilities['canvas.basic'], true);
  assert.equal(caps.body.data.capabilities['video.generate'], false);
  const features = Object.fromEntries(caps.body.data.features.map((f) => [f.id, f]));
  assert.equal(features['video-generation'].enabled, false);
  assert.equal(features['canvas-core'].enabled, true);
  assert.equal(caps.body.data.features.length, 12);

  const tools = await getJson('/dsh-canvas/python-tools');
  assert.equal(tools.body.data.tools.length, 10);
  assert.ok(tools.body.data.tools.every((t) => t.path.endsWith(t.script.replace('scripts/', 'scripts/'))));
  console.log('contracts integration: PASS');
} finally {
  await host.close();
  await rm(root, { recursive: true, force: true });
}
