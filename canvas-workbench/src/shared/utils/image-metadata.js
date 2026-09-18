// 自 lib/index.js 机械迁移（v1.8 Phase 2），函数体逐字未改。
import { open } from 'node:fs/promises';

function parseImageHeaderSize(buf) {
  if (!buf || buf.length < 12) return null;
  // PNG：IHDR 宽高固定在 16/20 偏移。
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    if (buf.length < 24) return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // GIF：逻辑屏幕尺寸在 6/8 偏移（小端）。
  if (buf.toString('ascii', 0, 3) === 'GIF') {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  // BMP：像素宽高在 18/22 偏移（小端，顶向下位图高为负）。
  if (buf[0] === 0x42 && buf[1] === 0x4d && buf.length >= 26) {
    return { width: Math.abs(buf.readInt32LE(18)), height: Math.abs(buf.readInt32LE(22)) };
  }
  // WebP：RIFF/WEBP 容器，按 VP8X / VP8L / VP8 数据块取画布尺寸。
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8X' && buf.length >= 30) {
      return {
        width: 1 + ((buf[24] | buf[25] << 8 | buf[26] << 16) & 0xffffff),
        height: 1 + ((buf[27] | buf[28] << 8 | buf[29] << 16) & 0xffffff)
      };
    }
    if (chunk === 'VP8L' && buf.length >= 25 && buf[20] === 0x2f) {
      const bits = buf[21] | buf[22] << 8 | buf[23] << 16 | buf[24] << 24;
      return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
    }
    if (chunk === 'VP8 ' && buf.length >= 30) {
      return {
        width: buf[26] | (buf[27] & 0x3f) << 8,
        height: buf[28] | (buf[29] & 0x3f) << 8
      };
    }
    return null;
  }
  // JPEG：逐段扫描 SOFn（0xC0-0xCF，除 C4/C8/CC），高在前宽在后。
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buf.length) {
      if (buf[offset] !== 0xff) { offset += 1; continue; }
      const marker = buf[offset + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
      if (marker === 0xda) break;
      if ((marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
      }
      const segmentLength = buf.readUInt16BE(offset + 2);
      if (segmentLength < 2) break;
      offset += 2 + segmentLength;
    }
    return null;
  }
  // SVG：文本属性匹配，接受常见单位与百分号（百分号视为未知）。
  const svgText = buf.toString('utf8', 0, Math.min(buf.length, 4096));
  if (/^\s*(?:<\?xml|<!DOCTYPE|<svg)/i.test(svgText) || svgText.includes('<svg')) {
    const pick = (attr) => {
      const match = new RegExp(attr + '\\s*=\\s*"([^"]+)"').exec(svgText) || new RegExp(attr + "\\s*=\\s*'([^']+)'").exec(svgText);
      if (!match) return 0;
      const value = parseFloat(match[1]);
      return Number.isFinite(value) ? Math.round(value) : 0;
    };
    let width = pick('width');
    let height = pick('height');
    if ((!width || !height)) {
      const viewBox = /viewBox\s*=\s*["']\s*[\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)/i.exec(svgText);
      if (viewBox) { width = width || Math.round(parseFloat(viewBox[1])); height = height || Math.round(parseFloat(viewBox[2])); }
    }
    if (width && height) return { width, height };
  }
  return null;
}

// 素材目录可能位于外置盘；按 path+mtime+size 记忆缓存，只有文件变化后才会重读。

const materialSizeCache = new Map();

async function probeMaterialSize(path, info) {
  const key = path + ':' + info.mtimeMs + ':' + info.size;
  if (materialSizeCache.has(key)) return materialSizeCache.get(key);
  let result = { width: 0, height: 0 };
  try {
    const handle = await open(path, 'r');
    try {
      const limit = Math.min(info.size || 0, 65536);
      const buf = Buffer.alloc(limit);
      const { bytesRead } = limit > 0 ? await handle.read(buf, 0, limit, 0) : { bytesRead: 0 };
      result = parseImageHeaderSize(buf.subarray(0, bytesRead)) || result;
    } finally { await handle.close(); }
  } catch (err) {}
  materialSizeCache.set(key, result);
  return result;
}

// 颜色标记集中存放在插件数据目录（跨项目共享，按绝对路径索引）。

export { parseImageHeaderSize, materialSizeCache, probeMaterialSize };
