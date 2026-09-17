// 擦除/局部编辑管线集成测试（不触网）：prepare_mask → prepare_model_input --crop-to-mask → composite_edit --crop --tone-match
//   node tests/integration/erase-pipeline.integration.mjs
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const candidates = [process.env.DSH_TEST_PYTHON, join(homedir(), '.dsh/canvas-workbench/python-runtime/bin/python3.12'), 'python3'].filter(Boolean);
const python = candidates.find((bin) => spawnSync(bin, ['-c', 'import PIL'], { stdio: 'ignore' }).status === 0);
if (!python) { console.log('erase pipeline: SKIP（无 Pillow）'); process.exit(0); }

const work = await mkdtemp(join(tmpdir(), 'dsh-erase-'));
const run = (script, args) => {
  const r = spawnSync(python, [join(pluginRoot, 'scripts', script), ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(script + ' 失败: ' + r.stderr);
  return r;
};
const py = (code) => {
  const r = spawnSync(python, ['-c', code], { encoding: 'utf8', cwd: work });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout.trim().split('\n').pop());
};

try {
  // 1) 合成源图（渐变 + 噪点纹理）、"文字"块、画布蒙版（透明 = 可编辑区）
  py(`
import json, random
from PIL import Image, ImageDraw
random.seed(7)
W, H = 2000, 1400
img = Image.new('RGB', (W, H))
px = img.load()
for y in range(H):
    for x in range(0, W, 1):
        base = 150 + int(60 * y / H)
        n = random.randint(-6, 6)
        px[x, y] = (base + n, base + 10 + n, base + 25 + n)
d = ImageDraw.Draw(img)
d.rectangle((420, 620, 1200, 740), fill=(20, 20, 20))  # 要擦掉的"文字条"
img.save('source.png')
mask = Image.new('RGBA', (W, H), (0, 0, 0, 255))
md = ImageDraw.Draw(mask)
md.rectangle((400, 600, 1220, 760), fill=(0, 0, 0, 0))  # 用户框选（透明）
mask.save('mask.png')
print(json.dumps({'ok': True}))
`);

  // 2) prepare_mask（膨胀）→ prepare_model_input（按蒙版裁剪）
  run('prepare_mask.py', ['--source', 'source.png', '--mask', 'mask.png', '--output', 'prepared.png'].map((a) => a.endsWith('.png') ? join(work, a) : a));
  const prep = run('prepare_model_input.py', ['--source', join(work, 'source.png'), '--output-image', join(work, 'model.webp'), '--mask', join(work, 'prepared.png'), '--output-mask', join(work, 'model-mask.png'), '--max-side', '1024', '--crop-to-mask', '--crop-info', join(work, 'crop.json')]);
  const crop = JSON.parse(spawnSync('cat', [join(work, 'crop.json')], { encoding: 'utf8' }).stdout);
  console.log('crop:', prep.stdout.trim(), '|', JSON.stringify(crop));
  assert.ok(crop.w > 0 && crop.h > 0, '应产生裁剪窗口');
  assert.ok(crop.w >= 820 && crop.h >= 160, '窗口覆盖选区');
  assert.equal(crop.scale, 1, '窗口 ≤1024 时不缩放（原生分辨率）');
  assert.ok(crop.x <= 400 && crop.y <= 600 && crop.x + crop.w >= 1220 && crop.y + crop.h >= 760, '窗口包含用户选区');
  assert.ok(crop.w <= 1024 && crop.h <= 1024, '窗口不超过模型预算');

  // 3) 模拟模型输出：把裁剪窗口里的"文字条"换成周围底色，并整体 +18 亮度（模拟色调漂移）
  py(`
import json
from PIL import Image, ImageDraw
crop = json.load(open('crop.json'))
src = Image.open('source.png').convert('RGB')
win = src.crop((crop['x'], crop['y'], crop['x'] + crop['w'], crop['y'] + crop['h']))
d = ImageDraw.Draw(win)
# 用"文字条"上方 40px 的平均色填掉文字条
ref = win.crop((420 - crop['x'], 560 - crop['y'], 1200 - crop['x'], 600 - crop['y'])).resize((1, 1)).getpixel((0, 0))
d.rectangle((400 - crop['x'], 600 - crop['y'], 1220 - crop['x'], 760 - crop['y']), fill=ref)
win = win.point(lambda v: min(255, v + 18))
win.save('generated.png')
print(json.dumps({'ref': ref}))
`);

  // 4) 合成（带裁剪贴回 + 色调匹配）与不带色调匹配的对照
  const comp = run('composite_edit.py', ['--source', join(work, 'source.png'), '--generated', join(work, 'generated.png'), '--mask', join(work, 'prepared.png'), '--output', join(work, 'out.png'), '--crop', [crop.x, crop.y, crop.w, crop.h].join(','), '--tone-match']);
  console.log('composite:', comp.stderr.trim());
  assert.match(comp.stderr, /tone offset r-1\d/, '应检测到约 -18 的色调偏移并回拉');
  run('composite_edit.py', ['--source', join(work, 'source.png'), '--generated', join(work, 'generated.png'), '--mask', join(work, 'prepared.png'), '--output', join(work, 'out-notone.png'), '--crop', [crop.x, crop.y, crop.w, crop.h].join(',')]);

  const m = py(`
import json
from PIL import Image, ImageChops
crop = json.load(open('crop.json'))
src = Image.open('source.png').convert('RGB'); out = Image.open('out.png').convert('RGB'); nt = Image.open('out-notone.png').convert('RGB')
assert out.size == src.size
diff = ImageChops.difference(src, out)
# 窗口外必须零改动
outside = diff.copy(); od = outside.load()
import itertools
maxo = 0
for x, y in itertools.chain(((x, 5) for x in range(0, src.size[0], 7)), ((5, y) for y in range(0, src.size[1], 7)), ((x, src.size[1] - 5) for x in range(0, src.size[0], 7)), ((src.size[0] - 5, y) for y in range(0, src.size[1], 7))):
    if not (crop['x'] <= x < crop['x'] + crop['w'] and crop['y'] <= y < crop['y'] + crop['h']):
        maxo = max(maxo, max(od[x, y]))
# 文字条中心：应被替换（不再是深色）
cx, cy = 810, 680
core = out.getpixel((cx, cy)); core_src = src.getpixel((cx, cy))
# 色调匹配效果：核心区亮度应接近源图周围（而不是 +18）
around = src.getpixel((810, 560))
lum = lambda p: 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]
# 边界过渡：核心区内侧 20px 带 vs 羽化环外侧未改动 20px 带的平均亮度差（带状均值抵消噪点纹理）
def band_mean(im, y0, y1):
    vals = [lum(im.getpixel((x, y))) for y in range(y0, y1) for x in range(520, 1100, 4)]
    return sum(vals) / len(vals)
def seam(im):
    return band_mean(im, 755, 775) - band_mean(im, 850, 870)
print(json.dumps({'max_outside_change': maxo, 'core': core, 'core_src': core_src, 'around': around,
  'core_lum_delta_tone': round(lum(core) - lum(around), 1), 'core_lum_delta_notone': round(lum(nt.getpixel((cx, cy))) - lum(around), 1),
  'seam_tone': round(seam(out), 1), 'seam_notone': round(seam(nt), 1), 'seam_src': round(seam(src), 1)}))
`);
  console.log('metrics:', JSON.stringify(m));
  assert.equal(m.max_outside_change, 0, '裁剪窗口外像素零改动');
  assert.ok(m.core[0] > 100, '文字条已被替换');
  assert.ok(Math.abs(m.core_lum_delta_tone) < 6, `色调匹配后核心区与周围亮度差应 <6，实际 ${m.core_lum_delta_tone}`);
  assert.ok(Math.abs(m.core_lum_delta_notone) > 12, `对照组（无色调匹配）应保留约 +18 偏移，实际 ${m.core_lum_delta_notone}`);
  // 源图本身有垂直渐变（seam_src 为基准），色调匹配后核心/外侧带差应回到基准附近
  assert.ok(Math.abs(m.seam_tone - m.seam_src) < 6, `色调匹配后边界带差应接近源图基准（|${m.seam_tone} - ${m.seam_src}| < 6）`);
  assert.ok(Math.abs(m.seam_notone - m.seam_src) > 12, `对照组应保留明显带差（|${m.seam_notone} - ${m.seam_src}| > 12）`);
  console.log('erase pipeline: PASS');
} finally {
  await rm(work, { recursive: true, force: true });
}
