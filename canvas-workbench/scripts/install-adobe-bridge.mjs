// 把 adobe-bridge/*.jsx 装进本机 Photoshop / Illustrator 的 Scripts 目录（DSH 不在运行时用）。
// 与画布「更多 → 安装 Adobe 桥接脚本」走同一个 installScripts()，逻辑只在 src/host/services/adobe-bridge.js 一处。
//
//   node scripts/install-adobe-bridge.mjs          # 安装
//   node scripts/install-adobe-bridge.mjs --list   # 只列出会安装到哪些目录，不写入
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAdobeBridge } from '../src/host/services/adobe-bridge.js';

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const bridge = createAdobeBridge({ pluginRoot });

if (process.argv.includes('--list')) {
  const targets = await bridge.findAdobeScriptDirs();
  if (!targets.length) console.log('未找到已安装的 Photoshop / Illustrator。');
  for (const t of targets) console.log(`${t.app.padEnd(11)} ${t.level.padEnd(4)} ${t.name} → ${t.dirs.length > 1 ? t.dirs[0] + ' …等 ' + t.dirs.length + ' 个' : t.dirs[0]}`);
  process.exit(0);
}

const result = await bridge.installScripts();
console.log(`用户副本：${result.userCopyDir}（可用「文件 → 脚本 → 浏览…/其它脚本…」直接打开）`);
for (const item of result.installed) console.log(`✓ ${item.name} → ${item.dir}`);
for (const item of result.errors) console.error(`✗ ${item.name || '(未找到)'}: ${item.error}${item.hint ? '\n    ' + item.hint : ''}`);
console.log(result.installed.length
  ? `\n已安装 ${result.scriptFiles.join(' / ')}。重启 Photoshop / Illustrator 后：文件 → 脚本 → DSH画布桥接-…`
  : `\n没有装进任何 Adobe 菜单目录。${result.manualHint}`);
process.exit(result.installed.length ? 0 : 1);
