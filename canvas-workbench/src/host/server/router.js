// 极简路由器：复刻原 apply() 里顺序 if 链的语义——按注册顺序匹配 path(+method)，
// handler 通过 respond() 写响应即视为已处理；未写响应则继续尝试后续路由（等价于原来的 fall-through）。
// use(middleware)：middleware(spec, handler) → handler'，在 add() 时按注册顺序包裹（用于 Job 跟踪等横切关注）。
export function createRouter() {
  const routes = [];
  const middlewares = [];
  return {
    use(middleware) { middlewares.push(middleware); },
    add(spec, handler) {
      let wrapped = handler;
      for (const mw of middlewares) wrapped = mw(spec, wrapped) || wrapped;
      routes.push({ ...spec, handler: wrapped });
    },
    list() { return routes.map((r) => ({ method: r.method, path: r.path, prefix: r.prefix })); },
    async dispatch(req, res, env) {
      for (const r of routes) {
        const pathOk = r.prefix ? env.pathname.startsWith(r.path) : env.pathname === r.path;
        if (!pathOk) continue;
        if (r.method && req.method !== r.method) continue;
        await r.handler(req, res, env);
        if (res.headersSent || res.writableEnded) return true;
      }
      return false;
    }
  };
}
