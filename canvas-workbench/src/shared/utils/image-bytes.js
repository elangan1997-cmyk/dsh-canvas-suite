// 图片字节嗅探（自 lib/image-engine.js 逐字迁移）。
export function imageMediaType(bytes) {
  const b = Buffer.from(bytes);
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (b.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return 'image/jpeg';
  if (b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (b.subarray(0, 6).toString('ascii') === 'GIF87a' || b.subarray(0, 6).toString('ascii') === 'GIF89a') return 'image/gif';
  return 'application/octet-stream';
}

export function dataUrl(bytes) {
  const mediaType = imageMediaType(bytes);
  if (!mediaType.startsWith('image/')) throw new Error('图片输入格式无效');
  return `data:${mediaType};base64,${Buffer.from(bytes).toString('base64')}`;
}
