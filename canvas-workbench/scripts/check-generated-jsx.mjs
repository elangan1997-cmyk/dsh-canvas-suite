// 生成的 Adobe JSX 语法检查。
//
// 为什么需要它：host 路由里的 Illustrator/Photoshop 脚本是用 JS 字符串拼出来的
// （`[ 'var doc=app.open(...);', ... ].join('\n')`）。这种脚本的语法错误**整文件
// `node --check` 查不出来**，只有把拼接结果抽出来单独检查才看得见。
//
// 已经踩过两次（同一文件）：
//   1) `'new File(' + JSON.stringify(prefix) + '"+i+".png")'` —— 拼出
//      `File("…-""+i+".png")`，缩略图整段解析失败 → 界面上只是「没有预览」；
//   2) `'var states=[].'` —— `/edit-layer` 的 .ai 提取必然失败 → 「Illustrator 图层提取失败」。
// 两处都被 try/catch 吞掉，静态检查全绿、测试全过，只能靠真机才发现。
//
// 检查方式：把数组抽出来求值（用下面的 STUBS 提供数组里引用的局部变量）→ 拼成脚本 →
// `node --check`。只对能成功求值的字符串数组判定，抽不出来的（非脚本数组）跳过并计数，
// 不产生假失败；跳过数会在结尾报告，便于发现 STUBS 需要补充。
import { readdir, readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const verbose = process.argv.includes('--verbose');

// 路由里在数组内部引用的局部变量（值只影响字符串内容，不影响语法判定）。
const STUBS = {
  path: '/tmp/jsx/source.ai', copyPath: '/tmp/jsx/source.ai', readCopy: '/tmp/jsx/source.ai',
  readCopyAi: '/tmp/jsx/source.ai', shotPath: '/tmp/jsx/layer.png', tempExtract: '/tmp/jsx/x.png',
  tempOut: '/tmp/jsx/out.ai', tempEdited: '/tmp/jsx/e.png', asciiSource: '/tmp/jsx/s.ai',
  thumbsDir: '/tmp/jsx', layerId: 3, layerName: 'layer', token: 'tok', outputDir: '/tmp/jsx'
};
const keys = Object.keys(STUBS);

async function listFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await listFiles(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const scratch = await mkdtemp(join(tmpdir(), 'dsh-jsxcheck-'));
let checked = 0, skipped = 0, failed = 0;

/** 花括号配平取出一段函数源码。 */
function sliceFn(src, start) {
  let depth = 0;
  for (let k = src.indexOf('{', start); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (!depth) return src.slice(start, k + 1); }
  }
  return '';
}

/** 真跑一遍生函数——这样拼接逻辑（含 JSON.stringify 等）本身也被验证，不会被 stub 掩盖。 */
function collectFromFunctions(src) {
  const out = [];
  for (const m of src.matchAll(/function ([A-Za-z0-9_$]+)\s*\([^)]*\)\s*\{/g)) {
    const body = sliceFn(src, m.index);
    if (!body.includes("].join('\\n')")) continue;
    try {
      const fn = new Function('return (' + body + ')')();
      const produced = fn('TMP/source.ai', 'TMP', 'TMP', 'TMP');
      if (typeof produced === 'string' && produced.length) out.push(m[1], produced);
    } catch (err) { /* 需要 host 依赖的函数，跳过（由下面的字面量扫描兜底） */ }
  }
  return out;
}

async function checkCode(tag, code) {
  // 不做内容去重：不同调用点可能生成开头相同的脚本（如两处都是 open 同一份副本），
  // 去重会把其中一处漏掉。
  const script = join(scratch, 'jsx-' + checked + '.js');
  await writeFile(script, '(function(){\n' + code.split('\n').filter((l) => !l.trim().startsWith('#target')).join('\n') + '\n})();', 'utf8');
  checked++;
  try {
    execFileSync(process.execPath, ['--check', script], { stdio: 'pipe' });
  } catch (err) {
    failed++;
    console.error('❌ 生成的脚本有语法错误：' + tag + '\n' + String(err.stderr || err.message).split('\n').slice(0, 4).join('\n'));
  }
}

for (const file of await listFiles(join(root, 'src', 'host'))) {  const src = await readFile(file, 'utf8');
  const rel = file.slice(root.length + 1);

  const fromFns = collectFromFunctions(src);
  for (let i = 0; i < fromFns.length; i += 2) await checkCode(rel + ' ' + fromFns[i] + '()', fromFns[i + 1]);

  const re = /\[\n([\s\S]*?)\n\s*\]\.join\('\\n'\)/g;
  let m, n = 0;
  while ((m = re.exec(src)) !== null) {
    n++;
    const tag = rel + '#' + n;
    let lines;
    try {
      lines = new Function(...keys, 'return [' + m[1] + ']')(...keys.map((k) => STUBS[k]));
    } catch (err) {
      skipped++;
      if (verbose) console.log('· 跳过（非脚本数组）' + tag + '：' + String(err.message).slice(0, 60));
      continue;
    }
    if (!Array.isArray(lines) || !lines.length || lines.some((l) => typeof l !== 'string')) { skipped++; continue; }
    await checkCode(tag, lines.join('\n'));
  }
}

// iframe 的 srcdoc 是一整段模板字符串，内联 <script> 的语法错误同样查不出来
// （文档里一直把「抽取反转义后 node --check」列为手工步骤，这里做成常驻检查）。
// 直接求值模板字面量拿到真实 HTML，再截出最后一个 <script> 的内容——不靠转义猜测。
for (const file of await listFiles(join(root, 'src', 'client'))) {
  const src = await readFile(file, 'utf8');
  if (!src.includes('<script>') || !src.includes('</script>')) continue;
  const a = src.indexOf('`'), b = src.lastIndexOf('`');
  if (a < 0 || b <= a) continue;
  let html;
  try { html = new Function('return ' + src.slice(a, b + 1))(); }
  catch (err) { skipped++; if (verbose) console.log('· 跳过（模板无法求值）' + file.slice(root.length + 1) + '：' + String(err.message).slice(0, 60)); continue; }
  if (typeof html !== 'string') { skipped++; continue; }
  const i = html.lastIndexOf('<script>'), j = html.lastIndexOf('</script>');
  if (i < 0 || j <= i) { skipped++; continue; }
  await checkCode(file.slice(root.length + 1) + ' <inline script>', html.slice(i + 8, j));
}

await rm(scratch, { recursive: true, force: true });
if (failed) {
  console.error('generated-script syntax failed: ' + failed + ' 处（检查 ' + checked + ' 段，跳过 ' + skipped + ' 段）');
  process.exit(1);
}
console.log('generated-script syntax ok: ' + checked + ' 段（跳过 ' + skipped + ' 段非脚本数组）');
