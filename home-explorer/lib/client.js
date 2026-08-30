/**
 * @local/home-explorer — Client half (browser bundle)
 *
 * Finder 风格的网格文件浏览器：文件夹图标、图片缩略图、文件名+大小，
 * 顶部返回/前进/上级/刷新/路径/搜索/视图切换，底部预览。
 * 数据走同源 HTTP（/dsh-home-explorer/home|list|read|image）。
 */
window.__ModuleLoader__.load({
  id: '@local/home-explorer',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require('react');
    const el = React.createElement;
    const useState = React.useState;
    const useEffect = React.useEffect;

    const API = {
      home: () => fetch('/dsh-home-explorer/home').then((r) => r.json()),
      list: (p) => fetch('/dsh-home-explorer/list?path=' + encodeURIComponent(p)).then((r) => r.json()),
      read: (p) => fetch('/dsh-home-explorer/read?path=' + encodeURIComponent(p)).then((r) => r.json()),
      saveImage: (directory, dataURL, name) => fetch('/dsh-home-explorer/save-image', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ directory, dataURL, name }) }).then((r) => r.json()),
    };
    const imgUrl = (p) => '/dsh-home-explorer/image?path=' + encodeURIComponent(p);

    const IMG_EXT = { png: 1, jpg: 1, jpeg: 1, webp: 1, gif: 1, avif: 1, bmp: 1, svg: 1, ico: 1 };
    const extOf = (n) => { const m = /\.([a-zA-Z0-9]+)$/.exec(String(n || '')); return m ? m[1].toLowerCase() : ''; };
    const isImage = (n) => !!IMG_EXT[extOf(n)];
    const fmtSize = (n) => {
      if (n === null || n === undefined) return '';
      if (n < 1024) return n + ' B';
      if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
      if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
      return (n / 1073741824).toFixed(1) + ' GB';
    };

    // ---- shared state (module level) ----
    const open = { v: false };
    const subs = new Set();
    const emit = () => { for (const fn of Array.from(subs)) fn() };
    const subscribe = (fn) => { subs.add(fn); return () => { subs.delete(fn) } };
    const setOpen = (v) => { open.v = !!v; emit() };

    const nav = { path: null, items: [], loading: false, error: null, back: [], forward: [], view: 'grid', query: '', selected: null };
    const preview = { open: false, path: null, name: null, content: null, state: 'idle', isImg: false, message: null, size: 0 };

    const parentOf = (p) => {
      const s = String(p || '').replace(/[\\/]+$/, '');
      const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
      if (i < 0 || (/^[A-Za-z]:$/.test(s.slice(0, i)) && i <= 2)) return null;
      return s.slice(0, i) || '/';
    };

    function loadDir(path) {
      nav.loading = true; nav.error = null; emit();
      API.list(path).then((res) => {
        if (res && res.error) { nav.loading = false; nav.error = res.error; nav.items = []; emit(); return; }
        nav.loading = false; nav.items = (res && res.entries) || []; nav.path = path; nav.selected = null; emit();
      }).catch((err) => { nav.loading = false; nav.error = String((err && err.message) || err); nav.items = []; emit(); });
    }
    function openRoot() {
      API.home().then((r) => {
        if (r && r.path) { nav.back = []; nav.forward = []; loadDir(r.path); }
        else { nav.error = '无法读取主目录'; emit(); }
      }).catch(() => { nav.error = '无法读取主目录'; emit(); });
    }
    function goInto(item) {
      if (!nav.path) return;
      nav.back.push(nav.path); nav.forward = []; loadDir(item.path);
    }
    function goBack() {
      if (!nav.back.length) return;
      nav.forward.push(nav.path); loadDir(nav.back.pop());
    }
    function goForward() {
      if (!nav.forward.length) return;
      nav.back.push(nav.path); loadDir(nav.forward.pop());
    }
    function goUp() {
      const p = parentOf(nav.path);
      if (!p) return;
      nav.back.push(nav.path); nav.forward = []; loadDir(p);
    }
    function refresh() { if (nav.path) loadDir(nav.path); }
    function setQuery(q) { nav.query = String(q || ''); emit(); }
    function setView(v) { nav.view = v; emit(); }
    function goToAbs(p) { const s = String(p || '').trim(); if (!s) return; nav.back = []; nav.forward = []; loadDir(s); }

    function openPreview(item) {
      nav.selected = item.path; emit();
      preview.path = item.path; preview.name = item.name; preview.open = true; preview.message = null; preview.content = null; preview.size = 0;
      if (isImage(item.name)) { preview.isImg = true; preview.state = 'image'; emit(); return; }
      preview.isImg = false; preview.state = 'loading'; emit();
      API.read(item.path).then((res) => {
        if (preview.path !== item.path) return;
        if (res && res.error) { preview.state = 'error'; preview.message = res.error; emit(); return; }
        if (res && res.tooLarge) { preview.state = 'too-large'; preview.size = res.size; emit(); return; }
        preview.state = 'ready'; preview.content = res.content; emit();
      }).catch((err) => {
        if (preview.path !== item.path) return;
        preview.state = 'error'; preview.message = String((err && err.message) || err); emit();
      });
    }
    function closePreview() { preview.open = false; preview.content = null; emit(); }
    function onItem(item) { if (item.type === 'directory') goInto(item); else openPreview(item); }

    const useNav = () => { const [, s] = useState(0); useEffect(() => subscribe(() => s((x) => x + 1)), []); return nav; };

    // 推走聊天内容（真实分栏，不遮挡），与 canvas-workbench 相同的做法
    function findAppFrame() {
      const layer = document.querySelector('[data-shell-overlay]');
      return layer && layer.parentElement ? layer.parentElement : null;
    }
    function applyFramePadding(px) {
      const frame = findAppFrame();
      if (frame) frame.style.paddingRight = px ? px + 'px' : '';
    }

    // ---- CSS ----
    const CSS = [
      '.fe-hdr{display:flex;align-items:center;gap:4px;padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.25));flex:none;flex-wrap:wrap}',
      '.fe-hbtn{display:flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary, #333);cursor:pointer;font-size:14px}',
      '.fe-hbtn:hover{background:var(--dsw-alias-bg-layer-2, rgba(128,128,128,.12))}',
      '.fe-hbtn:disabled{opacity:.3;cursor:default}',
      '.fe-path{flex:1;min-width:120px;font-size:12px;color:var(--dsw-alias-label-secondary, #666);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 4px}',
      '.fe-search{width:90px;padding:4px 8px;border:1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.35));border-radius:6px;background:var(--dsw-alias-bg-layer-1, rgba(128,128,128,.06));color:var(--dsw-alias-label-primary, #333);font-size:12px;outline:none}',
      '.fe-search:focus{border-color:var(--dsw-alias-brand-primary, #3b82f6)}',
      '.fe-path-edit{flex:1;min-width:120px;font-size:12px;padding:4px 8px;border:1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.35));border-radius:6px;background:var(--dsw-alias-bg-layer-1, rgba(128,128,128,.06));color:var(--dsw-alias-label-primary, #333);outline:none}',
      '.fe-path-edit:focus{border-color:var(--dsw-alias-brand-primary, #3b82f6)}',
      '.fe-vbtn{padding:3px 7px;font-size:12px;border:1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.35));border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary, #333);cursor:pointer;white-space:nowrap}',
      '.fe-vbtn:hover{background:var(--dsw-alias-bg-layer-2, rgba(128,128,128,.12))}',
      '.fe-scroll{flex:1;overflow:auto;padding:10px 12px;min-height:0;transition:background .15s,box-shadow .15s}',
      '.fe-scroll-drop{background:rgba(59,130,246,.12);box-shadow:inset 0 0 0 3px rgba(59,130,246,.55)}',
      '.fe-resize{position:absolute;left:-3px;top:0;bottom:0;width:8px;cursor:col-resize;z-index:5;touch-action:none}',
      '.fe-resize:hover,.fe-resize:active{background:var(--dsw-alias-brand-primary, #3b82f6);opacity:.35}',
      '.fe-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:8px}',
      '.fe-card{display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 4px;border-radius:10px;cursor:pointer;text-align:center;border:1px solid transparent}',
      '.fe-card:hover{background:var(--dsw-alias-bg-layer-1, rgba(128,128,128,.07))}',
      '.fe-card-sel{background:rgba(59,130,246,.14);border-color:rgba(59,130,246,.4)}',
      '.fe-thumb{width:64px;height:64px;display:flex;align-items:center;justify-content:center;font-size:40px;line-height:1;border-radius:8px;object-fit:contain;background:var(--dsw-alias-bg-layer-1, rgba(128,128,128,.06))}',
      '.fe-thumb-dir{color:#3b82f6}',
      '.fe-thumb-file{color:var(--dsw-alias-label-secondary, #888);font-size:30px}',
      '.fe-name{font-size:12px;color:var(--dsw-alias-label-primary, #333);max-width:100%;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-all;line-height:1.25}',
      '.fe-size{font-size:11px;color:var(--dsw-alias-label-secondary, #666)}',
      '.fe-empty{padding:24px 16px;color:var(--dsw-alias-label-secondary, #666);font-size:13px;text-align:center}',
      '.fe-err{color:var(--dsw-alias-state-error-primary, #c00)}',
      '.fe-status{flex:none;padding:4px 10px;font-size:11px;color:var(--dsw-alias-label-secondary, #666);border-top:1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.2))}',
      '.fe-prev{flex:none;max-height:46%;overflow:auto;border-top:1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.25));background:var(--dsw-alias-bg-layer-1, rgba(128,128,128,.04));display:flex;flex-direction:column}',
      '.fe-prev-hdr{display:flex;align-items:center;gap:6px;padding:5px 10px;font-size:12px;color:var(--dsw-alias-label-secondary, #666);border-bottom:1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.2));flex:none}',
      '.fe-prev-name{font-weight:600;color:var(--dsw-alias-label-primary, #333);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.fe-prev-btn{padding:2px 9px;font-size:12px;border:1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.35));border-radius:5px;background:transparent;color:var(--dsw-alias-label-primary, #333);cursor:pointer;flex:none}',
      '.fe-prev-btn:hover{background:var(--dsw-alias-bg-layer-2, rgba(128,128,128,.12))}',
      '.fe-prev-img{display:block;margin:0 auto;max-width:100%;max-height:100%;object-fit:contain}',
      '.fe-prev-pre{margin:0;padding:10px 12px;color:var(--dsw-alias-label-primary, #333);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-word}',
      '.fe-prev-msg{padding:10px 12px;color:var(--dsw-alias-label-secondary, #666);font-size:12px}',
      '.fe-toggle{display:flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary, #666);cursor:pointer;font-size:15px}',
      '.fe-toggle:hover{background:var(--dsw-alias-bg-layer-2, rgba(128,128,128,.12))}',
      '.fe-toggle-on{color:var(--dsw-alias-brand-primary, #3b82f6)}'
    ].join('\n');

    // ---- components ----
    function Header() {
      const n = useNav();
      const [addr, setAddr] = useState('');
      const [editing, setEditing] = useState(false);
      const hasBack = n.back.length > 0;
      const hasFwd = n.forward.length > 0;
      const hasUp = parentOf(n.path) !== null;
      const addrNode = editing
        ? el('input', { className: 'fe-path-edit', type: 'text', value: addr, autoFocus: true,
          spellCheck: false, placeholder: '输入路径后回车，例如 C:\\Users 或 /Volumes/Elements',
          onFocus: (e) => e.target.select(),
          onChange: (e) => setAddr(e.target.value),
          onBlur: () => setEditing(false),
          onKeyDown: (e) => {
            if (e.key === 'Enter') { e.preventDefault(); goToAbs(addr); setEditing(false); }
            else if (e.key === 'Escape') { setEditing(false); }
          } })
        : el('div', { className: 'fe-path', title: '点击编辑路径 / 前往任意位置（含外部磁盘）', onClick: () => { setAddr(n.path || ''); setEditing(true); } }, n.path || '…');
      return el('div', { className: 'fe-hdr' },
        el('button', { className: 'fe-hbtn', title: '后退', disabled: !hasBack, onClick: goBack }, '◀'),
        el('button', { className: 'fe-hbtn', title: '前进', disabled: !hasFwd, onClick: goForward }, '▶'),
        el('button', { className: 'fe-hbtn', title: '上级', disabled: !hasUp, onClick: goUp }, '↑'),
        el('button', { className: 'fe-hbtn', title: '刷新', disabled: !n.path, onClick: refresh }, '⟳'),
        addrNode,
        el('input', { className: 'fe-search', type: 'text', placeholder: '搜索', value: n.query, onChange: (e) => setQuery(e.target.value), spellCheck: false }),
        el('button', { className: 'fe-vbtn', title: '切换视图', onClick: () => setView(n.view === 'grid' ? 'list' : 'grid') }, n.view === 'grid' ? '☰' : '▦'),
        el('button', { className: 'fe-vbtn', title: '关闭', onClick: () => setOpen(false) }, '✕')
      );
    }

    function renderCard(item, n) {
      const sel = n.selected === item.path;
      let thumb;
      if (item.type === 'directory') thumb = el('div', { className: 'fe-thumb fe-thumb-dir' }, '📁');
      else if (isImage(item.name)) thumb = el('img', { className: 'fe-thumb', src: imgUrl(item.path), loading: 'lazy', alt: item.name });
      else thumb = el('div', { className: 'fe-thumb fe-thumb-file' }, '📄');
      return el('div', { key: item.path, className: 'fe-card' + (sel ? ' fe-card-sel' : ''), title: item.path, onClick: () => onItem(item) },
        thumb,
        el('div', { className: 'fe-name' }, item.name),
        item.type !== 'directory' && typeof item.size === 'number' ? el('div', { className: 'fe-size' }, fmtSize(item.size)) : null
      );
    }

    function renderListRow(item, n) {
      const sel = n.selected === item.path;
      return el('div', { key: item.path, className: 'fe-card' + (sel ? ' fe-card-sel' : ''), onClick: () => onItem(item), style: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: '4px 8px', textAlign: 'left' } },
        el('span', { style: { fontSize: 18 } }, item.type === 'directory' ? '📁' : (isImage(item.name) ? '🖼' : '📄')),
        el('span', { className: 'fe-name', style: { flex: '1', WebkitLineClamp: 1 } }, item.name),
        item.type !== 'directory' && typeof item.size === 'number' ? el('span', { className: 'fe-size' }, fmtSize(item.size)) : null
      );
    }

    function Body() {
      const n = useNav();
      const q = n.query.trim().toLowerCase();
      const visible = n.items.filter((i) => !String(i.name || '').startsWith('.'));
      const items = q ? visible.filter((i) => i.name.toLowerCase().includes(q)) : visible;
      if (n.loading) return el('div', { className: 'fe-scroll' }, el('div', { className: 'fe-empty' }, '加载中…'));
      if (n.error) return el('div', { className: 'fe-scroll' }, el('div', { className: 'fe-empty fe-err' }, n.error));
      if (!items.length) return el('div', { className: 'fe-scroll' }, el('div', { className: 'fe-empty' }, q ? '没有匹配的文件' : '空目录'));
      if (n.view === 'list') return el('div', { className: 'fe-scroll' }, el('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } }, items.map((i) => renderListRow(i, n))));
      return el('div', { className: 'fe-scroll' }, el('div', { className: 'fe-grid' }, items.map((i) => renderCard(i, n))));
    }

    function Preview() {
      if (!preview.open) return null;
      let contentNode;
      if (preview.state === 'image') contentNode = el('img', { className: 'fe-prev-img', src: imgUrl(preview.path), alt: preview.name });
      else if (preview.state === 'loading') contentNode = el('div', { className: 'fe-prev-msg' }, '加载中…');
      else if (preview.state === 'error') contentNode = el('div', { className: 'fe-prev-msg' }, preview.message);
      else if (preview.state === 'too-large') contentNode = el('div', { className: 'fe-prev-msg' }, '文件过大（' + fmtSize(preview.size) + '），不支持预览');
      else contentNode = el('pre', { className: 'fe-prev-pre' }, preview.content);
      return el('div', { className: 'fe-prev' },
        el('div', { className: 'fe-prev-hdr' },
          el('span', { className: 'fe-prev-name', title: preview.name }, preview.name),
          el('button', { className: 'fe-prev-btn', onClick: closePreview }, '关闭预览')
        ),
        el('div', { style: { flex: 1, overflow: 'auto', minHeight: 0 } }, contentNode)
      );
    }

    function Explorer(props) {
      const n = useNav();
      const [width, setWidth] = useState(420);
      useEffect(() => { openRoot(); }, []);
      useEffect(() => { applyFramePadding(open.v ? width : 0); }, [open.v, width]);
      useEffect(() => () => { applyFramePadding(0); }, []);
      if (!open.v) return null;
      const startResize = (e) => {
        e.preventDefault();
        const target = e.currentTarget;
        try { target.setPointerCapture(e.pointerId); } catch (err) {}
        const pid = e.pointerId;
        const onMove = (ev) => {
          if (ev.pointerId !== pid) return;
          const w = window.innerWidth - ev.clientX;
          if (w >= 300 && w <= Math.round(window.innerWidth * 0.8)) setWidth(Math.round(w));
        };
        const onUp = (ev) => {
          if (ev.pointerId !== pid) return;
          try { target.releasePointerCapture(pid); } catch (err) {}
          target.removeEventListener('pointermove', onMove);
          target.removeEventListener('pointerup', onUp);
          target.removeEventListener('pointercancel', onUp);
        };
        target.addEventListener('pointermove', onMove);
        target.addEventListener('pointerup', onUp);
        target.addEventListener('pointercancel', onUp);
      };
      return el('div', { className: 'fe-explorer', style: { position: 'fixed', top: 0, right: 0, bottom: 0, width: width + 'px', zIndex: 1200, display: 'flex', flexDirection: 'column', background: 'var(--dsw-alias-bg-overlay, #fff)', borderLeft: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.25))', color: 'var(--dsw-alias-label-primary, #333)', fontSize: 13, lineHeight: 1.4, boxSizing: 'border-box' } },
        el('div', { className: 'fe-resize', title: '拖动调整宽度', onPointerDown: startResize }),
        el(Header),
        el(Body),
        el('div', { className: 'fe-status' }, (n.loading ? '加载中…' : (n.items.length + ' 项' + (n.selected ? ' · 已选 ' + ((n.items.find((i) => i.path === n.selected) || {}).name || '') : ''))) ),
        el(Preview)
      );
    }

    function Toggle() {
      useNav();
      return el('button', { title: '文件浏览器', 'aria-label': '文件浏览器', onClick: () => setOpen(!open.v), className: 'fe-toggle' + (open.v ? ' fe-toggle-on' : ''), style: { fontSize: 15 } }, '🗂');
    }

    function apply(ctx) {
      const styleTag = document.createElement('style');
      styleTag.textContent = CSS;
      document.head.appendChild(styleTag);
      const effect = (setup) => {
        try { return ctx && typeof ctx.effect === 'function' ? ctx.effect(() => { try { return setup(); } catch (e) { return () => {}; } }) : setup(); }
        catch (e) { return () => {}; }
      };
      const slot = (name, options, component) => effect(() => {
        if (!ctx || !ctx.slots || typeof ctx.slots.inject !== 'function' || typeof ctx.slots.register !== 'function') return () => {};
        const result = ctx.slots.inject(name, () => { try { return ctx.slots.register(options, component); } catch (e) { return () => {}; } });
        if (result && typeof result.catch === 'function') result.catch(() => {});
        return typeof result === 'function' ? result : () => {};
      });
      effect(() => () => styleTag.remove());

      slot('conversation.session.header.actions', { name: 'conversation.session.header.actions', id: 'home-explorer-toggle', order: 30, label: '文件' }, () => el(Toggle));
      slot('shell.overlay', { name: 'shell.overlay', id: 'home-explorer', order: 90, label: '文件浏览器' }, (props) => el(Explorer, props));
    }

    exports.apply = apply;
    exports.inject = ['slots'];
    return module.exports;
  }
});
