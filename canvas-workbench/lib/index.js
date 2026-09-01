import { access, mkdir, open, readFile, readdir, rename, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm';
import { recognizeWithTesseractJs } from './ocr-engine.js';
import {
  generateImage,
  imageEngineHealth,
  readImageEngineSettings,
  imageMediaType,
  testImageApiConnection,
  writeLegacyApiAuth,
  writeImageEngineSettings
} from './image-engine.js';
import {
  expandUserPath,
  isAbsolutePath,
  isMac,
  isWindows,
  openFolder,
  openWithSystem,
  pickFolder,
  platformCapabilities,
  revealFile,
  resolvePython
} from './platform.js';

/**
 * @local/canvas-workbench — Host half
 *
 * 静态 Cordis 插件：通过 webServer 服务注册 /dsh-canvas 前缀路由：
 *   GET  /dsh-canvas/image?path=<abs>  → 本地图片字节（CORS 开放）
 *   GET  /dsh-canvas/state            → 画布状态 JSON（工作区 .dsh-canvas-state.json）
 *   POST /dsh-canvas/state            → 保存画布状态 JSON
 *   GET/POST /dsh-canvas/image-settings → 图像引擎选择（脱敏）
 *   GET  /dsh-canvas/health           → 插件与图像引擎健康状态（脱敏）
 *
 * 客户端（lib/client.js）全部走同源 HTTP，无需 RPC。
 */
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_SOURCE_BYTES = 128 * 1024 * 1024;
const IMAGE_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml' };
const DOCUMENT_EXTENSIONS = new Set(['pdf', 'ai']);
const RASTER_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp']);
const SOURCE_EXTENSIONS = new Set([...Object.keys(IMAGE_MIME), ...DOCUMENT_EXTENSIONS, 'psd']);

// 设计模式是 renderer 中的开关，但图片工具在 host/agent 进程中执行。
// 通过一个很小的 host 状态桥把两者同步起来，确保画布开启时所有 agent
// 都能看到同一个 canvas-owned imagegen shadow；关闭后立即恢复 DSH 原生工具。
let canvasDesignMode = false;
const canvasDesignModeListeners = new Set();
const activeCanvasProjectsByCwd = new Map();
function isCanvasDesignMode() { return canvasDesignMode; }
function setCanvasDesignMode(value) {
  const next = Boolean(value);
  if (next === canvasDesignMode) return;
  canvasDesignMode = next;
  for (const listener of [...canvasDesignModeListeners]) {
    try { listener(next); } catch (_) {}
  }
}
function watchCanvasDesignMode(listener) {
  canvasDesignModeListeners.add(listener);
  return () => canvasDesignModeListeners.delete(listener);
}

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
async function findWindowsAdobeExecutable(product, ctx, runProcess, configuredPath = '') {
  if (!isWindows) return '';
  const manualPath = expandUserPath(String(configuredPath || '').trim());
  if (manualPath) {
    try {
      if ((await stat(manualPath)).isFile()) return manualPath;
    } catch (err) {}
  }
  const roots = [...new Set([process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean).map((root) => join(root, 'Adobe')))];
  const prefix = product === 'photoshop' ? 'Adobe Photoshop' : 'Adobe Illustrator';
  const installLocations = [];
  const associatedExecutables = [];
  // Adobe 允许安装到任意盘符（例如 C:\\ps）；查询卸载登记以覆盖自定义路径。
  try {
    let reg = '';
    try { reg = await ctx.subprocess.resolveExecutable('reg.exe'); } catch (err) {}
    if (!reg) reg = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
    const registryKeys = product === 'photoshop'
      ? ['HKLM\\SOFTWARE\\Adobe\\Photoshop', 'HKLM\\SOFTWARE\\WOW6432Node\\Adobe\\Photoshop']
      : ['HKLM\\SOFTWARE\\Adobe\\Illustrator', 'HKLM\\SOFTWARE\\WOW6432Node\\Adobe\\Illustrator'];
    registryKeys.push('HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall');
    for (const key of registryKeys) {
      const result = await runProcess(reg, ['query', key, '/s', '/v', 'InstallLocation'], process.cwd());
      const extra = product === 'photoshop' || product === 'illustrator'
        ? await runProcess(reg, ['query', key, '/s', '/v', 'ApplicationPath'], process.cwd())
        : { stdout: '' };
      for (const line of (String(result.stdout || '') + '\n' + String(extra.stdout || '')).split(/\r?\n/)) {
        const match = line.match(/(?:InstallLocation|ApplicationPath)\s+REG_(?:SZ|EXPAND_SZ)\s+(.+)$/i);
        if (match) {
          const location = String(match[1] || '').trim();
          if (location) installLocations.push(location);
        }
      }
    }
  } catch (err) {}
  // 若安装程序没有写 Uninstall 项，读取 .psd/.ai 的 Windows 文件关联作为兜底。
  try {
    const cmd = await ctx.subprocess.resolveExecutable('cmd.exe');
    const extension = product === 'photoshop' ? '.psd' : '.ai';
    const assoc = await runProcess(cmd, ['/d', '/c', 'assoc', extension], process.cwd());
    const type = String(assoc.stdout || '').match(/=([^\r\n]+)/)?.[1]?.trim();
    if (type) {
      const ftype = await runProcess(cmd, ['/d', '/c', 'ftype', type], process.cwd());
      const executable = String(ftype.stdout || '').match(/=\s*"([^"]+\.exe)"/i)?.[1];
      if (executable) associatedExecutables.push(executable);
    }
  } catch (err) {}
  for (const location of installLocations) {
    if (location.toLowerCase().includes(prefix.toLowerCase())) roots.push(location);
  }
  for (const root of roots) {
    let folders = [];
    if (root.toLowerCase().includes(prefix.toLowerCase()) && !root.toLowerCase().endsWith('\\adobe')) folders = [root];
    else {
      try { folders = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory() && entry.name.toLowerCase().startsWith(prefix.toLowerCase())).map((entry) => entry.name).sort().reverse(); } catch (err) {}
    }
    for (const folder of folders) {
      const base = join(root, folder);
      const candidates = product === 'photoshop'
        ? [join(base, 'Photoshop.exe')]
        : [join(base, 'Support Files', 'Contents', 'Windows', 'Illustrator.exe'), join(base, 'Illustrator.exe')];
      for (const executable of candidates) {
        try { if ((await stat(executable)).isFile()) return executable; } catch (err) {}
      }
    }
  }
  for (const executable of associatedExecutables) {
    try { if ((await stat(executable)).isFile()) return executable; } catch (err) {}
  }
  return '';
}
function cleanJobId(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 96);
}

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
function expandHome(p) {
  return expandUserPath(p);
}
function normalizeLocalPath(value) {
  let path = String(value || '').trim();
  if (/^file:\/\//i.test(path)) {
    try {
      const parsed = new URL(path);
      if (!parsed.hostname || parsed.hostname === 'localhost') path = decodeURIComponent(parsed.pathname);
    } catch (err) {}
  }
  return expandHome(path);
}
// Windows 请求体里的源路径可能使用反斜杠，而 URL/项目路径比较使用正斜杠。
// 统一成不区分大小写的绝对键，避免“删除画布图片”因分隔符不同而跳过归档。
function pathKey(value) {
  return resolve(normalizeLocalPath(value)).replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase();
}
function isPathInside(child, parent) {
  const c = pathKey(child);
  const p = pathKey(parent);
  return c === p || c.startsWith(p + '/');
}
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

const name = 'canvas-workbench';
const inject = ['webServer', 'subprocess', 'llm', 'attachments'];

const CANVAS_IMAGEGEN_PARAMETERS = {
  prompt: { type: 'string', required: true, description: 'Complete generation or edit instruction.' },
  referenced_image_paths: { type: 'array', items: { type: 'string' }, description: 'Up to five local or active-workspace image paths.' },
  num_last_images_to_include: { type: 'integer', description: 'Use the most recent 1–5 conversation images.' },
  output_path: { type: 'string', description: 'Optional active-workspace path for the generated PNG.' },
};
const CANVAS_IMAGEGEN_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    prompt: { type: 'string', required: true },
    engine: { type: 'string', required: true },
    image: {
      type: 'object', required: true, additionalProperties: false,
      properties: {
        attachmentId: { type: 'string', required: true },
        mediaType: { type: 'string', required: true },
        bytes: { type: 'integer', required: true },
        width: { type: 'integer', required: true },
        height: { type: 'integer', required: true },
        name: { type: 'string' },
      },
    },
    file: {
      type: 'object', additionalProperties: false,
      properties: {
        path: { type: 'string', required: true },
        operation: { type: 'string', required: true },
      },
    },
    writeError: { type: 'string' },
  },
};

function collectCanvasImageRefs(content, output) {
  for (const block of Array.isArray(content) ? content : []) {
    if (block && block.type === 'image' && block.attachment) output.push(block.attachment);
    else if (block && block.type === 'tool-result') collectCanvasImageRefs(block.content, output);
  }
}

async function readCanvasImageInputs(toolCtx, args, exec) {
  const paths = Array.isArray(args.referenced_image_paths) ? args.referenced_image_paths : [];
  const count = args.num_last_images_to_include;
  if (paths.length && count !== undefined) throw new Error('请只提供图片路径或最近聊天图片，不能同时提供两者');
  if (paths.length > 5) throw new Error('最多只能引用 5 张图片');
  if (count !== undefined && (!Number.isInteger(count) || count < 1 || count > 5)) throw new Error('最近聊天图片数量必须是 1 到 5');
  const images = [];
  if (paths.length) {
    if (!toolCtx.fs || typeof toolCtx.fs.resolve !== 'function' || typeof toolCtx.fs.readBytes !== 'function') throw new Error('当前 DSH 文件服务不可用，无法读取参考图片');
    const cwd = exec.agent && exec.agent.session && exec.agent.session.header ? exec.agent.session.header.cwd : undefined;
    const maxBytes = toolCtx.attachments && toolCtx.attachments.imageLimits
      ? Math.min(toolCtx.attachments.imageLimits.maxImageBytes, toolCtx.attachments.imageLimits.maxMessageImageBytes)
      : 32 * 1024 * 1024;
    for (const rawPath of paths) {
      const path = String(rawPath || '').trim();
      if (!path) throw new Error('参考图片路径不能为空');
      const target = await toolCtx.fs.resolve(path, { ...(cwd === undefined ? {} : { cwd }), signal: exec.signal });
      const info = await toolCtx.fs.stat(target, exec.signal);
      if (!info || info.type !== 'file') throw new Error('参考图片不存在或不是文件：' + path);
      const data = Buffer.from(await toolCtx.fs.readBytes(target, exec.signal, maxBytes));
      if (!imageMediaType(data).startsWith('image/')) throw new Error('参考文件不是支持的图片格式：' + path);
      images.push(data);
    }
    return images;
  }
  if (count !== undefined) {
    const session = exec.agent && exec.agent.session;
    if (!session || typeof session.deriveMessages !== 'function' || !toolCtx.attachments || typeof toolCtx.attachments.readImage !== 'function') throw new Error('当前会话没有可读取的图片附件');
    const refs = [];
    for (const message of session.deriveMessages() || []) collectCanvasImageRefs(message && message.content, refs);
    const selected = refs.slice(-count);
    if (selected.length !== count) throw new Error(`最近聊天中只有 ${selected.length} 张图片，无法取得 ${count} 张`);
    for (const ref of selected) {
      const stored = await toolCtx.attachments.readImage(ref, exec.signal);
      images.push(Buffer.from(stored.data));
    }
  }
  return images;
}

async function writeCanvasImageOutput(toolCtx, exec, outputPath, bytes) {
  if (!outputPath) return { file: undefined, writeError: undefined };
  try {
    if (!toolCtx.fs || typeof toolCtx.fs.resolve !== 'function' || typeof toolCtx.fs.writeBytes !== 'function') throw new Error('当前文件服务不支持保存输出文件');
    const cwd = exec.agent && exec.agent.session && exec.agent.session.header ? exec.agent.session.header.cwd : undefined;
    const target = await toolCtx.fs.resolve(String(outputPath), { ...(cwd === undefined ? {} : { cwd }), signal: exec.signal });
    const intent = typeof toolCtx.waterfall === 'function'
      ? await toolCtx.waterfall('fs/write-intent', target, exec, () => undefined)
      : undefined;
    const result = await toolCtx.fs.writeBytes(target, bytes, intent, exec.signal);
    return { file: { path: String(target.displayPath || outputPath), operation: String(result && result.operation || 'create') }, writeError: undefined };
  } catch (error) {
    return { file: undefined, writeError: String((error && error.message) || error) };
  }
}

async function writeChatGeneratedImage(exec, bytes, mediaType) {
  try {
    // Chat output is the durable source. It must stay outside every canvas
    // project so deleting/archiving a canvas copy never breaks the chat card
    // or prevents the user from adding the same image again.
    const header = exec.agent && exec.agent.session && exec.agent.session.header;
    const cwd = String(header && header.cwd || '').trim();
    const projectDir = cwd ? activeCanvasProjectsByCwd.get(pathKey(cwd)) : '';
    const outputDir = projectDir
      ? join(projectDir, 'DSH聊天生成图片')
      : join(homedir(), 'Pictures', 'DSH聊天生成图片');
    await mkdir(outputDir, { recursive: true });
    const ext = mediaType === 'image/jpeg' ? 'jpg' : mediaType === 'image/webp' ? 'webp' : 'png';
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
    let target = '';
    for (let index = 0; index < 1000; index += 1) {
      const suffix = index ? `-${index + 1}` : '';
      const candidate = join(outputDir, `聊天生成图片-${stamp}${suffix}.${ext}`);
      try {
        await writeFile(candidate, bytes, { flag: 'wx' });
        target = candidate;
        break;
      } catch (error) {
        if (!error || error.code !== 'EEXIST') throw error;
      }
    }
    if (!target) throw new Error('无法生成不重名的项目图片');
    return { file: { path: target, operation: 'create' }, writeError: undefined };
  } catch (error) {
    return { file: undefined, writeError: String((error && error.message) || error) };
  }
}

function createCanvasImagegenTool(toolCtx, defineTool, toolName) {
  const contentOf = (value) => {
    const file = value.file ? `\n<output_path operation="${value.file.operation}">${value.file.path}</output_path>` : value.writeError ? `\n<output_error>${value.writeError}</output_error>` : '';
    return [
      { type: 'text', text: `<image>${value.image.mediaType}, ${value.image.width}x${value.image.height} px, ${value.image.bytes} bytes</image>${file}\n<canvas_image_engine>${value.engine}</canvas_image_engine>` },
      { type: 'image', attachment: { ...value.image } },
    ];
  };
  return defineTool({
    name: toolName,
    description: 'Generate or edit an image through DSH Canvas. When Design Mode is on, this tool is the active imagegen route and follows the Canvas image engine setting (Codex or configured API). When Design Mode is off, the native DSH imagegen is used.',
    parameters: CANVAS_IMAGEGEN_PARAMETERS,
    output: { schema: CANVAS_IMAGEGEN_OUTPUT_SCHEMA, render: (_args, value) => contentOf(value) },
    timeoutMs: 900000,
    isConcurrencySafe: (args) => args && args.output_path === undefined,
    async execute(args, exec) {
      const settings = await readImageEngineSettings();
      const images = await readCanvasImageInputs(toolCtx, args, exec);
      const generated = await generateImage({ ctx: toolCtx, image: images[0] || Buffer.alloc(0), images, prompt: String(args.prompt || '').trim(), engine: settings.engine, signal: exec.signal });
      const mediaType = imageMediaType(generated.bytes);
      if (!mediaType.startsWith('image/')) throw new Error('图片生成接口返回了不可识别的图片格式');
      const ref = await toolCtx.attachments.saveImage({ data: generated.bytes, mediaType, name: 'canvas-generated.png' });
      // Always keep a durable chat-owned source outside the canvas project.
      // “加入画布” materializes a separate managed copy into project/assets.
      let written = await writeChatGeneratedImage(exec, generated.bytes, mediaType);
      if (!written.file && args.output_path) written = await writeCanvasImageOutput(toolCtx, exec, args.output_path, generated.bytes);
      return {
        prompt: String(args.prompt || '').trim(),
        engine: generated.engine,
        image: {
          attachmentId: String(ref.attachmentId), mediaType, bytes: Number(ref.bytes), width: Number(ref.width), height: Number(ref.height),
          ...(ref.name === undefined ? {} : { name: ref.name }),
        },
        ...(written.file ? { file: written.file } : {}),
        ...(written.writeError ? { writeError: written.writeError } : {}),
      };
    },
  });
}

// While Design Mode is on, provide the standard `imagegen` tool in every live
// agent scope.  Deliberately do not expose a second `canvas_imagegen` tool: a
// second name lets the model bypass DSH's native image result renderer and was
// the reason generated attachments appeared only as a generic failed tool row.
// This registration must not depend on dsh-codex being installed; API-only
// users still need the Canvas image engine to work.
function installCanvasImagegenTool(ctx) {
  if (!ctx || typeof ctx.inject !== 'function') return;
  ctx.inject(['tools', 'attachments', 'fs', 'agents'], (toolCtx) => {
    void import('@deepseek-ai/dsh-tools').then(({ defineTool }) => {
      if (!toolCtx.tools || typeof toolCtx.tools.register !== 'function') return;

      const installed = new Map();
      let syncing = false;
      const remove = (agent) => {
        const current = installed.get(agent);
        if (!current) return;
        installed.delete(agent);
        try { current.dispose(); } catch (_) {}
      };
      const syncAgent = (agent) => {
        const current = installed.get(agent);
        if (!isCanvasDesignMode() || !agent || !agent.ctx || !agent.ctx.tools || typeof agent.ctx.tools.register !== 'function') {
          remove(agent);
          return;
        }
        if (current) return;
        remove(agent);
        try {
          // Register in the agent scope, but execute with the host tool context.
          // Agent-local contexts do not consistently expose the attachments/fs
          // services; using them caused `imagegen` to fail before the request
          // with a missing attachment injection error in Desktop.
          const dispose = agent.ctx.tools.register(createCanvasImagegenTool(toolCtx, defineTool, 'imagegen'));
          installed.set(agent, { dispose });
        } catch (error) { console.warn('[canvas-workbench] imagegen shadow registration skipped:', error); }
      };
      const syncAll = () => {
        if (syncing) return;
        syncing = true;
        try {
          for (const agent of (toolCtx.agents && typeof toolCtx.agents.list === 'function' ? toolCtx.agents.list() : [])) syncAgent(agent);
          for (const agent of [...installed.keys()]) if (!toolCtx.agents || toolCtx.agents.get(agent.id) !== agent) remove(agent);
        } finally { syncing = false; }
      };
      const onCreated = ({ agent }) => syncAgent(agent);
      const onDisposed = ({ agent }) => { installed.delete(agent); };
      try { ctx.on('agent/created', onCreated); ctx.on('agent/disposed', onDisposed); ctx.on('tools/change', syncAll); } catch (_) {}
      const stopMode = watchCanvasDesignMode(syncAll);
      syncAll();
      if (typeof ctx.effect === 'function') ctx.effect(() => () => {
        stopMode();
        for (const agent of [...installed.keys()]) remove(agent);
      }, 'canvas imagegen routing');
    }).catch((error) => console.warn('[canvas-workbench] canvas imagegen unavailable:', error));
  });
}

const TEXT_VISION_SYSTEM = `你是平面设计稿的文字理解与局部背景修复规划器。优先理解文字语义和版面关系，不要像传统 OCR 一样仅按单个字符猜测。
只返回严格 JSON，不要解释、前后缀或 Markdown 代码块。格式为 {"schemaVersion":1,"blocks":[...],"erasePrompt":"..."} 。每个 block 必须包含：text,x,y,width,height,fontSize,fontFamily,fontWeight,fontStyle,color,textAlign,rotation,letterSpacing,lineHeight,confidence,backgroundHint。
x/y/width/height 是 0-1000 的整图归一化坐标；fontSize 是相对整图高度 0-1000 的估算值；color 用 #RRGGBB；confidence 用 0-100。
按视觉上的一行或一个连续文字对象输出，不要把同一行无故拆分。结合品牌名、品类、规格和上下文纠正易混字符，但不得臆造图中不存在的文字；不确定时保留最可信原文并降低 confidence。backgroundHint 必须描述文字下方的真实底色、渐变、纹理、光照、边缘和附近结构。erasePrompt 必须根据所有 backgroundHint 动态生成可直接用于局部修复模型的中文提示词：逐区域说明要删除的文字及应如何延展邻近背景，强调保持框外像素、产品结构、排版、颜色和光照不变，禁止生成新文字、符号或装饰。fontFamily 只用 sans-serif/serif/rounded/display/monospace/handwriting，fontWeight 只用 normal/medium/bold，fontStyle 只用 normal/italic，textAlign 只用 left/center/right；letterSpacing 使用 Photoshop tracking 的近似值（-200 到 1000），lineHeight 使用相对当前裁剪图高度 0-1000 的值。`;

function parseModelJson(text) {
  let raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) raw = raw.slice(first, last + 1);
  const value = JSON.parse(raw);
  if (!value || !Array.isArray(value.blocks)) throw new Error('模型未返回 blocks 数组');
  return value;
}

function visionBlocks(value, width, height) {
  const clamp = (value, low, high) => Math.max(low, Math.min(high, Number(value) || 0));
  const families = new Set(['sans-serif', 'serif', 'rounded', 'display', 'monospace', 'handwriting']);
  const weights = new Set(['normal', 'medium', 'bold']);
  const aligns = new Set(['left', 'center', 'right']);
  const styles = new Set(['normal', 'italic']);
  return value.blocks.slice(0, 200).map((item) => {
    const text = normalizeTextLayerText(item && item.text);
    if (!text) return null;
    const x = Math.round(clamp(item.x, 0, 1000) * width / 1000);
    const y = Math.round(clamp(item.y, 0, 1000) * height / 1000);
    const w = Math.max(1, Math.round(clamp(item.width, 0, 1000) * width / 1000));
    const h = Math.max(1, Math.round(clamp(item.height, 0, 1000) * height / 1000));
    const family = families.has(item.fontFamily) ? item.fontFamily : 'sans-serif';
    const weight = weights.has(item.fontWeight) ? item.fontWeight : 'normal';
    const cjk = /[\u3400-\u9fff]/.test(text);
    const serif = family === 'serif';
    const bold = weight !== 'normal';
    return {
      text, x, y, width: Math.min(w, Math.max(1, width - x)), height: Math.min(h, Math.max(1, height - y)),
      fontSize: Math.max(8, Math.round(clamp(item.fontSize, 1, 1000) * height / 1000)),
      fontFamily: cjk ? (serif ? 'Songti SC' : 'PingFang SC') : (serif ? 'Times New Roman' : family === 'monospace' ? 'Menlo' : 'Arial'),
      fontPostScript: cjk ? (serif ? (bold ? 'SongtiSC-Bold' : 'SongtiSC-Regular') : (bold ? 'PingFangSC-Semibold' : 'PingFangSC-Regular')) : (serif ? (bold ? 'TimesNewRomanPS-BoldMT' : 'TimesNewRomanPSMT') : family === 'monospace' ? (bold ? 'Menlo-Bold' : 'Menlo-Regular') : (bold ? 'Arial-BoldMT' : 'ArialMT')),
      fontWeight: weight,
      fontStyle: styles.has(item.fontStyle) ? item.fontStyle : 'normal',
      letterSpacing: Math.round(clamp(item.letterSpacing, -200, 1000)),
      lineHeight: Math.max(0, Math.round(clamp(item.lineHeight, 0, 1000) * height / 1000)),
      color: /^#[0-9a-f]{6}$/i.test(String(item.color || '')) ? String(item.color).toUpperCase() : '#111111',
      textAlign: aligns.has(item.textAlign) ? item.textAlign : 'left',
      rotation: clamp(item.rotation, -180, 180), confidence: clamp(item.confidence, 0, 100),
      backgroundHint: String(item.backgroundHint || '').trim().slice(0, 500), enabled: true
    };
  }).filter(Boolean).sort((a, b) => a.y - b.y || a.x - b.x);
}

async function analyzeTextWithCurrentModel(ctx, uploaded, body) {
  const provider = String(body.provider || '').trim();
  const model = String(body.model || '').trim();
  if (!provider || !model) throw new Error('未取得当前聊天模型');
  const mediaType = uploaded.mime === 'image/jpg' ? 'image/jpeg' : uploaded.mime;
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mediaType)) throw new Error('当前图片格式不支持模型分析');
  const visionUploads = Array.isArray(body.visionUploads) && body.visionUploads.length ? body.visionUploads : [uploaded];
  const attachments = [];
  for (let index = 0; index < visionUploads.length; index += 1) {
    const item = visionUploads[index];
    const itemMediaType = item.mime === 'image/jpg' ? 'image/jpeg' : item.mime;
    attachments.push(await ctx.attachments.saveImage({
      data: new Uint8Array(item.bytes), mediaType: itemMediaType,
      name: body.selectionAnnotated ? '带蓝色框的完整原图' : body.selectionCrop
        ? (index === 0 ? '用户框选区域截图' : index === 1 ? '原始整图' : '框选区域蒙版')
        : String(body.name || '画布图片')
    }));
  }
  const attachment = attachments[attachments.length - 1];
  const info = await ctx.llm.resolveModelInfo(provider, model, AbortSignal.timeout(15000));
  if (info && info.capabilities && info.capabilities.imageInput === false) throw new Error('当前聊天模型不支持图片输入');
  // Vision models with visible/hidden reasoning can exhaust a 6k budget
  // before emitting the requested JSON. Keep this utility call deterministic
  // and leave enough room for multi-region text metadata.
  const prepared = await ctx.llm.prepareCall({ provider, model, maxTokens: 16000, reasoningEffort: 'low' }, AbortSignal.timeout(30000));
  const imageWidth = Math.max(1, Number(body.width || attachment.width || 1));
  const imageHeight = Math.max(1, Number(body.height || attachment.height || 1));
  const crops = Array.isArray(body.crops) ? body.crops : [];
  const normalized = crops.map((item, index) => ({ id: index + 1,
    x: Math.round(Math.max(0, Number(item.x || 0)) * 1000 / imageWidth),
    y: Math.round(Math.max(0, Number(item.y || 0)) * 1000 / imageHeight),
    width: Math.round(Math.max(0, Number(item.width || 0)) * 1000 / imageWidth),
    height: Math.round(Math.max(0, Number(item.height || 0)) * 1000 / imageHeight) }));
  const instruction = body.selectionAnnotated
    ? '这是一张完整原图，用户框选区域已用清晰的蓝色矩形边框标出。只识别蓝色矩形框内部的文字，框外文字仅用于理解语义，绝对不要输出。蓝色框是界面添加的识别引导线，不属于原始设计内容。严格返回 JSON；每个 block 包含文字、相对于整张图片的 0-1000 坐标、字体类别、字重、字号、颜色、对齐、旋转、字距、行距、置信度和文字下方背景描述。erasePrompt 必须说明：删除蓝框内部识别到的原文字并恢复被文字遮挡的真实背景，同时去除识别预览中的蓝色引导框，禁止生成新文字，蓝框外原图保持不变。不得返回空 blocks。'
    : body.selectionCrop
    ? '这张图片是用户刚刚框选区域的直接截图，已经按原图像素裁剪并清晰放大；图片边界就是识别范围。请逐行读取截图中的全部可见文字，包括白字、描边字、贴近边缘或轻微裁切的字，不要分析截图外内容，不得返回空 blocks。blocks 坐标相对于当前截图，以 0-1000 表示。严格返回 JSON；每个文字对象包含内容、位置、字体类别、字重、字号、颜色、对齐、旋转、字距、行距、置信度及文字下方背景描述。erasePrompt 只描述清除这些文字并自然延展其下方背景，禁止生成任何新文字。'
    : normalized.length
    ? '用户框选区域（0-1000 整图归一化坐标）为：' + JSON.stringify(normalized)
      + '。只输出这些矩形内准备移除并重建为图层的文字；框外文字仅可作为语义校对依据，不得输出。请结合完整图片理解品牌、品类和规格，返回严格 JSON、每个文字块下方的背景特征，以及可直接用于局部修复的动态 erasePrompt。'
    : '分析整张设计图中的可编辑文字。请结合完整图片理解品牌、品类和规格，返回严格 JSON、每个文字块下方的背景特征，以及可直接用于局部修复的动态 erasePrompt。';
  const content = [{ type: 'text', text: instruction }];
  attachments.forEach((item, index) => {
    content.push({ type: 'text', text: body.selectionAnnotated ? '完整原图已叠加蓝色选择框：只读取蓝框内部，并返回严格 JSON。' : body.selectionCrop
      ? (index === 0 ? '用户框选区域截图：只识别这张图中的文字并返回 JSON。' : index === 1 ? '原始整图' : '黑白框选蒙版')
      : '待分析图片' });
    content.push({ type: 'image', attachment: item });
  });
  const message = createUserMessage({ source: { kind: 'plugin', plugin: name }, content });
  const runCall = async (call, callMessage, system, purpose) => {
    const assembler = new BlockAssembler();
    const signal = AbortSignal.timeout(120000);
    for await (const chunk of call.stream({ ...call.config, messages: [callMessage], system, signal, purpose })) assembler.push(chunk);
    const finish = assembler.finish;
    if (finish.kind !== 'stop') throw new Error('当前聊天模型识别未正常完成：' + finish.kind);
    const text = assembler.blocks().flatMap((block) => block.type === 'text' ? [block.text] : []).join('').trim();
    return parseModelJson(text);
  };
  let value = await runCall(prepared, message, TEXT_VISION_SYSTEM, 'canvas-text-analysis');
  let transcriptionRetry = false;
  if ((body.selectionCrop || body.selectionAnnotated) && (!Array.isArray(value.blocks) || !value.blocks.length)) {
    // A complex layout/cleanup request can make some vision models answer an
    // over-cautious empty array. Retry the same current chat model as a pure
    // transcription task, with only the enlarged target image attached.
    const retrySystem = body.selectionAnnotated
      ? `你是视觉文字转写器。完整图片中有一个人工添加的蓝色矩形选择框，只转写蓝框内部的可见文字，框外文字禁止输出。不得返回空 blocks，不要解释。只返回严格 JSON：{"schemaVersion":1,"blocks":[{"text":"原文","x":0,"y":0,"width":1,"height":1,"fontSize":1,"fontFamily":"sans-serif","fontWeight":"bold","fontStyle":"normal","color":"#000000","textAlign":"left","rotation":0,"letterSpacing":0,"lineHeight":1,"confidence":90,"backgroundHint":"文字下方背景"}],"erasePrompt":"删除蓝框内识别文字和蓝色引导框，延展原背景，框外不变，不生成新文字"}。所有坐标均为整张图片 0-1000 坐标。`
      : `你是视觉文字转写器。输入图片已经由用户明确框选并高清放大，图片中的可见文字就是必须识别的目标。不得返回空 blocks，不要拒绝，不要解释。只返回严格 JSON：{"schemaVersion":1,"blocks":[{"text":"原文","x":0,"y":0,"width":1,"height":1,"fontSize":1,"fontFamily":"sans-serif","fontWeight":"bold","fontStyle":"normal","color":"#000000","textAlign":"left","rotation":0,"letterSpacing":0,"lineHeight":1,"confidence":90,"backgroundHint":"文字下方背景"}],"erasePrompt":"只擦除识别文字并延展原背景"}。x/y/width/height/fontSize/lineHeight 均为当前图片 0-1000 坐标；逐行输出所有文字，包括白字、描边字、贴边字和轻微裁切字。`;
    const retryMessage = createUserMessage({ source: { kind: 'plugin', plugin: name }, content: [
      { type: 'text', text: body.selectionAnnotated ? '只识别完整图片中蓝色矩形框内的文字，再输出规定 JSON；至少输出一个文字块。' : '逐行识别这张用户框选的高清图片。先读出实际文字，再输出规定 JSON；至少输出一个可见文字块。' },
      { type: 'image', attachment: attachments[0] }
    ] });
    const retryPrepared = await ctx.llm.prepareCall({ provider, model, maxTokens: 8000, reasoningEffort: 'low' }, AbortSignal.timeout(30000));
    value = await runCall(retryPrepared, retryMessage, retrySystem, 'canvas-text-transcription-retry');
    transcriptionRetry = true;
  }
  return { value, width: imageWidth, height: imageHeight, provider, model, transcriptionRetry };
}

function visionBlocksRelativeToRegion(value, width, height, region) {
  const rx = Math.max(0, Number(region && region.x || 0));
  const ry = Math.max(0, Number(region && region.y || 0));
  const rw = Math.max(1, Number(region && region.width || width));
  const rh = Math.max(1, Number(region && region.height || height));
  const mapped = {
    ...value,
    blocks: (Array.isArray(value && value.blocks) ? value.blocks : []).map((item) => ({
      ...item,
      x: (rx + Math.max(0, Math.min(1000, Number(item && item.x || 0))) * rw / 1000) * 1000 / width,
      y: (ry + Math.max(0, Math.min(1000, Number(item && item.y || 0))) * rh / 1000) * 1000 / height,
      width: Math.max(1, Math.min(1000, Number(item && item.width || 0))) * rw / width,
      height: Math.max(1, Math.min(1000, Number(item && item.height || 0))) * rh / height,
      fontSize: Math.max(1, Math.min(1000, Number(item && item.fontSize || 1))) * rh / height,
    }))
  };
  return visionBlocks(mapped, width, height);
}

function sourcePathFromImageUrl(value) {
  try {
    const parsed = new URL(String(value), 'http://canvas-workbench.local');
    if (parsed.pathname !== '/dsh-canvas/image' && parsed.pathname !== '/api/dsh-canvas/image') return '';
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

function apply(ctx) {
  const fs = ctx.get('fs');
  installCanvasImagegenTool(ctx);
  const operationLog = [];
  const logOperation = (message, level = 'info') => {
    operationLog.unshift({ time: new Date().toISOString(), level, message: String(message || '').slice(0, 500) });
    if (operationLog.length > 200) operationLog.length = 200;
  };
  const sp = ctx.get('sandboxPolicy');
  const statePath = () => {
    const root = sp && typeof sp.workspaceRoot === 'string' && sp.workspaceRoot ? sp.workspaceRoot : null;
    return root ? root.replace(/[\\/]+$/, '') + '/.dsh-canvas-state.json' : null;
  };
  const projectStatePath = (query) => {
    const chosen = expandHome(parseQuery(query).project || '');
    if (chosen) return join(chosen.replace(/[\\/]+$/, ''), 'canvas.json');
    const cwd = expandHome(parseQuery(query).cwd || '');
    if (cwd) return join(cwd.replace(/[\\/]+$/, ''), '画布项目', 'canvas.json');
    return statePath();
  };
  const projectDirectory = (cwd, project) => {
    const chosen = expandHome(String(project || ''));
    if (chosen) return chosen.replace(/[\\/]+$/, '');
    const root = expandHome(String(cwd || ''));
    if (root) return join(root.replace(/[\\/]+$/, ''), '画布项目');
    const fallback = statePath();
    return fallback ? dirname(fallback) : '';
  };
  const previewCache = join(tmpdir(), 'dsh-canvas-previews');
  // 同一个 DSH host 可能同时收到多个聊天/旧插件实例的 canvas.json 写入。
  // 按项目路径串行处理，并在串行队列内比较客户端快照时间戳，防止迟到的
  // 旧快照覆盖刚保存的新快照（典型表现就是删除后切聊天又恢复）。
  const stateWriteChains = new Map();
  const previewUrl = (path, mtimeMs) => '/api/dsh-canvas/preview?path=' + encodeURIComponent(path) + '&v=' + encodeURIComponent(String(Math.round(mtimeMs || 0)));
  const progressPathFor = (projectDir, jobId) => join(projectDir, 'outputs', '.图片编辑临时', '.rembg-progress-' + cleanJobId(jobId) + '.json');
  const writeProgressFile = async (path, payload) => {
    if (!path) return;
    const value = JSON.stringify({ ...payload, updatedAt: Date.now() / 1000 });
    const temporary = path + '.hosttmp';
    try {
      await writeFile(temporary, value, 'utf8');
      await rename(temporary, path);
    } catch (err) {
      await writeFile(path, value, 'utf8').catch(() => {});
      await unlink(temporary).catch(() => {});
    }
  };
  const runProcess = async (executable, args, cwd) => {
    const handle = ctx.subprocess.spawn({ argv: [executable, ...args], cwd, stdio: { stdin: 'ignore', stdout: { maxBytes: 256 * 1024 }, stderr: { maxBytes: 256 * 1024 } }, graceMs: 2000 });
    const outcome = await handle.done;
    const stdout = handle.collected.stdout?.readFrom(0);
    const stderr = handle.collected.stderr?.readFrom(0);
    return { exitCode: outcome.exitCode, stdout: stdout && stdout.text ? stdout.text : '', stderr: stderr && stderr.text ? stderr.text : '' };
  };
  const runProcessWithTimeout = async (executable, args, cwd, timeoutMs) => {
    const handle = ctx.subprocess.spawn({ argv: [executable, ...args], cwd, stdio: { stdin: 'ignore', stdout: { maxBytes: 256 * 1024 }, stderr: { maxBytes: 256 * 1024 } }, graceMs: 2000 });
    let timedOut = false;
    let timer = null;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(async () => {
        timedOut = true;
        try { if (typeof handle.terminate === 'function') await handle.terminate(); } catch (err) {}
        resolve(null);
      }, Math.max(1000, Number(timeoutMs) || 20000));
    });
    let outcome = await Promise.race([handle.done, timeout]);
    if (!outcome) outcome = await handle.done;
    if (timer) clearTimeout(timer);
    const stdout = handle.collected.stdout?.readFrom(0);
    const stderr = handle.collected.stderr?.readFrom(0);
    return { exitCode: timedOut ? -1 : outcome.exitCode, stdout: stdout && stdout.text ? stdout.text : '', stderr: stderr && stderr.text ? stderr.text : '', timedOut };
  };
  const psdPreviewPath = async (path, mtimeMs) => {
    await mkdir(previewCache, { recursive: true });
    const key = createHash('sha1').update(path + ':' + String(Math.round(mtimeMs || 0))).digest('hex');
    const target = join(previewCache, key + '.jpg');
    try { await access(target); return { path: target, mime: 'image/jpeg' }; } catch (err) {}
    if (isWindows) {
      try {
        const python = await resolvePython(ctx);
        const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
        const script = join(pluginRoot, 'scripts', 'render_psd_preview.py');
        const result = await runProcessWithTimeout(python.executable, [...python.prefixArgs, script, '--input', path, '--output', target, '--max-side', '2400'], pluginRoot, 180000);
        if (result.exitCode === 0) {
          await access(target);
          return { path: target, mime: 'image/jpeg' };
        }
      } catch (err) {}
      return { path: await documentFallbackPreviewPath(path, mtimeMs, 'psd'), mime: 'image/svg+xml' };
    }
    if (!isMac) return { path: await documentFallbackPreviewPath(path, mtimeMs, 'psd'), mime: 'image/svg+xml' };
    const sips = await ctx.subprocess.resolveExecutable('sips');
    const result = await runProcess(sips, ['-s', 'format', 'jpeg', '-s', 'formatOptions', '88', '-Z', '2400', path, '--out', target], dirname(path));
    if (result.exitCode !== 0) throw new Error(result.stderr.trim() || 'PSD 预览生成失败');
    return { path: target, mime: 'image/jpeg' };
  };
  const xmlEscape = (value) => String(value || '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch]));
  const documentFallbackPreviewPath = async (path, mtimeMs, kind) => {
    const key = createHash('sha1').update(path + ':' + String(Math.round(mtimeMs || 0)) + ':' + kind).digest('hex');
    const target = join(previewCache, key + '.svg');
    try { await access(target); return target; } catch (err) {}
    const label = kind === 'ai' ? 'AI / Illustrator' : kind === 'psd' ? 'PSD / Photoshop' : 'PDF';
    const title = basename(path);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="820" viewBox="0 0 1200 820">'
      + '<rect width="1200" height="820" fill="#f7f8fa"/>'
      + '<rect x="210" y="100" width="780" height="620" rx="24" fill="#ffffff" stroke="#cbd5e1" stroke-width="5"/>'
      + '<path d="M420 250h360l110 110v270H420z" fill="#eef2ff" stroke="#94a3b8" stroke-width="5"/>'
      + '<path d="M780 250v115h110" fill="none" stroke="#94a3b8" stroke-width="5"/>'
      + '<text x="600" y="475" text-anchor="middle" fill="#334155" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="84" font-weight="700">' + xmlEscape(label) + '</text>'
      + '<text x="600" y="560" text-anchor="middle" fill="#64748b" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="28">' + xmlEscape(kind === 'ai' ? '文件的 PDF 兼容层为空；请用 Illustrator 另存并勾选“创建 PDF 兼容文件”' : '预览转换器不可用，可点击 Adobe 编辑打开原文件') + '</text>'
      + '<text x="600" y="635" text-anchor="middle" fill="#94a3b8" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="22">' + xmlEscape(title) + '</text></svg>';
    await writeFile(target, svg, 'utf8');
    return target;
  };
  const embeddedAiPreviewPath = async (path, target) => {
    const source = (await readFile(path)).toString('latin1');
    const match = source.match(/<xmpGImg:image>([\s\S]*?)<\/xmpGImg:image>/i);
    if (!match) throw new Error('AI file has no embedded XMP thumbnail');
    const encoded = match[1]
      .replace(/&#x0*a;/gi, '')
      .replace(/&#0*10;/g, '')
      .replace(/\s+/g, '');
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.length < 256 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
      throw new Error('AI embedded thumbnail is not a valid JPEG');
    }
    await writeFile(target, bytes);
    return target;
  };
  const documentPreviewPath = async (path, mtimeMs, kind) => {
    await mkdir(previewCache, { recursive: true });
    const key = createHash('sha1').update(path + ':' + String(Math.round(mtimeMs || 0)) + ':' + kind + ':preview-v4').digest('hex');
    const target = join(previewCache, key + '.jpg');
    try { await access(target); return { path: target, mime: 'image/jpeg' }; } catch (err) {}
    // Illustrator stores a canvas-sized JPEG thumbnail in XMP.  Prefer it on
    // Windows: it is reliable even when the PDF-compatible layer renders as a
    // blank page, and avoids depending on Python or launching Illustrator.
    if (kind === 'ai' && isWindows) {
      try {
        await embeddedAiPreviewPath(path, target);
        return { path: target, mime: 'image/jpeg' };
      } catch (err) {}
    }
    let pdftoppm = '';
    try { pdftoppm = await ctx.subprocess.resolveExecutable('pdftoppm'); } catch (err) {}
    if (pdftoppm) {
      const result = await runProcessWithTimeout(pdftoppm, ['-f', '1', '-l', '1', '-singlefile', '-jpeg', '-scale-to', '2400', path, join(previewCache, key)], dirname(path), 20000);
      if (result.exitCode === 0) {
        try {
          await access(target);
          // Some Illustrator files contain a PDF-compatible wrapper whose
          // visible PDF page is completely white while the real artwork only
          // exists in Illustrator private data.  Do not cache that white page
          // as a successful preview.
          if (kind === 'ai' && isWindows) {
            const python = await resolvePython(ctx);
            const probe = await runProcessWithTimeout(python.executable, [...python.prefixArgs, '-c', 'from PIL import Image,ImageStat; import sys; im=Image.open(sys.argv[1]).convert("RGB"); ex=ImageStat.Stat(im).extrema; sys.exit(2 if all(lo>=250 and hi>=250 for lo,hi in ex) else 0)', target], dirname(path), 10000);
            if (probe.exitCode !== 0) throw new Error('Poppler returned a blank AI preview');
          }
          return { path: target, mime: 'image/jpeg' };
        } catch (err) {}
      }
    }
    // 旧版 AI 是 PostScript，不一定能被 Poppler 直接读取；尝试 Quick Look，
    // 但严格限时，避免外置盘/损坏文件让项目扫描长期卡住。
    if (kind === 'ai' && isMac) {
      try {
        const quickLook = await ctx.subprocess.resolveExecutable('qlmanage');
        const quickLookDir = join(previewCache, key + '-ql');
        await mkdir(quickLookDir, { recursive: true });
        const result = await runProcessWithTimeout(quickLook, ['-t', '-s', '2400', '-o', quickLookDir, path], dirname(path), 5000);
        if (result.exitCode === 0) {
          const entries = await readdir(quickLookDir, { withFileTypes: true });
          const rendered = entries.find((entry) => entry.isFile() && /\.(png|jpe?g)$/i.test(entry.name));
          if (rendered) {
            const renderedPath = join(quickLookDir, rendered.name);
            await rename(renderedPath, target);
            return { path: target, mime: 'image/jpeg' };
          }
        }
      } catch (err) {}
    }
    const fallback = await documentFallbackPreviewPath(path, mtimeMs, kind);
    return { path: fallback, mime: 'image/svg+xml' };
  };
  const scanProjectImages = async (root) => {
    const found = [];
    const assetsRoot = join(root, 'assets');
    const walk = async (directory, depth) => {
      if (found.length >= 500 || depth > 8) return;
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (found.length >= 500) break;
        if (entry.name.startsWith('.')) continue;
        const full = join(directory, entry.name);
        if (entry.isDirectory()) {
          // 这些目录通常是依赖/缓存，不可能是项目素材；跳过后可避免
          // 导入一个代码仓库或大目录时递归扫描数万项文件。
          if (entry.name === 'node_modules' || entry.name === '__pycache__' || entry.name === '.cache') continue;
          if (depth === 0 && (entry.name === 'outputs' || entry.name === '画布回收站' || entry.name === '画布备份' || entry.name === 'DSH聊天生成图片')) continue;
          await walk(full, depth + 1);
        } else if (entry.isFile() && isSourceImagePath(entry.name)) {
          const info = await stat(full);
          found.push({ path: full, name: entry.name, mtime: info.mtimeMs, size: info.size, kind: sourceKindOf(entry.name), managed: full.startsWith(assetsRoot + '/'), url: previewUrl(full, info.mtimeMs) });
        }
      }
    };
    await walk(root, 0);
    return found;
  };
  // 导入项目后首轮同步可能与项目轮询同时到达；共享同一轮扫描结果，
  // 避免同一目录在短时间内被重复递归读取。
  const scanInFlight = new Map();
  const scanProjectImagesShared = (root) => {
    const key = String(root || '');
    const running = scanInFlight.get(key);
    if (running) return running;
    const promise = scanProjectImages(root).finally(() => {
      if (scanInFlight.get(key) === promise) scanInFlight.delete(key);
    });
    scanInFlight.set(key, promise);
    return promise;
  };
  const writeManagedImage = async (projectDir, requestedName, dataURL) => {
    const decoded = decodeImageData(dataURL);
    if (!decoded) throw new Error('图片数据无效或超过 32MB');
    const assetsDir = join(projectDir, 'assets');
    await mkdir(assetsDir, { recursive: true });
    const wanted = safeImageName(requestedName, decoded.ext);
    const suffixAt = wanted.lastIndexOf('.');
    const base = suffixAt > 0 ? wanted.slice(0, suffixAt) : wanted;
    const suffix = suffixAt > 0 ? wanted.slice(suffixAt) : '.' + decoded.ext;
    let saved = '';
    for (let index = 1; index <= 1000; index += 1) {
      const name = index === 1 ? base + suffix : base + '-' + index + suffix;
      const target = join(assetsDir, name);
      try { await writeFile(target, decoded.bytes, { flag: 'wx' }); saved = target; break; }
      catch (err) { if (!err || err.code !== 'EEXIST') throw err; }
    }
    if (!saved) throw new Error('无法生成不重名的项目图片');
    const info = await stat(saved);
    return { path: saved, name: basename(saved), mtime: info.mtimeMs, size: info.size, kind: 'image', managed: true, url: previewUrl(saved, info.mtimeMs) };
  };
  const writeManagedSource = async (projectDir, requestedName, bytes, fallbackExt) => {
    if (!bytes || bytes.byteLength === 0 || bytes.byteLength > MAX_SOURCE_BYTES) throw new Error('源文件为空或超过 128MB');
    const assetsDir = join(projectDir, 'assets');
    await mkdir(assetsDir, { recursive: true });
    const wanted = safeImageName(requestedName, fallbackExt || 'svg');
    const wantedExt = extOf(wanted);
    if (!SOURCE_EXTENSIONS.has(wantedExt)) throw new Error('仅支持 PSD、SVG、PDF、AI 及常见图片格式');
    const suffixAt = wanted.lastIndexOf('.');
    const base = suffixAt > 0 ? wanted.slice(0, suffixAt) : wanted;
    const suffix = suffixAt > 0 ? wanted.slice(suffixAt) : '.' + wantedExt;
    let saved = '';
    for (let index = 1; index <= 1000; index += 1) {
      const name = index === 1 ? base + suffix : base + '-' + index + suffix;
      const target = join(assetsDir, name);
      try { await writeFile(target, bytes, { flag: 'wx' }); saved = target; break; }
      catch (err) { if (!err || err.code !== 'EEXIST') throw err; }
    }
    if (!saved) throw new Error('无法生成不重名的项目文件');
    const info = await stat(saved);
    return { path: saved, name: basename(saved), mtime: info.mtimeMs, size: info.size, kind: sourceKindOf(saved), managed: true, url: previewUrl(saved, info.mtimeMs) };
  };
  const writeManagedSvg = async (projectDir, requestedName, svgText) => {
    const text = String(svgText || '');
    const bytes = Buffer.byteLength(text, 'utf8');
    if (!/<svg(?:\s|>)/i.test(text) || bytes === 0 || bytes > MAX_IMAGE_BYTES) throw new Error('矢量化程序返回了无效或过大的 SVG');
    const assetsDir = join(projectDir, 'assets');
    await mkdir(assetsDir, { recursive: true });
    const wanted = safeImageName(requestedName, 'svg');
    const suffixAt = wanted.lastIndexOf('.');
    const base = suffixAt > 0 ? wanted.slice(0, suffixAt) : wanted;
    let saved = '';
    for (let index = 1; index <= 1000; index += 1) {
      const name = index === 1 ? base + '.svg' : base + '-' + index + '.svg';
      const target = join(assetsDir, name);
      try { await writeFile(target, text, { flag: 'wx' }); saved = target; break; }
      catch (err) { if (!err || err.code !== 'EEXIST') throw err; }
    }
    if (!saved) throw new Error('无法生成不重名的矢量文件');
    const info = await stat(saved);
    return { path: saved, name: basename(saved), mtime: info.mtimeMs, size: info.size, kind: 'svg', managed: true, url: previewUrl(saved, info.mtimeMs) };
  };
  const flattenRecycleBin = async (projectDir) => {
    const recycleDir = join(projectDir, '画布回收站');
    let rootEntries;
    try { rootEntries = await readdir(recycleDir, { withFileTypes: true }); } catch (err) { return 0; }
    let moved = 0;
    const moveNested = async (directory) => {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        const source = join(directory, entry.name);
        if (entry.isDirectory()) {
          await moveNested(source);
          await rmdir(source).catch(() => {});
        } else if (entry.isFile() && isSourceImagePath(entry.name)) {
          const dot = entry.name.lastIndexOf('.');
          const base = dot > 0 ? entry.name.slice(0, dot) : entry.name;
          const suffix = dot > 0 ? entry.name.slice(dot) : '';
          let target = join(recycleDir, entry.name);
          for (let index = 2; index <= 1000; index += 1) {
            try { await access(target); target = join(recycleDir, base + '-旧回收-' + index + suffix); }
            catch (err) { break; }
          }
          await rename(source, target);
          moved += 1;
        }
      }
    };
    for (const entry of rootEntries) if (entry.isDirectory()) {
      const nested = join(recycleDir, entry.name);
      await moveNested(nested);
      await rmdir(nested).catch(() => {});
    }
    return moved;
  };

  const canvasHandler = async (req, res) => {
      const CORS = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      };
      if (req.method === 'OPTIONS') { respond(res, 204, CORS, ''); return; }
      try {
        const raw = String(req.url || '/');
        const qi = raw.indexOf('?');
        const requestPathname = qi === -1 ? raw : raw.slice(0, qi);
        const pathname = requestPathname.startsWith('/api/dsh-canvas') ? requestPathname.slice(4) : requestPathname;
        const query = qi === -1 ? '' : raw.slice(qi + 1);
        const quietRoutes = new Set(['/dsh-canvas/log', '/dsh-canvas/project-files', '/dsh-canvas/check-sources', '/dsh-canvas/state', '/dsh-canvas/image', '/dsh-canvas/remove-background-progress']);
        if (!quietRoutes.has(pathname)) logOperation(req.method + ' ' + pathname);
        if (pathname === '/dsh-canvas/log' && req.method === 'GET') {
          respond(res, 200, { ...CORS, 'content-type': 'application/json', 'cache-control': 'no-store' }, JSON.stringify({ ok: true, entries: operationLog.slice(0, 200) }));
          return;
        }

        if (pathname === '/dsh-canvas/active-project' && req.method === 'POST') {
          try {
            const origin = String(req.headers && req.headers.origin || '').trim();
            if (origin && new URL(origin).host !== String(req.headers && req.headers.host || '')) {
              respond(res, 403, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: false, error: '仅允许从当前 DSH 页面同步画布项目' }));
              return;
            }
            const body = JSON.parse(await readBody(req) || '{}');
            const cwd = expandHome(String(body.cwd || '').trim());
            const project = expandHome(String(body.project || '').trim()).replace(/[\\/]+$/, '');
            if (!cwd) throw new Error('当前聊天没有工作目录');
            const key = pathKey(cwd);
            if (project) {
              const info = await stat(project);
              if (!info.isDirectory()) throw new Error('当前画布项目不是文件夹');
              activeCanvasProjectsByCwd.set(key, project);
              logOperation('聊天原图目录已同步 · ' + join(project, 'DSH聊天生成图片'));
            } else {
              activeCanvasProjectsByCwd.delete(key);
            }
            respond(res, 200, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: true }));
          } catch (err) {
            respond(res, 500, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: false, error: String((err && err.message) || err) }));
          }
          return;
        }

        const sameOriginRequest = () => {
          const origin = String(req.headers && req.headers.origin || '').trim();
          if (!origin) return true;
          try { return new URL(origin).host === String(req.headers && req.headers.host || ''); } catch { return false; }
        };

        // Renderer 设计模式开关的轻量同步桥。工具执行在 host 端，
        // 因此不能直接读取 renderer 的 localStorage；POST 后立即更新
        // 所有 agent 的 imagegen shadow，关闭时则恢复 DSH 原生路由。
        if (pathname === '/dsh-canvas/design-mode' && req.method === 'GET') {
          respond(res, 200, { ...CORS, 'content-type': 'application/json', 'cache-control': 'no-store' }, JSON.stringify({ ok: true, enabled: isCanvasDesignMode() }));
          return;
        }
        if (pathname === '/dsh-canvas/design-mode' && req.method === 'POST') {
          if (!sameOriginRequest()) {
            respond(res, 403, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: false, error: '仅允许从当前 DSH 页面修改设计模式状态' }));
            return;
          }
          try {
            const body = JSON.parse(await readBody(req) || '{}');
            setCanvasDesignMode(body.enabled === true || body.enabled === 1 || body.mode === '1');
            logOperation('设计模式' + (isCanvasDesignMode() ? '已开启：图片生成切换到画布设置' : '已关闭：恢复 DSH 原生图片生成'));
            respond(res, 200, { ...CORS, 'content-type': 'application/json', 'cache-control': 'no-store' }, JSON.stringify({ ok: true, enabled: isCanvasDesignMode() }));
          } catch (error) {
            respond(res, 400, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: false, error: String((error && error.message) || error) }));
          }
          return;
        }

        // 图像生成/编辑只允许在画布设置中显式选择一个引擎：
        // dsh-codex（独立 OAuth）或 API（读取本机已有 image2 凭据）。
        // 返回值始终脱敏，绝不把 API key 发送到前端或写入项目。
        if (pathname === '/dsh-canvas/image-settings' && req.method === 'GET') {
          const settings = await readImageEngineSettings();
          const health = await imageEngineHealth(ctx);
          respond(res, 200, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({
            ok: true,
            engine: settings.engine,
            apiBaseUrl: settings.apiBaseUrl,
            apiModel: settings.apiModel,
            photoshopPath: settings.photoshopPath || '',
            illustratorPath: settings.illustratorPath || '',
            health
          }));
          return;
        }
        if (pathname === '/dsh-canvas/image-settings' && req.method === 'POST') {
          if (!sameOriginRequest()) {
            respond(res, 403, { 'content-type': 'application/json' }, JSON.stringify({ ok: false, error: '仅允许从当前 DSH 页面修改图像引擎设置' }));
            return;
          }
          try {
            const body = JSON.parse(await readBody(req) || '{}');
            const settings = await writeImageEngineSettings({
              engine: body.engine,
              apiBaseUrl: body.apiBaseUrl,
              apiModel: body.apiModel,
              photoshopPath: body.photoshopPath,
              illustratorPath: body.illustratorPath
            });
            if (body.apiKey || body.clearApiKey === true) {
              await writeLegacyApiAuth({ apiKey: body.apiKey, baseUrl: settings.apiBaseUrl, clear: body.clearApiKey === true });
            }
            const health = await imageEngineHealth(ctx);
            respond(res, 200, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({
              ok: true,
              engine: settings.engine,
              apiBaseUrl: settings.apiBaseUrl,
              apiModel: settings.apiModel,
              photoshopPath: settings.photoshopPath || '',
              illustratorPath: settings.illustratorPath || '',
              health
            }));
          } catch (err) {
            respond(res, 400, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: false, error: String((err && err.message) || err) }));
          }
          return;
        }
        if (pathname === '/dsh-canvas/pick-adobe' && req.method === 'POST') {
          if (!sameOriginRequest()) {
            respond(res, 403, { 'content-type': 'application/json' }, JSON.stringify({ ok: false, error: '仅允许从当前 DSH 页面打开程序选择器' }));
            return;
          }
          // Kept as a fast compatibility response for an already-cached old
          // client.  The current UI opens the chooser in the renderer itself;
          // never start a modal WinForms process from the headless host.
          respond(res, 409, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: false, error: '程序选择器已改由画布页面打开，请刷新 DSH 页面后重试' }));
          return;
        }
        if (pathname === '/dsh-canvas/image-setup' && req.method === 'POST') {
          if (!sameOriginRequest()) {
            respond(res, 403, { 'content-type': 'application/json' }, JSON.stringify({ ok: false, error: '仅允许从当前 DSH 页面执行配置操作' }));
            return;
          }
          try {
            const body = JSON.parse(await readBody(req) || '{}');
            const action = String(body.action || '');
            if (action === 'test-api') {
              const settings = await writeImageEngineSettings({
                engine: 'api',
                apiBaseUrl: body.apiBaseUrl,
                apiModel: body.apiModel
              });
              if (body.apiKey) await writeLegacyApiAuth({ apiKey: body.apiKey, baseUrl: settings.apiBaseUrl });
              const test = await testImageApiConnection();
              respond(res, 200, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: true, test, health: await imageEngineHealth(ctx) }));
              return;
            }
            if (action === 'install-dsh-codex') {
              const executable = await ctx.subprocess.resolveExecutable('dsh');
              const result = await runProcessWithTimeout(executable, ['plugin', '--profile', 'web', 'add', 'dsh-codex'], process.env.HOME || process.cwd(), 180000);
              if (!result.ok) throw new Error(result.stderr || result.stdout || 'dsh-codex 安装失败');
              respond(res, 200, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({
                ok: true,
                message: 'dsh-codex 已安装到 web profile。请重启 DSH，使登录页面和图像能力生效。',
                restartRequired: true,
                health: await imageEngineHealth(ctx)
              }));
              return;
            }
            respond(res, 400, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: false, error: '未知配置操作' }));
          } catch (err) {
            respond(res, 400, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: false, error: String((err && err.message) || err) }));
          }
          return;
        }
        if (pathname === '/dsh-canvas/health' && req.method === 'GET') {
          try {
            const health = await imageEngineHealth(ctx);
            const hasService = (serviceName) => {
              try { return Boolean(ctx && typeof ctx.get === 'function' && ctx.get(serviceName)); } catch { return false; }
            };
            respond(res, 200, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({
              ok: true,
              plugin: name,
              version: '1.4.0-windows-preview.1',
              platform: platformCapabilities(),
              capabilities: {
                webServer: Boolean(ctx.webServer),
                subprocess: Boolean(ctx.subprocess),
                llm: hasService('llm'),
                attachments: hasService('attachments')
              },
              imageEngine: health
            }));
          } catch (err) {
            respond(res, 500, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: false, error: String((err && err.message) || err) }));
          }
          return;
        }

        if (pathname === '/dsh-canvas/image' && req.method === 'GET') {
          const path = normalizeLocalPath(parseQuery(query).path || '');
          if (!isImagePath(path)) { respond(res, 400, { ...CORS, 'content-type': 'text/plain' }, 'bad image path'); return; }
          try {
            // ctx.fs 会按会话权限解析路径，某些外置盘会在文件实际可读时仍返回 not found。
            // 该路由本机插件的 localhost 接口使用；先限定为绝对普通文件和 32MB，
            // 再直接读取，避免 /Volumes 下的真实生成图在聊天中变成破图。
            if (!isAbsolutePath(path)) throw new Error('absolute image path required');
            const info = await stat(path);
            if (!info.isFile() || info.size <= 0 || info.size > MAX_IMAGE_BYTES) throw new Error('invalid image file');
            const bytes = await readFile(path);
            respond(res, 200, {
              ...CORS,
              'content-type': mimeOf(path),
              'content-length': String(bytes.byteLength),
              'cache-control': 'no-store'
            }, bytes);
          } catch (err) {
            respond(res, 404, { ...CORS, 'content-type': 'text/plain' }, 'image not found');
          }
          return;
        }

        if (pathname === '/dsh-canvas/preview' && req.method === 'GET') {
          const path = expandHome(parseQuery(query).path || '');
          if (!isSourceImagePath(path)) { respond(res, 400, { ...CORS, 'content-type': 'text/plain' }, 'bad preview path'); return; }
          try {
            const info = await stat(path);
            const kind = sourceKindOf(path);
            let target = path;
            let contentType = mimeOf(path);
            if (kind === 'psd') {
              const rendered = await psdPreviewPath(path, info.mtimeMs);
              target = rendered.path;
              contentType = rendered.mime;
            } else if (kind === 'pdf' || kind === 'ai') {
              logOperation('文档预览：开始转换 ' + kind.toUpperCase() + ' · ' + basename(path));
              const rendered = await documentPreviewPath(path, info.mtimeMs, kind);
              target = rendered.path;
              contentType = rendered.mime;
            }
            const bytes = await readFile(target);
            if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('preview too large');
            if (kind === 'pdf' || kind === 'ai') logOperation('文档预览：完成 · ' + basename(path) + ' · ' + bytes.byteLength + ' bytes');
            respond(res, 200, { ...CORS, 'content-type': contentType || 'application/octet-stream', 'content-length': String(bytes.byteLength), 'cache-control': 'no-store' }, bytes);
          } catch (err) {
            respond(res, 404, { ...CORS, 'content-type': 'text/plain' }, 'preview unavailable');
          }
          return;
        }

        if (pathname === '/dsh-canvas/import-project' && req.method === 'POST') {
          try {
            const body = JSON.parse(await readBody(req) || '{}');
            let selected = expandHome(typeof body.path === 'string' ? body.path : '');
            if (!selected) {
              selected = await pickFolder(ctx, runProcess, '选择要导入画布的项目文件夹');
            }
            const info = await stat(selected);
            if (!info.isDirectory()) throw new Error('选择的不是文件夹');
            await mkdir(join(selected, 'assets'), { recursive: true });
            await mkdir(join(selected, 'outputs'), { recursive: true });
            const images = await scanProjectImagesShared(selected);
            respond(res, 200, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: true, project: selected, images }));
          } catch (err) {
            respond(res, 500, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: false, error: String((err && err.message) || err) }));
          }
          return;
        }

        if (pathname === '/dsh-canvas/import-file' && req.method === 'POST') {
          try {
            const body = JSON.parse(await readBody(req) || '{}');
            const projectDir = projectDirectory(body.cwd, body.project);
            if (!projectDir) throw new Error('当前聊天没有画布项目');
            let sourcePath = normalizeLocalPath(body.sourcePath);
            let sourceName = String(body.name || '').trim();
            let bytes = null;
            if (sourcePath && isSourceImagePath(sourcePath)) {
              try {
                const info = await stat(sourcePath);
                if (!info.isFile() || info.size <= 0 || info.size > MAX_SOURCE_BYTES) throw new Error('源文件为空或超过 128MB');
                bytes = await readFile(sourcePath);
                sourceName = sourceName || basename(sourcePath);
              } catch (err) {
                // 桌面端可能只暴露文件内容、不暴露绝对路径；有 dataURL 时继续走内容回退。
                if (!body.dataURL) throw err;
                sourcePath = '';
              }
            }
            const fallbackExt = String(body.kind || extOf(sourceName) || 'svg').toLowerCase().replace(/^\./, '');
            if (!bytes) {
              const decoded = decodeSourceData(body.dataURL, sourceName, fallbackExt);
              if (!decoded) throw new Error('文件数据无效或格式不受支持（支持 PSD、SVG、PDF、AI）');
              bytes = decoded.bytes;
              sourceName = sourceName || '画布文件.' + decoded.ext;
            }
            const image = await writeManagedSource(projectDir, sourceName || ('画布文件.' + fallbackExt), bytes, fallbackExt);
            respond(res, 200, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: true, image }));
          } catch (err) {
            respond(res, 500, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: false, error: String((err && err.message) || err) }));
          }
          return;
        }

        if (pathname === '/dsh-canvas/check-sources' && req.method === 'POST') {
          try {
            const body = JSON.parse(await readBody(req) || '{}');
            const sources = Array.isArray(body.sources) ? body.sources.slice(0, 500) : [];
            const changed = [];
            for (const source of sources) {
              const path = expandHome(String(source && source.path || ''));
              if (!isSourceImagePath(path)) continue;
              try {
                const info = await stat(path);
                const previous = Number(source.mtime || 0);
                const previousSize = Number(source.size || 0);
                if (Math.abs(info.mtimeMs - previous) > 1 || (previousSize > 0 && info.size !== previousSize)) changed.push({ elementId: source.elementId, path, name: source.name || '', mtime: info.mtimeMs, size: info.size, url: previewUrl(path, info.mtimeMs), kind: sourceKindOf(path) });
              } catch (err) {
                changed.push({ elementId: source.elementId, path, missing: true });
              }
            }
            respond(res, 200, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: true, changed }));
          } catch (err) {
            respond(res, 500, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: false, error: String((err && err.message) || err) }));
          }
          return;
        }

        if (pathname === '/dsh-canvas/project-files' && req.method === 'POST') {
          try {
            const body = JSON.parse(await readBody(req) || '{}');
            const projectDir = projectDirectory(body.cwd, body.project);
            if (!projectDir) throw new Error('当前聊天没有画布项目');
            const images = await scanProjectImagesShared(projectDir);
            respond(res, 200, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: true, project: projectDir, images }));
          } catch (err) {
            respond(res, 500, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: false, error: String((err && err.message) || err) }));
          }
          return;
        }

        if (pathname === '/dsh-canvas/materialize-image' && req.method === 'POST') {
          try {
            const body = JSON.parse(await readBody(req) || '{}');
            const projectDir = projectDirectory(body.cwd, body.project);
            if (!projectDir) throw new Error('当前聊天没有画布项目');
            const image = await writeManagedImage(projectDir, body.name || '画布图片.png', body.dataURL);
            respond(res, 200, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: true, image }));
          } catch (err) {
            respond(res, 500, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: false, error: String((err && err.message) || err) }));
          }
          return;
        }

        if (pathname === '/dsh-canvas/vectorize-image' && req.method === 'POST') {
          let tempInput = '';
          let tempOutput = '';
          try {
            const body = JSON.parse(await readBody(req) || '{}');
            const projectDir = projectDirectory(body.cwd, body.project);
            if (!projectDir) throw new Error('当前聊天没有画布项目');
            const requestedBackend = ['auto', 'imagetracer', 'vtracer', 'vecto'].includes(String(body.backend || 'auto')) ? String(body.backend || 'auto') : 'auto';
            const vectorMode = ['auto', 'flat', 'full', 'silhouette'].includes(String(body.vectorMode || 'flat')) ? String(body.vectorMode || 'flat') : 'flat';
            const outputDir = join(projectDir, 'outputs', '.图片编辑临时');
            await mkdir(outputDir, { recursive: true });
            let sourcePath = typeof body.imagePath === 'string' && isRasterImagePath(body.imagePath) ? expandHome(body.imagePath) : '';
            if (sourcePath) {
              try {
                const info = await stat(sourcePath);
                // 空文件或超过单次上传上限都不能交给本地后端；若有 imageData，
                // 下面会自动回退到已上传的画布副本，避免 Rust 只报“找不到图片”。
                if (!info.isFile() || info.size <= 0 || info.size > MAX_IMAGE_BYTES) sourcePath = '';
              } catch (err) { sourcePath = ''; }
            }
            const uploaded = decodeImageData(body.imageData);
            if (!sourcePath && uploaded) {
              tempInput = join(outputDir, '.vector-input-' + Date.now() + '-' + Math.random().toString(16).slice(2) + '.' + uploaded.ext);
              await writeFile(tempInput, uploaded.bytes);
              sourcePath = tempInput;
            }
            if (!isRasterImagePath(sourcePath)) throw new Error('当前图片无法转为矢量（仅支持 PNG/JPG/WebP/GIF/AVIF/BMP）');
            try {
              const info = await stat(sourcePath);
              if (!info.isFile() || info.size <= 0) throw new Error('输入图片尚未落盘，请稍后重试');
            } catch (err) {
              if (err && err.message === '输入图片尚未落盘，请稍后重试') throw err;
              throw new Error('输入图片不存在或无法读取');
            }
            const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
            const script = join(pluginRoot, 'scripts', 'vectorize_image.py');
            await access(script);
            tempOutput = join(outputDir, '.vectorized-' + Date.now() + '-' + Math.random().toString(16).slice(2) + '.svg');
            const python = await resolvePython(ctx);
            const result = await runProcessWithTimeout(python.executable, [...python.prefixArgs, script, '--input', expandHome(sourcePath), '--output', tempOutput, '--backend', requestedBackend, '--vector-mode', vectorMode], pluginRoot, 360000);
            const lines = String(result.stdout || '').trim().split(/\r?\n/).filter(Boolean);
            let payload = null;
            try { payload = lines.length ? JSON.parse(lines[lines.length - 1]) : null; } catch (err) { payload = null; }
            if (result.exitCode !== 0 || !payload || payload.success !== true || !payload.output) {
              throw new Error((payload && payload.error) || result.stderr.trim() || (result.timedOut ? '本地矢量化超时' : '本地矢量化失败'));
            }
            const svgText = await readFile(tempOutput, 'utf8');
            const originalName = safeImageName(body.name || '画布图片.png');
            const dot = originalName.lastIndexOf('.');
            const base = dot > 0 ? originalName.slice(0, dot) : originalName;
            const saved = await writeManagedSvg(projectDir, base + '-矢量.svg', svgText);
            respond(res, 200, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: true, image: saved, backend: payload.backend, engine: payload.engine, vectorMode: payload.vectorMode || vectorMode, reason: payload.reason, complexity: payload.complexity, quality: payload.quality, available: payload.available }));
          } catch (err) {
            respond(res, 500, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: false, error: String((err && err.message) || err) }));
          } finally {
            if (tempInput) await unlink(tempInput).catch(() => {});
            if (tempOutput) await unlink(tempOutput).catch(() => {});
          }
          return;
        }

        if (pathname === '/dsh-canvas/ocr-image' && req.method === 'POST') {
          let tempInput = '';
          let tempBlocks = '';
          let tempVisionCrop = '';
          let tempVisionOcr = '';
          let tempVisionAnnotated = '';
          let visionCropMapping = null;
          try {
            const body = JSON.parse(await readBody(req) || '{}');
            const uploaded = decodeImageData(body.imageData);
            if (!uploaded) throw new Error('图片数据无效或超过 32MB');
            let visionWarning = '';
            const validCrop = (item) => item && typeof item === 'object' && Number(item.width || 0) >= 6 && Number(item.height || 0) >= 6;
            const requestedCrops = Array.isArray(body.crops) ? body.crops.filter(validCrop).slice(0, 24) : (validCrop(body.crop) ? [body.crop] : []);
            // A box drawn exactly on the glyph bounds clips antialiasing,
            // ascenders/descenders and the neighbouring context required by
            // both vision models and OCR. Expand only the recognition crop;
            // the original user rectangle remains the eligibility boundary.
            const sourceWidth = Math.max(1, Number(body.width || 1));
            const sourceHeight = Math.max(1, Number(body.height || 1));
            const recognitionCrops = requestedCrops.map((crop) => {
              const x = Number(crop.x || 0), y = Number(crop.y || 0);
              const width = Number(crop.width || 0), height = Number(crop.height || 0);
              const padX = Math.max(8, Math.min(48, width * 0.12));
              const padY = Math.max(8, Math.min(48, height * 0.22));
              const left = Math.max(0, x - padX), top = Math.max(0, y - padY);
              const right = Math.min(sourceWidth, x + width + padX), bottom = Math.min(sourceHeight, y + height + padY);
              return { x: Math.round(left), y: Math.round(top), width: Math.max(1, Math.round(right - left)), height: Math.max(1, Math.round(bottom - top)) };
            });
            logOperation('文字识别：开始 · ' + requestedCrops.length + ' 个选区 · ' + (body.model || '未取得聊天模型'));
            // 用户先框选，再由聊天输入框当前模型理解选区内文字与背景。
            if (body.provider && body.model) {
              try {
                let modelUploaded = uploaded;
                let modelBody = { ...body, crops: recognitionCrops };
                let cropMapping = null;
                if (recognitionCrops.length === 1) {
                  const outputDir = join(tmpdir(), 'dsh-canvas-text-rebuild');
                  await mkdir(outputDir, { recursive: true });
                  const token = Date.now() + '-' + Math.random().toString(16).slice(2);
                  tempInput = join(outputDir, '.ocr-input-' + token + '.' + uploaded.ext);
                  tempVisionCrop = join(outputDir, '.vision-crop-' + token + '.png');
                  tempVisionOcr = join(outputDir, '.vision-ocr-' + token + '.png');
                  tempVisionAnnotated = join(outputDir, '.vision-annotated-' + token + '.png');
                  await writeFile(tempInput, uploaded.bytes);
                  const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
                  const cropScript = join(pluginRoot, 'scripts', 'prepare_text_vision_crop.py');
                  const cropPython = await resolvePython(ctx);
                  const cropResult = await runProcessWithTimeout(cropPython.executable, [...cropPython.prefixArgs, cropScript, '--input', tempInput, '--output', tempVisionCrop, '--ocr-output', tempVisionOcr, '--annotated-output', tempVisionAnnotated, '--selection-region', JSON.stringify(requestedCrops[0]), '--region', JSON.stringify(recognitionCrops[0])], pluginRoot, 30000);
                  const cropLines = String(cropResult.stdout || '').trim().split(/\r?\n/).filter(Boolean);
                  let cropPayload = null;
                  try { cropPayload = cropLines.length ? JSON.parse(cropLines[cropLines.length - 1]) : null; } catch (err) { cropPayload = null; }
                  if (cropResult.exitCode === 0 && cropPayload && cropPayload.success === true) {
                    modelUploaded = { bytes: await readFile(tempVisionAnnotated), mime: 'image/png', ext: 'png' };
                    // Give the model exactly what the user sees conceptually:
                    // the complete image with a blue selection rectangle.
                    modelBody = { ...body, width: sourceWidth, height: sourceHeight, crops: [], selectionAnnotated: true,
                      visionUploads: [modelUploaded] };
                    visionCropMapping = cropPayload;
                    logOperation('文字识别：已放大选区送入聊天模型 · ' + cropPayload.outputWidth + '×' + cropPayload.outputHeight);
                  }
                }
                const analyzed = await analyzeTextWithCurrentModel(ctx, modelUploaded, modelBody);
                if (analyzed.transcriptionRetry) logOperation('文字识别：首轮为空，已使用当前聊天模型纯转写重试');
                const intersects = (block, region) => {
                  const iw = Math.max(0, Math.min(block.x + block.width, region.x + region.width) - Math.max(block.x, region.x));
                  const ih = Math.max(0, Math.min(block.y + block.height, region.y + region.height) - Math.max(block.y, region.y));
                  if (iw <= 0 || ih <= 0) return false;
                  const blockArea = Math.max(1, Number(block.width || 0) * Number(block.height || 0));
                  const centerX = Number(block.x || 0) + Number(block.width || 0) / 2;
                  const centerY = Number(block.y || 0) + Number(block.height || 0) / 2;
                  return (iw * ih) >= blockArea * 0.35
                    || (centerX >= Number(region.x || 0) && centerX <= Number(region.x || 0) + Number(region.width || 0)
                      && centerY >= Number(region.y || 0) && centerY <= Number(region.y || 0) + Number(region.height || 0));
                };
                let understood = visionBlocks(analyzed.value, analyzed.width, analyzed.height);
                logOperation('文字识别：聊天模型原始返回 · ' + (Array.isArray(analyzed.value && analyzed.value.blocks) ? analyzed.value.blocks.length : 0) + ' 个 blocks；规范化后 ' + understood.length + ' 个');
                if (cropMapping) {
                  const scaleX = Math.max(0.0001, Number(cropMapping.scaleX || 1));
                  const scaleY = Math.max(0.0001, Number(cropMapping.scaleY || 1));
                  understood = understood.map((block) => ({
                    ...block,
                    x: Math.round(Number(cropMapping.x || 0) + Number(block.x || 0) / scaleX),
                    y: Math.round(Number(cropMapping.y || 0) + Number(block.y || 0) / scaleY),
                    width: Math.max(1, Math.round(Number(block.width || 1) / scaleX)),
                    height: Math.max(1, Math.round(Number(block.height || 1) / scaleY)),
                    fontSize: Math.max(8, Math.round(Number(block.fontSize || 8) / scaleY)),
                  }));
                }
                // The annotated-image prompt already restricts output to the
                // blue rectangle. Do not discard valid recognized text a
                // second time based on model-estimated geometry: providers
                // vary between pixel, 0-1 and 0-1000 coordinate conventions.
                let blocks = modelBody.selectionAnnotated
                  ? understood
                  : requestedCrops.length
                  ? understood.filter((block) => requestedCrops.some((region) => intersects(block, region)))
                  : understood;
                let coordinateMode = cropMapping ? 'upscaled-selection-crop' : 'full-image';
                // Some vision adapters correctly read the selected text but
                // express 0-1000 coordinates relative to the selected crop,
                // despite being asked for full-image coordinates. Reproject
                // that valid text instead of discarding every row and falling
                // into a weaker OCR engine.
                if (!modelBody.selectionAnnotated && !blocks.length && understood.length && requestedCrops.length) {
                  const left = Math.min(...requestedCrops.map((item) => Number(item.x || 0)));
                  const top = Math.min(...requestedCrops.map((item) => Number(item.y || 0)));
                  const right = Math.max(...requestedCrops.map((item) => Number(item.x || 0) + Number(item.width || 0)));
                  const bottom = Math.max(...requestedCrops.map((item) => Number(item.y || 0) + Number(item.height || 0)));
                  const relative = visionBlocksRelativeToRegion(analyzed.value, analyzed.width, analyzed.height, {
                    x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top)
                  });
                  blocks = relative.filter((block) => requestedCrops.some((region) => intersects(block, region)));
                  if (blocks.length) {
                    coordinateMode = 'selection-relative';
                    logOperation('文字识别：已将模型选区相对坐标重映射到整图 · ' + blocks.length + ' 个文字对象');
                  }
                }
                if (!blocks.length) throw new Error('模型未识别到可用文字');
                const hints = Array.from(new Set(blocks.map((block) => String(block.backgroundHint || '').trim()).filter(Boolean))).slice(0, 12);
                const modelErasePrompt = String(analyzed.value.erasePrompt || '').trim();
                const erasePrompt = ((modelErasePrompt || ('仅擦除所选文字并按邻近真实背景连续补全。局部背景特征：' + hints.join('；')))
                  + (modelBody.selectionAnnotated ? ' 同时移除识别预览中人工添加的蓝色矩形引导框；蓝框不是原图内容。除蓝框内文字及该引导框外，其他内容保持不变。' : ''))
                  .slice(0, 2400);
                const erasePlan = {
                  schemaVersion: 1,
                  operation: 'remove-recognized-text',
                  prompt: erasePrompt,
                  preserveOutsideMask: true,
                  forbidNewText: true,
                  regions: blocks.map((block) => ({
                    text: block.text, x: block.x, y: block.y, width: block.width, height: block.height,
                    backgroundHint: block.backgroundHint || ''
                  }))
                };
                logOperation('文字识别：聊天模型完成 · ' + blocks.length + ' 个文字对象 · ' + analyzed.model);
                respond(res, 200, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({
                  ok: true, width: sourceWidth, height: sourceHeight, blocks, crops: requestedCrops,
                  schemaVersion: 1, erasePrompt, erasePlan, coordinateMode,
                  engine: 'current-chat-model', provider: analyzed.provider, model: analyzed.model, styleEngine: 'current-chat-model'
                }));
                return;
              } catch (err) {
                visionWarning = '当前聊天模型识别失败，已自动切换本地 OCR：' + String((err && err.message) || err);
                logOperation('文字识别：聊天模型失败，切换本地 OCR · ' + String((err && err.message) || err), 'warn');
              }
            } else if (requestedCrops.length) {
              visionWarning = '未取得聊天输入框的当前模型，已使用本地 OCR';
            }
            const outputDir = join(tmpdir(), 'dsh-canvas-text-rebuild');
            await mkdir(outputDir, { recursive: true });
            if (!tempInput) {
              tempInput = join(outputDir, '.ocr-input-' + Date.now() + '-' + Math.random().toString(16).slice(2) + '.' + uploaded.ext);
              await writeFile(tempInput, uploaded.bytes);
            }
            const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
            const script = join(pluginRoot, 'scripts', 'ocr_image.py');
            await access(script);
            // OCR no longer depends on a machine-wide tesseract.exe or on a
            // pre-installed pytesseract package.  The primary local engine is
            // a user-scoped Tesseract.js runtime; retain Python as a fallback
            // for installations that already provide the older stack.
            let python = null;
            try { python = await resolvePython(ctx); } catch (err) {}
            const runOcr = async (crop, inputPath = tempInput, inputWidth = Number(body.width || 0), inputHeight = Number(body.height || 0)) => {
              try {
                return await recognizeWithTesseractJs({
                  ctx,
                  runProcessWithTimeout,
                  cwd: pluginRoot,
                  inputPath,
                  width: inputWidth,
                  height: inputHeight,
                  lang: String(body.lang || 'chi_sim+eng'),
                  psm: String(body.psm || '11'),
                  crop,
                });
              } catch (jsError) {
                if (!python) throw jsError;
                // Sparse-text mode is more reliable for a selected artwork
                // area. Keep the Python path for older installations that
                // already have pytesseract and a native Tesseract binary.
                const ocrArgs = [script, '--input', tempInput, '--lang', String(body.lang || 'chi_sim+eng'), '--psm', String(body.psm || '11')];
                if (crop) ocrArgs.push('--crop', JSON.stringify(crop));
                const result = await runProcessWithTimeout(python.executable, [...python.prefixArgs, ...ocrArgs], pluginRoot, 120000);
                const lines = String(result.stdout || '').trim().split(/\r?\n/).filter(Boolean);
                let payload = null;
                try { payload = lines.length ? JSON.parse(lines[lines.length - 1]) : null; } catch (err) { payload = null; }
                if (result.exitCode !== 0 || !payload || payload.success !== true) {
                  const fallbackMessage = (payload && payload.error) || result.stderr.trim() || (result.timedOut ? 'OCR 识别超时' : 'OCR 识别失败');
                  throw new Error('本地 OCR 不可用：' + fallbackMessage + '；Tesseract.js 兜底也失败：' + String((jsError && jsError.message) || jsError));
                }
                return { ...payload, engine: 'tesseract' };
              }
            };
            let payloads = [];
            if (requestedCrops.length === 1 && tempVisionCrop && visionCropMapping) {
              let cropPayload = await runOcr(null, tempVisionCrop, Number(visionCropMapping.outputWidth || 0), Number(visionCropMapping.outputHeight || 0));
              if ((!Array.isArray(cropPayload.blocks) || !cropPayload.blocks.length) && tempVisionOcr) {
                cropPayload = await runOcr(null, tempVisionOcr, Number(visionCropMapping.outputWidth || 0), Number(visionCropMapping.outputHeight || 0));
                logOperation('文字识别：彩色高清选区未命中，已使用黑字白底增强图');
              }
              const scaleX = Math.max(0.0001, Number(visionCropMapping.scaleX || 1));
              const scaleY = Math.max(0.0001, Number(visionCropMapping.scaleY || 1));
              cropPayload.blocks = (Array.isArray(cropPayload.blocks) ? cropPayload.blocks : []).map((block) => ({
                ...block,
                x: Math.round(Number(visionCropMapping.x || 0) + Number(block.x || 0) / scaleX),
                y: Math.round(Number(visionCropMapping.y || 0) + Number(block.y || 0) / scaleY),
                width: Math.max(1, Math.round(Number(block.width || 1) / scaleX)),
                height: Math.max(1, Math.round(Number(block.height || 1) / scaleY)),
                fontSize: Math.max(8, Math.round(Number(block.fontSize || 8) / scaleY)),
              }));
              cropPayload.width = Number(body.width || 1);
              cropPayload.height = Number(body.height || 1);
              payloads = [cropPayload];
              logOperation('文字识别：本地兜底改用高清选区 · ' + Number(visionCropMapping.outputWidth || 0) + '×' + Number(visionCropMapping.outputHeight || 0));
            } else {
              payloads = requestedCrops.length ? [] : [await runOcr(null)];
              for (const crop of recognitionCrops) payloads.push(await runOcr(crop));
            }
            const payload = payloads[0] || { width: Number(body.width || 1), height: Number(body.height || 1) };
            let blocks = [];
            const seenBlocks = new Set();
            for (const item of payloads.flatMap((entry) => Array.isArray(entry.blocks) ? entry.blocks : [])) {
              const key = [String(item.text || '').trim(), Math.round(Number(item.x || 0)), Math.round(Number(item.y || 0)), Math.round(Number(item.width || 0)), Math.round(Number(item.height || 0))].join('|');
              if (!seenBlocks.has(key)) { seenBlocks.add(key); blocks.push(item); }
            }
            blocks.sort((a, b) => Number(a.y || 0) - Number(b.y || 0) || Number(a.x || 0) - Number(b.x || 0));
            // Each crop engine starts numbering at ocr-1. Reassign after
            // flattening so multiple selections never create duplicate React
            // keys or make a row update the wrong candidate.
            blocks.forEach((item, index) => { if (item && typeof item === 'object') item.id = 'ocr-' + (index + 1); });
            // OCR only returns geometry.  Add a conservative, local visual
            // estimate for font family/weight/size/color so the review panel
            // starts with usable values instead of an unavailable font name.
            let styleEngine = 'unavailable';
            try {
              const styleScript = join(pluginRoot, 'scripts', 'infer_text_style.py');
              await access(styleScript);
              if (!python) throw new Error('未检测到 Python，跳过文字样式推测');
              // Passing Chinese OCR text as a Windows argv is not reliable in
              // every DSH subprocess host (it can become U+FFFD). Use a UTF-8
              // temporary JSON file so style inference never changes text.
              tempBlocks = join(outputDir, '.ocr-blocks-' + Date.now() + '-' + Math.random().toString(16).slice(2) + '.json');
              await writeFile(tempBlocks, JSON.stringify(blocks), 'utf8');
              const styled = await runProcessWithTimeout(python.executable, [...python.prefixArgs, styleScript, '--input', tempInput, '--blocks-file', tempBlocks], pluginRoot, 120000);
              const styleLines = String(styled.stdout || '').trim().split(/\r?\n/).filter(Boolean);
              let stylePayload = null;
              try { stylePayload = styleLines.length ? JSON.parse(styleLines[styleLines.length - 1]) : null; } catch (err) { stylePayload = null; }
              if (styled.exitCode === 0 && stylePayload && stylePayload.success === true && Array.isArray(stylePayload.blocks)) {
                blocks = stylePayload.blocks;
                styleEngine = stylePayload.engine || 'local-font-heuristic';
              }
            } catch (err) {}
            blocks.forEach((item, index) => { if (item && typeof item === 'object') item.id = 'ocr-' + (index + 1); });
            const localEngine = payloads.some((entry) => entry && entry.engine === 'tesseract') ? 'tesseract' : 'tesseract.js';
            logOperation('文字识别：本地兜底完成 · ' + blocks.length + ' 个文字对象 · ' + localEngine);
            respond(res, 200, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: true, width: payload.width, height: payload.height, blocks, crops: requestedCrops, engine: localEngine, styleEngine, warning: visionWarning }));
          } catch (err) {
            respond(res, 500, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: false, error: String((err && err.message) || err) }));
          } finally {
            if (tempInput) await unlink(tempInput).catch(() => {});
            if (tempBlocks) await unlink(tempBlocks).catch(() => {});
            if (tempVisionCrop) await unlink(tempVisionCrop).catch(() => {});
            if (tempVisionOcr) await unlink(tempVisionOcr).catch(() => {});
            if (tempVisionAnnotated) await unlink(tempVisionAnnotated).catch(() => {});
          }
          return;
        }

        if (pathname === '/dsh-canvas/export-text-psd' && req.method === 'POST') {
          let tempInput = '';
          let tempBlocks = '';
          let tempMask = '';
          let tempGenerated = '';
          let tempClean = '';
          let draftPsd = '';
          let finalPsd = '';
          let jsxPath = '';
          let appleScriptPath = '';
          try {
            const body = JSON.parse(await readBody(req) || '{}');
            const projectDir = projectDirectory(body.cwd, body.project);
            if (!projectDir) throw new Error('当前聊天没有画布项目');
            const uploaded = decodeImageData(body.imageData);
            if (!uploaded) throw new Error('图片数据无效或超过 32MB');
            const blocks = (Array.isArray(body.blocks) ? body.blocks.slice(0, 200) : []).map((item) => {
              if (!item || typeof item !== 'object') return item;
              return { ...item, text: normalizeTextLayerText(item.text) };
            });
            const validRegion = (item) => item && typeof item === 'object'
              && Number(item.width || 0) >= 6 && Number(item.height || 0) >= 6;
            const selections = (Array.isArray(body.selections) ? body.selections : (validRegion(body.selection) ? [body.selection] : []))
              .filter(validRegion).slice(0, 24);
            const intersectsSelection = (block, region) => {
              const bx = Number(block && block.x || 0), by = Number(block && block.y || 0);
              const bw = Number(block && block.width || 0), bh = Number(block && block.height || 0);
              const rx = Number(region && region.x || 0), ry = Number(region && region.y || 0);
              const rw = Number(region && region.width || 0), rh = Number(region && region.height || 0);
              const iw = Math.max(0, Math.min(bx + bw, rx + rw) - Math.max(bx, rx));
              const ih = Math.max(0, Math.min(by + bh, ry + rh) - Math.max(by, ry));
              if (iw <= 0 || ih <= 0) return false;
              const area = iw * ih;
              const blockArea = Math.max(1, bw * bh);
              const centerX = bx + bw / 2, centerY = by + bh / 2;
              return area >= blockArea * 0.35 || (centerX >= rx && centerX <= rx + rw && centerY >= ry && centerY <= ry + rh);
            };
            // Blue-box recognition already guarantees that every returned
            // block belongs to the user's selection. Re-filtering by the
            // model-estimated coordinates here used to disable valid rows,
            // leaving both the draft and Photoshop PSD without text layers.
            const exportBlocks = blocks.map((item) => item && typeof item === 'object'
              ? { ...item, enabled: item.enabled !== false }
              : item);
            // Photoshop ExtendScript 在部分版本中无法 app.open 中文目录下的
            // 临时文件；先在 ASCII 系统临时目录完成 JSX/PSD，再把最终字节
            // 写回项目 assets，避免路径编码导致原生文字层分支失败。
            const outputDir = join(tmpdir(), 'dsh-canvas-text-psd');
            await mkdir(outputDir, { recursive: true });
            const token = Date.now() + '-' + Math.random().toString(16).slice(2);
            // 不使用点开头的隐藏文件名：Photoshop 2025 ExtendScript 对
            // 隐藏 PSD 的 app.open() 会误报“打开选项不正确”。
            tempInput = join(outputDir, 'text-psd-input-' + token + '.' + uploaded.ext);
            draftPsd = join(outputDir, 'text-psd-draft-' + token + '.psd');
            finalPsd = join(outputDir, 'text-psd-final-' + token + '.psd');
            jsxPath = join(outputDir, 'text-psd-' + token + '.jsx');
            appleScriptPath = join(outputDir, 'text-psd-' + token + '.applescript');
            await writeFile(tempInput, uploaded.bytes);
            const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
            const script = join(pluginRoot, 'scripts', 'export_text_psd.py');
            await access(script);
            const python = await resolvePython(ctx);
            let cleanInput = '';
            let cleanupEngine = '';
            let cleanupWarning = '';
            const enabledBlocks = exportBlocks.filter((item) => item && item.enabled !== false && String(item.text || '').trim());
            // Build a narrow mask from the reviewed OCR rows and run the same
            // model chain as normal image editing: Codex/gpt-image-2 first,
            // Pixel image2 API second.  The final composite copies every pixel
            // outside the mask from the source, so a model cannot redraw the
            // whole poster or silently alter the product.
            if (body.cleanBackground !== false && selections.length) {
              try {
                const maskScript = join(pluginRoot, 'scripts', 'prepare_text_mask.py');
                const compositeScript = join(pluginRoot, 'scripts', 'composite_edit.py');
                await access(maskScript);
                await access(compositeScript);
                tempMask = join(outputDir, 'text-psd-mask-' + token + '.png');
                const preparedMask = await runProcessWithTimeout(python.executable, [...python.prefixArgs, maskScript, '--source', tempInput, '--blocks', JSON.stringify(exportBlocks), '--regions', JSON.stringify(selections), '--output', tempMask], pluginRoot, 120000);
                const maskLines = String(preparedMask.stdout || '').trim().split(/\r?\n/).filter(Boolean);
                let maskPayload = null;
                try { maskPayload = maskLines.length ? JSON.parse(maskLines[maskLines.length - 1]) : null; } catch (err) { maskPayload = null; }
                if (preparedMask.exitCode !== 0 || !maskPayload || maskPayload.success !== true || (Number(maskPayload.regions || 0) < 1 && Number(maskPayload.blocks || 0) < 1)) throw new Error('文字遮罩生成失败');

                const width = Math.max(1, Number(body.width || 1));
                const height = Math.max(1, Number(body.height || 1));
                const selectedTexts = Array.from(new Set(enabledBlocks.map((item) => String(item.text || '').replace(/\s+/g, ' ').trim()).filter(Boolean))).slice(0, 40);
                const selectedTextJson = JSON.stringify(selectedTexts, null, 0);
                const erasePlan = body.erasePlan && typeof body.erasePlan === 'object' ? body.erasePlan : null;
                const reasonedErasePrompt = String((erasePlan && erasePlan.prompt) || body.erasePrompt || '').trim().slice(0, 2400);
                const cleanPrompt = '这是严格局部的文字擦除与背景修复任务。用户明确框选了 ' + selections.length + ' 个区域；透明遮罩就是唯一允许编辑的区域。\n'
                  + '需要擦除的已识别文字候选为：' + selectedTextJson + '。识别结果可能不完整或有错，因此仍须删除遮罩区域内所有属于原文字的内容，包括完整文字、残缺偏旁、半个字形、笔画、标点、抗锯齿边缘、描边、阴影、发光和压缩残影；不要生成任何替代文字。\n'
                  + (reasonedErasePrompt ? ('视觉模型对选区的局部理解：' + reasonedErasePrompt + '\n') : '')
                  + '擦除后，根据每个框选区域四周紧邻像素，推断并延续文字出现之前的真实背景。保持原有颜色、渐变、材质纹理、光照、噪声、透视、颗粒尺度及连续线条，形成自然 clean plate。框选区域内若存在非文字的产品、人物、图形或结构，只修补被文字覆盖的部分，不改变其形状与位置。\n'
                  + '框选区域之外必须逐像素保持原图不变。禁止重绘、缩放、美化或锐化整图，禁止改变其他文字、产品、人物、构图、颜色和清晰度，禁止生成新文字、图标、色块或装饰。输出尺寸必须与原图完全一致，边缘自然无接缝、无白块、无光晕、无重复纹理。';
                tempClean = join(outputDir, 'text-psd-clean-' + token + '.png');
                // Deterministic glyph inpainting is the primary path. Image
                // generation cannot guarantee that a button/card gradient is
                // pixel-identical even with a strict prompt and mask.
                const localInpaintScript = join(pluginRoot, 'scripts', 'inpaint_text_glyphs.py');
                try {
                  await access(localInpaintScript);
                  const localResult = await runProcessWithTimeout(python.executable, [...python.prefixArgs, localInpaintScript, '--source', tempInput, '--mask', tempMask, '--output', tempClean], pluginRoot, 180000);
                  const localLines = String(localResult.stdout || '').trim().split(/\r?\n/).filter(Boolean);
                  let localPayload = null;
                  try { localPayload = localLines.length ? JSON.parse(localLines[localLines.length - 1]) : null; } catch (err) { localPayload = null; }
                  if (localResult.exitCode === 0 && localPayload && localPayload.success === true) {
                    cleanInput = tempClean;
                    cleanupEngine = localPayload.engine || 'local-glyph-inpaint';
                  }
                } catch (err) {}
                // Retain image2 as a compatibility fallback only when the
                // deterministic local repair is unavailable.
                if (!cleanInput) {
                  const engineSettings = await readImageEngineSettings();
                  const generated = await generateImage({
                    ctx,
                    image: uploaded.bytes,
                    mask: await readFile(tempMask),
                    prompt: cleanPrompt,
                    engine: engineSettings.engine,
                    signal: AbortSignal.timeout(900000)
                  });
                  cleanupEngine = generated.engine;
                  tempGenerated = join(outputDir, 'text-psd-generated-' + token + '.png');
                  await writeFile(tempGenerated, generated.bytes);
                  const composite = await runProcessWithTimeout(python.executable, [...python.prefixArgs, compositeScript, '--source', tempInput, '--generated', tempGenerated, '--mask', tempMask, '--output', tempClean], pluginRoot, 180000);
                  if (composite.exitCode === 0) {
                    try { const cleanInfo = await stat(tempClean); if (cleanInfo.isFile() && cleanInfo.size > 0) cleanInput = tempClean; } catch (err) {}
                  }
                }
                if (!cleanInput) {
                  try { const cleanInfo = await stat(tempClean); if (cleanInfo.isFile() && cleanInfo.size > 0) cleanInput = tempClean; } catch (err) {}
                }
                if (!cleanInput) {
                  cleanupWarning = '局部背景合成失败，已保留原图作为 PSD 底层';
                  cleanupEngine = '';
                }
              } catch (err) {
                cleanupWarning = String((err && err.message) || err);
                cleanupEngine = '';
              }
            } else if (body.cleanBackground !== false && !selections.length) {
              cleanupWarning = '没有框选文字区域，跳过 image2 背景清理';
            }
            tempBlocks = join(outputDir, 'text-psd-blocks-' + token + '.json');
            await writeFile(tempBlocks, JSON.stringify(exportBlocks), 'utf8');
            const generatedArgs = [script, '--input', tempInput, '--output', draftPsd, '--blocks-file', tempBlocks];
            if (cleanInput) generatedArgs.push('--clean-input', cleanInput);
            const generated = await runProcessWithTimeout(python.executable, [...python.prefixArgs, ...generatedArgs], pluginRoot, 180000);
            const generatedLines = String(generated.stdout || '').trim().split(/\r?\n/).filter(Boolean);
            let generatedPayload = null;
            try { generatedPayload = generatedLines.length ? JSON.parse(generatedLines[generatedLines.length - 1]) : null; } catch (err) { generatedPayload = null; }
            if (generated.exitCode !== 0 || !generatedPayload || generatedPayload.success !== true) throw new Error((generatedPayload && generatedPayload.error) || generated.stderr.trim() || (generated.timedOut ? 'PSD 草稿生成超时' : 'PSD 草稿生成失败'));

            let photoshop = false;
            let photoshopWarning = '';
            // Keep the JSX ASCII-only so Windows Photoshop never decodes
            // Chinese text/path metadata through a legacy code page.
            const jsxPayload = JSON.stringify({ input: draftPsd, output: finalPsd, blocks: exportBlocks, cleanBackground: Boolean(cleanInput) })
              .replace(/[\u007f-\uffff]/g, (character) => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'));
            const jsx = '#target photoshop\n(function(){\n'
              + 'var cfg=' + jsxPayload + ';\n'
              + 'function rgb(value){var m=String(value||"#111827").replace("#",""); if(m.length!==6)m="111827"; var c=new SolidColor(); c.rgb.red=parseInt(m.substr(0,2),16); c.rgb.green=parseInt(m.substr(2,2),16); c.rgb.blue=parseInt(m.substr(4,2),16); return c;}\n'
              + 'try{var doc=app.open(new File(cfg.input)); var list=cfg.blocks||[]; for(var i=0;i<list.length;i++){var b=list[i]||{}; var text=String(b.text||"").replace(/^[\\s\\r\\n]+|[\\s\\r\\n]+$/g,""); if(b.enabled===false||!text)continue; var layer=doc.artLayers.add(); layer.kind=LayerKind.TEXT; layer.name="文字 "+(i+1)+" · "+text.substr(0,24); var ti=layer.textItem; ti.contents=text; ti.position=[Number(b.x||0),Number(b.y||0)+Math.max(8,Number(b.fontSize||24))]; ti.size=Math.max(8,Number(b.fontSize||24)); try{ti.font=String(b.fontPostScript||b.fontFamily||"PingFangSC-Regular");}catch(fontErr){try{ti.font="ArialMT";}catch(fontFallbackErr){}} ti.color=rgb(b.color); try{ti.tracking=Math.max(-200,Math.min(1000,Number(b.letterSpacing||0)));}catch(trackErr){} try{if(Number(b.lineHeight||0)>0)ti.leading=Number(b.lineHeight);}catch(leadErr){} try{ti.justification=String(b.textAlign||"left")==="center"?Justification.CENTER:String(b.textAlign||"left")==="right"?Justification.RIGHT:Justification.LEFT;}catch(justErr){} try{if(Math.abs(Number(b.rotation||0))>0.01)layer.rotate(Number(b.rotation));}catch(rotateErr){} layer.visible=true;} for(var g=0;g<doc.layerSets.length;g++){try{if(String(doc.layerSets[g].name)==="OCR text preview - replace in Photoshop")doc.layerSets[g].visible=false;}catch(groupErr){}} var opts=new PhotoshopSaveOptions(); opts.layers=true; doc.saveAs(new File(cfg.output),opts,true,Extension.LOWERCASE); doc.close(SaveOptions.DONOTSAVECHANGES); }catch(err){try{if(doc)doc.close(SaveOptions.DONOTSAVECHANGES);}catch(closeErr){} throw err;}\n})();\n';
            await writeFile(jsxPath, jsx, 'utf8');
            // Explicit UTF-8 decoding prevents Chinese `contents` from being
            // interpreted with the host's legacy Mac encoding.
            const appleScript = 'tell application id "com.adobe.Photoshop"\nactivate\ndo javascript (read POSIX file ' + JSON.stringify(jsxPath) + ' as «class utf8»)\nend tell\n';
            await writeFile(appleScriptPath, appleScript, 'utf8');
            if (body.openPhotoshop !== false && isWindows) {
              try {
                const settings = await readImageEngineSettings();
                const executable = await findWindowsAdobeExecutable('photoshop', ctx, runProcess, settings.photoshopPath);
                if (!executable) throw new Error('未找到 Adobe Photoshop');
                const powershell = await ctx.subprocess.resolveExecutable('powershell.exe');
                const literal = (value) => "'" + String(value || '').replace(/'/g, "''") + "'";
                // `Photoshop.exe -r file.jsx` is ignored when an existing
                // Photoshop process owns the single-instance window. Use its
                // COM automation API and retry while Photoshop is starting or
                // temporarily busy; success means the JSX actually returned.
                const launchScript = '$deadline=(Get-Date).AddSeconds(90);$last="";do{try{$app=New-Object -ComObject Photoshop.Application;$app.Visible=$true;$app.DoJavaScriptFile(' + literal(jsxPath) + ');exit 0}catch{$last=$_.Exception.Message;Start-Sleep -Milliseconds 750}}while((Get-Date)-lt $deadline);Write-Error $last;exit 1';
                const launched = await runProcessWithTimeout(powershell, ['-NoLogo', '-NoProfile', '-Command', launchScript], outputDir, 105000);
                if (launched.exitCode !== 0 || launched.timedOut) throw new Error(launched.stderr.trim() || 'Photoshop 脚本自动化失败或超时');
                const deadline = Date.now() + 90000;
                while (Date.now() < deadline) {
                  try {
                    const info = await stat(finalPsd);
                    if (info.isFile() && info.size > 0) { photoshop = true; break; }
                  } catch (err) {}
                  await new Promise((resolve) => setTimeout(resolve, 500));
                }
                if (!photoshop) photoshopWarning = 'Photoshop 未在 90 秒内返回文字层 PSD，已使用草稿兜底';
              } catch (err) {
                photoshopWarning = String((err && err.message) || err) + '，已使用 PSD 草稿兜底';
              }
            } else if (body.openPhotoshop !== false && isMac) {
              try {
                const osascript = await ctx.subprocess.resolveExecutable('osascript');
                const scripted = await runProcessWithTimeout(osascript, [appleScriptPath], outputDir, 120000);
                try { await stat(finalPsd); photoshop = scripted.exitCode === 0; } catch (err) {}
                if (!photoshop) photoshopWarning = String(scripted.stderr || '').trim() || '未能调用 Photoshop 原生文字层，已使用 PSD 草稿兜底';
              } catch (err) {
                photoshopWarning = String((err && err.message) || err);
              }
            } else if (body.openPhotoshop === false) {
              photoshopWarning = '已生成 PSD 草稿（未调用 Photoshop），原图与 OCR 文字预览均已保留';
            } else {
              photoshopWarning = '已生成可打开的 PSD 草稿；未执行 Photoshop 原生文字层写入';
            }
            const sourcePsd = photoshop ? finalPsd : draftPsd;
            const bytes = await readFile(sourcePsd);
            const originalName = safeImageName(body.name || '画布图片.png');
            const dot = originalName.lastIndexOf('.');
            const base = dot > 0 ? originalName.slice(0, dot) : originalName;
            const saved = await writeManagedSource(projectDir, base + '-文字编辑.psd', bytes, 'psd');
            let opened = false;
            if (body.openPhotoshop !== false) {
              try {
                if (isWindows) {
                  const result = await openWithSystem(ctx, runProcess, saved.path, dirname(saved.path));
                  opened = result.exitCode === 0;
                } else {
                  const opener = await ctx.subprocess.resolveExecutable('open');
                  const attempts = [['-b', 'com.adobe.Photoshop', saved.path], ['-a', 'Adobe Photoshop 2024', saved.path], ['-a', 'Adobe Photoshop 2025', saved.path], ['-a', 'Adobe Photoshop', saved.path]];
                  for (const args of attempts) {
                    const result = await runProcess(opener, args, dirname(saved.path));
                    if (result.exitCode === 0) { opened = true; break; }
                  }
                }
              } catch (err) {}
            }
            const info = await stat(saved.path);
            const warnings = [cleanupWarning, photoshopWarning].filter(Boolean).join('；');
            respond(res, 200, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: true, image: { path: saved.path, name: saved.name, mtime: info.mtimeMs, kind: 'psd', managed: true, url: previewUrl(saved.path, info.mtimeMs) }, photoshop, opened, cleanedBackground: Boolean(cleanInput), cleanupEngine: cleanupEngine || 'none', styleEngine: 'local-font-heuristic', warning: warnings, blockCount: enabledBlocks.length, selectionCount: selections.length }));
          } catch (err) {
            respond(res, 500, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: false, error: String((err && err.message) || err) }));
          } finally {
            for (const path of [tempInput, tempBlocks, tempMask, tempGenerated, tempClean, draftPsd, finalPsd, jsxPath, appleScriptPath]) if (path) await unlink(path).catch(() => {});
          }
          return;
        }

        if (pathname === '/dsh-canvas/archive-images' && req.method === 'POST') {
          try {
            const body = JSON.parse(await readBody(req) || '{}');
            const projectDir = projectDirectory(body.cwd, body.project);
            if (!projectDir) throw new Error('当前聊天没有画布项目');
            await flattenRecycleBin(projectDir);
            const paths = Array.isArray(body.paths) ? [...new Set(body.paths.map((item) => expandHome(String(item || ''))))].slice(0, 500) : [];
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            const recycleDir = join(projectDir, '画布回收站');
            const chatImagesDir = join(projectDir, 'DSH聊天生成图片');
            const records = [];
            for (const source of paths) {
              if (!source || !isPathInside(source, projectDir) || !isSourceImagePath(source) || isPathInside(source, recycleDir) || isPathInside(source, chatImagesDir)) continue;
              try {
                await access(source);
                await mkdir(recycleDir, { recursive: true });
                const originalName = basename(source);
                let target = join(recycleDir, originalName);
                for (let index = 1; index <= 1000; index += 1) {
                  try { await access(target); target = join(recycleDir, originalName.replace(/(\.[^.]+)?$/, '-删除于-' + stamp + (index > 1 ? '-' + index : '') + '$1')); }
                  catch (err) { break; }
                }
                await rename(source, target);
                records.push({ original: source, archived: target });
              } catch (err) {}
            }
            respond(res, 200, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: true, recycle: recycleDir, records }));
          } catch (err) {
            respond(res, 500, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: false, error: String((err && err.message) || err) }));
          }
          return;
        }

        if (pathname === '/dsh-canvas/restore-image' && req.method === 'POST') {
          try {
            const body = JSON.parse(await readBody(req) || '{}');
            const projectDir = projectDirectory(body.cwd, body.project);
            const archived = expandHome(String(body.archived || ''));
            const original = expandHome(String(body.original || ''));
            if (!projectDir || !isPathInside(archived, join(projectDir, '画布回收站')) || !isPathInside(original, projectDir)) throw new Error('恢复路径无效');
            await mkdir(dirname(original), { recursive: true });
            try { await access(original); throw new Error('原位置已有同名文件'); } catch (err) { if (err && err.message === '原位置已有同名文件') throw err; }
            await rename(archived, original);
            const info = await stat(original);
            respond(res, 200, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: true, path: original, mtime: info.mtimeMs, url: previewUrl(original, info.mtimeMs) }));
          } catch (err) {
            respond(res, 500, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: false, error: String((err && err.message) || err) }));
          }
          return;
        }

        if (pathname === '/dsh-canvas/backup-canvas' && req.method === 'POST') {
          try {
            const body = JSON.parse(await readBody(req) || '{}');
            const projectDir = projectDirectory(body.cwd, body.project);
            if (!projectDir || !body.snapshot) throw new Error('没有可备份的画布');
            const backupDir = join(projectDir, '画布备份');
            await mkdir(backupDir, { recursive: true });
            const name = 'canvas-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
            const path = join(backupDir, name);
            await writeFile(path, JSON.stringify(body.snapshot, null, 2), 'utf8');
            respond(res, 200, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: true, path }));
          } catch (err) {
            respond(res, 500, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: false, error: String((err && err.message) || err) }));
          }
          return;
        }

        if (pathname === '/dsh-canvas/projects' && req.method === 'GET') {
          const cwd = expandHome(parseQuery(query).cwd || '');
          if (!cwd) { respond(res, 400, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ error: 'missing cwd' })); return; }
          try {
            const entries = await readdir(cwd, { withFileTypes: true });
            const projects = [];
            for (const entry of entries) {
              if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
              const dir = join(cwd, entry.name);
              const canvas = join(dir, 'canvas.json');
              try {
                const info = await stat(canvas);
                const elements = (await readCanvasProjectElements(canvas, info)).filter((item) => item && !item.isDeleted);
                projects.push({ name: entry.name, path: dir, elements: elements.length, images: elements.filter((item) => item.type === 'image').length, updatedAt: info.mtimeMs });
              } catch (err) {}
            }
            projects.sort((a, b) => b.updatedAt - a.updatedAt);
            respond(res, 200, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ projects }));
          } catch (err) {
            respond(res, 500, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ error: String((err && err.message) || err) }));
          }
          return;
        }

        if (pathname === '/dsh-canvas/rename-project' && req.method === 'POST') {
          try {
            const body = JSON.parse(await readBody(req) || '{}');
            const projectDir = projectDirectory(body.cwd, body.project);
            const requested = String(body.name || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').trim().replace(/[. ]+$/g, '').slice(0, 80);
            if (!projectDir || !requested) throw new Error('项目名称不能为空');
            const info = await stat(projectDir);
            if (!info.isDirectory()) throw new Error('项目目录不存在');
            await stat(join(projectDir, 'canvas.json'));
            const target = join(dirname(projectDir), requested);
            if (target === projectDir) {
              respond(res, 200, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: true, project: projectDir, name: basename(projectDir) }));
              return;
            }
            try { await access(target); throw new Error('同级目录中已存在同名项目'); } catch (err) { if (err && err.message === '同级目录中已存在同名项目') throw err; }
            await rename(projectDir, target);
            respond(res, 200, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: true, project: target, name: requested }));
          } catch (err) {
            respond(res, 500, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: false, error: String((err && err.message) || err) }));
          }
          return;
        }

        if (pathname === '/dsh-canvas/delete-project' && req.method === 'POST') {
          try {
            const body = JSON.parse(await readBody(req) || '{}');
            const projectDir = projectDirectory(body.cwd, body.project);
            if (!projectDir) throw new Error('缺少项目目录');
            const info = await stat(projectDir);
            if (!info.isDirectory()) throw new Error('项目目录不存在');
            await stat(join(projectDir, 'canvas.json'));
            const recycleDir = join(dirname(projectDir), '已删除画布项目');
            if (projectDir === recycleDir || projectDir.startsWith(recycleDir + '/')) throw new Error('项目已在回收目录中');
            await mkdir(recycleDir, { recursive: true });
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            const base = basename(projectDir);
            let target = join(recycleDir, base + '-删除于-' + stamp);
            for (let index = 2; index <= 1000; index += 1) {
              try { await access(target); target = join(recycleDir, base + '-删除于-' + stamp + '-' + index); }
              catch (err) { break; }
            }
            await rename(projectDir, target);
            respond(res, 200, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: true, archived: target, recycle: recycleDir }));
          } catch (err) {
            respond(res, 500, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: false, error: String((err && err.message) || err) }));
          }
          return;
        }

        if (pathname === '/dsh-canvas/open-project' && req.method === 'POST') {
          try {
            const body = JSON.parse(await readBody(req));
            const projectDir = projectDirectory(body.cwd, body.project);
            if (!projectDir) throw new Error('当前聊天没有可打开的项目目录');
            await mkdir(join(projectDir, 'assets'), { recursive: true });
            await mkdir(join(projectDir, 'outputs'), { recursive: true });
            await flattenRecycleBin(projectDir);
            const outcome = await openFolder(ctx, runProcess, projectDir);
            if (outcome.exitCode !== 0) throw new Error(isWindows ? '资源管理器打开失败' : '访达打开失败');
            respond(res, 200, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: true, project: projectDir, assets: join(projectDir, 'assets') }));
          } catch (err) {
            respond(res, 500, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: false, error: String((err && err.message) || err) }));
          }
          return;
        }

        if (pathname === '/dsh-canvas/reveal-file' && req.method === 'POST') {
          try {
            const body = JSON.parse(await readBody(req) || '{}');
            const target = expandHome(String(body.path || ''));
            if (!target) throw new Error('缺少文件路径');
            const info = await stat(target);
            if (!info.isFile()) throw new Error('目标不是文件');
            const result = await revealFile(ctx, runProcess, target, dirname(target));
            if (result.exitCode !== 0) throw new Error(result.stderr.trim() || (isWindows ? '资源管理器定位失败' : '访达定位失败'));
            respond(res, 200, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: true, path: target }));
          } catch (err) {
            respond(res, 500, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: false, error: String((err && err.message) || err) }));
          }
          return;
        }

        if (pathname === '/dsh-canvas/open-in-photoshop' && req.method === 'POST') {
          try {
            const body = JSON.parse(await readBody(req) || '{}');
            const projectDir = projectDirectory(body.cwd, body.project);
            if (!projectDir) throw new Error('当前聊天没有画布项目');

            let path = expandHome(String(body.sourcePath || ''));
            let materialized = false;
            if (path && isSourceImagePath(path)) {
              const info = await stat(path);
              if (!info.isFile()) path = '';
            } else {
              path = '';
            }
            if (!path) {
              const image = await writeManagedImage(projectDir, body.name || 'Photoshop-编辑.png', body.dataURL);
              path = image.path;
              materialized = true;
            }

            let opened = false;
            let lastError = '';
            if (isWindows) {
              const settings = await readImageEngineSettings();
              const executable = await findWindowsAdobeExecutable('photoshop', ctx, runProcess, settings.photoshopPath);
              if (!executable) throw new Error('未找到 Adobe Photoshop，请先安装 Photoshop');
              // GUI 进程不会自行退出；用系统非阻塞启动器打开已确认存在的文件。
              const result = await openWithSystem(ctx, runProcess, path, dirname(path), executable);
              opened = result.exitCode === 0;
              lastError = result.stderr.trim();
            } else {
              const opener = await ctx.subprocess.resolveExecutable('open');
              const settings = await readImageEngineSettings();
              const attempts = [];
              if (settings.photoshopPath) attempts.push(['-a', settings.photoshopPath, path]);
              attempts.push(['-b', 'com.adobe.Photoshop', path], ['-a', 'Adobe Photoshop 2026', path], ['-a', 'Adobe Photoshop 2025', path], ['-a', 'Adobe Photoshop', path]);
              for (const args of attempts) {
                const result = await runProcess(opener, args, dirname(path));
                if (result.exitCode === 0) { opened = true; break; }
                lastError = result.stderr.trim() || lastError;
              }
            }
            if (!opened) throw new Error(lastError || '未找到 Adobe Photoshop，请先安装或启动 Photoshop');

            const info = await stat(path);
            const watchDirectory = dirname(path);
            const psdBaseline = [];
            try {
              const siblings = await readdir(watchDirectory, { withFileTypes: true });
              for (const sibling of siblings) {
                // macOS 在部分磁盘/共享目录会生成 AppleDouble `._文件名`
                // 元数据。它不是可编辑 PSD，绝不能进入基线或画布。
                if (!sibling.isFile() || sibling.name.startsWith('.') || extOf(sibling.name) !== 'psd') continue;
                const siblingPath = join(watchDirectory, sibling.name);
                const siblingInfo = await stat(siblingPath);
                psdBaseline.push({ path: siblingPath, mtime: siblingInfo.mtimeMs, size: siblingInfo.size });
              }
            } catch (err) {}
            const assetsDir = join(projectDir, 'assets');
            respond(res, 200, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({
              ok: true,
              image: {
                path,
                name: basename(path),
                mtime: info.mtimeMs,
                size: info.size,
                kind: sourceKindOf(path),
                managed: path === assetsDir || path.startsWith(assetsDir + (isWindows ? '\\' : '/')),
                url: previewUrl(path, info.mtimeMs)
              },
              materialized,
              photoshopWatch: { directory: watchDirectory, startedAt: Date.now(), baseline: psdBaseline }
            }));
          } catch (err) {
            respond(res, 500, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: false, error: String((err && err.message) || err) }));
          }
          return;
        }

        if (pathname === '/dsh-canvas/photoshop-outputs' && req.method === 'POST') {
          try {
            const body = JSON.parse(await readBody(req) || '{}');
            const projectDir = projectDirectory(body.cwd, body.project);
            const directory = normalizeLocalPath(body.directory);
            if (!projectDir || !directory) throw new Error('缺少 Photoshop 跟踪目录');
            const directoryInfo = await stat(directory);
            if (!directoryInfo.isDirectory()) throw new Error('Photoshop 跟踪目录不存在');
            const baseline = new Map((Array.isArray(body.baseline) ? body.baseline : []).slice(0, 1000).map((item) => [String(item && item.path || ''), item || {}]));
            const entries = await readdir(directory, { withFileTypes: true });
            const outputs = [];
            for (const entry of entries) {
              if (!entry.isFile() || entry.name.startsWith('.') || extOf(entry.name) !== 'psd') continue;
              const path = join(directory, entry.name);
              const info = await stat(path);
              if (!info.isFile() || info.size <= 0 || info.size > MAX_SOURCE_BYTES) continue;
              const previous = baseline.get(path);
              const changed = !previous || Math.abs(Number(previous.mtime || 0) - info.mtimeMs) > 1 || Number(previous.size || 0) !== info.size;
              if (!changed) continue;
              outputs.push({ path, name: entry.name, mtime: info.mtimeMs, size: info.size, kind: 'psd', managed: isPathInside(path, join(projectDir, 'assets')), url: previewUrl(path, info.mtimeMs) });
            }
            respond(res, 200, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: true, outputs }));
          } catch (err) {
            respond(res, 500, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: false, error: String((err && err.message) || err) }));
          }
          return;
        }

        if (pathname === '/dsh-canvas/open-in-illustrator' && req.method === 'POST') {
          try {
            const body = JSON.parse(await readBody(req) || '{}');
            const projectDir = projectDirectory(body.cwd, body.project);
            const path = expandHome(String(body.sourcePath || ''));
            const kind = sourceKindOf(path);
            if (!projectDir || !path || !isSourceImagePath(path) || !['svg', 'pdf', 'ai'].includes(kind)) throw new Error('Illustrator 编辑需要项目中的 SVG、PDF 或 AI 源文件');
            const info = await stat(path);
            if (!info.isFile()) throw new Error('源文件不存在');
            let opened = false;
            let lastError = '';
            if (isWindows) {
              const settings = await readImageEngineSettings();
              const executable = await findWindowsAdobeExecutable('illustrator', ctx, runProcess, settings.illustratorPath);
              if (!executable) throw new Error('未找到 Adobe Illustrator，请先安装 Illustrator');
              // GUI 进程不会自行退出；用系统非阻塞启动器打开已确认存在的文件。
              const result = await openWithSystem(ctx, runProcess, path, dirname(path), executable);
              opened = result.exitCode === 0;
              lastError = result.stderr.trim();
            } else {
              const opener = await ctx.subprocess.resolveExecutable('open');
              const settings = await readImageEngineSettings();
              const attempts = [];
              if (settings.illustratorPath) attempts.push(['-a', settings.illustratorPath, path]);
              attempts.push(['-b', 'com.adobe.Illustrator', path], ['-a', 'Adobe Illustrator 2026', path], ['-a', 'Adobe Illustrator 2025', path], ['-a', 'Adobe Illustrator 2024', path], ['-a', 'Adobe Illustrator', path]);
              for (const args of attempts) {
                const result = await runProcess(opener, args, dirname(path));
                if (result.exitCode === 0) { opened = true; break; }
                lastError = result.stderr.trim() || lastError;
              }
            }
            if (!opened) throw new Error(lastError || '未找到 Adobe Illustrator，请先安装或启动 Illustrator');
            respond(res, 200, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: true, path, name: basename(path), kind, mtime: info.mtimeMs, url: previewUrl(path, info.mtimeMs) }));
          } catch (err) {
            respond(res, 500, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: false, error: String((err && err.message) || err) }));
          }
          return;
        }

        if (pathname === '/dsh-canvas/rename-image' && req.method === 'POST') {
          try {
            const body = JSON.parse(await readBody(req));
            const projectDir = projectDirectory(body.cwd, body.project);
            if (!projectDir) throw new Error('当前聊天没有画布项目');
            const assetsDir = join(projectDir, 'assets');
            await mkdir(assetsDir, { recursive: true });
            const oldName = safeImageName(body.oldName || '', body.ext || 'png');
            const linkedSource = expandHome(String(body.sourcePath || ''));
            const normalizedProject = resolve(projectDir).replace(/\\/g, '/').toLowerCase();
            const normalizedSource = linkedSource ? resolve(linkedSource).replace(/\\/g, '/').toLowerCase() : '';
            const sourceInsideProject = linkedSource && (normalizedSource === normalizedProject || normalizedSource.startsWith(normalizedProject + '/')) && isSourceImagePath(linkedSource);
            const oldExt = sourceInsideProject ? extOf(linkedSource) : (extname(oldName).replace(/^\./, '') || 'png');
            const requested = String(body.newName || '').replace(/\.[a-zA-Z0-9]+$/, '');
            const newName = safeImageName(requested, oldExt);
            let renamedSource = linkedSource;
            if (sourceInsideProject) {
              await stat(linkedSource);
              const targetSource = join(dirname(linkedSource), newName);
              if (targetSource !== linkedSource) {
                try { await access(targetSource); throw new Error('源文件所在目录中已存在同名文件'); } catch (err) { if (err && err.message === '源文件所在目录中已存在同名文件') throw err; }
                await rename(linkedSource, targetSource);
                renamedSource = targetSource;
              }
            }
            const entries = await readdir(assetsDir, { withFileTypes: true });
            const safeId = String(body.fileId || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
            const source = entries.find((entry) => entry.isFile() && entry.name === oldName)
              || entries.find((entry) => entry.isFile() && safeId && entry.name.startsWith(safeId + '.'));
            const collision = entries.find((entry) => entry.isFile() && entry.name === newName && (!source || entry.name !== source.name));
            if (collision) throw new Error('项目图片目录中已存在同名文件');
            if (source && source.name !== newName && oldExt !== 'psd') await rename(join(assetsDir, source.name), join(assetsDir, newName));
            respond(res, 200, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: true, name: newName, path: join(assetsDir, newName), sourcePath: renamedSource }));
          } catch (err) {
            respond(res, 500, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: false, error: String((err && err.message) || err) }));
          }
          return;
        }

        if (pathname === '/dsh-canvas/remove-background-progress' && req.method === 'GET') {
          const params = parseQuery(query);
          const projectDir = projectDirectory(params.cwd, params.project);
          const jobId = cleanJobId(params.jobId);
          if (!projectDir || !jobId) {
            respond(res, 400, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: false, error: '无效的去背景任务' }));
            return;
          }
          const progressPath = progressPathFor(projectDir, jobId);
          try {
            const payload = JSON.parse(await readFile(progressPath, 'utf8'));
            respond(res, 200, { ...CORS, 'content-type': 'application/json', 'cache-control': 'no-store' }, JSON.stringify(payload));
          } catch (err) {
            // POST 还没来得及创建文件时，先返回可展示的启动状态。
            respond(res, 200, { ...CORS, 'content-type': 'application/json', 'cache-control': 'no-store' }, JSON.stringify({ ok: true, jobId, stage: 'starting', message: '正在启动本地 rembg…', percent: 1 }));
          }
          return;
        }

        if (pathname === '/dsh-canvas/remove-background' && req.method === 'POST') {
          let tempOutput = '';
          let progressPath = '';
          let jobId = '';
          try {
            const body = JSON.parse(await readBody(req));
            const projectDir = projectDirectory(body.cwd, body.project);
            if (!projectDir) throw new Error('当前聊天没有画布项目');
            logOperation('去背景：开始 · ' + String(body.name || '画布图片'));
            jobId = cleanJobId(body.jobId) || ('bg-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8));
            progressPath = progressPathFor(projectDir, jobId);
            await mkdir(dirname(progressPath), { recursive: true });
            await writeProgressFile(progressPath, { ok: true, jobId, stage: 'starting', message: '正在启动本地 rembg…', percent: 1 });
            const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
            const script = join(pluginRoot, 'scripts', 'remove_background.py');
            await access(script);
            const outputDir = join(projectDir, 'outputs', '.图片编辑临时');
            await mkdir(outputDir, { recursive: true });
            let sourcePath = typeof body.imagePath === 'string' && isRasterImagePath(body.imagePath) ? expandHome(body.imagePath) : sourcePathFromImageUrl(body.imageUrl);
            const uploaded = decodeImageData(body.imageData);
            if (!sourcePath && uploaded) {
              const masterDir = join(projectDir, '.dsh-edit-masters');
              await mkdir(masterDir, { recursive: true });
              const masterHash = createHash('sha1').update(uploaded.bytes).digest('hex');
              sourcePath = join(masterDir, masterHash + '.' + uploaded.ext);
              try { await access(sourcePath); } catch (err) { await writeFile(sourcePath, uploaded.bytes, { flag: 'wx' }).catch(async (writeErr) => { if (!writeErr || writeErr.code !== 'EEXIST') throw writeErr; }); }
            }
            if (!isRasterImagePath(sourcePath)) throw new Error('当前图片无法进行本地去背景（仅支持 PNG/JPG/WebP/GIF/AVIF/BMP）');
            tempOutput = join(outputDir, '.rembg-' + Date.now() + '-' + Math.random().toString(16).slice(2) + '.png');
            const python = await resolvePython(ctx);
            const result = await runProcess(python.executable, [...python.prefixArgs, script, '--input', expandHome(sourcePath), '--output', tempOutput, '--model', 'isnet-general-use', '--progress-file', progressPath], pluginRoot);
            const lines = String(result.stdout || '').trim().split(/\r?\n/).filter(Boolean);
            let payload = null;
            try { payload = lines.length ? JSON.parse(lines[lines.length - 1]) : null; } catch (err) { payload = null; }
            if (result.exitCode !== 0 || !payload || payload.success !== true || !isImagePath(payload.image)) {
              throw new Error((payload && payload.error) || result.stderr.trim() || 'rembg 去背景失败');
            }
            logOperation('去背景：模型完成，正在校验尺寸并保存');
            const finalBytes = await readFile(tempOutput);
            const originalName = safeImageName(body.name || '画布图片.png');
            const dot = originalName.lastIndexOf('.');
            const base = dot > 0 ? originalName.slice(0, dot) : originalName;
            const saved = await writeManagedImage(projectDir, base + '-去背景.png', 'data:image/png;base64,' + finalBytes.toString('base64'));
            logOperation('去背景：完成 · ' + saved.name + ' · ' + saved.size + ' bytes');
            await writeProgressFile(progressPath, { ok: true, jobId, stage: 'complete', message: '去背景完成', percent: 100 });
            respond(res, 200, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: true, jobId, engine: 'rembg-isnet-general-use', model: 'isnet-general-use', transparent: true, image: saved }));
          } catch (err) {
            if (progressPath) await writeProgressFile(progressPath, { ok: false, jobId, stage: 'error', message: String((err && err.message) || err), percent: null }).catch(() => {});
            respond(res, 500, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: false, error: String((err && err.message) || err) }));
          } finally {
            if (tempOutput) await unlink(tempOutput).catch(() => {});
            if (progressPath) {
              const timer = setTimeout(() => unlink(progressPath).catch(() => {}), 10 * 60 * 1000);
              if (timer && typeof timer.unref === 'function') timer.unref();
            }
          }
          return;
        }

        if (pathname === '/dsh-canvas/edit-image' && req.method === 'POST') {
          let tempInput = '';
          let tempRawMask = '';
          let tempMask = '';
          let tempModelInput = '';
          let tempModelMask = '';
          let tempGenerated = '';
          let tempComposite = '';
          try {
            const body = JSON.parse(await readBody(req));
            const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
            // 新客户端允许“编辑图片 + 可选遮罩”。显式 mode 优先；仅旧客户端
            // 未提供 mode 时，才把 maskData 兼容解释为擦除任务。
            const explicitMode = body.mode === 'erase' ? 'erase' : (body.mode === 'edit' ? 'edit' : '');
            const mode = explicitMode || (typeof body.maskData === 'string' && body.maskData.startsWith('data:image/') ? 'erase' : 'edit');
            logOperation('图片编辑：开始 · ' + (mode === 'erase' ? '局部擦除' : '图片修改') + ' · 第 ' + (Number(body.editDepth || 0) + 1) + ' 次');
            if (!prompt && mode !== 'erase') { respond(res, 400, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: false, error: '请输入图片修改提示词' })); return; }
            if (prompt.length > 4000) { respond(res, 400, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: false, error: '提示词过长' })); return; }

            const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
            const compositeScript = join(pluginRoot, 'scripts', 'composite_edit.py');
            const maskScript = join(pluginRoot, 'scripts', 'prepare_mask.py');
            const modelInputScript = join(pluginRoot, 'scripts', 'prepare_model_input.py');
            const projectDir = projectDirectory(body.cwd, body.project);
            if (!projectDir) throw new Error('当前聊天没有画布项目');
            const outputDir = join(projectDir, 'outputs', '.图片编辑临时');
            await mkdir(outputDir, { recursive: true });

            let currentSourcePath = typeof body.imagePath === 'string' && isRasterImagePath(body.imagePath) ? expandHome(body.imagePath) : sourcePathFromImageUrl(body.imageUrl);
            const rootSourcePath = typeof body.editRootPath === 'string' && isRasterImagePath(body.editRootPath) ? expandHome(body.editRootPath) : '';
            const uploaded = decodeImageData(body.imageData);
            if (!currentSourcePath && uploaded) {
              const masterDir = join(projectDir, '.dsh-edit-masters');
              await mkdir(masterDir, { recursive: true });
              const masterHash = createHash('sha1').update(uploaded.bytes).digest('hex');
              currentSourcePath = join(masterDir, masterHash + '.' + uploaded.ext);
              try { await access(currentSourcePath); } catch (err) { await writeFile(currentSourcePath, uploaded.bytes, { flag: 'wx' }).catch(async (writeErr) => { if (!writeErr || writeErr.code !== 'EEXIST') throw writeErr; }); }
            }
            // 连续擦除时让模型始终参考原始母版，避免把上一次的生成瑕疵
            // 再次作为输入；最终合成仍以当前图为底，保留之前已经完成的修改。
            let sourcePath = mode === 'edit' && rootSourcePath ? rootSourcePath : currentSourcePath;
            let modelSourcePath = mode === 'erase' && rootSourcePath ? rootSourcePath : sourcePath;
            let compositeSourcePath = currentSourcePath && isRasterImagePath(currentSourcePath) ? currentSourcePath : sourcePath;
            if (uploaded && !(mode === 'edit' && rootSourcePath)) {
              if (!sourcePath || !modelSourcePath) {
                tempInput = join(outputDir, '.canvas-edit-input-' + Date.now() + '-' + Math.random().toString(16).slice(2) + '.' + uploaded.ext);
                await writeFile(tempInput, uploaded.bytes);
                sourcePath = tempInput;
                modelSourcePath = tempInput;
                compositeSourcePath = tempInput;
              }
            }
            if (!isRasterImagePath(modelSourcePath)) throw new Error('当前图片无法转换为模型输入（仅支持栅格图片）');
            if (!isRasterImagePath(compositeSourcePath)) throw new Error('当前图片无法用于无损合成（仅支持栅格图片）');

            const python = await resolvePython(ctx);
            const mask = decodeImageData(body.maskData);
            if (mode === 'erase' && !mask) throw new Error('请先用画笔涂抹要擦除的区域');
            if (mask) {
              const maskToken = Date.now() + '-' + Math.random().toString(16).slice(2);
              tempRawMask = join(outputDir, '.canvas-edit-mask-raw-' + maskToken + '.png');
              tempMask = join(outputDir, '.canvas-edit-mask-prepared-' + maskToken + '.png');
              await writeFile(tempRawMask, mask.bytes);
              await access(maskScript);
              const prepared = await runProcess(python.executable, [...python.prefixArgs, maskScript, '--source', expandHome(modelSourcePath), '--mask', tempRawMask, '--output', tempMask], pluginRoot);
              if (prepared.exitCode !== 0) throw new Error(prepared.stderr.trim() || '擦除遮罩预处理失败');
            }

            const previousHistory = Array.isArray(body.editHistory) ? body.editHistory.filter((item) => typeof item === 'string' && item.trim()).slice(-10) : [];
            const currentInstruction = prompt || '仅清除遮罩区域并制作干净底图：依据遮罩边界四周的真实背景连续补全，不添加任何新内容';
            const cumulative = mode === 'edit' && previousHistory.length
              ? '以原始母版为基础，依次完成这些已确认修改：\n- ' + previousHistory.join('\n- ') + '\n本次继续修改：' + currentInstruction
              : currentInstruction;
            const finalPrompt = mode === 'erase'
              ? '这是严格的局部 clean-plate 图像修复，不是整图重绘、风格化生成或重新设计。透明遮罩覆盖的区域是必须移除的内容，遮罩外区域是锁定参考。\n'
                + cumulative
                + '\n硬性要求：\n'
                + '1. 将透明遮罩内的原始内容视为不存在，彻底移除文字、字形、标点、线条、描边、阴影、压痕、色块、反射和所有碎片；不得读取、猜测、复制、复原或改写原内容。\n'
                + '2. 只从遮罩边界外最近的真实背景取样并向内连续延伸，匹配原有颜色、渐变、材质纹理尺度、光照、透视、噪声和水纹方向；结果必须像原本就没有该内容，不能有涂抹感、补丁感、模糊边缘、光晕、接缝或重复纹理。\n'
                + (prompt
                  ? '3. 除用户明确写出的补全要求外，不得生成任何新物体、字符、图形或装饰。\n'
                  : '3. 不得在遮罩内生成任何可读或不可读字符、深色碎点、幽灵轮廓、新物体或装饰。\n')
                + '4. 遮罩外的产品、排版、颜色、清晰度、构图和所有像素必须保持不变；只允许改变透明遮罩区域。'
              : cumulative
                + (mask ? '\n本次只允许修改遮罩选区；遮罩外必须逐像素保持原样。' : '\n本次为整图修改。')
                + '\n保持未提及区域、产品身份、材质纹理、构图、颜色和清晰度不变，不要自行增加文字或装饰。';

            const width = Math.max(1, Number(body.width || 1));
            const height = Math.max(1, Number(body.height || 1));
            await access(compositeScript);
            await access(modelInputScript);
            const engineSettings = await readImageEngineSettings();
            const modelToken = Date.now() + '-' + Math.random().toString(16).slice(2);
            tempModelInput = join(outputDir, '.canvas-model-input-' + modelToken + '.webp');
            tempModelMask = tempMask ? join(outputDir, '.canvas-model-mask-' + modelToken + '.png') : '';
            const modelArgs = [modelInputScript, '--source', expandHome(modelSourcePath), '--output-image', tempModelInput, '--max-side', '1024'];
            if (tempMask) modelArgs.push('--mask', tempMask, '--output-mask', tempModelMask);
            const modelPrepared = await runProcess(python.executable, [...python.prefixArgs, ...modelArgs], pluginRoot);
            if (modelPrepared.exitCode !== 0) throw new Error(modelPrepared.stderr.trim() || '模型输入预处理失败');
            logOperation('图片编辑：模型输入已标准化为最长边 1024px' + (tempMask ? '，遮罩尺寸已对齐' : ''));
            const sourceBytes = await readFile(tempModelInput);
            const maskBytes = tempModelMask ? await readFile(tempModelMask) : null;
            const generated = await generateImage({
              ctx,
              image: sourceBytes,
              mask: maskBytes,
              prompt: finalPrompt,
              engine: engineSettings.engine,
              signal: AbortSignal.timeout(900000)
            });
            const engine = generated.engine;
            logOperation('图片编辑：引擎返回完成 · ' + engine + '，正在与当前母版合成');
            tempGenerated = join(outputDir, '.image-edit-' + Date.now() + '-' + Math.random().toString(16).slice(2) + '.png');
            await writeFile(tempGenerated, generated.bytes);
            tempComposite = join(outputDir, '.composited-edit-' + Date.now() + '-' + Math.random().toString(16).slice(2) + '.png');
            const compositeArgs = [compositeScript, '--source', expandHome(compositeSourcePath), '--generated', tempGenerated, '--output', tempComposite];
            if (tempMask) compositeArgs.push('--mask', tempMask);
            const composited = await runProcess(python.executable, [...python.prefixArgs, ...compositeArgs], pluginRoot);
            if (composited.exitCode !== 0) throw new Error(composited.stderr.trim() || '图片无损合成失败');
            logOperation('图片编辑：合成完成，遮罩外像素已恢复');

            const finalBytes = await readFile(tempComposite);
            const originalName = safeImageName(body.name || '画布图片.png');
            const dot = originalName.lastIndexOf('.');
            const base = dot > 0 ? originalName.slice(0, dot) : originalName;
            const saved = await writeManagedImage(projectDir, base + (mode === 'erase' ? '-擦除.png' : '-编辑.png'), 'data:image/png;base64,' + finalBytes.toString('base64'));
            logOperation('图片编辑：完成 · ' + saved.name + ' · ' + saved.size + ' bytes');
            const rootPath = rootSourcePath || (currentSourcePath && isRasterImagePath(currentSourcePath) ? currentSourcePath : saved.path);
            const nextHistory = previousHistory.concat([currentInstruction]).slice(-12);
            respond(res, 200, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({
              ok: true,
              engine,
              image: saved,
              editRootPath: rootPath,
              editHistory: nextHistory,
              editDepth: Number(body.editDepth || 0) + 1
            }));
          } catch (err) {
            respond(res, 500, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: false, error: String((err && err.message) || err) }));
          } finally {
            for (const path of [tempInput, tempRawMask, tempMask, tempModelInput, tempModelMask, tempGenerated, tempComposite]) if (path) await unlink(path).catch(() => {});
          }
          return;
        }

        if (pathname === '/dsh-canvas/state') {
          if (req.method === 'GET') {
            const path = projectStatePath(query);
            if (!path) { respond(res, 200, { ...CORS, 'content-type': 'application/json' }, 'null'); return; }
            try {
              const text = await readFile(path, 'utf8');
              respond(res, 200, { ...CORS, 'content-type': 'application/json' }, text);
            } catch (err) {
              respond(res, 200, { ...CORS, 'content-type': 'application/json' }, 'null');
            }
            return;
          }
          if (req.method === 'POST') {
            const path = projectStatePath(query);
            if (!path) { respond(res, 500, { ...CORS, 'content-type': 'text/plain' }, 'no state path'); return; }
            try {
              const body = await readBody(req);
              const snapshot = JSON.parse(body);
              const incomingMeta = snapshot && snapshot.dshMeta && typeof snapshot.dshMeta === 'object' ? snapshot.dshMeta : {};
              const incomingSavedAt = Number(incomingMeta.revision || incomingMeta.savedAt || 0);
              const incomingBaseRevision = Number(incomingMeta.baseRevision || 0);
              const previousWrite = stateWriteChains.get(path) || Promise.resolve();
              const writeTask = previousWrite.catch(() => {}).then(async () => {
                let existingSavedAt = 0;
                try {
                  const existing = JSON.parse(await readFile(path, 'utf8'));
                  existingSavedAt = Number(existing && existing.dshMeta && (existing.dshMeta.revision || existing.dshMeta.savedAt) || 0);
                } catch (err) {}
                // 新版状态已有版本标记时，旧版/旧缓存发来的无标记状态不再允许
                // 覆盖它；带更早时间戳的状态同样只确认但不落盘。
                if (
                  // 已版本化的项目不接受无基线快照；旧聊天/旧插件即使
                  // 把旧内容标成“刚保存”，也不能覆盖当前项目。
                  (existingSavedAt > 0 && (incomingSavedAt <= 0 || incomingBaseRevision <= 0)) ||
                  (incomingSavedAt > 0 && existingSavedAt >= incomingSavedAt) ||
                  // 客户端基于旧版本编辑时，拒绝其迟到写入，避免旧聊天
                  // 在删除后再次把已删除元素“复活”。
                  (existingSavedAt > 0 && incomingBaseRevision > 0 && existingSavedAt > incomingBaseRevision)
                ) {
                  return { stale: true, project: dirname(path), savedAt: existingSavedAt };
                }
                const projectDir = dirname(path);
                const assetsDir = join(projectDir, 'assets');
                const outputsDir = join(projectDir, 'outputs');
                await mkdir(assetsDir, { recursive: true });
                await mkdir(outputsDir, { recursive: true });
                const temp = path + '.tmp-' + process.pid + '-' + Date.now();
                await writeFile(temp, body, 'utf8');
                await rename(temp, path);
                await writeFile(join(projectDir, 'project.json'), JSON.stringify({ version: 1, canvas: 'canvas.json', assets: 'assets', outputs: 'outputs', updatedAt: new Date().toISOString() }, null, 2) + '\n', 'utf8');
                return { stale: false, project: projectDir, savedAt: incomingSavedAt };
              });
              stateWriteChains.set(path, writeTask.catch(() => {}));
              const result = await writeTask;
              respond(res, 200, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: true, project: result.project, stale: !!result.stale, savedAt: result.savedAt || 0 }));
            } catch (err) {
              respond(res, 500, { ...CORS, 'content-type': 'text/plain' }, 'save failed');
            }
            return;
          }
        }

        respond(res, 404, { ...CORS, 'content-type': 'text/plain' }, 'not found');
      } catch (err) {
        logOperation('请求失败：' + String((err && err.message) || err), 'error');
        respond(res, 500, { ...CORS, 'content-type': 'text/plain' }, 'internal error');
      }
    };
  const dispose = ctx.webServer.register({
    kind: 'prefix',
    path: '/dsh-canvas',
    handler: canvasHandler
  });
  const disposeApi = ctx.webServer.register({
    kind: 'prefix',
    path: '/api/dsh-canvas',
    handler: canvasHandler
  });
  // 注意：ctx.effect 会立即执行回调，返回的 disposer 才是清理函数。
  // 这里回调只返回 dispose（不执行），fiber 卸载时才真正销毁路由。
  ctx.effect(() => () => { disposeApi(); dispose(); });
}

export { apply, inject, name };
