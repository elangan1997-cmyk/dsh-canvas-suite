// UI 结构/样式快照：通过 CDP 读取 DSH 页面与画布 iframe 的关键 DOM 状态，
// 产出可跨版本 diff 的 JSON。像素截图对 DSH 透明材质窗口不可靠，这里只取 DOM 真值。
//
//   node tests/smoke/ui-snapshot.mjs <out.json>
import { connectDsh } from './cdp-client.mjs';
import { writeFile } from 'node:fs/promises';

export const SNAPSHOT_SCRIPT = `(() => {
  const cs = (el, props) => { if (!el) return null; const s = getComputedStyle(el); const o = {}; for (const p of props) o[p] = s[p]; return o; };
  const text = (sel, root = document) => [...root.querySelectorAll(sel)].map((e) => (e.textContent || '').trim()).filter(Boolean);
  const out = { page: {}, canvas: {}, frame: {} };

  out.page.designModeOn = localStorage.getItem('dsh-canvas-design-mode') === '1';
  out.page.bgFollowSystem = localStorage.getItem('dsh-canvas-bg-follow-system');
  out.page.materialSort = localStorage.getItem('dsh-canvas-material-sort-v1');
  out.page.bodyDarkAttr = document.body.hasAttribute('data-ds-dark-theme');
  out.page.tokens = {};
  for (const k of ['--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-alias-label-primary', '--dsw-alias-border-l2']) out.page.tokens[k] = getComputedStyle(document.body).getPropertyValue(k).trim();
  out.page.imageTail = { blocks: document.querySelectorAll('.dsh-canvas-tool-output').length, images: document.querySelectorAll('.dsh-canvas-images img').length, titles: text('.dsh-canvas-tool-title').slice(0, 3), counts: text('.dsh-canvas-tool-count').slice(0, 3), buttons: text('.dsh-canvas-tool-bar button, .dsh-canvas-add-btn').slice(0, 6) };

  const overlay = document.querySelector('.dsh-canvas-overlay');
  out.canvas.overlayPresent = Boolean(overlay);
  if (overlay) {
    out.canvas.toolbarButtons = text('.dsh-canvas-toolbar button', overlay).slice(0, 12);
    out.canvas.toolbarStyle = cs(overlay.querySelector('.dsh-canvas-toolbar'), ['backgroundColor', 'color', 'boxShadow']);
    out.canvas.overlayStyle = cs(overlay, ['backgroundColor', 'boxShadow']);
    out.canvas.titleText = text('.dsh-canvas-title', overlay).slice(0, 2);
  }
  const materials = document.querySelector('[class*="material"]');
  out.canvas.materialPanelOpen = Boolean(materials && materials.getClientRects().length);

  const frame = [...document.querySelectorAll('iframe')].find((i) => i.contentDocument && i.contentDocument.querySelector('.excalidraw'));
  if (frame) {
    const d = frame.contentDocument, w = frame.contentWindow;
    const html = d.documentElement;
    out.frame.vars = {};
    for (const k of ['--dsh-bg', '--dsh-fg', '--dsh-fg-muted', '--dsh-surface', '--dsh-line', '--dsh-hover']) out.frame.vars[k] = html.style.getPropertyValue(k);
    out.frame.colorScheme = html.style.colorScheme;
    out.frame.excalidrawClass = (d.querySelector('.excalidraw') || {}).className || null;
    out.frame.imageElements = d.querySelectorAll('.dsh-image-name-plain, .dsh-image-tag-corner').length;
    out.frame.selectionToolbar = cs(d.querySelector('.dsh-selection-toolbar'), ['backgroundColor', 'color', 'borderColor']);
    out.frame.selectionMenu = cs(d.querySelector('.dsh-selection-menu'), ['backgroundColor', 'color']);
    out.frame.selectionActions = [...d.querySelectorAll('.dsh-selection-action')].map((e) => (e.textContent || '').trim()).filter(Boolean).slice(0, 12);
    out.frame.tagDots = d.querySelectorAll('.dsh-tag-dot-btn').length;
    out.frame.bodyBg = w.getComputedStyle(d.body).backgroundColor;
    out.frame.canvasCount = d.querySelectorAll('canvas').length;
  } else {
    out.frame.present = false;
  }
  return out;
})()`;

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const out = process.argv[2];
  const cdp = await connectDsh();
  try {
    const snap = await cdp.eval(SNAPSHOT_SCRIPT);
    const json = JSON.stringify(snap, null, 2);
    if (out) { await writeFile(out, json); console.log('已写入', out); } else console.log(json);
  } finally { cdp.close(); }
}
