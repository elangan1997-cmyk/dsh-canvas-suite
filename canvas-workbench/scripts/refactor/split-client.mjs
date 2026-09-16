// Phase 5 分段工具（一次性）：把基线 lib/client.js 按语义边界切成 src/client/** 分段源码，
// 并生成 build-manifest.json；scripts/build-client.mjs 按清单拼回 lib/client.js。
// 分段是浏览器 bundle 工厂函数内的连续文本片段（共享同一闭包作用域），拼接结果与原文件逐字节一致。
//
//   node scripts/refactor/split-client.mjs            # 生成分段与清单
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(here, '..', '..');
const OUT = join(pluginRoot, 'src', 'client');
const srcArg = process.argv.indexOf('--source');
const text = srcArg !== -1
  ? await readFile(process.argv[srcArg + 1], 'utf8')
  : execFileSync('git', ['-C', pluginRoot, 'show', 'refactor-baseline:canvas-workbench/lib/client.js'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const lines = text.split('\n');
if (lines[lines.length - 1] !== '') throw new Error('期望文件以换行结尾');
lines.pop(); // 末尾空串（由结尾换行产生）
const L = (n) => lines[n - 1];

// [声明所在行, 目标文件, 说明]
const SEGMENTS = [
  [1, 'main/00-loader-prelude.js', '模块加载器包装：__ModuleLoader__.load({ id, factory }) 与 React 单例'],
  [21, 'main/01-constants.js', 'localStorage 键常量（含 tldraw 时代遗留的 CDN 常量）'],
  [33, 'features/material-library/00-tag-colors.js', 'MATERIAL_TAG_COLORS 七色标记'],
  [45, 'features/text-edit/00-fonts.js', 'TEXT_REBUILD_FONTS 免费商用字体白名单 / 默认字体 / textRebuildFontValue'],
  [120, 'shared/utils/00-storage.js', 'canvasDefaultBackground / PROJECT_SYNC_INTERVAL / localStorage 读写'],
  [147, 'core/document/00-mode.js', '设计模式开关状态与订阅'],
  [173, 'features/project-browser/00-choices.js', '项目选择记忆（按 cwd / session）'],
  [252, 'shared/utils/01-url.js', '本地路径 → 同源 URL、Markdown 图片本地回退'],
  [336, 'core/document/01-state.js', '画布状态版本化 / 去内联数据 / 读写项目'],
  [426, 'shared/utils/02-asset.js', '附件与图片名工具、SVG 栅格化、路径解析'],
  [542, 'features/chat-image-output/00-extract.js', '聊天事件 → 图片路径提取管线'],
  [807, 'features/chat-image-output/01-definition.js', 'turnTail 事件节点定义、加入画布 / 定位文件'],
  [915, 'features/chat-image-output/02-ImageTail.js', '聊天图片输出组件（时间过滤、三级回退、灯箱）'],
  [1130, 'features/text-edit/01-TextRebuildPanel.js', '文字重建面板组件'],
  [1408, 'core/capabilities/00-dsh-bridge.js', '与 DSH 会话服务桥接（模型 / cwd / session / 项目）'],
  [1464, 'app/00-DesignModeToggle.js', '设计模式开关按钮'],
  [1537, 'legacy/00-tldraw-bundle.js', 'tldraw 时代遗留：TLDR_BUNDLE 内嵌包 + IFRAME_SRCDOC（无引用，待删除）'],
  [1558, 'core/canvas/frame/00-srcdoc.js', 'EXCALIDRAW_SRCDOC iframe 模板（HTML/CSS/转义 JS）'],
  [2043, 'core/canvas/frame/01-variants.js', 'EXCALIDRAW_VENDOR_BOOTSTRAP / SRCDOC_LOCAL / SRCDOC_CLEAN'],
  [2059, 'app/01-layout.js', '分栏布局与宿主 iframe 定位'],
  [2133, 'app/02-CanvasOverlay.js', 'CanvasOverlay 主组件（素材库 / 引擎设置 / 编辑工具 / 主题同步）'],
  [4239, 'app/03-styles.js', '父侧 CSS 字符串（DSH 设计令牌）'],
  [4389, 'core/capabilities/01-compat.js', 'compatibilityLogger / safeEffect / safeSlot'],
  [4425, 'main/99-apply.js', 'apply()：注册 slots / turnTail / overlay / input dock；工厂收尾']
];

// 声明行之前紧邻的注释行归入本段
function adjustedStart(decl) {
  let s = decl;
  while (s > 1 && /^\s*\/\//.test(L(s - 1))) s -= 1;
  return s;
}
const starts = SEGMENTS.map(([decl]) => adjustedStart(decl));
starts[0] = 1;
for (let i = 1; i < starts.length; i++) if (starts[i] <= starts[i - 1]) throw new Error('分段起点非递增: ' + i);

const manifest = [];
for (let i = 0; i < SEGMENTS.length; i++) {
  const [decl, file, note] = SEGMENTS[i];
  const start = starts[i];
  const end = i + 1 < SEGMENTS.length ? starts[i + 1] - 1 : lines.length;
  const body = lines.slice(start - 1, end).join('\n') + '\n';
  const target = join(OUT, file);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, body);
  manifest.push({ file, note, lines: [start, end] });
  console.log(String(start).padStart(5), String(end).padStart(5), file);
}
await writeFile(join(OUT, 'build-manifest.json'), JSON.stringify({
  _comment: 'scripts/build-client.mjs 按 order 依次拼接为 lib/client.js。分段共享工厂函数闭包，顺序即作用域顺序，不可随意调换。',
  output: 'lib/client.js',
  order: manifest
}, null, 2) + '\n');
console.log('分段', manifest.length, '个；清单 src/client/build-manifest.json');
