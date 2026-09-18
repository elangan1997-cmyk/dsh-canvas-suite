/*
  DSH 画布桥接 · CEP 面板逻辑（ES5，兼容 CEP 5~12 的旧 Chromium）
  ---------------------------------------------------------------------------
  这个面板只是"壳"：状态/发件箱靠 cep.fs 直接读文件夹协议；按钮通过 evalScript 调用
  ~/.dsh/canvas-workbench/adobe-bridge/scripts/ 里的 ExtendScript 函数（DSH_BRIDGE.ps.* / .ai.*），
  所以逻辑与模态面板、一键脚本、DSH 远程驱动完全同源（改 bug 只改 .jsx）。
  协议：canvas-workbench/adobe-bridge/PROTOCOL.md。日志：桥接根/script-log.txt（jsx 写）+ 面板底部提示。
*/
(function () {
  var cep = window.__adobe_cep__;
  var cfs = window.cep && window.cep.fs;
  var UTF8 = (window.cep && window.cep.encoding && window.cep.encoding.UTF8) || 'UTF-8';
  var $ = function (id) { return document.getElementById(id); };
  var el = { dot: $('dot'), status: $('status'), project: $('project'), send: $('send'), sendDoc: $('sendDoc'), merged: $('merged'), dpiRow: $('dpiRow'), dpi: $('dpi'), pending: $('pending'), place: $('place'), open: $('open'), alwaysHome: $('alwaysHome'), note: $('note') };
  var state = { app: 'photoshop', home: '', sep: '/', root: '', scriptPath: '', online: false, pendingCount: 0, busy: false, prefs: { merged: false, alwaysHome: false, dpi: 150 } };
  var ONLINE_MS = 60000;
  var POLL_MS = 3000;

  function note(text, kind) { el.note.textContent = text; el.note.className = 'note' + (kind ? ' ' + kind : ''); }
  function join(a, b) { return a + state.sep + b; }

  /* ---------- 宿主识别 + 主题 ---------- */
  var env = {};
  try { env = JSON.parse(cep.getHostEnvironment()); } catch (e) {}
  state.app = /ILST/i.test(String(env.appName || '')) ? 'illustrator' : 'photoshop';
  var LABEL = state.app === 'illustrator' ? 'Illustrator' : 'Photoshop';
  var NS = state.app === 'illustrator' ? 'ai' : 'ps';
  if (state.app === 'illustrator') { el.dpiRow.style.display = ''; el.merged.parentNode.style.display = 'none'; el.send.textContent = '发送选中对象 → 画布'; el.sendDoc.textContent = '发送整个画板 (.ai 副本)'; }
  try {
    var c = env.appSkinInfo && env.appSkinInfo.panelBackgroundColor && env.appSkinInfo.panelBackgroundColor.color;
    if (c) {
      document.body.style.background = 'rgb(' + Math.round(c.red) + ',' + Math.round(c.green) + ',' + Math.round(c.blue) + ')';
      var lum = (0.299 * c.red + 0.587 * c.green + 0.114 * c.blue) / 255;
      if (lum > 0.6) { document.body.style.color = '#1f2937'; }
    }
  } catch (e2) {}

  /* ---------- 文件读写（cep.fs 同步 API，返回 {err, data}） ---------- */
  function readText(path) { if (!cfs) return null; var r = cfs.readFile(path, UTF8); return r && r.err === 0 ? r.data : null; }
  function readJSON(path) { var t = readText(path); if (!t) return null; try { return JSON.parse(t.replace(/^\uFEFF/, '')); } catch (e) { return null; } }
  function writeJSON(path, obj) { if (!cfs) return; cfs.writeFile(path, JSON.stringify(obj, null, 2), UTF8); }
  function listDir(path) { if (!cfs) return []; var r = cfs.readdir(path); return r && r.err === 0 && r.data ? r.data : []; }

  /* ---------- 协议：握手 / 发件箱 ---------- */
  function handshake() { return state.root ? readJSON(join(state.root, 'bridge.json')) : null; }
  function computeStatus() {
    var h = handshake();
    if (!h) return { online: false, reason: '未找到 bridge.json：DSH 未安装画布插件，或从未打开过画布', handshake: null };
    if (Number(h.protocol) !== 1) return { online: false, reason: '协议版本不匹配（面板 1 / 插件 ' + h.protocol + '），请更新桥接脚本', handshake: h };
    if (Date.now() - Number(h.updatedAt || 0) > ONLINE_MS) return { online: false, reason: 'DSH 离线或画布不可见（心跳超时）', handshake: h };
    if (!h.project) return { online: false, reason: '画布还没有绑定项目', handshake: h };
    return { online: true, reason: '', handshake: h };
  }
  function pendingCount(h) {
    if (!h || !h.outbox) return 0;
    var names = listDir(h.outbox), n = 0;
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      if (!/\.json$/i.test(name) || /\.(done|failed)\.json$/i.test(name)) continue;
      var m = readJSON(join(h.outbox, name));
      if (m && Number(m.protocol) === 1 && (!m.targetApp || m.targetApp === state.app)) n++;
    }
    return n;
  }

  /* ---------- 偏好（与 ExtendScript 面板共用 panel-prefs.json） ---------- */
  function loadPrefs() {
    var all = readJSON(join(state.root, 'panel-prefs.json')) || {};
    var mine = all[state.app] || {};
    state.prefs.merged = !!mine.merged; state.prefs.alwaysHome = !!mine.alwaysHome; state.prefs.dpi = Number(mine.dpi) || 150;
    el.merged.checked = state.prefs.merged; el.alwaysHome.checked = state.prefs.alwaysHome; el.dpi.value = String(state.prefs.dpi);
  }
  function savePrefs() {
    var all = readJSON(join(state.root, 'panel-prefs.json')) || {};
    all[state.app] = { merged: state.prefs.merged, alwaysHome: state.prefs.alwaysHome, dpi: state.prefs.dpi };
    writeJSON(join(state.root, 'panel-prefs.json'), all);
  }

  /* ---------- evalScript：调用 jsx 里的无头函数 ---------- */
  function evalScript(src, cb) {
    try { cep.evalScript(src, function (r) { cb(String(r === undefined || r === null ? '' : r)); }); }
    catch (e) { cb('ERR:' + (e && e.message ? e.message : e)); }
  }
  /* pre：调用前执行的语句（如同步 prefs 到 jsx）；expr：返回值表达式 */
  function callBridge(pre, expr, cb) {
    var src = '$.global.DSH_BRIDGE_HEADLESS = true;\n'
      + '(function () { try {\n'
      + '  if (typeof DSH_BRIDGE === "undefined" || !DSH_BRIDGE.' + NS + ') $.evalFile(new File(' + JSON.stringify(state.scriptPath) + '));\n'
      + '  if (typeof DSH_BRIDGE === "undefined" || !DSH_BRIDGE.' + NS + ') return "ERR:桥接脚本未加载：" + ' + JSON.stringify(state.scriptPath) + ';\n'
      + '  ' + (pre || '') + '\n'
      + '  return "OK:" + String(' + expr + ');\n'
      + '} catch (e) { return "ERR:" + String(e && e.message ? e.message : e); } })();';
    evalScript(src, function (out) {
      if (out.indexOf('OK:') === 0) cb(null, out.slice(3));
      else if (out.indexOf('ERR:') === 0) cb(new Error(out.slice(4)));
      else cb(new Error(out === 'EvalScript error.' ? LABEL + ' 脚本执行出错（看 script-log.txt）' : (out || LABEL + ' 没有返回结果')));
    });
  }
  function run(label, pre, expr) {
    if (state.busy) return;
    state.busy = true;
    note('正在' + label + '…');
    setButtons();
    callBridge(pre, expr, function (err, value) {
      state.busy = false;
      if (err) note('⚠ ' + label + '失败：' + err.message, 'err');
      else note('✓ ' + label + '：' + value + ' 项' + (label.indexOf('发送') === 0 ? '，约 3 秒后出现在画布' : ''), 'ok');
      refresh();
    });
  }

  /* ---------- 状态刷新（每 3 秒；面板常驻，不挡应用） ---------- */
  function setButtons() {
    var can = !state.busy;
    el.send.disabled = el.sendDoc.disabled = !(can && state.online);
    el.place.disabled = el.open.disabled = !(can && state.pendingCount > 0);
  }
  function refresh() {
    if (!state.root) return;
    var s = computeStatus();
    state.online = s.online;
    el.dot.className = 'dot ' + (s.online ? 'on' : 'off');
    el.status.textContent = s.online ? '已连接 DSH 画布' : '离线：' + s.reason;
    el.project.textContent = '项目：' + (s.handshake && s.handshake.project ? (s.handshake.project.name || s.handshake.project.dir) : '—');
    state.pendingCount = pendingCount(s.handshake);
    el.pending.textContent = state.pendingCount ? ('📥 发件箱有 ' + state.pendingCount + ' 个返回件待置入') : '发件箱：暂无新返回件';
    el.pending.className = 'pending' + (state.pendingCount ? ' has' : '');
    setButtons();
  }

  /* ---------- 按钮 ---------- */
  el.send.onclick = function () {
    if (state.app === 'photoshop') run('发送选中图层', '', 'DSH_BRIDGE.ps.sendSelection(' + (state.prefs.merged ? 'true' : 'false') + ')');
    else run('发送选中对象', '', 'DSH_BRIDGE.ai.sendSelection(' + (Number(state.prefs.dpi) || 150) + ')');
  };
  el.sendDoc.onclick = function () {
    if (state.app === 'photoshop') run('发送整个文档', '', 'DSH_BRIDGE.ps.sendDocument()');
    else run('发送整个画板', '', 'DSH_BRIDGE.ai.sendArtboard()');
  };
  var syncHome = function () { return 'DSH_BRIDGE.' + NS + '.prefs.alwaysHome = ' + (state.prefs.alwaysHome ? 'true' : 'false') + ';'; };
  el.place.onclick = function () { run('置入', syncHome(), 'DSH_BRIDGE.' + NS + '.importPending("place")'); };
  el.open.onclick = function () { run('打开', syncHome(), 'DSH_BRIDGE.' + NS + '.importPending("open")'); };
  el.merged.onchange = function () { state.prefs.merged = el.merged.checked; savePrefs(); };
  el.alwaysHome.onchange = function () { state.prefs.alwaysHome = el.alwaysHome.checked; savePrefs(); };
  el.dpi.onchange = function () { state.prefs.dpi = Number(el.dpi.value) || 150; savePrefs(); };

  /* ---------- 启动：问宿主用户目录 → 定位桥接根与脚本 ---------- */
  if (!cep || !cfs) { note('⚠ 不在 Adobe CEP 环境中运行', 'err'); return; }
  evalScript('Folder("~").fsName', function (home) {
    home = String(home || '');
    if (!home || /EvalScript error/.test(home)) { note('⚠ 无法获取用户目录', 'err'); return; }
    state.home = home;
    state.sep = home.indexOf('\\') >= 0 ? '\\' : '/';
    state.root = [home, '.dsh', 'canvas-workbench', 'adobe-bridge'].join(state.sep);
    state.scriptPath = [state.root, 'scripts', state.app === 'illustrator' ? 'DSH画布桥接-Illustrator.jsx' : 'DSH画布桥接-Photoshop.jsx'].join(state.sep);
    if (!readText(state.scriptPath)) note('⚠ 找不到桥接脚本：' + state.scriptPath + '（请启动一次 DSH 画布，它会自动生成）', 'err');
    loadPrefs();
    refresh();
    setInterval(refresh, POLL_MS);
  });
})();
