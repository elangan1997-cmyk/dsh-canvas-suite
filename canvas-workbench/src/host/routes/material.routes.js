// 自 lib/index.js apply() 机械迁移（v1.8 Phase 2）：每个 handler 体逐字未改，
// 原来的 `if (pathname === … && req.method === …) { … }` 外壳由 router 负责。
import { access, mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { isAbsolutePath, isWindows, openFolder, pickFolder } from '../../../lib/platform.js';
import { parseQuery, readBody, respond } from '../server/http.js';
import { materialDirectory, normalizeLocalPath } from '../../shared/utils/paths.js';
import { name } from '../plugin-meta.js';
import { isImagePath } from '../../shared/utils/image-types.js';
import { probeMaterialSize } from '../../shared/utils/image-metadata.js';
import { MATERIAL_TAG_COLORS, readMaterialTags, tagsForDirectory, writeMaterialTags } from '../services/material-tags.js';
import { decodeImageData } from '../../shared/utils/data-url.js';

export function register(router, h) {
  const { ctx, runProcess } = h;
  router.add({ method: 'GET', path: '/dsh-canvas/materials', prefix: false }, async (req, res, { pathname, query, CORS, sameOriginRequest }) => {
          // 素材库是独立目录；cwd 只用于从旧版“工作区/画布素材库”平滑迁移。
          const params = parseQuery(query);
          try {
            const mdir = materialDirectory(params.dir, params.cwd);
            await mkdir(mdir, { recursive: true });
            const entries = await readdir(mdir);
            const files = [];
            for (const name of entries) {
              if (name.startsWith('.')) continue;
              const full = join(mdir, name);
              try {
                const st = await stat(full);
                if (!st.isFile() || !isImagePath(name)) continue;
                const size = await probeMaterialSize(full, st);
                files.push({ name, size: st.size, mtime: st.mtimeMs, width: size.width, height: size.height });
              } catch (err) {}
            }
            files.sort((a, b) => b.mtime - a.mtime);
            respond(res, 200, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: true, dir: mdir, files }));
          } catch (err) {
            respond(res, 500, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: false, error: String((err && err.message) || err) }));
          }
          return;
  });

  router.add({ method: 'GET', path: '/dsh-canvas/materials/tags', prefix: false }, async (req, res, { pathname, query, CORS, sameOriginRequest }) => {
          try {
            const mdir = materialDirectory(parseQuery(query).dir, parseQuery(query).cwd);
            respond(res, 200, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: true, tags: tagsForDirectory(await readMaterialTags(), mdir) }));
          } catch (err) {
            respond(res, 400, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: false, error: String((err && err.message) || err) }));
          }
          return;
  });

  router.add({ method: 'POST', path: '/dsh-canvas/materials/tag', prefix: false }, async (req, res, { pathname, query, CORS, sameOriginRequest }) => {
          try {
            const body = JSON.parse(await readBody(req) || '{}');
            const mdir = materialDirectory(body.dir, body.cwd);
            const names = Array.isArray(body.names) ? body.names.map((value) => basename(String(value || '').replace(/[\\/:*?"<>|]/g, ''))).filter(Boolean) : [];
            const color = String(body.color || '').trim();
            if (!names.length) throw new Error('缺少要标记的素材');
            if (color && !MATERIAL_TAG_COLORS.has(color)) throw new Error('不支持的颜色标记');
            const tags = await readMaterialTags();
            for (const name of names) {
              const target = join(mdir, name);
              if (color) tags[target] = color;
              else delete tags[target];
            }
            await writeMaterialTags(tags);
            respond(res, 200, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: true, tags: tagsForDirectory(tags, mdir) }));
          } catch (err) {
            respond(res, 400, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: false, error: String((err && err.message) || err) }));
          }
          return;
  });

  router.add({ method: 'POST', path: '/dsh-canvas/materials/save', prefix: false }, async (req, res, { pathname, query, CORS, sameOriginRequest }) => {
          try {
            const body = JSON.parse(await readBody(req) || '{}');
            const mdir = materialDirectory(body.dir, body.cwd);
            await mkdir(mdir, { recursive: true });
            const decoded = decodeImageData(body.dataURL);
            if (!decoded) throw new Error('图片数据无效或超过限制');
            let name = basename(String(body.name || '').replace(/[\\/:*?"<>|]/g, '-').trim()) || ('素材-' + Date.now() + '.png');
            if (!isImagePath(name)) name += '.' + (decoded.ext || 'png');
            let target = join(mdir, name);
            try { await access(target); target = join(mdir, Date.now() + '-' + name); } catch (err) {}
            await writeFile(target, decoded.bytes);
            respond(res, 200, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: true, name: basename(target), path: target }));
          } catch (err) {
            respond(res, 500, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: false, error: String((err && err.message) || err) }));
          }
          return;
  });

  router.add({ method: 'POST', path: '/dsh-canvas/materials/open', prefix: false }, async (req, res, { pathname, query, CORS, sameOriginRequest }) => {
          try {
            const body = JSON.parse(await readBody(req) || '{}');
            const mdir = materialDirectory(body.dir, body.cwd);
            await mkdir(mdir, { recursive: true });
            const outcome = await openFolder(ctx, runProcess, mdir);
            if (outcome.exitCode !== 0) throw new Error(isWindows ? '资源管理器打开失败' : '访达打开失败');
            respond(res, 200, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: true, dir: mdir }));
          } catch (err) {
            respond(res, 500, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: false, error: String((err && err.message) || err) }));
          }
          return;
  });

  router.add({ method: 'POST', path: '/dsh-canvas/materials/select', prefix: false }, async (req, res, { pathname, query, CORS, sameOriginRequest }) => {
          try {
            const body = JSON.parse(await readBody(req) || '{}');
            let selected = normalizeLocalPath(body.path);
            if (!selected) selected = await pickFolder(ctx, runProcess, '选择素材库文件夹');
            if (!selected || !isAbsolutePath(selected)) throw new Error('素材库目录必须使用绝对路径');
            const info = await stat(selected);
            if (!info.isDirectory()) throw new Error('选择的不是文件夹');
            respond(res, 200, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: true, dir: selected }));
          } catch (err) {
            respond(res, 500, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: false, error: String((err && err.message) || err) }));
          }
          return;
  });

  router.add({ method: 'POST', path: '/dsh-canvas/materials/delete', prefix: false }, async (req, res, { pathname, query, CORS, sameOriginRequest }) => {
          try {
            const body = JSON.parse(await readBody(req) || '{}');
            const mdir = materialDirectory(body.dir, body.cwd);
            const name = basename(String(body.name || '').replace(/[\\/:*?"<>|]/g, ''));
            if (!name) throw new Error('missing material name');
            const target = join(mdir, name);
            if (!isImagePath(target)) throw new Error('仅允许删除图片文件');
            await unlink(target);
            // 同步清掉颜色标记，避免同目录重建同名文件时带上旧标记。
            try {
              const tags = await readMaterialTags();
              if (tags[target]) { delete tags[target]; await writeMaterialTags(tags); }
            } catch (err) {}
            respond(res, 200, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: true }));
          } catch (err) {
            respond(res, 500, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: false, error: String((err && err.message) || err) }));
          }
          return;
  });
}
