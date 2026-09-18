/*
  DSH 画布桥接 · Illustrator 面板
  ---------------------------------------------------------------------------
  安装：与 dsh-bridge-core.jsx、DSH画布桥接-Photoshop.jsx 一起放进 Illustrator 的 Presets/<语言>/Scripts，
        重启后 文件 → 脚本 → DSH画布桥接-Illustrator（画布「更多 → 安装 Adobe 桥接脚本」会自动拷贝）。
  功能：① 发送选中对象 → 画布（透明 PNG，裁到对象边界，72/150/300 dpi 可选，记录相对画板的坐标）
        ② 发送整个画板 (.ai 副本) → 画布（画布可做图层级编辑；原文档不受影响）
        ③ 读取项目发件箱 → 「置入」（置入对象，可归位到出发位置）/「打开」
  说明：Illustrator 的 ExtendScript 不支持常驻 palette，本面板是模态对话框——用完点「关闭」，下次从菜单再开；
        没有自动轮询，返回件用「刷新」查看。
  坐标（子代理改 bug 先读）：AI 原生是 y 向上 / 单位 pt。清单里一律换算成「以所在画板左上角为原点、y 向下」：
        bounds.left = 对象.left − 画板.left；bounds.top = 画板.top − 对象.top（PROTOCOL §3）。置入时反向换算。
  协议：canvas-workbench/adobe-bridge/PROTOCOL.md。排障：~/.dsh/canvas-workbench/adobe-bridge/script-log.txt
*/
#target illustrator
#include "dsh-bridge-core.jsx"

(function () {
  var B = DSH_BRIDGE, APP = 'illustrator';
  var prefs = B.loadPrefs(APP, { dpi: 150, alwaysHome: false });
  var DPI_CHOICES = [72, 150, 300];

  /* ===================== Illustrator 侧工具 ===================== */
  function activeArtboard(doc) {
    var index = 0;
    try { index = doc.artboards.getActiveArtboardIndex(); } catch (e) {}
    var rect = doc.artboards[index].artboardRect; /* [left, top, right, bottom]，y 向上：top > bottom */
    return { index: index, rect: rect, width: rect[2] - rect[0], height: rect[1] - rect[3] };
  }
  function selectionItems(doc) {
    var sel = doc.selection;
    if (!sel) return [];
    if (sel.typename === 'TextRange') return [];
    var out = [];
    for (var i = 0; i < sel.length; i++) out.push(sel[i]);
    return out;
  }
  function itemType(item) {
    var t = String(item.typename || '');
    if (t === 'TextFrame') return 'text';
    if (t === 'GroupItem') return 'group';
    if (t === 'PlacedItem' || t === 'RasterItem') return 'placed';
    if (t === 'PathItem' || t === 'CompoundPathItem') return 'pathitem';
    return 'other';
  }
  function itemName(item, index) {
    var n = '';
    try { n = B.trim(item.name); } catch (e) {}
    if (!n && String(item.typename) === 'TextFrame') { try { n = B.trim(item.contents).substring(0, 20); } catch (e2) {} }
    return n || (String(item.typename || '对象').replace(/Item$/, '') + '-' + (index + 1));
  }
  /* 联合可见边界（含描边），y 向上 [l, t, r, b] */
  function unionVisibleBounds(items) {
    var u = null;
    for (var i = 0; i < items.length; i++) {
      var b = items[i].visibleBounds;
      if (!u) u = [b[0], b[1], b[2], b[3]];
      else { u[0] = Math.min(u[0], b[0]); u[1] = Math.max(u[1], b[1]); u[2] = Math.max(u[2], b[2]); u[3] = Math.min(u[3], b[3]); }
    }
    return u;
  }
  /* y 向上的页面边界 → 清单坐标（画板左上为原点、y 向下） */
  function toManifestBounds(ub, ab) {
    return { left: B.round(ub[0] - ab.rect[0]), top: B.round(ab.rect[1] - ub[1]), right: B.round(ub[2] - ab.rect[0]), bottom: B.round(ab.rect[1] - ub[3]) };
  }
  function manifestArtboard(ab) {
    return { index: ab.index, left: 0, top: 0, right: B.round(ab.width), bottom: B.round(ab.height) };
  }
  function docInfo(doc, ab) {
    var path = '';
    try { path = doc.fullName.fsName; } catch (e) {}
    var mode = 'RGB';
    try { mode = doc.documentColorSpace === DocumentColorSpace.CMYK ? 'CMYK' : 'RGB'; } catch (e2) {}
    return { name: doc.name, path: path, width: B.round(ab.width), height: B.round(ab.height), resolution: 72, units: 'pt', colorMode: mode };
  }
  function withQuiet(fn) {
    var old = app.userInteractionLevel;
    app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
    try { return fn(); } finally { app.userInteractionLevel = old; }
  }

  /* 把当前选区复制到临时文档并导出透明 PNG（临时目录）；不修改原文档 */
  function exportSelectionPNG(doc, items, tempName, dpi) {
    var ub = unionVisibleBounds(items);
    var w = ub[2] - ub[0], h = ub[1] - ub[3];
    if (!(w > 0.01) || !(h > 0.01)) throw new Error('所选对象没有尺寸');
    app.executeMenuCommand('copy');
    var tmp = app.documents.add(doc.documentColorSpace, w, h);
    try {
      app.executeMenuCommand('paste');
      var pasted = selectionItems(tmp);
      if (!pasted.length) throw new Error('粘贴到临时文档失败');
      var ab = tmp.artboards[0].artboardRect;
      var pb = unionVisibleBounds(pasted);
      var dx = ab[0] - pb[0], dy = ab[1] - pb[1];
      for (var i = 0; i < pasted.length; i++) pasted[i].translate(dx, dy);
      var file = new File(B.tempFolder().fsName + '/' + tempName + '.png');
      if (file.exists) file.remove();
      var o = new ExportOptionsPNG24();
      o.artBoardClipping = true;
      o.transparency = true;
      o.antiAliasing = true;
      o.matte = false;
      o.horizontalScale = o.verticalScale = Math.max(10, Number(dpi) || 150) / 72 * 100;
      tmp.exportFile(file, ExportType.PNG24, o);
      if (!file.exists) throw new Error('PNG 导出失败');
      return { file: file, bounds: ub };
    } finally {
      try { tmp.close(SaveOptions.DONOTSAVECHANGES); } catch (e) {}
      try { app.activeDocument = doc; } catch (e2) {}
    }
  }

  /* ===================== 发送 ===================== */
  function sendSelection(dpi) {
    var s = B.status();
    if (!s.online) throw new Error(s.reason);
    if (!app.documents.length) throw new Error('请先打开一个文档');
    var doc = app.activeDocument;
    var items = selectionItems(doc);
    if (!items.length) throw new Error('请先选中至少一个对象');
    var inbox = B.inboxFolder(s.handshake, APP);
    var ab = activeArtboard(doc);
    var job = B.jobId('ai');
    return withQuiet(function () {
      var r = exportSelectionPNG(doc, items, job + '-01', dpi);
      var label = items.length === 1 ? itemName(items[0], 0) : ('合并' + items.length + '个对象');
      var name = job + '-01-' + B.safeName(label) + '.png';
      B.deliverFile(r.file, inbox, name);
      var manifest = {
        protocol: B.PROTOCOL, jobId: job, app: APP, appVersion: String(app.version), createdAt: B.now(),
        document: docInfo(doc, ab), merged: items.length > 1,
        items: [{ file: name, kind: 'png', layer: { name: items.length === 1 ? itemName(items[0], 0) : ('合并·' + items.length + '个对象'), id: 0, type: items.length === 1 ? itemType(items[0]) : 'group' }, bounds: toManifestBounds(r.bounds, ab), artboard: manifestArtboard(ab) }]
      };
      B.writeInboundManifest(inbox, manifest);
      B.log(APP, '发送选区（' + items.length + ' 个对象，' + dpi + 'dpi）→ ' + name);
      return 1;
    });
  }

  /* 整个画板：全选 → 复制 → 新临时文档粘贴到原位 → 另存 .ai 副本（原文档不动、不改关联） */
  function sendArtboard() {
    var s = B.status();
    if (!s.online) throw new Error(s.reason);
    if (!app.documents.length) throw new Error('请先打开一个文档');
    var doc = app.activeDocument;
    var inbox = B.inboxFolder(s.handshake, APP);
    var ab = activeArtboard(doc);
    var job = B.jobId('ai');
    var oldRemember = true;
    try { oldRemember = app.preferences.getBooleanPreference('pasteRemembersLayers'); } catch (e0) {}
    return withQuiet(function () {
      try { app.preferences.setBooleanPreference('pasteRemembersLayers', true); } catch (e1) {}
      doc.selection = null;
      app.executeMenuCommand('selectall');
      var items = selectionItems(doc);
      if (!items.length) throw new Error('画板上没有可选对象（锁定/隐藏的对象不会被发送）');
      app.executeMenuCommand('copy');
      var tmp = app.documents.add(doc.documentColorSpace, ab.width, ab.height);
      try {
        app.executeMenuCommand('pasteInPlace');
        var pasted = selectionItems(tmp);
        var tab = tmp.artboards[0].artboardRect;
        var dx = tab[0] - ab.rect[0], dy = tab[1] - ab.rect[1];
        if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) for (var i = 0; i < pasted.length; i++) pasted[i].translate(dx, dy);
        var temp = new File(B.tempFolder().fsName + '/' + job + '-artboard.ai');
        if (temp.exists) temp.remove();
        var o = new IllustratorSaveOptions();
        o.pdfCompatible = true;
        o.embedLinkedFiles = true;
        tmp.saveAs(temp, o);
        var name = job + '-01-' + B.safeName(B.baseName(doc.name), '画板') + '.ai';
        B.deliverFile(temp, inbox, name);
        var info = docInfo(doc, ab);
        B.writeInboundManifest(inbox, {
          protocol: B.PROTOCOL, jobId: job, app: APP, appVersion: String(app.version), createdAt: B.now(), document: info, merged: false,
          items: [{ file: name, kind: 'ai', layer: { name: doc.name, id: 0, type: 'document' }, bounds: { left: 0, top: 0, right: info.width, bottom: info.height }, artboard: manifestArtboard(ab) }]
        });
        B.log(APP, '发送整个画板 → ' + name);
        return 1;
      } finally {
        try { tmp.close(SaveOptions.DONOTSAVECHANGES); } catch (e2) {}
        try { app.activeDocument = doc; } catch (e3) {}
        try { app.preferences.setBooleanPreference('pasteRemembersLayers', oldRemember); } catch (e4) {}
        try { doc.selection = null; } catch (e5) {}
      }
    });
  }

  /* ===================== 置入 / 打开 ===================== */
  /* 置入为链接对象；归位时把清单的 y 向下坐标换回页面坐标：x = 画板.left + left；y = 画板.top − top */
  function placeInto(doc, file, origin, alwaysHome, label) {
    var ab = activeArtboard(doc);
    var pi = doc.placedItems.add();
    pi.file = file;
    try { pi.name = label + ' ← 画布'; } catch (e) {}
    if (B.shouldHome(origin, doc.name, alwaysHome)) {
      var W = origin.bounds.right - origin.bounds.left, H = origin.bounds.bottom - origin.bounds.top;
      if (W > 0 && H > 0) { pi.width = W; pi.height = H; }
      pi.position = [ab.rect[0] + origin.bounds.left, ab.rect[1] - origin.bounds.top];
    } else {
      pi.position = [ab.rect[0] + (ab.width - pi.width) / 2, ab.rect[1] - (ab.height - pi.height) / 2];
    }
    return pi;
  }
  function importPending(mode) {
    var s = B.status();
    var h = s.handshake;
    if (!h || !h.outbox) throw new Error(s.reason || '未找到发件箱');
    var jobs = B.pendingOutbox(h, APP);
    if (!jobs.length) throw new Error('发件箱没有新的返回件');
    return withQuiet(function () {
      var count = 0, i, j;
      for (i = 0; i < jobs.length; i++) {
        var m = jobs[i].manifest, ok = true, err = '';
        try {
          for (j = 0; j < m.files.length; j++) {
            var f = new File(jobs[i].file.parent.fsName + '/' + m.files[j].file);
            if (!f.exists) throw new Error('文件不存在：' + m.files[j].file);
            if (mode === 'open') {
              app.open(f);
            } else {
              if (!app.documents.length) throw new Error('没有打开的文档可置入，请先打开文档或改用「打开」');
              var origin = m.origin;
              var label = origin && origin.layer && origin.layer.name ? origin.layer.name : B.baseName(m.files[j].name || m.files[j].file);
              placeInto(app.activeDocument, f, origin, prefs.alwaysHome, label);
            }
            count++;
          }
        } catch (e) { ok = false; err = String(e && e.message ? e.message : e); }
        B.markManifest(jobs[i].file, ok ? 'done' : 'failed', ok ? '' : err);
        B.log(APP, (ok ? '返回件已' + (mode === 'open' ? '打开 ' : '置入 ') : '返回件失败 ') + jobs[i].file.name + (err ? '：' + err : ''));
        if (!ok) throw new Error(err);
      }
      return count;
    });
  }

  /* 对外暴露（无界面自动化测试 / 其它脚本复用）。$.global.DSH_BRIDGE_HEADLESS === true 时只挂函数、不开对话框。 */
  B.ai = { sendSelection: sendSelection, sendArtboard: sendArtboard, importPending: importPending, placeInto: placeInto, activeArtboard: activeArtboard, selectionItems: selectionItems, unionVisibleBounds: unionVisibleBounds, toManifestBounds: toManifestBounds, exportSelectionPNG: exportSelectionPNG, prefs: prefs };
  if ($.global.DSH_BRIDGE_HEADLESS === true) return;

  /* ===================== 面板（模态对话框） ===================== */
  var win = B.makeWindow('dialog', 'DSH 画布桥接 · Illustrator');
  var g1 = win.add('group');
  g1.orientation = 'row';
  var btnSend = g1.add('button', undefined, '发送选中对象 → 画布');
  g1.add('statictext', undefined, '分辨率');
  var ddDpi = g1.add('dropdownlist', undefined, ['72 dpi', '150 dpi', '300 dpi']);
  var dpiIndex = 1;
  for (var k = 0; k < DPI_CHOICES.length; k++) if (DPI_CHOICES[k] === Number(prefs.dpi)) dpiIndex = k;
  ddDpi.selection = dpiIndex;
  var btnDoc = win.add('button', undefined, '发送整个画板 (.ai 副本) → 画布');
  var outHeader = win.add('statictext', undefined, '发件箱：正在检测…');
  outHeader.characters = 42;
  var g2 = win.add('group');
  g2.orientation = 'row';
  var btnPlace = g2.add('button', undefined, '置入');
  var btnOpen = g2.add('button', undefined, '打开');
  var btnRefresh = g2.add('button', undefined, '刷新');
  var cbHome = win.add('checkbox', undefined, '总是归位到出发位置（即使文档名不同）');
  cbHome.value = !!prefs.alwaysHome;
  var note = win.add('statictext', undefined, ' ', { multiline: true });
  note.characters = 42;
  win.__note = note;
  var btnClose = win.add('button', undefined, '关闭', { name: 'cancel' });

  function currentDpi() { return DPI_CHOICES[ddDpi.selection ? ddDpi.selection.index : 1] || 150; }
  function refresh() {
    var s = B.status();
    B.paintStatus(win, s);
    var n = 0;
    if (s.handshake && s.handshake.outbox) { try { n = B.pendingOutbox(s.handshake, APP).length; } catch (e) { n = 0; } }
    outHeader.text = n ? ('📥 发件箱有 ' + n + ' 个返回件待置入') : '发件箱：暂无新返回件';
    btnSend.enabled = btnDoc.enabled = !!s.online;
    btnPlace.enabled = btnOpen.enabled = n > 0;
    return s;
  }
  function run(label, fn) {
    try {
      var n = fn();
      B.setNote(win, '✓ ' + label + '：' + n + ' 项');
    } catch (e) {
      var msg = String(e && e.message ? e.message : e);
      B.setNote(win, '⚠ ' + label + '失败：' + msg);
      B.log(APP, label + '失败：' + msg);
    }
    try { refresh(); } catch (e2) {}
  }
  btnSend.onClick = function () { run('发送对象', function () { return sendSelection(currentDpi()); }); };
  btnDoc.onClick = function () { run('发送画板', sendArtboard); };
  btnPlace.onClick = function () { run('置入', function () { return importPending('place'); }); };
  btnOpen.onClick = function () { run('打开', function () { return importPending('open'); }); };
  btnRefresh.onClick = function () { try { refresh(); B.setNote(win, '已刷新'); } catch (e) { B.setNote(win, '⚠ ' + e); } };
  ddDpi.onChange = function () { prefs.dpi = currentDpi(); B.savePrefs(APP, prefs); };
  cbHome.onClick = function () { prefs.alwaysHome = cbHome.value; B.savePrefs(APP, prefs); };
  btnClose.onClick = function () { win.close(); };

  refresh();
  B.log(APP, '面板已打开（core ' + B.CORE_VERSION + '）');
  win.center();
  win.show();
})();
