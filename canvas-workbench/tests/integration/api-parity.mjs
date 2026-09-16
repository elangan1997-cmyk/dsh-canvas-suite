// API 对等测试：同一份请求清单分别打到「基线 Host」和「候选 Host」，归一化后逐字段 diff。
// 基线 = git ref（默认 refactor-baseline 标签）导出的 canvas-workbench；候选 = 当前工作树。
// 两边都跑在同一个假 ctx 上，因此任何差异都是代码变更造成的。
//
//   node tests/integration/api-parity.mjs                 # 基线 vs 工作树
//   node tests/integration/api-parity.mjs --baseline aa36de7
//   node tests/integration/api-parity.mjs --against-live  # 工作树 vs docs/refactor/baseline 的真实 DSH 样例（仅告警）

import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startHost, runRequests } from './host-harness.mjs';
import { buildRequests, normalizeResponse, sha256 } from './api-requests.mjs';
import { makeSampleProject } from '../fixtures/make-sample-project.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(here, '..', '..');
const repoRoot = resolve(pluginRoot, '..');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i === -1 ? def : args[i + 1]; };
const baselineRef = opt('--baseline', 'refactor-baseline');
const againstLive = args.includes('--against-live');
const outDir = opt('--out', join(repoRoot, 'docs', 'refactor', 'parity'));

export function deepDiff(a, b, path = '', out = []) {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push({ path: path + '.length', baseline: a.length, candidate: b.length });
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) deepDiff(a[i], b[i], `${path}[${i}]`, out);
    return out;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(k in a)) out.push({ path: `${path}.${k}`, baseline: '<absent>', candidate: b[k] });
      else if (!(k in b)) out.push({ path: `${path}.${k}`, baseline: a[k], candidate: '<absent>' });
      else deepDiff(a[k], b[k], `${path}.${k}`, out);
    }
    return out;
  }
  if (a !== b) out.push({ path, baseline: a, candidate: b });
  return out;
}

async function exportRef(ref) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-parity-baseline-'));
  const tar = execFileSync('git', ['-C', repoRoot, 'archive', '--format=tar', ref, 'canvas-workbench'], { maxBuffer: 64 * 1024 * 1024 });
  execFileSync('tar', ['-x', '-C', dir], { input: tar });
  return { dir, pluginDir: join(dir, 'canvas-workbench') };
}

async function main() {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'dsh-parity-fixture-'));
  const fixture = await makeSampleProject(join(fixtureRoot, 'sample-project'));
  const requests = buildRequests(fixture.dir);
  const run = async (pluginDir) => {
    const host = await startHost({ pluginDir, workspaceRoot: fixtureRoot });
    try { return await runRequests(host.baseUrl, requests, { normalizeResponse, fixtureDir: fixture.dir, sha256 }); }
    finally { await host.close(); }
  };

  await mkdir(outDir, { recursive: true });
  const candidate = await run(pluginRoot);
  await writeFile(join(outDir, 'candidate-latest.json'), JSON.stringify(candidate, null, 2));

  let failures = 0;
  if (againstLive) {
    const live = JSON.parse(await readFile(join(repoRoot, 'docs', 'refactor', 'baseline', 'api-samples-1.7.0', 'summary.json'), 'utf8'));
    const diffs = deepDiff(live, candidate);
    console.log(`[against-live] 与真实 DSH 1.7.0 样例差异 ${diffs.length} 处（假 ctx 与真实 ctx 的能力差异属预期，仅供人工核对）`);
    for (const d of diffs.slice(0, 60)) console.log('  ', d.path, JSON.stringify(d.baseline), '→', JSON.stringify(d.candidate));
  } else {
    let exported;
    try { exported = await exportRef(baselineRef); }
    catch (err) { console.error('无法导出基线 ref', baselineRef, err.message); process.exit(2); }
    try {
      const baseline = await run(exported.pluginDir);
      await writeFile(join(outDir, `baseline-${baselineRef.replace(/[^a-zA-Z0-9.-]/g, '_')}.json`), JSON.stringify(baseline, null, 2));
      const diffs = deepDiff(baseline, candidate);
      const names = Object.keys(baseline);
      console.log(`请求 ${names.length} 条；差异 ${diffs.length} 处（基线 ${baselineRef} → 工作树）`);
      for (const d of diffs) console.log('  DIFF', d.path, JSON.stringify(d.baseline), '→', JSON.stringify(d.candidate));
      failures = diffs.length;
      await writeFile(join(outDir, 'last-diff.json'), JSON.stringify({ baselineRef, at: new Date().toISOString(), diffs }, null, 2));
    } finally { await rm(exported.dir, { recursive: true, force: true }); }
  }
  await rm(fixtureRoot, { recursive: true, force: true });
  if (failures) { console.error(`API 对等测试失败：${failures} 处差异`); process.exit(1); }
  console.log(againstLive ? '（against-live 模式不判定失败）' : 'API 对等测试通过：0 差异');
}

main().catch((err) => { console.error(err); process.exit(1); });
