// 内存 Job Store：按创建顺序保存，超出上限时淘汰最早的**终态**任务（进行中的永不淘汰）。
export function createJobStore({ limit = 200 } = {}) {
  const jobs = new Map();
  return {
    set(job) {
      jobs.set(job.id, job);
      if (jobs.size > limit) {
        for (const [id, j] of jobs) {
          if (jobs.size <= limit) break;
          if (j.status === 'completed' || j.status === 'failed' || j.status === 'cancelled') jobs.delete(id);
        }
      }
      return job;
    },
    get(id) { return jobs.get(id) || null; },
    delete(id) { return jobs.delete(id); },
    list({ status, type } = {}) {
      return [...jobs.values()].filter((j) => (!status || j.status === status) && (!type || j.type === type));
    },
    size() { return jobs.size; },
    snapshot() { return [...jobs.values()].map((j) => ({ ...j })); }
  };
}
