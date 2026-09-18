// v1.8 新增只读端点（执行文档 §5 §7 §20）：统一 Asset 视图、能力集、Python 工具清单。
// 响应用 §28 统一形状 { ok, data } / { ok:false, error:{code,message} }。既有路由不受影响。
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parseQuery, respond } from '../server/http.js';
import { createAsset, assetTypeOf, inferSourceType } from '../../shared/contracts/asset.js';
import { probeMaterialSize } from '../../shared/utils/image-metadata.js';
import { normalizeLocalPath } from '../../shared/utils/paths.js';
import { isAbsolutePath, platformCapabilities } from '../../../lib/platform.js';
import { BUILTIN_FEATURES, capabilitiesFromHealth, createFeatureRegistry } from '../../shared/registry/feature-registry.js';
import { imageEngineHealth } from '../../providers/image-engine.js';

export function register(router, h) {
  const { ctx, pythonTools } = h;
  const json = (res, CORS, status, payload) => respond(res, status, { ...CORS, 'content-type': 'application/json', 'cache-control': 'no-store' }, JSON.stringify(payload));
  const fail = (res, CORS, status, code, message) => json(res, CORS, status, { ok: false, error: { code, message } });

  router.add({ method: 'GET', path: '/dsh-canvas/assets', prefix: false }, async (req, res, { query, CORS }) => {
    const dir = normalizeLocalPath(parseQuery(query).dir || '');
    if (!dir || !isAbsolutePath(dir)) { fail(res, CORS, 400, 'INVALID_REQUEST', '缺少绝对路径 dir'); return; }
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch (err) { fail(res, CORS, 404, 'ASSET_NOT_FOUND', '目录不存在或不可读：' + dir); return; }
    const assets = [];
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.startsWith('.')) continue;
      const path = join(dir, entry.name);
      if (!assetTypeOf(path)) continue;
      try {
        const info = await stat(path);
        let size = { width: null, height: null };
        if (assetTypeOf(path) === 'image') { try { const probed = await probeMaterialSize(path, info); if (probed) size = probed; } catch {} }
        assets.push(createAsset({ path, fileName: entry.name, size: info.size, width: size.width, height: size.height, mtimeMs: info.mtimeMs, source: { type: inferSourceType(entry.name) } }));
      } catch {}
    }
    assets.sort((a, b) => a.fileName.localeCompare(b.fileName, 'zh-Hans-CN'));
    json(res, CORS, 200, { ok: true, data: { dir, assets, total: assets.length } });
  });

  router.add({ method: 'GET', path: '/dsh-canvas/capabilities', prefix: false }, async (req, res, { CORS }) => {
    let engine = null;
    try { engine = await imageEngineHealth(ctx); } catch {}
    const health = {
      capabilities: { webServer: true, subprocess: Boolean(ctx.get('subprocess')), llm: Boolean(ctx.get('llm')), attachments: Boolean(ctx.get('attachments')) },
      platform: platformCapabilities(),
      imageEngine: engine
    };
    const capabilities = capabilitiesFromHealth(health);
    const registry = createFeatureRegistry();
    for (const f of BUILTIN_FEATURES) registry.register(f);
    json(res, CORS, 200, { ok: true, data: { capabilities, features: registry.list().map((f) => ({ id: f.id, name: f.name, capabilities: f.capabilities, enabled: f.capabilities.every((c) => Boolean(capabilities[c])) })) } });
  });

  router.add({ method: 'GET', path: '/dsh-canvas/python-tools', prefix: false }, async (req, res, { CORS }) => {
    json(res, CORS, 200, { ok: true, data: { tools: pythonTools ? pythonTools.list() : [] } });
  });
}
