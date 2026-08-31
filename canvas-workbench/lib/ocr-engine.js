import { access, mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

// Tesseract.js keeps the OCR engine and traineddata in a user-scoped cache.
// This avoids requiring an administrator-installed tesseract.exe on Windows
// and keeps the plugin package itself small.
export const TESSERACT_JS_VERSION = '5.1.1';
const RUNTIME_ROOT = join(homedir(), '.dsh', 'canvas-workbench', 'tesseract-runtime');
const CACHE_ROOT = join(homedir(), '.dsh', 'canvas-workbench', 'tesseract-cache');
const PACKAGE_ENTRY = join(RUNTIME_ROOT, 'node_modules', 'tesseract.js', 'src', 'index.js');
const PACKAGE_JSON = join(RUNTIME_ROOT, 'node_modules', 'tesseract.js', 'package.json');
const requireFromPlugin = createRequire(import.meta.url);
let runtimePromise = null;

function cleanText(value) {
  let text = String(value || '').replace(/\s+/g, ' ').trim();
  text = text.replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, '$1');
  text = text.replace(/([\u3400-\u9fff])\s+(?=[，。！？；：、）》】])/g, '$1');
  text = text.replace(/([（【《])\s+/g, '$1');
  return text;
}

function normalizeLanguages(value) {
  const aliases = new Map([
    ['zh', 'chi_sim'], ['zh-cn', 'chi_sim'], ['zh_cn', 'chi_sim'],
    ['zh-tw', 'chi_tra'], ['zh_tw', 'chi_tra'], ['en', 'eng'],
  ]);
  const list = String(value || 'chi_sim+eng').split(/[+,]/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .map((item) => aliases.get(item) || item.replace(/[^a-z0-9_]/g, ''));
  const allowed = list.filter((item) => /^[a-z][a-z0-9_]{1,31}$/.test(item));
  return [...new Set(allowed.length ? allowed : ['chi_sim', 'eng'])];
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function uint32be(bytes, offset) {
  return ((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
}

function uint16le(bytes, offset) { return bytes[offset] | (bytes[offset + 1] << 8); }
function uint32le(bytes, offset) { return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0; }

async function readImageSize(inputPath) {
  const bytes = await readFile(inputPath);
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { width: uint32be(bytes, 16), height: uint32be(bytes, 20) };
  }
  if (bytes.length >= 10 && (bytes.subarray(0, 6).toString('ascii') === 'GIF87a' || bytes.subarray(0, 6).toString('ascii') === 'GIF89a')) {
    return { width: uint16le(bytes, 6), height: uint16le(bytes, 8) };
  }
  if (bytes.length >= 30 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') {
    const kind = bytes.subarray(12, 16).toString('ascii');
    if (kind === 'VP8X' && bytes.length >= 30) {
      return { width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16), height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16) };
    }
    if (kind === 'VP8 ' && bytes.length >= 30) return { width: uint16le(bytes, 26), height: uint16le(bytes, 28) };
    if (kind === 'VP8L' && bytes.length >= 25) return { width: 1 + (bytes[21] | ((bytes[22] & 0x3f) << 8)), height: 1 + (((bytes[22] >> 6) | (bytes[23] << 2) | ((bytes[24] & 0xf) << 10))) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      offset += 2;
      if (marker === 0xd8 || marker === 0xd9) continue;
      if (offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
      }
      offset += length;
    }
  }
  throw new Error('无法读取图片尺寸');
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function rectFromLine(line, width, height) {
  const box = line && line.bbox;
  if (!box || typeof box !== 'object') return null;
  const x0 = clamp(Math.round(number(box.x0)), 0, Math.max(0, width - 1));
  const y0 = clamp(Math.round(number(box.y0)), 0, Math.max(0, height - 1));
  const x1 = clamp(Math.round(number(box.x1)), x0 + 1, width);
  const y1 = clamp(Math.round(number(box.y1)), y0 + 1, height);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function intersects(block, region) {
  const bx = number(block && block.x), by = number(block && block.y);
  const bw = number(block && block.width), bh = number(block && block.height);
  const rx = number(region && region.x), ry = number(region && region.y);
  const rw = number(region && region.width), rh = number(region && region.height);
  const iw = Math.max(0, Math.min(bx + bw, rx + rw) - Math.max(bx, rx));
  const ih = Math.max(0, Math.min(by + bh, ry + rh) - Math.max(by, ry));
  if (iw <= 0 || ih <= 0) return false;
  const blockArea = Math.max(1, bw * bh);
  const centerX = bx + bw / 2, centerY = by + bh / 2;
  // A row may extend a little outside a hand-drawn rectangle, but a sliver
  // crossing its edge is not enough to make it an editable candidate.
  return (iw * ih) >= blockArea * 0.35
    || (centerX >= rx && centerX <= rx + rw && centerY >= ry && centerY <= ry + rh);
}

function candidateFromLine(line, width, height, region) {
  const text = cleanText(line && line.text);
  const confidence = number(line && line.confidence, -1);
  const compact = text.replace(/[^A-Za-z0-9\u3400-\u9fff]/g, '');
  if (!text || !compact || confidence < 30) return null;
  const hasCjk = /[\u3400-\u9fff]/.test(text);
  const latinOnly = /^[A-Za-z][A-Za-z .,'’:/+&-]*$/.test(text);
  if (latinOnly && !hasCjk && confidence < 55) return null;
  if (compact.length <= 1 && confidence < 55) return null;
  if (!hasCjk && compact.length <= 2 && confidence < 58) return null;
  const rect = rectFromLine(line, width, height);
  if (!rect || (region && !intersects(rect, region))) return null;
  const boxHeight = Math.max(1, rect.height);
  return {
    text,
    originalText: text,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    confidence: Math.round(confidence * 10) / 10,
    enabled: true,
    fontSize: Math.max(12, Math.min(220, Math.round(boxHeight * 0.92))),
    fontFamily: 'PingFang SC',
    fontPostScript: 'PingFangSC-Regular',
    fontWeight: 'normal',
    color: '#111827',
  };
}

function mergeRows(rows) {
  const sorted = rows.slice().sort((a, b) => a.y - b.y || a.x - b.x);
  const merged = [];
  for (const item of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous) {
      merged.push(item);
      continue;
    }
    const maxHeight = Math.max(previous.height, item.height, 1);
    const overlap = Math.max(0, Math.min(previous.y + previous.height, item.y + item.height) - Math.max(previous.y, item.y));
    const overlapRatio = overlap / Math.max(1, Math.min(previous.height, item.height));
    const centerDelta = Math.abs((previous.y + previous.height / 2) - (item.y + item.height / 2));
    const left = previous.x <= item.x ? previous : item;
    const right = previous.x <= item.x ? item : previous;
    const gap = Math.max(0, right.x - (left.x + left.width));
    if ((overlapRatio >= 0.45 || centerDelta <= maxHeight * 0.45) && gap <= Math.max(96, maxHeight * 4)) {
      previous.text = cleanText(previous.text + ' ' + item.text);
      previous.originalText = previous.text;
      previous.x = Math.min(previous.x, item.x);
      previous.y = Math.min(previous.y, item.y);
      const rightEdge = Math.max(previous.x + previous.width, item.x + item.width);
      const bottomEdge = Math.max(previous.y + previous.height, item.y + item.height);
      previous.width = Math.max(1, rightEdge - previous.x);
      previous.height = Math.max(1, bottomEdge - previous.y);
      previous.confidence = Math.max(previous.confidence, item.confidence);
      previous.fontSize = Math.max(12, Math.min(220, Math.round(previous.height * 0.92)));
    } else {
      merged.push(item);
    }
  }
  return merged.map((item, index) => ({ ...item, id: `ocr-${index + 1}` })).slice(0, 200);
}

async function installRuntime(ctx, runProcessWithTimeout, cwd) {
  await mkdir(RUNTIME_ROOT, { recursive: true });
  // DSH's restricted Windows subprocess host cannot always spawn a `.cmd`
  // shim directly (it reports EINVAL). Invoke npm's JavaScript CLI through a
  // real node.exe instead, just like a normal `npm install` command.
  const nodeCandidates = [process.execPath];
  for (const name of ['node.exe', 'node']) {
    try {
      const resolved = await ctx.subprocess.resolveExecutable(name);
      if (resolved) nodeCandidates.push(resolved);
    } catch {}
  }
  let node = '';
  let npmCli = '';
  for (const candidate of [...new Set(nodeCandidates)]) {
    if (!candidate) continue;
    const cli = join(dirname(candidate), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    try { await access(cli); node = candidate; npmCli = cli; break; } catch {}
  }
  if (!node || !npmCli) throw new Error('未找到 npm，无法准备本地 OCR 运行环境');
  const result = await runProcessWithTimeout(node, [npmCli, 'install', '--prefix', RUNTIME_ROOT, '--no-package-lock', '--ignore-scripts',
    '--no-audit', '--no-fund', 'tesseract.js@' + TESSERACT_JS_VERSION], cwd, 240000);
  if (result.exitCode !== 0 || result.timedOut) {
    const detail = String(result.stderr || result.stdout || '').trim().split(/\r?\n/).slice(-3).join(' ');
    throw new Error('安装本地 OCR 运行环境失败' + (detail ? '：' + detail : '，请检查网络后重试'));
  }
  try { await access(PACKAGE_ENTRY); } catch { throw new Error('本地 OCR 运行环境安装不完整'); }
}

async function loadTesseract(ctx, runProcessWithTimeout, cwd) {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      try { await access(PACKAGE_ENTRY); } catch { await installRuntime(ctx, runProcessWithTimeout, cwd); }
      await mkdir(CACHE_ROOT, { recursive: true });
      return requireFromPlugin(PACKAGE_ENTRY);
    })().catch((error) => {
      runtimePromise = null;
      throw error;
    });
  }
  return runtimePromise;
}

function expandedCrop(crop, width, height) {
  const x = clamp(number(crop && crop.x), 0, Math.max(0, width - 1));
  const y = clamp(number(crop && crop.y), 0, Math.max(0, height - 1));
  const w = clamp(number(crop && crop.width), 1, width - x);
  const h = clamp(number(crop && crop.height), 1, height - y);
  // A small context border prevents Tesseract from seeing a clipped glyph at
  // the edge of a tight user selection.  Returned boxes are filtered back to
  // the original selection, so this does not widen the erase target.
  const padX = Math.max(8, Math.min(28, Math.round(w * 0.04)));
  const padY = Math.max(6, Math.min(20, Math.round(h * 0.08)));
  const left = Math.max(0, x - padX), top = Math.max(0, y - padY);
  const right = Math.min(width, x + w + padX), bottom = Math.min(height, y + h + padY);
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

export async function recognizeWithTesseractJs({ ctx, runProcessWithTimeout, cwd, inputPath, width, height, lang, psm, crop }) {
  const tesseract = await loadTesseract(ctx, runProcessWithTimeout, cwd);
  if (!(Number(width) > 0 && Number(height) > 0)) {
    const size = await readImageSize(inputPath);
    width = size.width;
    height = size.height;
  }
  const languages = normalizeLanguages(lang);
  const worker = await tesseract.createWorker(languages, 1, {
    cachePath: CACHE_ROOT,
    // Keep the service response JSON-only; progress is intentionally not
    // emitted into DSH's bounded stdout collector.
    logger: () => {},
  });
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: String(psm || '11'),
      preserve_interword_spaces: '1',
    });
    const rectangle = crop ? expandedCrop(crop, width, height) : undefined;
    const result = rectangle
      ? await worker.recognize(inputPath, { rectangle }, { blocks: true, text: true })
      : await worker.recognize(inputPath, {}, { blocks: true, text: true });
    const lines = Array.isArray(result && result.data && result.data.lines) ? result.data.lines : [];
    const blocks = mergeRows(lines.map((line) => candidateFromLine(line, width, height, crop)).filter(Boolean));
    return { success: true, width, height, blocks, crop: crop || undefined, engine: 'tesseract.js' };
  } finally {
    await worker.terminate().catch(() => {});
  }
}
