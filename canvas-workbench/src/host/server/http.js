// 自 lib/index.js 机械迁移（v1.8 Phase 2），函数体逐字未改。
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
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try { resolve(Buffer.concat(chunks).toString('utf8')); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function respond(res, status, headers, body) {
  try { res.writeHead(status, headers); res.end(body); } catch (e) { try { res.end(); } catch (_) {} }
}

export { parseQuery, readBody, respond };
