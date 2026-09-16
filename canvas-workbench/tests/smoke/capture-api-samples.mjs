// 通过 CDP 在真实 DSH 渲染进程里执行 api-requests.mjs 的请求清单，把 1.7.0 基线响应落盘。
// 用法：node tests/smoke/capture-api-samples.mjs <fixtureDir> <outDir>
import { connectDsh } from './cdp-client.mjs';
import { buildRequests, normalizeResponse } from '../integration/api-requests.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const fixtureDir = process.argv[2];
const outDir = process.argv[3];
if (!fixtureDir || !outDir) { console.error('用法: capture-api-samples.mjs <fixtureDir> <outDir>'); process.exit(1); }

const cdp = await connectDsh();
await mkdir(outDir, { recursive: true });
const requests = buildRequests(fixtureDir);
const results = {};
let index = 0;
for (const req of requests) {
  index += 1;
  const init = req.method === 'GET' ? { method: req.method } : { method: req.method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(req.body || {}) };
  const r = await cdp.api(req.path, init);
  const res = { status: r.status, contentType: r.contentType, binary: Boolean(req.binary) };
  if (req.binary) {
    const meta = await cdp.eval(`(async () => {
      const r = await fetch(${JSON.stringify(req.path)});
      const buf = await r.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', buf);
      const hex = [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
      return { byteLength: buf.byteLength, sha256: hex };
    })()`);
    res.byteLength = meta.byteLength; res.sha256 = meta.sha256;
  } else if (typeof r.body === 'string') {
    res.byteLength = r.body.length;
    try { res.body = JSON.parse(r.body); } catch { res.body = r.body; }
  } else {
    res.body = r.body;
  }
  results[req.name] = normalizeResponse(res, { fixtureDir });
  console.log(String(index).padStart(2), req.name.padEnd(32), '→', res.status);
}
await writeFile(join(outDir, 'summary.json'), JSON.stringify(results, null, 2));
console.log('已写入', join(outDir, 'summary.json'));
cdp.close();
