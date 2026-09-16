// 自 lib/index.js 机械迁移（v1.8 Phase 2），函数体逐字未改。
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;

const MAX_SOURCE_BYTES = 128 * 1024 * 1024;

const IMAGE_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml' };

const DOCUMENT_EXTENSIONS = new Set(['pdf', 'ai']);

const RASTER_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp']);

const SOURCE_EXTENSIONS = new Set([...Object.keys(IMAGE_MIME), ...DOCUMENT_EXTENSIONS, 'psd']);

function extOf(p) { const m = /\.([a-zA-Z0-9]+)$/.exec(String(p)); return m ? m[1].toLowerCase() : ''; }

function mimeOf(p) { return IMAGE_MIME[extOf(p)] || null; }

function isImagePath(p) { return typeof p === 'string' && mimeOf(p) !== null; }

function isRasterImagePath(p) { return typeof p === 'string' && RASTER_EXTENSIONS.has(extOf(p)); }

function isSourceImagePath(p) { return typeof p === 'string' && SOURCE_EXTENSIONS.has(extOf(p)); }

function sourceKindOf(p) {
  const ext = extOf(p);
  if (ext === 'psd') return 'psd';
  if (ext === 'svg') return 'svg';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'ai') return 'ai';
  return 'image';
}

function cleanJobId(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 96);
}

export { MAX_IMAGE_BYTES, MAX_SOURCE_BYTES, IMAGE_MIME, DOCUMENT_EXTENSIONS, RASTER_EXTENSIONS, SOURCE_EXTENSIONS, extOf, mimeOf, isImagePath, isRasterImagePath, isSourceImagePath, sourceKindOf, cleanJobId };
