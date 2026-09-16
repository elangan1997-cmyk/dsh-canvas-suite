// 自 lib/index.js 机械迁移（v1.8 Phase 2），函数体逐字未改。
import { open, readFile } from 'node:fs/promises';

async function readCanvasProjectElements(path, info) {
  // 快速列表只读 elements/appState 所在的文件头，避免为统计数量读取几十到数百 MB 的 Base64 图片。
  const maxHeaderBytes = Math.min(Number(info && info.size || 0), 8 * 1024 * 1024);
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(maxHeaderBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxHeaderBytes, 0);
    const header = buffer.subarray(0, bytesRead).toString('utf8');
    const marker = /,\s*"files"\s*:/.exec(header);
    if (marker) {
      const summary = JSON.parse(header.slice(0, marker.index) + '}');
      return Array.isArray(summary.elements) ? summary.elements : [];
    }
  } finally {
    await handle.close();
  }
  const snapshot = JSON.parse(await readFile(path, 'utf8'));
  return Array.isArray(snapshot.elements) ? snapshot.elements : [];
}

export { readCanvasProjectElements };
