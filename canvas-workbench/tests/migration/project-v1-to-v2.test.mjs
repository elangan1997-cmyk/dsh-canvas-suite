import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrateProject, detectSchemaVersion } from '../../src/shared/schemas/project.schema.js';

// 1.7.0 真实项目的 project.json 形状（来自用户项目：画布项目-橄榄球，个人路径已省略）
const REAL_V1 = { version: 1, canvas: 'canvas.json', assets: 'assets', outputs: 'outputs', updatedAt: '2026-08-29T03:22:11.551Z' };

test('真实 v1 project.json → v2：旧字段一字不改，新增 schemaVersion/assetIndex', () => {
  const r = migrateProject(structuredClone(REAL_V1));
  assert.equal(r.from, 1); assert.equal(r.to, 2);
  assert.deepEqual({ ...r.project, schemaVersion: undefined, assetIndex: undefined }, { ...REAL_V1, schemaVersion: undefined, assetIndex: undefined });
  assert.equal(r.project.schemaVersion, 2); assert.deepEqual(r.project.assetIndex, {});
  assert.equal(detectSchemaVersion(r.project), 2);
});

test('旧插件读取 v2 文件不受影响：version 仍为 1，未知字段可忽略', () => {
  const r = migrateProject(structuredClone(REAL_V1));
  const asSeenByOldPlugin = { version: r.project.version, canvas: r.project.canvas, assets: r.project.assets, outputs: r.project.outputs };
  assert.deepEqual(asSeenByOldPlugin, { version: 1, canvas: 'canvas.json', assets: 'assets', outputs: 'outputs' });
});

test('canvas.json 不在迁移范围：elements/appState/files 由 Excalidraw 语义约束，不改格式', () => {
  // 迁移函数只接受 project 元数据；传入 canvas 形状应被识别为不可识别而不是被改写
  assert.throws(() => migrateProject({ elements: [], appState: {}, files: {} }), /无法识别/);
});
