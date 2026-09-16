// 生成确定性的画布样例项目（不含任何个人图片）。供 integration / smoke / migration 测试使用。
//
//   import { makeSampleProject } from './make-sample-project.mjs';
//   const { dir, assets } = await makeSampleProject('/tmp/dsh-sample');
//
// 生成物：project.json(version 1) / canvas.json(3 个 image 元素 + 内嵌 dataURL) / assets/* / outputs/
// PNG、BMP、SVG 为纯 Node 合成；JPEG、WebP、GIF 在有 Pillow 的 python3 时补充生成（没有则跳过）。

import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

/** 纯色 + 对角线的 RGBA PNG，大小可控，用于尺寸排序/header 解析测试。 */
export function makePng(width, height, [r, g, b] = [220, 40, 40]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const o = row + 1 + x * 4;
      const diag = Math.abs(x - y) < 2;
      raw[o] = diag ? 255 : r; raw[o + 1] = diag ? 255 : g; raw[o + 2] = diag ? 255 : b; raw[o + 3] = 255;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
  ]);
}

/** 24 位未压缩 BMP。 */
export function makeBmp(width, height, [r, g, b] = [40, 120, 220]) {
  const rowSize = Math.ceil(width * 3 / 4) * 4;
  const pixels = rowSize * height;
  const buf = Buffer.alloc(54 + pixels);
  buf.write('BM', 0); buf.writeUInt32LE(54 + pixels, 2); buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14); buf.writeInt32LE(width, 18); buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26); buf.writeUInt16LE(24, 28); buf.writeUInt32LE(pixels, 34);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const o = 54 + y * rowSize + x * 3; buf[o] = b; buf[o + 1] = g; buf[o + 2] = r;
  }
  return buf;
}

export function makeSvg(width, height) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#f4d35e"/><text x="12" y="${Math.round(height / 2)}" font-family="sans-serif" font-size="24">样例 SVG</text></svg>`;
}

function pillowPython() {
  for (const bin of [process.env.DSH_TEST_PYTHON, 'python3', join(process.env.HOME || '', '.dsh/canvas-workbench/python-runtime/bin/python3.12')].filter(Boolean)) {
    const r = spawnSync(bin, ['-c', 'import PIL'], { stdio: 'ignore' });
    if (r.status === 0) return bin;
  }
  return null;
}

export async function makeSampleProject(target, { withPillow = true } = {}) {
  const dir = resolve(target);
  await rm(dir, { recursive: true, force: true });
  await mkdir(join(dir, 'assets'), { recursive: true });
  await mkdir(join(dir, 'outputs'), { recursive: true });

  const assets = [];
  const put = async (name, bytes, width, height) => {
    await writeFile(join(dir, 'assets', name), bytes);
    assets.push({ name, path: join(dir, 'assets', name), width, height, size: bytes.length });
  };
  await put('a-small-red.png', makePng(64, 48), 64, 48);
  await put('b-wide-green.png', makePng(320, 120, [40, 180, 90]), 320, 120);
  await put('c-square-blue.bmp', makeBmp(200, 200), 200, 200);
  await put('d-vector.svg', Buffer.from(makeSvg(240, 80), 'utf8'), 240, 80);

  const py = withPillow ? pillowPython() : null;
  if (py) {
    const script = `
from PIL import Image
import sys, os
d = sys.argv[1]
Image.new('RGB', (150, 100), (200, 120, 40)).save(os.path.join(d, 'e-photo.jpg'), quality=85)
Image.new('RGB', (96, 96), (120, 60, 200)).save(os.path.join(d, 'f-web.webp'), quality=80)
Image.new('P', (40, 30), 3).save(os.path.join(d, 'g-anim.gif'))
`;
    const r = spawnSync(py, ['-c', script, join(dir, 'assets')], { encoding: 'utf8' });
    if (r.status === 0) {
      const { statSync } = await import('node:fs');
      for (const [name, w, h] of [['e-photo.jpg', 150, 100], ['f-web.webp', 96, 96], ['g-anim.gif', 40, 30]]) {
        const p = join(dir, 'assets', name);
        assets.push({ name, path: p, width: w, height: h, size: statSync(p).size });
      }
    }
  }

  const now = 1789000000000;
  const files = {};
  const elements = assets.filter((a) => /\.png$/.test(a.name)).map((a, i) => {
    const fileId = 'fixture-file-' + (i + 1);
    files[fileId] = { id: fileId, mimeType: 'image/png', created: now, lastRetrieved: now, dataURL: 'data:image/png;base64,' + makePng(8, 8).toString('base64') };
    return {
      id: 'fixture-el-' + (i + 1), type: 'image', x: 100 + i * 400, y: 100, width: a.width, height: a.height, angle: 0,
      strokeColor: 'transparent', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 1, strokeStyle: 'solid',
      roughness: 0, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: 1000 + i, version: 1, versionNonce: 1, isDeleted: false,
      boundElements: null, updated: now, link: null, locked: false, status: 'saved', fileId, scale: [1, 1],
      customData: { dshFileName: a.name, dshSourcePath: a.path, dshSourceMtime: now, dshSourceKind: 'image', dshManaged: true, ...(i === 1 ? { dshTagColor: 'blue' } : {}) }
    };
  });
  const canvas = { elements, appState: { theme: 'light', viewBackgroundColor: '#ffffff', gridSize: null }, files };
  await writeFile(join(dir, 'canvas.json'), JSON.stringify(canvas));
  await writeFile(join(dir, 'project.json'), JSON.stringify({ version: 1, canvas: 'canvas.json', assets: 'assets', outputs: 'outputs', updatedAt: new Date(now).toISOString() }, null, 2));
  return { dir, assets, elements: elements.length, pillow: Boolean(py) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = await makeSampleProject(process.argv[2] || '/tmp/dsh-canvas-sample-project');
  console.log(JSON.stringify(out, null, 2));
}
