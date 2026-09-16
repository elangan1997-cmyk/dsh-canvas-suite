// Asset 契约（执行文档 §7）：所有文件统一进入 Asset 视图；Canvas 只引用 assetId 而不是到处传绝对路径。
// 注意：本文件是共享契约，不依赖 Node fs；构造时由调用方提供 stat/尺寸信息。
export const ASSET_TYPES = ['image', 'video', 'document', 'source'];
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp', 'svg']);
const VIDEO_EXT = new Set(['mp4', 'mov', 'webm', 'm4v']);
const DOCUMENT_EXT = new Set(['pdf', 'ai']);
const SOURCE_EXT = new Set(['psd', 'sketch', 'fig', 'xd']);
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/x-m4v', pdf: 'application/pdf', ai: 'application/postscript', psd: 'image/vnd.adobe.photoshop' };

export function assetExt(path) { const m = /\.([a-zA-Z0-9]+)$/.exec(String(path || '')); return m ? m[1].toLowerCase() : ''; }
export function assetTypeOf(path) {
  const ext = assetExt(path);
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  if (DOCUMENT_EXT.has(ext)) return 'document';
  if (SOURCE_EXT.has(ext)) return 'source';
  return null;
}
export function assetMimeOf(path) { return MIME[assetExt(path)] || 'application/octet-stream'; }

/** 稳定 id：同一绝对路径恒得同一 id（FNV-1a 32 位，够用且无依赖）。 */
export function assetIdFor(path) {
  let h = 0x811c9dc5;
  const s = String(path || '');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return 'asset_' + h.toString(16).padStart(8, '0');
}

export function createAsset({ path, fileName, size = 0, width = null, height = null, duration = null, mtimeMs = 0, source = {}, metadata = {} } = {}) {
  const type = assetTypeOf(path);
  if (!type) throw new Error('不支持的资产类型：' + path);
  const name = fileName || String(path).split(/[\\/]/).pop();
  return {
    id: assetIdFor(path),
    type,
    mimeType: assetMimeOf(path),
    path: String(path),
    fileName: name,
    size: Number(size) || 0,
    width: width === null ? null : Number(width),
    height: height === null ? null : Number(height),
    duration: type === 'video' ? duration : null,
    createdAt: Number(mtimeMs) || 0,
    source: { type: source.type || 'imported', parentAssetIds: Array.isArray(source.parentAssetIds) ? [...source.parentAssetIds] : [] },
    metadata: { ...metadata }
  };
}

/** 从文件名推断来源类型：`-编辑`/`-擦除`/`-矢量` 等后缀是 1.7.0 的派生产物约定。 */
export function inferSourceType(fileName) {
  const base = String(fileName || '').replace(/\.[a-zA-Z0-9]+$/, '');
  if (/-(编辑|擦除|去背景|矢量|重建|修复)(-\d+)?$/.test(base)) return 'derived';
  if (/^(dsh|gen|generated|生成)[-_]/i.test(base) || /^\d{8}-\d{6}/.test(base)) return 'generated';
  return 'imported';
}
