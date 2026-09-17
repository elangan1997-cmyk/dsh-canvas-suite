import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvasObject, fromExcalidrawElement, applyToExcalidrawElement, CANVAS_OBJECT_TYPES } from '../../src/shared/contracts/canvas-object.js';
import { createAsset, assetIdFor, assetTypeOf, assetMimeOf, inferSourceType } from '../../src/shared/contracts/asset.js';
import { migrateProject, detectSchemaVersion, CURRENT_SCHEMA_VERSION, newProjectMeta } from '../../src/shared/schemas/project.schema.js';
import { createFeatureRegistry, BUILTIN_FEATURES, capabilitiesFromHealth, capabilityPredicate } from '../../src/shared/registry/feature-registry.js';
import { createPythonToolRegistry, PYTHON_TOOLS } from '../../src/host/adapters/python.adapter.js';
import { makeSampleProject } from '../fixtures/make-sample-project.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// 与 1.7.0 真实项目 canvas.json 中 image 元素相同的字段形状
const REAL_IMAGE_ELEMENT = {
  id: 'el1', type: 'image', x: 10.5, y: 20, width: 300, height: 200, angle: 0.25, opacity: 80, locked: false, isDeleted: false,
  fileId: 'f1', version: 3, scale: [1, -1], strokeColor: 'transparent',
  customData: { dshFileName: 'a.png', dshSourcePath: '/p/assets/a.png', dshSourceMtime: 1787648719460, dshSourceKind: 'image', dshManaged: true, dshTagColor: 'blue' }
};

test('CanvasObject：默认值与类型兜底', () => {
  const o = createCanvasObject({ id: 'x', type: 'nope', transform: { x: '3' } });
  assert.equal(o.type, 'shape'); assert.equal(o.transform.x, 3); assert.equal(o.transform.scaleX, 1); assert.equal(o.visible, true);
  assert.deepEqual(CANVAS_OBJECT_TYPES, ['image', 'text', 'video', 'shape', 'group']);
});

test('Excalidraw image element ↔ ImageObject 往返：业务字段可写回，其余原样', () => {
  const obj = fromExcalidrawElement(REAL_IMAGE_ELEMENT);
  assert.equal(obj.type, 'image');
  assert.equal(obj.assetId, 'path:/p/assets/a.png');
  assert.equal(obj.fileName, 'a.png');
  assert.equal(obj.tagColor, 'blue');
  assert.equal(obj.opacity, 0.8);
  assert.deepEqual(obj.transform, { x: 10.5, y: 20, width: 300, height: 200, rotation: 0.25, scaleX: 1, scaleY: -1 });
  assert.equal(obj.metadata.customData.dshManaged, true);
  const moved = { ...obj, transform: { ...obj.transform, x: 99 }, tagColor: null };
  const el = applyToExcalidrawElement(REAL_IMAGE_ELEMENT, moved);
  assert.equal(el.x, 99); assert.equal(el.fileId, 'f1'); assert.equal(el.strokeColor, 'transparent');
  assert.equal('dshTagColor' in el.customData, false, '清除标记');
  assert.equal(el.customData.dshSourcePath, '/p/assets/a.png');
  assert.equal(fromExcalidrawElement(null), null);
  assert.equal(fromExcalidrawElement({ id: 't', type: 'text', text: 'hi', fontSize: 20 }).content, 'hi');
});

test('Asset：类型/MIME/稳定 id/来源推断', () => {
  assert.equal(assetTypeOf('/x/a.PNG'), 'image'); assert.equal(assetTypeOf('/x/v.mp4'), 'video'); assert.equal(assetTypeOf('/x/d.ai'), 'document'); assert.equal(assetTypeOf('/x/s.psd'), 'source'); assert.equal(assetTypeOf('/x/n.txt'), null);
  assert.equal(assetMimeOf('a.webp'), 'image/webp');
  assert.equal(assetIdFor('/a/b.png'), assetIdFor('/a/b.png'));
  assert.notEqual(assetIdFor('/a/b.png'), assetIdFor('/a/c.png'));
  assert.match(assetIdFor('/a'), /^asset_[0-9a-f]{8}$/);
  const a = createAsset({ path: '/p/assets/P07-编辑.png', size: 10, width: 2, height: 3, mtimeMs: 5, source: { type: inferSourceType('P07-编辑.png') } });
  assert.equal(a.type, 'image'); assert.equal(a.fileName, 'P07-编辑.png'); assert.equal(a.source.type, 'derived'); assert.equal(a.duration, null);
  assert.equal(inferSourceType('20260916-233035.png'), 'generated');
  assert.equal(inferSourceType('photo.jpg'), 'imported');
  assert.throws(() => createAsset({ path: '/p/x.txt' }), /不支持的资产类型/);
});

test('project schema：v1 → v2 只加字段、幂等、拒绝未知/更高版本', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-schema-'));
  try {
    const { dir: project } = await makeSampleProject(join(dir, 'p'));
    const v1 = JSON.parse(await readFile(join(project, 'project.json'), 'utf8'));
    assert.equal(detectSchemaVersion(v1), 1);
    const r = migrateProject(v1);
    assert.equal(r.from, 1); assert.equal(r.to, CURRENT_SCHEMA_VERSION); assert.equal(r.changed, true);
    assert.equal(r.project.version, 1, '保留旧字段供旧插件读取');
    assert.equal(r.project.schemaVersion, 2);
    assert.deepEqual(r.project.assetIndex, {});
    for (const k of Object.keys(v1)) assert.deepEqual(r.project[k], v1[k], '旧字段原样：' + k);
    const again = migrateProject(r.project);
    assert.equal(again.changed, false); assert.deepEqual(again.project, r.project);
    assert.throws(() => migrateProject({}), /无法识别/);
    assert.throws(() => migrateProject({ schemaVersion: 99 }), /高于当前支持/);
    assert.equal(newProjectMeta().schemaVersion, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Feature Registry：注册/去重/按能力启用/initialize-dispose 生命周期', () => {
  const r = createFeatureRegistry();
  const log = [];
  r.register({ id: 'a', capabilities: ['x'], initialize: () => log.push('a:init'), dispose: () => log.push('a:dispose') });
  r.register({ id: 'b', capabilities: ['x', 'y'] });
  assert.throws(() => r.register({ id: 'a' }), /重复注册/);
  assert.throws(() => r.register({}), /缺少 id/);
  assert.deepEqual(r.enabled({ x: true }).map((f) => f.id), ['a']);
  assert.deepEqual(r.enabled(new Set(['x', 'y'])).map((f) => f.id), ['a', 'b']);
  assert.deepEqual(r.apply(['x']), { enabled: ['a'], disabled: [] });
  assert.equal(r.isEnabled('a'), true);
  assert.deepEqual(r.apply([]), { enabled: [], disabled: ['a'] });
  assert.deepEqual(log, ['a:init', 'a:dispose']);
  assert.equal(capabilityPredicate(null)('x'), false);
  assert.equal(r.unregister('b'), true); assert.equal(r.get('b'), null);
});

test('BUILTIN_FEATURES 全部可注册；capabilitiesFromHealth 基于真实 1.7.0 health 样例', async () => {
  const r = createFeatureRegistry();
  for (const f of BUILTIN_FEATURES) r.register(f);
  assert.equal(r.list().length, BUILTIN_FEATURES.length);
  const samples = JSON.parse(await readFile(join(repoRoot, 'docs', 'refactor', 'baseline', 'api-samples-1.7.0', 'summary.json'), 'utf8'));
  const caps = capabilitiesFromHealth(samples.health.body);
  assert.equal(caps['canvas.basic'], true);
  assert.equal(caps['image.generate'], true, '基线 dshCodex.ready=true');
  assert.equal(caps['text.recognition'], true);
  assert.equal(caps['python.available'], true);
  assert.equal(caps['video.generate'], false);
  const enabled = r.enabled(caps).map((f) => f.id);
  assert.ok(enabled.includes('text-edit') && enabled.includes('material-library') && !enabled.includes('video-generation'));
  assert.equal(capabilitiesFromHealth({})['image.generate'], false);
});

test('Python Tool Registry：10 个工具、路径落在 pluginRoot、run 经 resolvePython', async () => {
  const calls = [];
  const reg = createPythonToolRegistry({ pluginRoot: '/plugin', resolvePython: async () => '/usr/bin/python3', run: async (exe, args, cwd, t) => { calls.push({ exe, args, cwd, t }); return { exitCode: 0, stdout: 'ok', stderr: '' }; } });
  assert.equal(PYTHON_TOOLS.length, 13);
  assert.equal(new Set(PYTHON_TOOLS.map((t) => t.id)).size, 13, 'id 唯一');
  assert.equal(reg.resolve('text.ocr').path, '/plugin/scripts/ocr_image.py');
  assert.throws(() => reg.resolve('nope'), /未注册的 Python 工具/);
  const out = await reg.run('vector.vectorize', { args: ['--in', 'a.png'], cwd: '/w', timeoutMs: 5 });
  assert.deepEqual(out, { exitCode: 0, stdout: 'ok', stderr: '' });
  assert.deepEqual(calls[0], { exe: '/usr/bin/python3', args: ['/plugin/scripts/vectorize_image.py', '--in', 'a.png'], cwd: '/w', t: 5 });
  assert.equal(reg.list().length, 13);
});

test('注册表声明的脚本文件都真实存在', async () => {
  const { access } = await import('node:fs/promises');
  for (const t of PYTHON_TOOLS) await access(join(repoRoot, 'canvas-workbench', t.script));
});
