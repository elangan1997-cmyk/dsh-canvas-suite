// adobe-bridge/*.jsx 静态检查（挂在 npm run check 里）。
//
// ExtendScript 是 ES3 方言：没有 JSON / forEach / map / indexOf / trim / Date.now / Object.keys /
// 箭头函数 / const / let / 模板串 / 对象字面量尾逗号。这些写进 .jsx 在 Photoshop/Illustrator 里
// 只会在运行时报一句「undefined is not a function」，静态阶段完全看不见 —— 本脚本把它们挡在提交前。
//
// 检查内容：
//   1) 文件必须以 UTF-8 BOM 开头（ExtendScript 据此正确解析中文字符串）；
//   2) 去掉 `#target/#targetengine/#include` 指令后 `node --check`（基础语法）；
//   3) 正则扫描 ES5+ 特性；命中即失败并给出行号。
import { readdir, readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'adobe-bridge');

// [正则, 说明]。只扫代码行（去掉块注释/行注释/字符串后的文本），避免把说明文字误报。
const FORBIDDEN = [
  [/=>/, '箭头函数'],
  [/\b(const|let)\s+[A-Za-z_$]/, 'const/let（用 var）'],
  [/`/, '模板字符串'],
  [/\bJSON\s*\./, 'JSON 对象（用 B.parseJSON / B.toJSON）'],
  [/\bDate\s*\.\s*now\s*\(/, 'Date.now（用 B.now()）'],
  [/\bObject\s*\.\s*keys\s*\(/, 'Object.keys（用 B.keys）'],
  [/\bArray\s*\.\s*isArray\s*\(/, 'Array.isArray（用 instanceof Array）'],
  // String.indexOf/lastIndexOf 是 ES3，Array 版才是 ES5——静态无法区分接收者，故不列 indexOf；数组查找请用 B.has。
  // `B.xxx(` 是 dsh-bridge-core 自带的兼容工具，不算原生调用。
  [/(?<!\bB)\.\s*(forEach|map|filter|reduce|some|every|includes|trim|trimStart|trimEnd|startsWith|endsWith|padStart|padEnd|find|findIndex)\s*\(/, 'ES5+ 数组/字符串方法（用 for 循环 / B.has / B.trim）'],
  [/,\s*[}\]]/, '对象/数组字面量尾逗号'],
  [/\bfunction\s*\*|\basync\s+function|\bawait\s/, '生成器/async'],
  [/\bclass\s+[A-Za-z_$]/, 'class'],
  [/\bfor\s*\(\s*(var\s+)?[A-Za-z_$][\w$]*\s+of\s/, 'for…of'],
  [/[^=!<>]==[^=]/, '宽松相等 ==（用 ===）'],
];

function stripNonCode(source) {
  // 去块注释、行注释、字符串与正则字面量（粗略但足够：只用于特性扫描，不用于语法判定）
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g, (m) => '"' + ' '.repeat(Math.max(0, m.length - 2)) + '"')
    .replace(/(^|[=(,:;!&|?{}\[\n]\s*)\/(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n\[])+\/[gimuy]*/g, (m, pre) => pre + '/re/')
    .replace(/\/\/[^\n]*/g, '');
}

async function main() {
  const files = (await readdir(dir)).filter((name) => name.endsWith('.jsx')).sort();
  if (!files.length) { console.error('adobe-bridge/ 下没有 .jsx'); process.exit(1); }
  const temp = await mkdtemp(join(tmpdir(), 'dsh-bridge-jsx-'));
  const problems = [];
  try {
    for (const name of files) {
      const raw = await readFile(join(dir, name), 'utf8');
      if (raw.charCodeAt(0) !== 0xfeff) problems.push(`${name}: 缺少 UTF-8 BOM（ExtendScript 需要它才能正确读中文；用 node -e 或编辑器另存为「UTF-8 with BOM」）`);
      const source = raw.replace(/^\uFEFF/, '');
      const stripped = source.replace(/^\s*#(target|targetengine|include|includepath|strict|script)\b[^\n]*$/gm, '');
      const tempFile = join(temp, name.replace(/[^\w.-]/g, '_') + '.js');
      await writeFile(tempFile, stripped);
      try { execFileSync(process.execPath, ['--check', tempFile], { stdio: 'pipe' }); }
      catch (err) { problems.push(`${name}: 语法错误\n${String(err.stderr || err.message).split('\n').slice(0, 6).join('\n')}`); continue; }
      const code = stripNonCode(source);
      const lines = code.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        for (const [re, why] of FORBIDDEN) {
          if (re.test(lines[i])) problems.push(`${name}:${i + 1}: ${why} —— ${source.split('\n')[i].trim().slice(0, 100)}`);
        }
      }
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
  if (problems.length) {
    console.error('adobe-bridge jsx 检查失败：\n' + problems.map((p) => '  - ' + p).join('\n'));
    process.exit(1);
  }
  console.log(`adobe-bridge jsx ok: ${files.length} 个脚本（BOM / 语法 / ES3 特性）`);
}

main().catch((err) => { console.error(err); process.exit(1); });
