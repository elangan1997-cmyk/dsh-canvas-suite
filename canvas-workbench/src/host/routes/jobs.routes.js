// 任务查询路由（v1.8 Phase 4 新增，只读 + 取消）。响应采用 §28 统一形状 { ok, data } / { ok:false, error }。
import { parseQuery, readBody, respond } from '../server/http.js';

export function register(router, h) {
  const { jobs } = h;
  const json = (res, CORS, status, payload) => respond(res, status, { ...CORS, 'content-type': 'application/json', 'cache-control': 'no-store' }, JSON.stringify(payload));

  router.add({ method: 'GET', path: '/dsh-canvas/jobs', prefix: false }, async (req, res, { query, CORS }) => {
    const params = parseQuery(query);
    const filter = {};
    if (params.status) filter.status = String(params.status);
    if (params.type) filter.type = String(params.type);
    const list = jobs.list(filter);
    json(res, CORS, 200, { ok: true, data: { jobs: list, total: list.length } });
  });

  router.add({ method: 'GET', path: '/dsh-canvas/jobs/get', prefix: false }, async (req, res, { query, CORS }) => {
    const job = jobs.get(String(parseQuery(query).id || ''));
    if (!job) { json(res, CORS, 404, { ok: false, error: { code: 'JOB_NOT_FOUND', message: '任务不存在' } }); return; }
    json(res, CORS, 200, { ok: true, data: { job } });
  });

  router.add({ method: 'POST', path: '/dsh-canvas/jobs/cancel', prefix: false }, async (req, res, { CORS }) => {
    let body = {};
    try { body = JSON.parse(await readBody(req) || '{}'); } catch { body = {}; }
    const id = String(body.id || '');
    if (!jobs.get(id)) { json(res, CORS, 404, { ok: false, error: { code: 'JOB_NOT_FOUND', message: '任务不存在' } }); return; }
    json(res, CORS, 200, { ok: true, data: { job: jobs.cancel(id) } });
  });
}
