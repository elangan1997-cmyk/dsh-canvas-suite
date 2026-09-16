// 极简路由器：复刻原 apply() 里顺序 if 链的语义——按注册顺序匹配 path(+method)，
// handler 通过 respond() 写响应即视为已处理；未写响应则继续尝试后续路由（等价于原来的 fall-through）。
export function createRouter() {
  const routes = [];
  return {
    add(spec, handler) { routes.push({ ...spec, handler }); },
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
