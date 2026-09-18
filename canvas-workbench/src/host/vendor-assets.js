import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 本文件位于 <plugin>/src/host/，插件根目录向上三级（原 lib/index.js 为两级）。
const PLUGIN_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const VENDOR_ASSETS = new Map([
  ['react.js', { path: join(PLUGIN_ROOT, 'vendor', 'react-18.3.1.production.min.js'), type: 'text/javascript; charset=utf-8' }],
  ['react-dom.js', { path: join(PLUGIN_ROOT, 'vendor', 'react-dom-18.3.1.production.min.js'), type: 'text/javascript; charset=utf-8' }],
  ['excalidraw.js', { path: join(PLUGIN_ROOT, 'vendor', 'excalidraw-0.17.6.production.min.js'), type: 'text/javascript; charset=utf-8' }]
]);

export { PLUGIN_ROOT, VENDOR_ASSETS };
