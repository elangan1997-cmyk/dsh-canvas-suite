// Job Manager（执行文档 §10.2）：状态机 + 事件。视频等异步 Provider 未来通过同一套接口接入。
import { createJob, canTransition, TERMINAL_STATUSES } from '../../shared/contracts/generation-job.js';
import { createJobStore } from './job-store.js';
import { createEventBus } from '../../shared/events/event-bus.js';
import { EVENTS } from '../../shared/events/event-types.js';

export function createJobManager({ store = createJobStore(), bus = createEventBus(), now = () => Date.now() } = {}) {
  const transition = (job, to, patch = {}) => {
    if (!canTransition(job.status, to)) throw new Error(`任务 ${job.id} 不能从 ${job.status} 迁移到 ${to}`);
    Object.assign(job, patch, { status: to });
    store.set(job);
    return job;
  };
  const requireJob = (id) => {
    const job = store.get(id);
    if (!job) throw new Error('任务不存在：' + id);
    return job;
  };
  return {
    bus,
    store,
    create(input) {
      const job = store.set(createJob(input, now()));
      bus.emit(EVENTS.JOB_CREATED, { job: { ...job } });
      return { ...job };
    },
    start(id) {
      const job = transition(requireJob(id), 'running', { startedAt: now() });
      bus.emit(EVENTS.JOB_STARTED, { job: { ...job } });
      return { ...job };
    },
    update(id, patch = {}) {
      const job = requireJob(id);
      if (TERMINAL_STATUSES.has(job.status)) throw new Error(`任务 ${id} 已结束（${job.status}），不能再更新`);
      const next = {};
      if (patch.progress !== undefined) next.progress = Math.max(0, Math.min(100, Number(patch.progress) || 0));
      if (patch.params) next.params = { ...job.params, ...patch.params };
      if (patch.message !== undefined) next.message = String(patch.message);
      const to = job.status === 'queued' ? 'running' : job.status;
      transition(job, to, job.status === 'queued' ? { ...next, startedAt: now() } : next);
      bus.emit(EVENTS.JOB_PROGRESS, { job: { ...job } });
      return { ...job };
    },
    complete(id, outputs = {}) {
      const job = requireJob(id);
      if (job.status === 'queued') transition(job, 'running', { startedAt: now() });
      transition(job, 'completed', {
        progress: 100,
        finishedAt: now(),
        outputAssetIds: Array.isArray(outputs.outputAssetIds) ? [...outputs.outputAssetIds] : job.outputAssetIds,
        result: outputs.result === undefined ? job.result : outputs.result
      });
      bus.emit(EVENTS.JOB_COMPLETED, { job: { ...job } });
      return { ...job };
    },
    fail(id, error) {
      const job = requireJob(id);
      if (job.status === 'queued') transition(job, 'running', { startedAt: now() });
      const message = error && error.message ? error.message : String(error || '未知错误');
      transition(job, 'failed', { finishedAt: now(), error: { message, code: error && error.code ? String(error.code) : 'JOB_FAILED' } });
      bus.emit(EVENTS.JOB_FAILED, { job: { ...job } });
      return { ...job };
    },
    cancel(id) {
      const job = requireJob(id);
      if (TERMINAL_STATUSES.has(job.status)) return { ...job };
      transition(job, 'cancelled', { finishedAt: now() });
      bus.emit(EVENTS.JOB_CANCELLED, { job: { ...job } });
      return { ...job };
    },
    get(id) { const job = store.get(id); return job ? { ...job } : null; },
    list(filter) { return store.list(filter).map((j) => ({ ...j })); },
    /** 用任务包裹一段异步工作：自动 create → start → complete/fail，返回工作结果。 */
    async run(input, work) {
      const job = this.create(input);
      this.start(job.id);
      try {
        const result = await work(job.id);
        this.complete(job.id, { result: result && result.summary !== undefined ? result.summary : undefined });
        return result;
      } catch (err) {
        this.fail(job.id, err);
        throw err;
      }
    }
  };
}
