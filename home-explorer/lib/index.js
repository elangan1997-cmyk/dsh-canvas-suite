import { homedir } from 'node:os';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';

/**
 * @local/home-explorer — Host half
 *
 * 静态 Cordis 插件：通过 webServer 服务注册 /dsh-home-explorer 前缀路由：
 *   GET /dsh-home-explorer/home                  → 用户主目录绝对路径
 *   GET /dsh-home-explorer/list?path=<abs>       → 目录条目列表
 *   GET /dsh-home-explorer/read?path=<abs>       → 文本文件内容（>1MB 提示不支持）
 *   GET /dsh-home-explorer/image?path=<abs>      → 图片字节（缩略图/预览）
 *
 * 客户端（lib/client.js）全部走同源 HTTP fetch，无需 RPC。
 */
const MAX_READ = 1000000;
const MAX_IMAGE = 32 * 1024 * 1024;
const MAX_SAVE_BODY = 48 * 1024 * 1024;
const IMAGE_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml', ico: 'image/x-icon' };

function extOf(p) { const m = /\.([a-zA-Z0-9]+)$/.exec(String(p)); return m ? m[1].toLowerCase() : ''; }
function parseQuery(qs) {
  const out = {};
  if (!qs) return out;
  for (const pair of qs.split('&')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const k = pair.slice(0, eq);
    if (k) out[k] = decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, ' '));
  }
  return out;
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_SAVE_BODY) { reject(new Error('图片过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => { try { resolve(Buffer.concat(chunks).toString('utf8')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function respond(res, status, headers, body) {
  try { res.writeHead(status, headers); res.end(body); } catch (e) { try { res.end(); } catch (_) {} }
}
function json(res, status, obj) {
  respond(res, status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, JSON.stringify(obj));
}

const name = 'home-explorer';
const inject = ['webServer', 'fs'];

function apply(ctx) {
  const fs = ctx.fs;
  const home = homedir();
  const message = (err) => String((err && err.message) || err);
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  const dispose = ctx.webServer.register({
    kind: 'prefix',
    path: '/dsh-home-explorer',
    handler: async (req, res) => {
      try {
        if (req.method === 'OPTIONS') { respond(res, 204, CORS, ''); return; }
        const raw = String(req.url || '/');
        const qi = raw.indexOf('?');
        const pathname = qi === -1 ? raw : raw.slice(0, qi);
        const query = qi === -1 ? '' : raw.slice(qi + 1);

        if (pathname === '/dsh-home-explorer/home') { json(res, 200, { path: home }); return; }

        if (pathname === '/dsh-home-explorer/save-image' && req.method === 'POST') {
          try {
            const body = JSON.parse(await readBody(req));
            const directory = typeof body.directory === 'string' ? body.directory : '';
            const match = typeof body.dataURL === 'string' ? /^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/.exec(body.dataURL) : null;
            if (!directory || !match) { json(res, 400, { error: '缺少目录或图片数据' }); return; }
            const dirTarget = await fs.resolve(directory);
            const info = await fs.stat(dirTarget);
            if (!info || info.type !== 'directory') { json(res, 400, { error: '保存目标不是目录' }); return; }
            const extMap = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'image/bmp': 'bmp', 'image/svg+xml': 'svg' };
            const ext = extMap[match[1].toLowerCase()] || 'png';
            const requested = String(body.name || 'canvas-image').replace(/\.[a-zA-Z0-9]+$/, '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').trim().slice(0, 80) || 'canvas-image';
            const dirPath = fs.processPath(dirTarget);
            const bytes = Buffer.from(match[2], 'base64');
            if (!bytes.length || bytes.length > MAX_IMAGE) { json(res, 400, { error: '图片数据无效或超过 32MB' }); return; }
            let saved = '';
            for (let i = 0; i < 1000; i += 1) {
              const target = join(dirPath, requested + (i ? '-' + i : '') + '.' + ext);
              try { await writeFile(target, bytes, { flag: 'wx' }); saved = target; break; }
              catch (err) { if (!err || err.code !== 'EEXIST') throw err; }
            }
            if (!saved) throw new Error('无法生成不重名文件');
            json(res, 200, { ok: true, path: saved });
          } catch (err) { json(res, 500, { error: message(err) }); }
          return;
        }

        if (req.method !== 'GET') { respond(res, 405, { ...CORS, 'content-type': 'text/plain' }, 'use GET'); return; }

        if (pathname === '/dsh-home-explorer/list') {
          const path = parseQuery(query).path || '';
          if (!path) { json(res, 400, { error: 'missing path' }); return; }
          try {
            const target = await fs.resolve(path);
            const info = await fs.stat(target);
            if (info === undefined || info.type !== 'directory') { json(res, 404, { error: 'not-a-directory' }); return; }
            const entries = await fs.listDir(target);
            json(res, 200, { entries: entries.map((e) => ({ name: e.name, type: e.type, size: typeof e.size === 'number' ? e.size : null, path: fs.processPath(e.target) })) });
          } catch (err) { json(res, 500, { error: message(err) }); }
          return;
        }

        if (pathname === '/dsh-home-explorer/read') {
          const path = parseQuery(query).path || '';
          if (!path) { json(res, 400, { error: 'missing path' }); return; }
          try {
            const target = await fs.resolve(path);
            const info = await fs.stat(target);
            if (info === undefined) { json(res, 404, { error: 'not-found' }); return; }
            if (info.type !== 'file') { json(res, 400, { error: 'not-a-file' }); return; }
            const size = typeof info.size === 'number' ? info.size : 0;
            if (size > MAX_READ) { json(res, 200, { tooLarge: true, size }); return; }
            const content = await fs.readText(target);
            json(res, 200, { content, size });
          } catch (err) { json(res, 500, { error: message(err) }); }
          return;
        }

        if (pathname === '/dsh-home-explorer/image') {
          const path = parseQuery(query).path || '';
          const mime = IMAGE_MIME[extOf(path)];
          if (!mime) { respond(res, 400, { ...CORS, 'content-type': 'text/plain' }, 'bad image path'); return; }
          try {
            const target = await fs.resolve(path);
            const bytes = await fs.readBytes(target, undefined, MAX_IMAGE);
            respond(res, 200, { 'content-type': mime, 'content-length': String(bytes.byteLength), 'cache-control': 'no-store', ...CORS }, bytes);
          } catch (err) {
            respond(res, 404, { ...CORS, 'content-type': 'text/plain' }, 'image not found');
          }
          return;
        }

        respond(res, 404, { ...CORS, 'content-type': 'text/plain' }, 'not found');
      } catch (err) {
        respond(res, 500, { 'content-type': 'text/plain' }, 'internal error');
      }
    }
  });
  // ctx.effect 立即执行回调；回调返回 dispose（不执行），fiber 卸载时才真正销毁路由。
  ctx.effect(() => dispose);
}

export { apply, inject, name };
