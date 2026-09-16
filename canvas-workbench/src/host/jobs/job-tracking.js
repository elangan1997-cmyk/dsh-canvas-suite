// Job 跟踪中间件：对生成/编辑类路由在分派前后自动 create → start → complete/fail。
// 不改 handler、不改响应；只把每次调用登记到 JobManager（供 GET /dsh-canvas/jobs 与事件订阅）。
export const JOB_ROUTES = Object.freeze({
  '/dsh-canvas/edit-image': 'image.edit',
  '/dsh-canvas/remove-background': 'background.remove',
  '/dsh-canvas/vectorize-image': 'vectorize',
  '/dsh-canvas/ocr-image': 'text.recognize',
  '/dsh-canvas/export-text-psd': 'text.psd-export'
});

export function jobTrackingMiddleware(jobs, { routes = JOB_ROUTES } = {}) {
  return (spec, handler) => {
    const type = routes[spec.path];
    if (!type || spec.prefix) return handler;
    return async (req, res, env) => {
      const job = jobs.create({ type, params: { route: spec.path, method: req.method } });
      jobs.start(job.id);
      try {
        await handler(req, res, env);
        const status = Number(res.statusCode || 0);
        if (status >= 400) jobs.fail(job.id, Object.assign(new Error(`HTTP ${status}`), { code: 'HTTP_' + status }));
        else jobs.complete(job.id, { result: { status } });
      } catch (err) {
        try { jobs.fail(job.id, err); } catch {}
        throw err;
      }
    };
  };
}
