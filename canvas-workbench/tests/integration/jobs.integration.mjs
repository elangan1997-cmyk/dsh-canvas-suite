// jobs 端点集成测试：在独立 Host 上触发一个被跟踪的路由，再查询 /dsh-canvas/jobs。
//   node tests/integration/jobs.integration.mjs
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { startHost } from './host-harness.mjs';
import { TINY_PNG } from './api-requests.mjs';
import { makeSampleProject } from '../fixtures/make-sample-project.mjs';

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const root = await mkdtemp(join(tmpdir(), 'dsh-jobs-it-'));
const fixture = await makeSampleProject(join(root, 'sample-project'));
const host = await startHost({ pluginDir: pluginRoot, workspaceRoot: root });
try {
  const post = (path, body) => fetch(host.baseUrl + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const getJson = async (path) => (await fetch(host.baseUrl + path)).json();

  let list = await getJson('/dsh-canvas/jobs');
  assert.deepEqual(list, { ok: true, data: { jobs: [], total: 0 } }, '初始为空');

  // 触发一个会失败的被跟踪路由（无 llm → 500）
  const r1 = await post('/dsh-canvas/ocr-image', { imageData: TINY_PNG, crops: [{ x: 0, y: 0, width: 800, height: 800 }] });
  assert.equal(r1.status, 500);
  list = await getJson('/dsh-canvas/jobs');
  assert.equal(list.data.total, 1);
  const job = list.data.jobs[0];
  assert.equal(job.type, 'text.recognize');
  assert.equal(job.status, 'failed');
  assert.equal(job.error.code, 'HTTP_500');
  assert.equal(job.params.route, '/dsh-canvas/ocr-image');

  const one = await getJson('/dsh-canvas/jobs/get?id=' + encodeURIComponent(job.id));
  assert.equal(one.data.job.id, job.id);
  const missing = await fetch(host.baseUrl + '/dsh-canvas/jobs/get?id=nope');
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, 'JOB_NOT_FOUND');

  const filtered = await getJson('/dsh-canvas/jobs?status=completed');
  assert.equal(filtered.data.total, 0);

  const cancel = await post('/dsh-canvas/jobs/cancel', { id: job.id });
  assert.equal((await cancel.json()).data.job.status, 'failed', '终态 cancel 幂等');

  // 未被跟踪的路由不产生任务
  await fetch(host.baseUrl + '/dsh-canvas/health');
  await post('/dsh-canvas/project-files', { cwd: root, project: fixture.dir });
  list = await getJson('/dsh-canvas/jobs');
  assert.equal(list.data.total, 1);
  console.log('jobs integration: PASS');
} finally {
  await host.close();
  await rm(root, { recursive: true, force: true });
}
