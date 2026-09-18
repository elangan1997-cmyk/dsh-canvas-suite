// Adobe 桥接路由（协议见 adobe-bridge/PROTOCOL.md §5 / §9）。业务逻辑都在 ../services/adobe-bridge.js，
// 这里只做：解析请求 → 定位项目目录 → 调服务 → JSON 响应。所有响应 { ok, error?, ... }。
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { parseQuery, readBody, respond } from '../server/http.js';
import { expandHome } from '../../shared/utils/paths.js';

export function register(router, h) {
  const { adobeBridge, projectDirectory, writeManagedImage } = h;
  const json = (res, CORS, status, payload) => respond(res, status, { ...CORS, 'content-type': 'application/json' }, JSON.stringify(payload));
  const fail = (res, CORS, err) => json(res, CORS, 500, { ok: false, error: String((err && err.message) || err) });
  const requireProject = (cwd, project) => {
    const projectDir = projectDirectory(cwd, project);
    if (!projectDir) throw new Error('当前聊天没有画布项目');
    return projectDir;
  };

  router.add({ method: 'POST', path: '/dsh-canvas/adobe-bridge/activate', prefix: false }, async (req, res, { CORS }) => {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const projectDir = requireProject(body.cwd, body.project);
      const handshake = await adobeBridge.activate({ projectDir, projectName: basename(projectDir), sessionId: body.sessionId });
      json(res, CORS, 200, { ok: true, written: !!handshake });
    } catch (err) { fail(res, CORS, err); }
  });

  router.add({ method: 'GET', path: '/dsh-canvas/adobe-bridge/inbound', prefix: false }, async (req, res, { query, CORS }) => {
    try {
      const q = parseQuery(query);
      const projectDir = requireProject(q.cwd, q.project);
      json(res, CORS, 200, { ok: true, jobs: await adobeBridge.listInbound(projectDir) });
    } catch (err) { fail(res, CORS, err); }
  });

  router.add({ method: 'POST', path: '/dsh-canvas/adobe-bridge/ack', prefix: false }, async (req, res, { CORS }) => {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const projectDir = requireProject(body.cwd, body.project);
      json(res, CORS, 200, await adobeBridge.ackInbound(projectDir, body.manifest));
    } catch (err) { fail(res, CORS, err); }
  });

  // 画布「→Ps / →Ai」：每项优先用磁盘源文件；没有源文件（粘贴图等）先用 dataURL 落盘到 assets。
  // 写完发件箱后，若目标应用正在运行，直接远程置入（用户不必打开面板）；失败或未运行则留在发件箱由面板处理。
  router.add({ method: 'POST', path: '/dsh-canvas/adobe-bridge/return', prefix: false }, async (req, res, { CORS }) => {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const projectDir = requireProject(body.cwd, body.project);
      const items = Array.isArray(body.items) ? body.items.slice(0, 50) : [];
      const resolved = [];
      for (const item of items) {
        if (!item) continue;
        let path = expandHome(String(item.sourcePath || ''));
        if (path) { try { const info = await stat(path); if (!info.isFile()) path = ''; } catch { path = ''; } }
        if (!path && item.dataURL) path = (await writeManagedImage(projectDir, item.name || '画布图片.png', item.dataURL)).path;
        if (!path) throw new Error('图片没有源文件也没有图像数据：' + String(item.name || ''));
        resolved.push({ path, name: basename(path), bridge: item.bridge && typeof item.bridge === 'object' ? item.bridge : null });
      }
      const result = await adobeBridge.createReturn(projectDir, { app: body.app, items: resolved });
      let remote = { attempted: false, running: false, placed: 0, error: '' };
      if (body.auto !== false) {
        remote.attempted = true;
        try {
          const placed = await adobeBridge.placePending(body.app, body.mode === 'open' ? 'open' : 'place');
          remote.running = placed.running;
          remote.placed = placed.placed;
        } catch (err) {
          remote.running = true;
          remote.error = String((err && err.message) || err);
        }
      }
      json(res, CORS, 200, { ok: true, ...result, remote });
    } catch (err) { fail(res, CORS, err); }
  });

  // 画布「取 Ps 图层 / 取 Ai 对象」：远程让运行中的 PS/AI 把当前选区送进收件箱；随后客户端轮询上画布。
  router.add({ method: 'POST', path: '/dsh-canvas/adobe-bridge/pull', prefix: false }, async (req, res, { CORS }) => {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const projectDir = requireProject(body.cwd, body.project);
      await adobeBridge.activate({ projectDir, projectName: basename(projectDir), sessionId: body.sessionId });
      const result = await adobeBridge.pullSelection(body.app, projectDir, { merged: body.merged === true, dpi: body.dpi });
      json(res, CORS, 200, { ok: true, ...result });
    } catch (err) { fail(res, CORS, err); }
  });

  router.add({ method: 'GET', path: '/dsh-canvas/adobe-bridge/status', prefix: false }, async (req, res, { CORS }) => {
    try { json(res, CORS, 200, { ok: true, ...(await adobeBridge.status()) }); } catch (err) { fail(res, CORS, err); }
  });

  // { cep: true }：安装 CEP 常驻面板（用户级目录，免管理员，自动打开 PlayerDebugMode）。
  // { elevate: true }（macOS）：对 root 目录用系统管理员密码弹窗装菜单脚本；否则普通安装（通常因权限记录 hint）。
  router.add({ method: 'POST', path: '/dsh-canvas/adobe-bridge/install-scripts', prefix: false }, async (req, res, { CORS }) => {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const result = body.cep === true ? await adobeBridge.installCep() : (body.elevate === true ? await adobeBridge.installScriptsElevated() : await adobeBridge.installScripts());
      json(res, CORS, 200, { ok: true, ...result });
    } catch (err) { fail(res, CORS, err); }
  });
}
