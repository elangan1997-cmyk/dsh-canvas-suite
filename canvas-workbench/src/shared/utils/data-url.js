// 自 lib/index.js 机械迁移（v1.8 Phase 2），函数体逐字未改。
import { access } from 'node:fs/promises';
import { extname } from 'node:path';
import { IMAGE_MIME, MAX_SOURCE_BYTES, SOURCE_EXTENSIONS, extOf } from './image-types.js';
import { name } from '../../host/plugin-meta.js';

function sourcePathFromImageUrl(value) {
  try {
    const parsed = new URL(String(value), 'http://canvas-workbench.local');
    if (parsed.pathname !== '/dsh-canvas/image') return '';
    return parsed.searchParams.get('path') || '';
  } catch (err) {
    return '';
  }
}

async function firstExisting(paths) {
  for (const path of paths) {
    if (!path) continue;
    try { await access(path); return path; } catch (err) {}
  }
  return '';
}

function decodeImageData(dataUrl) {
  const match = /^data:(image\/(?:png|jpeg|jpg|webp|gif|avif|bmp));base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(dataUrl || ''));
  if (!match) return null;
  const encoded = match[2].replace(/\s+/g, '');
  if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return null;
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_SOURCE_BYTES) return null;
  const mime = match[1].toLowerCase();
  const subtype = mime.split('/')[1].replace('jpeg', 'jpg');
  return { bytes, ext: subtype, mime };
}

function decodeSourceData(dataUrl, name, fallbackExt) {
  const ext = extOf(name) || String(fallbackExt || '').toLowerCase().replace(/^\./, '');
  if (!SOURCE_EXTENSIONS.has(ext)) return null;
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+\/=\s]+)$/.exec(String(dataUrl || ''));
  if (!match) return null;
  const bytes = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  // PSD/PDF/AI are source documents rather than render previews.  Keep their
  // upload limit aligned with writeManagedSource (128MB); using the 32MB image
  // limit here made large PSD drops fail even though the route advertised
  // 128MB support.
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_SOURCE_BYTES) return null;
  return { bytes, ext, mime: match[1] };
}

function safeImageName(value, fallbackExt = 'png') {
  const raw = String(value || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').trim().slice(0, 120);
  const ext = extname(raw).replace(/^\./, '').toLowerCase();
  const base = (ext ? raw.slice(0, -(ext.length + 1)) : raw).replace(/[. ]+$/g, '').trim() || '画布图片';
  const finalExt = IMAGE_MIME[ext] ? ext : fallbackExt;
  return base + '.' + finalExt;
}

function normalizeTextLayerText(value) {
  let text = String(value || '').replace(/\s+/g, ' ').trim();
  // Remove OCR-inserted gaps between adjacent CJK glyphs while preserving
  // intentional spaces inside Latin words such as “Aquarium Filter Media”.
  text = text.replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, '$1');
  text = text.replace(/([\u3400-\u9fff])\s+(?=[，。！？；：、）》】])/g, '$1');
  text = text.replace(/([（【《])\s+/g, '$1');
  return text;
}

export { sourcePathFromImageUrl, firstExisting, decodeImageData, decodeSourceData, safeImageName, normalizeTextLayerText };
