import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

process.env.DSH_CODEX_MODULE_PATH = resolve(import.meta.dirname, 'fixtures/mock-dsh-codex.mjs');
const { generateImage } = await import(pathToFileURL(resolve(import.meta.dirname, '../canvas-workbench/lib/image-engine.js')).href);
const result = await generateImage({
  ctx: { get() { return null; } },
  engine: 'dsh-codex',
  image: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  mask: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  prompt: '测试遮罩编辑'
});
assert.equal(result.engine, 'dsh-codex');
assert.equal(result.bytes.toString(), 'mock-generated-image');
console.log('image engine mask forwarding checks passed');

