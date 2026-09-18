// node --check 递归覆盖 lib/ 与 src/ 下所有 .js（含未来构建产物）。
import { readdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// src/client/** 是浏览器 bundle 工厂函数的分段片段（共享闭包，单文件不成立），由构建产物 lib/client.js 统一 node --check。
const SKIP = /[\\/]src[\\/]client[\\/]/;
async function walk(dir) { const out = []; for (const e of await readdir(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (SKIP.test(p + '/')) continue; if (e.isDirectory()) out.push(...await walk(p)); else if (/\.m?js$/.test(e.name)) out.push(p); } return out; }
const files = [...await walk(join(root, 'lib')), ...await walk(join(root, 'src')), ...await walk(join(root, 'tests')), ...await walk(join(root, 'scripts'))];
let failed = 0;
for (const f of files) { const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' }); if (r.status !== 0) { failed++; console.error('SYNTAX FAIL', f, '\n', r.stderr.split('\n').slice(0, 4).join('\n')); } }
if (failed) { console.error(`${failed} 个文件语法失败`); process.exit(1); }
console.log(`syntax ok: ${files.length} files`);
