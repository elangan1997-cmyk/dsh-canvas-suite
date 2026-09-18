// Generation Job 契约（执行文档 §10.1）。
export const JOB_TYPES = ['image.generate', 'image.edit', 'video.generate', 'background.remove', 'vectorize', 'text.recognize', 'text.psd-export'];
export const JOB_STATUSES = ['queued', 'running', 'processing', 'completed', 'failed', 'cancelled'];
export const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

// 合法状态迁移：queued → running → processing → completed/failed；任何非终态可 cancelled。
export const TRANSITIONS = {
  queued: new Set(['running', 'cancelled', 'failed']),
  // running/processing 允许自迁移：进度更新不算状态变化
  running: new Set(['running', 'processing', 'completed', 'failed', 'cancelled']),
  processing: new Set(['processing', 'completed', 'failed', 'cancelled']),
  completed: new Set(),
  failed: new Set(),
  cancelled: new Set()
};

let seq = 0;
export function newJobId(now = Date.now()) {
  seq = (seq + 1) % 1e6;
  return 'job_' + now.toString(36) + '_' + seq.toString(36).padStart(4, '0');
}

export function createJob(input = {}, now = Date.now()) {
  const type = String(input.type || '');
  if (!JOB_TYPES.includes(type)) throw new Error('未知任务类型：' + type);
  return {
    id: input.id || newJobId(now),
    type,
    providerId: input.providerId ? String(input.providerId) : null,
    status: 'queued',
    progress: 0,
    inputAssetIds: Array.isArray(input.inputAssetIds) ? [...input.inputAssetIds] : [],
    outputAssetIds: [],
    params: input.params && typeof input.params === 'object' ? { ...input.params } : {},
    error: null,
    createdAt: now,
    startedAt: null,
    finishedAt: null
  };
}

export function canTransition(from, to) {
  return Boolean(TRANSITIONS[from] && TRANSITIONS[from].has(to));
}
