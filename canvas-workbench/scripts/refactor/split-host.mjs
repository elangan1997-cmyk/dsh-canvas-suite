// Phase 2 机械拆分工具：把 lib/index.js 的 apply() 按路由切成 src/host/routes/*.js，
// 顶层辅助函数按映射表切成 shared/utils 与 host/services 模块。
// 原则：路由块与辅助函数**逐字不改**，只生成 import / 解构 / 注册样板。
//
//   node scripts/refactor/split-host.mjs --dry-run   # 打印切分计划
//   node scripts/refactor/split-host.mjs             # 生成文件

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(here, '..', '..');
const SRC = join(pluginRoot, 'src');
const dryRun = process.argv.includes('--dry-run');

// 源文本固定取自基线标签（refactor-baseline），保证工具可重复运行；--source <file> 可覆盖。
const srcArgIdx = process.argv.indexOf('--source');
const text = srcArgIdx !== -1
  ? await readFile(process.argv[srcArgIdx + 1], 'utf8')
  : execFileSync('git', ['-C', pluginRoot, 'show', 'refactor-baseline:canvas-workbench/lib/index.js'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const lines = text.split('\n');
const L = (n) => lines[n - 1]; // 1-based

// ---------- 1. 顶层 import 表：标识符 → 来源 ----------
const importSources = new Map();
{
  let i = 1;
  while (i <= 60) {
    const m = /^import\s+(\{[^}]*\}|[A-Za-z_$][\w$]*)\s+from\s+'([^']+)';?$/.exec(L(i));
    if (m) {
      const spec = m[2];
      if (m[1].startsWith('{')) for (const raw of m[1].slice(1, -1).split(',')) { const name = raw.trim().split(/\s+as\s+/).pop(); if (name) importSources.set(name, spec); }
      else importSources.set(m[1], spec);
      i += 1; continue;
    }
    if (/^import\s+\{$/.test(L(i))) {
      let j = i + 1; const names = [];
      while (!/^\}\s+from/.test(L(j))) { names.push(...L(j).split(',').map((s) => s.trim()).filter(Boolean)); j += 1; }
      const spec = /from\s+'([^']+)'/.exec(L(j))[1];
      for (const n of names) importSources.set(n.split(/\s+as\s+/).pop(), spec);
      i = j + 1; continue;
    }
    i += 1;
  }
}

// ---------- 2. 顶层声明（列 0）----------
const topDecls = [];
for (let n = 24; n <= 428; n++) {
  const m = /^(?:export\s+)?(?:async\s+)?(?:function|const|let)\s+([A-Za-z_$][\w$]*)/.exec(L(n));
  if (m) topDecls.push({ name: m[1], start: n });
}
for (let k = 0; k < topDecls.length; k++) topDecls[k].end = (k + 1 < topDecls.length ? topDecls[k + 1].start : 429) - 1;
// 去掉段尾空行与注释归属到下一段
for (const d of topDecls) { while (d.end > d.start && /^\s*$/.test(L(d.end))) d.end -= 1; }

// 顶层符号 → 目标模块（相对 src/）
const TOP_MAP = {
  'shared/utils/image-types.js': ['MAX_IMAGE_BYTES', 'MAX_SOURCE_BYTES', 'IMAGE_MIME', 'DOCUMENT_EXTENSIONS', 'RASTER_EXTENSIONS', 'SOURCE_EXTENSIONS', 'extOf', 'mimeOf', 'isImagePath', 'isRasterImagePath', 'isSourceImagePath', 'sourceKindOf', 'cleanJobId'],
  'shared/utils/paths.js': ['expandHome', 'normalizeLocalPath', 'materialDirectory', 'pathComparable', 'isPathWithin'],
  'shared/utils/image-metadata.js': ['parseImageHeaderSize', 'materialSizeCache', 'probeMaterialSize'],
  'shared/utils/data-url.js': ['sourcePathFromImageUrl', 'firstExisting', 'decodeImageData', 'decodeSourceData', 'safeImageName', 'normalizeTextLayerText'],
  'host/server/http.js': ['parseQuery', 'readBody', 'respond'],
  'host/services/project-store.js': ['readCanvasProjectElements'],
  'host/services/material-tags.js': ['MATERIAL_TAG_COLORS', 'materialTagsPath', 'readMaterialTags', 'writeMaterialTags', 'tagsForDirectory'],
  'host/services/text-analysis.js': ['TEXT_VISION_SYSTEM', 'parseModelJson', 'visionBlocks', 'analyzeTextWithCurrentModel'],
  'host/plugin-meta.js': ['name', 'inject']
};
const HAND_WRITTEN = new Set(['PLUGIN_ROOT', 'VENDOR_ASSETS']); // 依赖 import.meta.url 层级，手写
const topModuleOf = new Map();
for (const [mod, names] of Object.entries(TOP_MAP)) for (const n of names) topModuleOf.set(n, mod);
const unmapped = topDecls.filter((d) => !topModuleOf.has(d.name) && !HAND_WRITTEN.has(d.name));

// ---------- 3. apply() 闭包区与路由块 ----------
const APPLY_START = 429;               // function apply(ctx) {
const CLOSURE_START = 430, CLOSURE_END = 694; // 到 register 之前
const HANDLER_PRELUDE = [700, 715];    // CORS … sameOriginRequest 定义
const ROUTES_START = 716, ROUTES_END = 2227;
const TAIL = [2235, 2253];             // inject … ctx.effect

const closureNames = new Set(['ctx', 'fs', 'sp']);
for (let n = CLOSURE_START; n <= CLOSURE_END; n++) {
  const m = /^\s{2}(?:const|let|async function|function)\s+([A-Za-z_$][\w$]*)/.exec(L(n));
  if (m) closureNames.add(m[1]);
}

const blocks = [];
for (let n = ROUTES_START; n <= ROUTES_END; n++) {
  const m = /^\s{8}if \(pathname(?:\s*===\s*|\.startsWith\()'(\/dsh-canvas\/[^']+)'\)?(?:\s*&&\s*req\.method === '([A-Z]+)')?\) \{$/.exec(L(n));
  if (m) blocks.push({ path: m[1], method: m[2] || '*', prefix: L(n).includes('startsWith'), start: n });
}
for (let k = 0; k < blocks.length; k++) {
  const b = blocks[k];
  let end = (k + 1 < blocks.length ? blocks[k + 1].start : ROUTES_END + 1) - 1;
  // 尾部空行 / 注释（属于下一块）回退
  while (end > b.start && (/^\s*$/.test(L(end)) || /^\s*\/\//.test(L(end)))) end -= 1;
  b.end = end;
  b.closesProperly = L(end) === '        }';
}
// 前导注释归属到本块；块间不得有任何非空白/非注释代码
const gapProblems = [];
for (let k = 0; k < blocks.length; k++) {
  const b = blocks[k];
  const prevEnd = k === 0 ? ROUTES_START - 1 : blocks[k - 1].end;
  const lead = [];
  for (let n = prevEnd + 1; n < b.start; n++) {
    if (/^\s*$/.test(L(n))) continue;
    if (/^\s*\/\//.test(L(n))) { lead.push(L(n)); continue; }
    gapProblems.push({ line: n, text: L(n) });
  }
  b.leading = lead;
}
{
  const last = blocks[blocks.length - 1];
  for (let n = last.end + 1; n <= ROUTES_END; n++) if (!/^\s*$/.test(L(n))) gapProblems.push({ line: n, text: L(n) });
}

// ---------- 4. 自由标识符分析 ----------
const KEYWORDS = new Set('await async break case catch class const continue default delete do else export extends finally for function if import in instanceof let new null return super switch this throw true false try typeof var void while with yield of undefined NaN Infinity'.split(' '));
function identifiers(code) {
  const out = new Set();
  const re = /(?<![.\w$])([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = re.exec(code))) if (!KEYWORDS.has(m[1])) out.add(m[1]);
  return out;
}
const ENV_NAMES = new Set(['req', 'res', 'pathname', 'query', 'CORS', 'sameOriginRequest']);

// 唯一允许的文本替换：handler 里按 lib/ 层级内联计算的插件根目录，改为共享的 PLUGIN_ROOT
// （文件搬到 src/host/routes/ 后 dirname(dirname(...)) 会指向 src/，Python 脚本路径全部错位）。
const PLUGIN_ROOT_INLINE = 'dirname(dirname(fileURLToPath(import.meta.url)))';
function bodyOf(b) { return lines.slice(b.start, b.end - 1).join('\n').split(PLUGIN_ROOT_INLINE).join('PLUGIN_ROOT'); } // 去掉 if 行与末尾 }
function depsOf(code) {
  const ids = identifiers(code);
  return {
    imports: [...ids].filter((x) => importSources.has(x)),
    top: [...ids].filter((x) => topModuleOf.has(x) || HAND_WRITTEN.has(x)),
    closure: [...ids].filter((x) => closureNames.has(x))
  };
}

// 路由分组
const GROUPS = [
  ['health.routes.js', ['/dsh-canvas/health', '/dsh-canvas/system-appearance', '/dsh-canvas/vendor/']],
  ['settings.routes.js', ['/dsh-canvas/image-settings', '/dsh-canvas/image-setup', '/dsh-canvas/image-status', '/dsh-canvas/chat-context']],
  ['project.routes.js', ['/dsh-canvas/state', '/dsh-canvas/projects', '/dsh-canvas/open-project', '/dsh-canvas/import-project', '/dsh-canvas/rename-project', '/dsh-canvas/delete-project', '/dsh-canvas/project-files', '/dsh-canvas/list-directories', '/dsh-canvas/backup-canvas']],
  ['asset.routes.js', ['/dsh-canvas/image', '/dsh-canvas/preview', '/dsh-canvas/import-file', '/dsh-canvas/materialize-image', '/dsh-canvas/check-sources', '/dsh-canvas/rename-image', '/dsh-canvas/restore-image', '/dsh-canvas/archive-images', '/dsh-canvas/reveal-file']],
  ['material.routes.js', ['/dsh-canvas/materials', '/dsh-canvas/materials/tags', '/dsh-canvas/materials/tag', '/dsh-canvas/materials/save', '/dsh-canvas/materials/open', '/dsh-canvas/materials/select', '/dsh-canvas/materials/delete']],
  ['generation.routes.js', ['/dsh-canvas/edit-image', '/dsh-canvas/remove-background', '/dsh-canvas/remove-background-progress', '/dsh-canvas/vectorize-image']],
  ['text.routes.js', ['/dsh-canvas/ocr-image', '/dsh-canvas/export-text-psd']],
  ['external.routes.js', ['/dsh-canvas/open-in-photoshop', '/dsh-canvas/open-in-illustrator', '/dsh-canvas/photoshop-outputs']]
];
const groupOf = new Map();
for (const [file, paths] of GROUPS) for (const p of paths) groupOf.set(p, file);

if (dryRun) {
  console.log('顶层声明', topDecls.length, '未映射:', unmapped.map((d) => d.name));
  console.log('闭包符号', closureNames.size, [...closureNames].join(' '));
  console.log('路由块', blocks.length);
  for (const b of blocks) console.log(String(b.start).padStart(5), String(b.end).padStart(5), b.method.padEnd(4), b.path.padEnd(42), b.closesProperly ? 'ok' : 'BAD-END', groupOf.get(b.path) || 'UNGROUPED');
  const uncovered = blocks.filter((b) => !groupOf.has(b.path)).length;
  console.log('未分组路由', uncovered);
  console.log('块间非注释代码', gapProblems.length, gapProblems.slice(0, 5));
  process.exit(0);
}

// ---------- 5. 生成 ----------
function relImport(fromMod, toMod) {
  const from = dirname(join(SRC, fromMod)); let rel = relativePath(from, join(SRC, toMod)); if (!rel.startsWith('.')) rel = './' + rel; return rel;
}
function relativePath(fromDir, toFile) {
  const a = fromDir.split('/').filter(Boolean), b = toFile.split('/').filter(Boolean);
  let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return [...Array(a.length - i).fill('..'), ...b.slice(i)].join('/');
}
function libRel(fromMod, libFile) {
  const depth = fromMod.split('/').length - 1; // 'host/routes/x.js' → 2
  return '../'.repeat(depth + 1) + 'lib/' + libFile;
}
function importLines(fromMod, deps) {
  const byModule = new Map();
  const push = (target, n) => byModule.set(target, [...(byModule.get(target) || []), n]);
  for (const n of deps.imports) {
    const spec = importSources.get(n);
    push(spec.startsWith('./') ? libRel(fromMod, spec.slice(2)) : spec, n);
  }
  for (const n of deps.top) {
    const mod = HAND_WRITTEN.has(n) ? 'host/vendor-assets.js' : topModuleOf.get(n);
    if (mod === fromMod) continue;
    push(relImport(fromMod, mod), n);
  }
  return [...byModule].map(([target, names]) => `import { ${[...new Set(names)].sort().join(', ')} } from '${target}';`);
}
function fixLibImports(_mod, importArr) { return importArr; }

const written = [];
async function emit(mod, content) { const p = join(SRC, mod); await mkdir(dirname(p), { recursive: true }); await writeFile(p, content); written.push(mod); }

// 5a. 顶层模块
for (const [mod, names] of Object.entries(TOP_MAP)) {
  const decls = topDecls.filter((d) => names.includes(d.name));
  const code = decls.map((d) => lines.slice(d.start - 1, d.end).join('\n')).join('\n\n');
  const deps = depsOf(code);
  deps.top = deps.top.filter((n) => !names.includes(n));
  const imports = fixLibImports(mod, importLines(mod, deps));
  const exportsLine = `export { ${names.filter((n) => decls.some((d) => d.name === n)).join(', ')} };`;
  await emit(mod, `// 自 lib/index.js 机械迁移（v1.8 Phase 2），函数体逐字未改。\n${imports.join('\n')}${imports.length ? '\n\n' : ''}${code}\n\n${exportsLine}\n`);
}

// 5b. 路由模块
const routeModules = new Map();
for (const b of blocks) {
  const file = 'host/routes/' + groupOf.get(b.path);
  if (!routeModules.has(file)) routeModules.set(file, []);
  routeModules.get(file).push(b);
}
const closureUsedAll = new Set();
for (const [mod, bs] of routeModules) {
  const allCode = bs.map(bodyOf).join('\n');
  const deps = depsOf(allCode);
  for (const c of deps.closure) closureUsedAll.add(c);
  const imports = fixLibImports(mod, importLines(mod, deps));
  const destructure = deps.closure.length ? `  const { ${[...new Set(deps.closure)].sort().join(', ')} } = h;\n` : '';
  const handlers = bs.map((b) => {
    const method = b.method === '*' ? 'null' : `'${b.method}'`;
    const lead = b.leading.length ? b.leading.map((l) => '  ' + l.trim()).join('\n') + '\n' : '';
    return `${lead}  router.add({ method: ${method}, path: '${b.path}', prefix: ${b.prefix} }, async (req, res, { pathname, query, CORS, sameOriginRequest }) => {\n${bodyOf(b)}\n  });`;
  }).join('\n\n');
  await emit(mod, `// 自 lib/index.js apply() 机械迁移（v1.8 Phase 2）：每个 handler 体逐字未改，\n// 原来的 \`if (pathname === … && req.method === …) { … }\` 外壳由 router 负责。\n${imports.join('\n')}${imports.length ? '\n\n' : ''}export function register(router, h) {\n${destructure}${handlers}\n}\n`);
}

// 5c. host/index.js
{
  const closureCode = lines.slice(CLOSURE_START - 1, CLOSURE_END).join('\n');
  const tailCode = lines.slice(TAIL[0] - 1, TAIL[1]).join('\n');
  const preludeCode = lines.slice(HANDLER_PRELUDE[0] - 1, HANDLER_PRELUDE[1]).join('\n');
  const deps = depsOf(closureCode + '\n' + tailCode + '\n' + preludeCode);
  for (const n of ['name', 'inject', 'respond']) if (!deps.top.includes(n)) deps.top.push(n);
  const imports = fixLibImports('host/index.js', importLines('host/index.js', deps));
  const registerImports = [...routeModules.keys()].map((m, i) => `import { register as register${i} } from './${m.replace('host/', '')}';`);
  const hObject = `  const h = { ${[...closureUsedAll].sort().join(', ')} };`;
  const content = `// v1.8 Phase 2：Host 入口。闭包辅助函数区（原 lib/index.js 430-694）逐字保留；
// 41 条路由拆到 ./routes/*.js，由 createRouter 按原顺序分派；未命中仍回 404 'not found'。
${imports.join('\n')}
import { createRouter } from './server/router.js';
${registerImports.join('\n')}

function apply(ctx) {
${closureCode}

${hObject}
  const router = createRouter();
${[...routeModules.keys()].map((m, i) => `  register${i}(router, h);`).join('\n')}

  const dispose = ctx.webServer.register({
    kind: 'prefix',
    path: '/dsh-canvas',
    handler: async (req, res) => {
${preludeCode}

        const handled = await router.dispatch(req, res, { pathname, query, CORS, sameOriginRequest });
        if (handled) return;
        respond(res, 404, { ...CORS, 'content-type': 'text/plain' }, 'not found');
      } catch (err) {
        respond(res, 500, { ...CORS, 'content-type': 'text/plain' }, 'internal error');
      }
    }
  });
${tailCode}
}

export { apply, inject, name };
`;
  await emit('host/index.js', content);
}

// 5d. router
await emit('host/server/router.js', `// 极简路由器：复刻原 apply() 里顺序 if 链的语义——按注册顺序匹配 path(+method)，
// handler 通过 respond() 写响应即视为已处理；未写响应则继续尝试后续路由（等价于原来的 fall-through）。
export function createRouter() {
  const routes = [];
  return {
    add(spec, handler) { routes.push({ ...spec, handler }); },
    list() { return routes.map((r) => ({ method: r.method, path: r.path, prefix: r.prefix })); },
    async dispatch(req, res, env) {
      for (const r of routes) {
        const pathOk = r.prefix ? env.pathname.startsWith(r.path) : env.pathname === r.path;
        if (!pathOk) continue;
        if (r.method && req.method !== r.method) continue;
        await r.handler(req, res, env);
        if (res.headersSent || res.writableEnded) return true;
      }
      return false;
    }
  };
}
`);

// 5e. vendor-assets（手写：PLUGIN_ROOT 层级从 lib/ 变为 src/host/）
await emit('host/vendor-assets.js', `import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 本文件位于 <plugin>/src/host/，插件根目录向上三级（原 lib/index.js 为两级）。
const PLUGIN_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
${lines.slice(44, 49).join('\n')}

export { PLUGIN_ROOT, VENDOR_ASSETS };
`);

console.log('生成文件：'); for (const w of written) console.log('  src/' + w);
console.log('闭包符号被路由使用：', closureUsedAll.size, '/', closureNames.size);
