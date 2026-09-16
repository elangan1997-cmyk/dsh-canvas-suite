import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJob, canTransition, JOB_STATUSES, TERMINAL_STATUSES } from '../../src/shared/contracts/generation-job.js';
import { createJobManager } from '../../src/host/jobs/job-manager.js';
import { createJobStore } from '../../src/host/jobs/job-store.js';
import { createEventBus } from '../../src/shared/events/event-bus.js';
import { EVENTS } from '../../src/shared/events/event-types.js';
import { jobTrackingMiddleware, JOB_ROUTES } from '../../src/host/jobs/job-tracking.js';
import { createRouter } from '../../src/host/server/router.js';

test('createJob：默认字段与类型校验', () => {
  const j = createJob({ type: 'image.edit', providerId: 'api', params: { a: 1 }, inputAssetIds: ['x'] }, 1000);
  assert.equal(j.status, 'queued');
  assert.equal(j.progress, 0);
  assert.deepEqual(j.inputAssetIds, ['x']);
  assert.deepEqual(j.outputAssetIds, []);
  assert.equal(j.createdAt, 1000);
  assert.equal(j.startedAt, null);
  assert.ok(j.id.startsWith('job_'));
  assert.throws(() => createJob({ type: 'nope' }), /未知任务类型/);
});

test('状态迁移表：终态不可再迁；queued 不能直接 completed', () => {
  assert.equal(canTransition('queued', 'running'), true);
  assert.equal(canTransition('queued', 'completed'), false);
  assert.equal(canTransition('running', 'running'), true);
  assert.equal(canTransition('running', 'completed'), true);
  assert.equal(canTransition('processing', 'cancelled'), true);
  for (const t of TERMINAL_STATUSES) for (const to of JOB_STATUSES) assert.equal(canTransition(t, to), false, `${t}→${to}`);
});

test('JobManager 生命周期 + 事件顺序', () => {
  let t = 100;
  const bus = createEventBus();
  const seen = [];
  bus.on('*', ({ event }) => seen.push(event));
  const jobs = createJobManager({ bus, now: () => t++ });
  const j = jobs.create({ type: 'vectorize' });
  jobs.start(j.id);
  jobs.update(j.id, { progress: 40, message: 'tracing' });
  jobs.update(j.id, { progress: 250 });
  const done = jobs.complete(j.id, { outputAssetIds: ['asset_1'], result: { ok: true } });
  assert.equal(done.status, 'completed');
  assert.equal(done.progress, 100);
  assert.deepEqual(done.outputAssetIds, ['asset_1']);
  assert.deepEqual(done.result, { ok: true });
  assert.ok(done.startedAt < done.finishedAt);
  assert.deepEqual(seen, [EVENTS.JOB_CREATED, EVENTS.JOB_STARTED, EVENTS.JOB_PROGRESS, EVENTS.JOB_PROGRESS, EVENTS.JOB_COMPLETED]);
  assert.throws(() => jobs.update(j.id, { progress: 1 }), /已结束/);
  assert.throws(() => jobs.start(j.id), /不能从 completed/);
  assert.equal(jobs.cancel(j.id).status, 'completed', '终态 cancel 是幂等 no-op');
  assert.equal(jobs.get(j.id).progress, 100);
  assert.throws(() => jobs.start('nope'), /任务不存在/);
});

test('fail 记录错误码；queued 直接 fail 会补 startedAt；cancel 发事件', () => {
  const jobs = createJobManager({ now: () => 5 });
  const a = jobs.create({ type: 'image.generate' });
  const failed = jobs.fail(a.id, Object.assign(new Error('boom'), { code: 'PROVIDER_TIMEOUT' }));
  assert.equal(failed.status, 'failed');
  assert.deepEqual(failed.error, { message: 'boom', code: 'PROVIDER_TIMEOUT' });
  assert.equal(failed.startedAt, 5);
  const b = jobs.create({ type: 'image.generate' });
  let cancelled = null;
  jobs.bus.on(EVENTS.JOB_CANCELLED, ({ job }) => { cancelled = job; });
  jobs.cancel(b.id);
  assert.equal(cancelled.status, 'cancelled');
  assert.deepEqual(jobs.list({ status: 'failed' }).map((x) => x.id), [a.id]);
  assert.equal(jobs.list().length, 2);
});

test('run()：包裹异步工作，成功 complete、异常 fail 并原样抛出', async () => {
  const jobs = createJobManager();
  const out = await jobs.run({ type: 'text.recognize' }, async () => ({ summary: { blocks: 3 }, raw: 'x' }));
  assert.deepEqual(out, { summary: { blocks: 3 }, raw: 'x' });
  assert.equal(jobs.list({ status: 'completed' })[0].result.blocks, 3);
  await assert.rejects(jobs.run({ type: 'text.recognize' }, async () => { throw new Error('nope'); }), /nope/);
  assert.equal(jobs.list({ status: 'failed' }).length, 1);
});

test('JobStore 上限只淘汰终态', () => {
  const store = createJobStore({ limit: 3 });
  const jobs = createJobManager({ store });
  const ids = [1, 2, 3, 4, 5].map((i) => jobs.create({ type: 'vectorize' }).id);
  // 5 个全 queued（非终态）→ 不淘汰
  assert.equal(store.size(), 5);
  jobs.fail(ids[0], new Error('x'));
  jobs.create({ type: 'vectorize' });
  assert.equal(store.get(ids[0]), null, '终态被淘汰');
  assert.ok(store.get(ids[1]), '非终态保留');
});

test('EventBus：once / off / 监听器异常不影响发布方', () => {
  const bus = createEventBus();
  let n = 0;
  const off = bus.on('x', () => { n++; });
  bus.once('x', () => { n += 10; });
  bus.on('x', () => { throw new Error('listener boom'); });
  assert.equal(bus.emit('x'), 3);
  assert.equal(bus.emit('x'), 2);
  off();
  bus.emit('x');
  assert.equal(n, 12);
});

test('jobTrackingMiddleware：只包裹目标路由；按状态码 complete/fail；handler 抛错时 fail 并透传', async () => {
  const jobs = createJobManager();
  const router = createRouter();
  router.use(jobTrackingMiddleware(jobs));
  const calls = [];
  router.add({ method: 'POST', path: '/dsh-canvas/edit-image', prefix: false }, async (req, res) => { calls.push('edit'); res.statusCode = 200; res.headersSent = true; });
  router.add({ method: 'POST', path: '/dsh-canvas/ocr-image', prefix: false }, async (req, res) => { res.statusCode = 500; res.headersSent = true; });
  router.add({ method: 'POST', path: '/dsh-canvas/vectorize-image', prefix: false }, async () => { throw new Error('crash'); });
  router.add({ method: 'GET', path: '/dsh-canvas/health', prefix: false }, async (req, res) => { res.headersSent = true; });
  const res = () => ({ statusCode: 0, headersSent: false, writableEnded: false });
  assert.equal(await router.dispatch({ method: 'POST' }, res(), { pathname: '/dsh-canvas/edit-image' }), true);
  assert.equal(await router.dispatch({ method: 'POST' }, res(), { pathname: '/dsh-canvas/ocr-image' }), true);
  await assert.rejects(router.dispatch({ method: 'POST' }, res(), { pathname: '/dsh-canvas/vectorize-image' }), /crash/);
  await router.dispatch({ method: 'GET' }, res(), { pathname: '/dsh-canvas/health' });
  const list = jobs.list();
  assert.equal(list.length, 3, 'health 不被跟踪');
  assert.deepEqual(list.map((j) => [j.type, j.status]), [['image.edit', 'completed'], ['text.recognize', 'failed'], ['vectorize', 'failed']]);
  assert.equal(list[1].error.code, 'HTTP_500');
  assert.equal(list[2].error.message, 'crash');
  assert.equal(Object.keys(JOB_ROUTES).length, 5);
  assert.deepEqual(calls, ['edit']);
});
