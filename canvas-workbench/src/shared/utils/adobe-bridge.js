// Adobe 桥接：纯函数共享模块（无 Node / DOM 依赖）。Host 直接 import；客户端由 build-manifest 内联。
// 目录名、清单命名、序号、路径判定都集中在这里——改协议先改 adobe-bridge/PROTOCOL.md，再改这里。
const ADOBE_BRIDGE_PROTOCOL = 1;
const ADOBE_BRIDGE_DIR = 'ADOBE桥接';
const ADOBE_BRIDGE_INBOX = Object.freeze({ photoshop: '来自Photoshop', illustrator: '来自Illustrator' });
const ADOBE_BRIDGE_OUTBOX = '发件箱';
const ADOBE_BRIDGE_APPS = Object.freeze(['photoshop', 'illustrator']);
const ADOBE_BRIDGE_APP_LABELS = Object.freeze({ photoshop: 'Photoshop', illustrator: 'Illustrator' });
// 画布可原样返回给 Adobe 的文件类型（图片按图片、分层按分层，不做转换）。
const ADOBE_BRIDGE_RETURNABLE = Object.freeze(['png', 'jpg', 'jpeg', 'webp', 'psd', 'ai', 'svg', 'pdf']);

/** 路径是否位于项目的 ADOBE桥接/ 目录下（通用自动上画布要跳过它，交给桥接轮询器）。 */
function isAdobeBridgePath(path) {
  return /[\\/]ADOBE桥接[\\/]/.test(String(path || ''));
}

/** 是否为待处理清单：`*.json` 但不是 `*.done.json` / `*.failed.json`。 */
function isPendingBridgeManifest(name) {
  const value = String(name || '');
  return /\.json$/i.test(value) && !/\.(done|failed)\.json$/i.test(value);
}

/** 文件名安全化：去掉路径分隔与非法字符，折叠空白，限长；空值用 fallback。 */
function sanitizeBridgeName(value, fallback) {
  const cleaned = String(value || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  const capped = cleaned.length > 60 ? cleaned.slice(0, 60).trim() : cleaned;
  return capped || String(fallback || '文件');
}

/** 发件箱序号：扫描现有文件名的 `NNNN-` 前缀取最大值 +1（永不覆盖历史）。 */
function nextOutboxSeq(names) {
  let max = 0;
  for (const name of names || []) {
    const match = /^(\d{4,})[-.]/.exec(String(name || ''));
    if (match) max = Math.max(max, Number(match[1]) || 0);
  }
  return max + 1;
}

function padSeq(seq) {
  return String(Math.max(1, Number(seq) || 1)).padStart(4, '0');
}

/** 发件文件名：`0007-标题-画布.psd`。 */
function outboxFileName(seq, name, fallbackExt) {
  const safe = sanitizeBridgeName(name, '画布图片' + (fallbackExt ? '.' + fallbackExt : ''));
  return padSeq(seq) + '-' + safe;
}

function bridgeExtOf(name) {
  const value = String(name || '');
  const dot = value.lastIndexOf('.');
  return dot > 0 ? value.slice(dot + 1).toLowerCase() : '';
}

function isReturnableBridgeFile(name) {
  return ADOBE_BRIDGE_RETURNABLE.includes(bridgeExtOf(name));
}

/** 校验收件清单结构（脚本写的 JSON）。返回 { ok, error, manifest }；不做磁盘检查。 */
function validateInboundManifest(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, error: '清单不是对象' };
  if (Number(raw.protocol) !== ADOBE_BRIDGE_PROTOCOL) return { ok: false, error: '协议版本不匹配：' + raw.protocol };
  if (!ADOBE_BRIDGE_APPS.includes(raw.app)) return { ok: false, error: '未知 app：' + raw.app };
  if (!raw.jobId || typeof raw.jobId !== 'string') return { ok: false, error: '缺少 jobId' };
  if (!Array.isArray(raw.items) || !raw.items.length) return { ok: false, error: '清单 items 为空' };
  for (const item of raw.items) {
    if (!item || typeof item.file !== 'string' || !item.file) return { ok: false, error: '清单 item 缺少 file' };
    if (/[\\/]/.test(item.file)) return { ok: false, error: '清单 item.file 不能含路径：' + item.file };
  }
  return { ok: true, manifest: raw };
}

/** 生成发件清单对象（写盘前的最终结构；脚本按此读取）。 */
function buildOutboundManifest({ seq, targetApp, files, origin, createdAt }) {
  const at = Number(createdAt) || Date.now();
  const stamp = new Date(at);
  const pad = (n) => String(n).padStart(2, '0');
  const jobId = 'out-' + stamp.getFullYear() + pad(stamp.getMonth() + 1) + pad(stamp.getDate()) + '-' + pad(stamp.getHours()) + pad(stamp.getMinutes()) + pad(stamp.getSeconds()) + '-' + padSeq(seq);
  return {
    protocol: ADOBE_BRIDGE_PROTOCOL,
    jobId,
    seq: Number(seq) || 1,
    targetApp: ADOBE_BRIDGE_APPS.includes(targetApp) ? targetApp : 'photoshop',
    createdAt: at,
    files: (files || []).map((f) => ({ file: String(f.file || ''), name: String(f.name || f.file || ''), kind: String(f.kind || bridgeExtOf(f.file) || 'png') })),
    origin: origin && typeof origin === 'object' ? origin : null,
    placement: 'auto'
  };
}

export {
  ADOBE_BRIDGE_PROTOCOL, ADOBE_BRIDGE_DIR, ADOBE_BRIDGE_INBOX, ADOBE_BRIDGE_OUTBOX, ADOBE_BRIDGE_APPS, ADOBE_BRIDGE_APP_LABELS, ADOBE_BRIDGE_RETURNABLE,
  isAdobeBridgePath, isPendingBridgeManifest, sanitizeBridgeName, nextOutboxSeq, padSeq, outboxFileName, bridgeExtOf, isReturnableBridgeFile,
  validateInboundManifest, buildOutboundManifest
};
