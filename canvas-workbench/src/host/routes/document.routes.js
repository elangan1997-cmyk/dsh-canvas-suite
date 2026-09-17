// PSD / AI 文档的图层级编辑（v1.8 新增）：
//   POST /dsh-canvas/document-layers  → 列图层（PSD 用 psd-tools 纯 Python；AI 用 Illustrator 脚本）
//   POST /dsh-canvas/edit-layer       → 提取指定图层为整幅透明 PNG（临时，不进画布）→ 引擎按提示词编辑
//                                      →（规范化为真 PNG 并缩放回画布尺寸）→ Adobe 脚本**原位**写回该图层
//                                      → 另存新版本（-图层编辑.psd/.ai）加入画布，不覆盖原件
// 两条 Adobe 实战教训（都有现场复现）：
//   1) Photoshop/Illustrator 对中文目录文件 app.open 会报“打开选项不正确”——所有 Adobe 交互
//      文件（源文件副本、模型输出、写回产物）一律放 ASCII 系统临时目录，结束后只把字节搬回项目；
//   2) 脚本报错可能以模态弹窗出现并卡死 AppleEvent——脚本开头 displayDialogs=NO /
//      userInteractionLevel=DONTDISPLAYALERTS，并保存恢复。
import { cp, mkdir, readdir, readFile, realpath, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { expandHome } from '../../shared/utils/paths.js';
import { readBody, respond } from '../server/http.js';
import { isMac, resolvePython } from '../../../lib/platform.js';
import { extOf } from '../../shared/utils/image-types.js';
import { decodeImageData, safeImageName } from '../../shared/utils/data-url.js';
import { generateImage } from '../../providers/image-engine.js';
import { readImageEngineSettings } from '../../host/services/image-engine-settings.js';
import { PLUGIN_ROOT } from '../vendor-assets.js';

export function register(router, h) {
  const { ctx, projectDirectory, previewUrl, runProcessWithTimeout, writeManagedSource } = h;
  const json = (res, CORS, status, payload) => respond(res, status, { ...CORS, 'content-type': 'application/json' }, JSON.stringify(payload));
  const jsonNoStore = (res, CORS, status, payload) => respond(res, status, { ...CORS, 'content-type': 'application/json', 'cache-control': 'no-store' }, JSON.stringify(payload));

  /**
   * 只读 AI 流程（列图层/缩略图/提取图层）的诊断落盘：临时目录一个小 JSON。
   * 这些流程的失败以前被层层 try/catch 吞掉，界面上只表现为“没有预览”“没有反应”，
   * 事后无法核对。这里把关闭方式、缩略图成功项与首个错误留下，方便直接读文件定位。
   * 只写 tmpdir，不进用户项目。
   */
  async function writeAiDiag(payload) {
    const file = join(tmpdir(), 'dsh-canvas-ai-diag.json');
    try {
      let history = [];
      try { history = JSON.parse(await readFile(file, 'utf8')); } catch (err) { history = []; }
      if (!Array.isArray(history)) history = [];
      history.push({ at: new Date().toISOString(), ...payload });
      // 只留最近 8 条：列图层和提取图层是两次调用，覆盖写会丢掉前一次的耗时。
      await writeFile(file, JSON.stringify(history.slice(-8), null, 0), 'utf8');
    } catch (err) {}
  }

  /**
   * 运行 Illustrator JSX 主体（body-only）：自动包 #target、禁弹窗、恢复；stdout 为脚本返回值。
   *
   * 收尾关闭分两种，取决于本次打开的是什么文档：
   *   - 只读流程（列图层/缩略图/提取图层）打开的是 ASCII 临时**副本**，传 `openPath` —— 按文件精确
   *     关闭，绝不碰用户自己打开的稿件；同时默认不 activate，避免把 Illustrator 抢到前台再关闭，
   *     用户看到的就是“跳转到 AI→打开→立刻关闭”的闪烁。
   *   - 生成/写回流程打开的都是脚本自建的临时文档，维持原来的整体清场（已通过真机验收）。
   * Illustrator 2026 的 ExtendScript 没有 CloseOptions，`doc.close` 容易抛错，因此脚本内先尽力自关，
   * 宿主再用 AppleScript 兜底。
   */
  async function runIllustratorJsx(body, workDir, timeoutMs = 240000, opts = {}) {
    const activate = opts.activate === true;
    const openPath = String(opts.openPath || '');
    const noFinalClose = opts.noFinalClose === true;
    const jsx = '#target illustrator\n'
      + '(function(){\n'
      + 'var prevUA=null;try{prevUA=app.userInteractionLevel;app.userInteractionLevel=UserInteractionLevel.DONTDISPLAYALERTS;}catch(eU){}\n'
      + 'var r=null;\n'
      + 'try{ r=(function(){\n' + body + '\n})(); }\n'
      + 'catch(err){ r="ERR "+String(err); }\n'
      + 'try{if(prevUA!==null)app.userInteractionLevel=prevUA;}catch(eU2){}\n'
      + 'return r; })();\n';
    const osascript = await ctx.subprocess.resolveExecutable('osascript');
    const jsxPath = join(workDir, '.dsh-ai-jsx-' + Date.now() + '-' + Math.random().toString(16).slice(2) + '.jsx');
    const appleScriptPath = jsxPath + '.applescript';
    await writeFile(jsxPath, jsx, 'utf8');
    await writeFile(appleScriptPath, 'tell application id "com.adobe.Illustrator"\n' + (activate ? 'activate\n' : '')
      + 'do javascript (read POSIX file ' + JSON.stringify(jsxPath) + ' as «class utf8»)\nend tell\n', 'utf8');
    try {
      return await runProcessWithTimeout(osascript, [appleScriptPath], workDir, timeoutMs);
    } finally {
      await unlink(jsxPath).catch(() => {});
      await unlink(appleScriptPath).catch(() => {});
      const closeScript = openPath
        ? 'tell application id "com.adobe.Illustrator"\ntry\nclose (every document whose file is POSIX file ' + JSON.stringify(openPath) + ') saving no\nend try\nend tell\n'
        : 'tell application id "com.adobe.Illustrator"\nclose every document saving no\nend tell\n';
      if (!noFinalClose) await runProcessWithTimeout(osascript, ['-e', closeScript], workDir, 30000).catch(() => {});
    }
  }

  /**
   * 预检（替代旧版"请先手动关闭"确认弹窗）：目标 .ai 若开在 Illustrator 里，
   * 用脚本**保存并关闭**再继续；没打开就直接往下走。
   */
  async function ensureAiSavedClosed(path, workDir) {
    try {
      // Illustrator 2026 的 AppleScript 取不到 document 的 file/full name（coercion 全家报错），
      // 但 ExtendScript 的 Document.fullName / SaveOptions.DONOTSAVECHANGES 都是可靠的。
      // 按完整路径精确匹配；路径读不到时退化为按文件名匹配（临时副本同名也无害：一并保存关闭）。
      // realpath 归一：/var 是 /private/var 的符号链接，fullName 返回后者
      let wantAi = path;
      try { wantAi = await realpath(path); } catch (errRp) {}
      const body = [
        'var want=' + JSON.stringify(String(wantAi).replace(/\\/g, '/')) + ';',
        'var wantName=want.split("/").pop();',
        'var closed=0, saved=0;',
        'for(var i=app.documents.length-1;i>=0;i--){',
        '  var d=null; try{ d=app.documents[i]; }catch(eD){ continue; }',
        '  if(!d){ continue; }',
        '  var match=false;',
        '  try{ match=(String(d.fullName).replace(/\\\\/g,"/")===want); }catch(eF){}',
        '  if(!match){ try{ match=(String(d.name)===wantName); }catch(eN2){} }',
        '  if(match){',
        '    try{ app.activeDocument=d; }catch(eA){}',
        '    try{ d.save(); saved++; }catch(eS){}',
        '    try{ app.activeDocument=d; d.close(SaveOptions.DONOTSAVECHANGES); closed++; }catch(eC){ try{ d.close(2); closed++; }catch(eC2){} }',
        '  }',
        '}',
        'return "OK saved="+saved+" closed="+closed;'
      ].join('\n');
      const r = await runIllustratorJsx(body, workDir, 60000, { noFinalClose: true });
      return String(r.stdout || '').trim();
    } catch (err) {
      return 'preflight-failed: ' + String((err && err.message) || err).slice(0, 80);
    }
  }

  /**
   * 只读遍历一个 .ai（打开 ASCII 副本）：一次打开同时拿到图层清单与逐层缩略图，返回纯文本协议。
   * 第一行 `OK<TAB>关闭方式<TAB>缩略图索引<TAB>首个截屏错误`，其后每行 `L<TAB>字段…`。
   * 关键点（相对旧的两次 open/close 实现）：
   *   1) 不再跳过文字对象——文字层也能截到真实预览，设计师才认得出是哪一层；
   *   2) 文字对象把 `contents` 作为兜底名，避免整屏“图层 1/2/3”无法辨认；
   *   3) 截屏固定 72dpi（原 24dpi 会静默失败）并保留首选/降级两次尝试，失败原因必须回报。
   */
  function aiReadJsx(copyPath, captureDir) {
    const prefix = (captureDir + '/thumb-').replace(/\\/g, '/');
    // 注意：这里拼出的是 JSX 里的字符串拼接 `new File("<前缀>"+k+".png")`，
    // 不能写成 '"+k+".png"'——那会生成 `File("…-""+k+".png")` 的语法错误，
    // 整段 JSX 直接解析失败、什么也截不到（旧实现就是这么静默失败的）。
    const fileExpr = 'new File(' + JSON.stringify(prefix) + '+k+".png")';
    return [
      'var doc=app.open(new File(' + JSON.stringify(copyPath) + '));',
      'var ab=doc.artboards[0].artboardRect; var W=Math.round(ab[2]-ab[0]), H=Math.round(ab[1]-ab[3]);',
      'var items=doc.pageItems; var n=items.length; var rows=[]; var bnds=[];',
      'for(var i=0;i<n;i++){',
      '  var it=items[i]; var tn=String(it.typename); var vb=null;',
      '  try{ vb=it.visibleBounds; }catch(eV){ vb=[ab[0],ab[1],ab[0],ab[1]]; }',
      '  bnds.push([vb[0],vb[1],vb[2],vb[3]]);',
      '  var nm=String(it.name||("图层 "+(i+1))).replace(/[\\t\\r\\n]+/g," ");',
      '  var tx="";',
      '  if(tn==="TextFrame"){ try{ tx=String(it.contents===undefined?"":it.contents).replace(/[\\t\\r\\n]+/g," "); }catch(eT){} if(tx&&!it.name){ nm=tx; } }',
      '  rows.push("L\\t"+i+"\\t"+nm+"\\t"+tn+"\\t"+((it.hidden!==true)?"1":"0")+"\\t"',
      '    +Math.round(vb[0]-ab[0])+"\\t"+Math.round(ab[1]-vb[1])+"\\t"+Math.round(vb[2]-vb[0])+"\\t"+Math.round(ab[1]-vb[3])',
      '    +"\\t"+W+"\\t"+H+"\\t"+tx);',
      '}',
      'var states=[]; for(var s=0;s<n;s++){ try{ states.push(items[s].hidden); }catch(eST){ states.push(false); } }',
      'var thumbs=[]; var terr=""; var warn=""; var res=24;',
      'for(var k=0;k<n && thumbs.length<12;k++){',
      '  for(var m=0;m<n;m++){ try{ items[m].hidden=(m===k)?false:true; }catch(eH){} }',
      '  // 缩略图只渲染该元素自己的范围（+2pt 余量）而不是整块画板：栅格面积小一两个数量级，',
      '  // 这是「读图层要等很久」的主因。元素范围退化时退回整块画板。',
      '  var b=bnds[k]; var rc=[b[0]-2, b[1]+2, b[2]+2, b[3]-2];',
      '  if(!(rc[2]-rc[0] > 1 && rc[1]-rc[3] > 1)){ rc=[ab[0],ab[1],ab[2],ab[3]]; }',
      '  var ok=false;',
      '  // ImageCaptureOptions.resolution 有下限：实测 24 会被拒绝',
      '  // （Specified value less than minimum allowed value），逐级升 36/72 再试；',
      '  // 成功档位记进 warn，便于事后核对实际用的是哪一档。',
      '  for(var t=0;t<3 && !ok;t++){',
      '    try{',
      '      var oo=new ImageCaptureOptions(); oo.resolution=res; oo.transparency=true;',
      '      doc.imageCapture(' + fileExpr + ', rc, oo); ok=true; warn=("res"+res);',
      '    }catch(eA){',
      '      if(!terr){ terr=(("res"+res+" ")+String(eA)).replace(/[\\t\\r\\n]+/g," "); }',
      '      if(res<36){ res=36; } else if(res<72){ res=72; } else { break; }',
      '    }',
      '  }',
      '  if(!ok){',
      '    try{ doc.imageCapture(' + fileExpr + ', rc); ok=true; warn="plain"; }',
      '    catch(eB){ terr=("plain "+String(eB)).replace(/[\\t\\r\\n]+/g," "); }',
      '  }',
      '  if(ok){ thumbs.push(k); }',
      '}',
      'for(var q=0;q<n;q++){ try{ items[q].hidden=states[q]; }catch(eRS){} }',
      'var cs="none";',
      'try{ doc.close(SaveOptions.DONOTSAVECHANGES); cs="SaveOptions"; }',
      'catch(eC1){ try{ doc.close(CloseOptions.DONTSAVECHANGES); cs="CloseOptions"; }',
      'catch(eC2){ try{ doc.close(2); cs="num2"; }',
      'catch(eC3){ try{ doc.close(); cs="noarg"; }catch(eC4){ cs=("fail "+String(eC4)).replace(/[\\t\\r\\n]+/g," "); } } } }',
      'return "OK\\t"+cs+"\\t"+thumbs.join(",")+"\\t"+terr+"\\t"+warn+"\\n"+rows.join("\\n");'
    ].join('\n');
  }

  /** 解析 aiReadJsx 的文本协议；任何解析失败都退化为「无图层 + 错误原因」，不静默。 */
  function parseAiRead(stdout) {
    const text = String(stdout || '');
    const meta = /^OK\t([^\t]*)\t([\d,]*)\t([^\t]*)\t?([^\n]*)/.exec(text);
    const res = { layers: [], close: meta ? meta[1] : '', thumbs: meta && meta[2] ? meta[2].split(',').filter(Boolean).map(Number) : [], err: '', warn: '' };
    if (!meta) { res.err = text.trim().slice(0, 220); return res; }
    res.err = String(meta[3] || '').trim();
    res.warn = String(meta[4] || '').trim();
    for (const line of text.split(/\r?\n/).filter((l) => l.startsWith('L\t'))) {
      const f = line.split('\t');
      if (f.length >= 12) {
        res.layers.push({
          id: Number(f[1]), name: f[2], kind: f[3], visible: f[4] === '1',
          x: Number(f[5]), y: Number(f[6]), w: Number(f[7]), h: Number(f[8]),
          canvas: [Number(f[9]), Number(f[10])], text: f[11] || ''
        });
      }
    }
    return res;
  }

  /** 运行 Photoshop JSX（完整脚本字符串）。 */
  async function runPhotoshopJsx(jsx, workDir, timeoutMs = 300000, opts = {}) {
    const activate = opts.activate === true;
    const closeNames = Array.isArray(opts.closeNames) ? opts.closeNames : [];
    const noFinalClose = opts.noFinalClose === true;
    const osascript = await ctx.subprocess.resolveExecutable('osascript');
    const jsxPath = join(workDir, '.dsh-ps-jsx-' + Date.now() + '-' + Math.random().toString(16).slice(2) + '.jsx');
    const appleScriptPath = jsxPath + '.dsh.applescript';
    await writeFile(jsxPath, jsx, 'utf8');
    await writeFile(appleScriptPath, 'tell application id "com.adobe.Photoshop"\n' + (activate ? 'activate\n' : '') + 'do javascript (read POSIX file ' + JSON.stringify(jsxPath) + ' as «class utf8»)\nend tell\n', 'utf8');
    try {
      return await runProcessWithTimeout(osascript, [appleScriptPath], workDir, timeoutMs);
    } finally {
      await unlink(jsxPath).catch(() => {});
      await unlink(appleScriptPath).catch(() => {});
      // 绝不能“close every document”：用户自己的稿（含未保存修改）会被无提示丢弃。
      // 只兜底关我们本次打开的文件名对应的文档（脚本内正常路径已自行 close，这只是崩溃兜底）。
      if (!noFinalClose && closeNames.length) {
        for (const name of closeNames) {
          const closeScript = 'tell application id "com.adobe.Photoshop"\ntry\nclose (every document whose name is ' + JSON.stringify(name) + ') saving no\nend try\nend tell\n';
          await runProcessWithTimeout(osascript, ['-e', closeScript], workDir, 30000).catch(() => {});
        }
      }
    }
  }

  /**
   * PSD 预检（与 ensureAiSavedClosed 同语义）：目标 .psd 若开在 Photoshop 里，
   * 先保存再关闭；保存失败（如从未落盘的新建文档）就不关，绝不丢用户未保存的工作。
   */
  async function ensurePsdSavedClosed(path, workDir) {
    try {
      let wantPsd = path;
      try { wantPsd = await realpath(path); } catch (errRp2) {}
      const body = [
        'var want=' + JSON.stringify(String(wantPsd).replace(/\\/g, '/')) + ';',
        'var wantName=want.split("/").pop();',
        'var saved=0, closed=0;',
        'for(var i=app.documents.length-1;i>=0;i--){',
        '  var d=null; try{ d=app.documents[i]; }catch(eD){ continue; }',
        '  if(!d){ continue; }',
        '  var match=false;',
        '  try{ match=(String(d.fullName).replace(/\\\\/g,"/")===want); }catch(eF){}',
        '  if(!match){ try{ match=(String(d.name)===wantName); }catch(eN2){} }',
        '  if(!match){ continue; }',
        '  var ok=false;',
        // Photoshop 的 save/close 都要求目标文档是 activeDocument
        '  try{ app.activeDocument=d; }catch(eA){}',
        '  try{ d.save(); saved++; ok=true; }catch(eS){}',
        // 只有保存成功才关：保存失败说明文档可能从未落盘，关掉=丢未保存工作
        '  if(ok){ try{ app.activeDocument=d; d.close(SaveOptions.DONOTSAVECHANGES); closed++; }catch(eC){} }',
        '}',
        'return "OK saved="+saved+" closed="+closed;'
      ].join('\n');
      const jsx = '#target photoshop\n(function(){\ntry{ ' + body + ' }catch(err){ return "ERR "+String(err); }\n})();\n';
      const r = await runPhotoshopJsx(jsx, workDir, 60000, { noFinalClose: true });
      return String(r.stdout || '').trim();
    } catch (err) {
      return 'preflight-failed: ' + String((err && err.message) || err).slice(0, 80);
    }
  }

  // ── 图层列表 ────────────────────────────────────────────────────────────
  router.add({ method: 'POST', path: '/dsh-canvas/document-layers', prefix: false }, async (req, res, { CORS }) => {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const path = expandHome(String(body.path || ''));
      const ext = extOf(path);
      if (!path || (ext !== 'psd' && ext !== 'ai' && ext !== 'svg')) { json(res, CORS, 400, { ok: false, error: '仅支持 .psd / .ai / .svg 文件' }); return; }
      let layers = [];
      let aiRead = null;
      if (ext === 'psd') await ensurePsdSavedClosed(path, dirname(path));
      if (ext === 'psd') {
        const python = await resolvePython(ctx);
        const r = await runProcessWithTimeout(python.executable, [...python.prefixArgs, join(PLUGIN_ROOT, 'scripts', 'psd_layers.py'), '--psd', path, '--list'], PLUGIN_ROOT, 120000);
        if (r.exitCode !== 0) throw new Error(String(r.stderr || '').trim() || 'PSD 图层读取失败');
        layers = String(r.stdout || '').trim().split(/\r?\n/).filter(Boolean).map((line) => { try { return JSON.parse(line); } catch (err) { return null; } }).filter(Boolean);
      } else if (ext === 'svg') {
        const python = await resolvePython(ctx);
        const r = await runProcessWithTimeout(python.executable, [...python.prefixArgs, join(PLUGIN_ROOT, 'scripts', 'svg_layers.py'), '--svg', path, '--list'], PLUGIN_ROOT, 60000);
        if (r.exitCode !== 0) throw new Error(String(r.stderr || '').trim() || 'SVG 图层读取失败');
        layers = String(r.stdout || '').trim().split(/\r?\n/).filter(Boolean).map((line) => { try { return JSON.parse(line); } catch (err) { return null; } }).filter(Boolean);
      } else {
        if (!isMac) { json(res, CORS, 500, { ok: false, error: 'AI 文件图层读取需要 macOS 上的 Illustrator' }); return; }
        await ensureAiSavedClosed(path, dirname(path));
        // 只读遍历开的是 ASCII 临时副本：用户稿件不会被 Illustrator 打开，收尾也只关这一份副本。
        const readDir = join(tmpdir(), 'dsh-canvas-ai-read-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
        await mkdir(readDir, { recursive: true });
        const readCopy = join(readDir, 'source.ai');
        try {
          const copyMs = Date.now();
          await cp(path, readCopy);
          const copyDone = Date.now();
          const r = await runIllustratorJsx(aiReadJsx(readCopy, readDir), readDir, 300000, { openPath: readCopy });
          const jsxDone = Date.now();
          const read = parseAiRead(String(r.stdout || ''));
          layers = read.layers;
          // 缩略图字节必须在删临时目录之前读出来
          for (const id of read.thumbs) {
            try {
              const bytes = await readFile(join(readDir, 'thumb-' + id + '.png'));
              const layer = layers.find((l) => l.id === id);
              if (layer && bytes.length) layer.thumb = 'data:image/png;base64,' + bytes.toString('base64');
            } catch (err) {}
          }
          aiRead = read;
          await writeAiDiag({
            route: 'document-layers', file: path, copy: readCopy, close: read.close, layers: layers.length,
            thumbs: read.thumbs.length, err: read.err, warn: read.warn, fallback: read.warn,
            msCopy: copyDone - copyMs, msJsx: jsxDone - copyDone,
            thumbBytes: layers.filter((l) => l.thumb).map((l) => (l.thumb || '').length),
            stdoutHead: String(r.stdout || '').slice(0, 300)
          });
          if (!layers.length) throw new Error('Illustrator 图层读取失败：' + String(read.err || r.stderr || '').trim().slice(0, 200));
        } finally {
          await rm(readDir, { recursive: true, force: true }).catch(() => {});
        }
      }
      // 缩略图：PSD/SVG 走纯 Python；AI 已在上面的单次只读遍历里一并完成
      try {
        const projectDirForThumbs = projectDirectory(body.cwd, body.project);
        const thumbsDir = projectDirForThumbs ? join(projectDirForThumbs, 'outputs', '.图片编辑临时', 'layer-thumbs-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)) : '';
        if (thumbsDir) await mkdir(thumbsDir, { recursive: true });
        if (thumbsDir && ext === 'psd') {
          const pythonT = await resolvePython(ctx);
          const t = await runProcessWithTimeout(pythonT.executable, [...pythonT.prefixArgs, join(PLUGIN_ROOT, 'scripts', 'psd_layers.py'), '--psd', path, '--thumbs', '--outdir', thumbsDir], PLUGIN_ROOT, 180000);
          for (const line of String(t.stdout || '').trim().split(/\r?\n/).filter(Boolean)) {
            try {
              const item = JSON.parse(line);
              const bytes = await readFile(item.file);
              const layer = layers.find((l) => l.id === item.id);
              if (layer) layer.thumb = 'data:image/png;base64,' + bytes.toString('base64');
              await unlink(item.file).catch(() => {});
            } catch (err) {}
          }
        } else if (thumbsDir && ext === 'svg') {
          const pythonT = await resolvePython(ctx);
          const t = await runProcessWithTimeout(pythonT.executable, [...pythonT.prefixArgs, '-c',
            'import base64,io,sys,xml.etree.ElementTree as ET\n'
            + 'from PIL import Image\n'
            + 'root=ET.parse(sys.argv[1]).getroot()\n'
            + 'idx=0\n'
            + 'for image in root.iter("{http://www.w3.org/2000/svg}image"):\n'
            + '    href=image.get("{http://www.w3.org/1999/xlink}href") or ""\n'
            + '    data=href.split(",",1)[1] if href.startswith("data:") else ""\n'
            + '    if data:\n'
            + '        im=Image.open(io.BytesIO(base64.b64decode(data))).convert("RGBA")\n'
            + '        im.thumbnail((320,320))\n'
            + '        buf=io.BytesIO(); im.save(buf,format="PNG")\n'
            + '        print(str(idx)+"\\t"+base64.b64encode(buf.getvalue()).decode())\n'
            + '    idx+=1\n',
            path], PLUGIN_ROOT, 60000);
          for (const line of String(t.stdout || '').trim().split(/\r?\n/).filter(Boolean)) {
            const sep = line.indexOf('\t');
            const id = Number(line.slice(0, sep));
            const b64 = line.slice(sep + 1);
            const layer = layers.find((l) => l.id === id);
            if (layer && b64) layer.thumb = 'data:image/png;base64,' + b64;
          }
        }
        if (thumbsDir) await rm(thumbsDir, { recursive: true, force: true }).catch(() => {});
      } catch (err) { /* 缩略图失败不影响列表 */ }
      const missingThumbs = layers.filter((l) => !l.thumb).length;
      jsonNoStore(res, CORS, 200, {
        ok: true,
        layers,
        kind: ext,
        thumbNote: ext === 'ai' && missingThumbs
          ? (aiRead && aiRead.err
            ? '有 ' + missingThumbs + ' 层没截到预览（' + aiRead.err + '）'
            : '有 ' + missingThumbs + ' 层没截到预览')
          : ''
      });
    } catch (err) {
      json(res, CORS, 500, { ok: false, error: String((err && err.message) || err) });
    }
  });

  // ── 图层编辑 + 原位写回 ─────────────────────────────────────────────────
  router.add({ method: 'POST', path: '/dsh-canvas/edit-layer', prefix: false }, async (req, res, { CORS }) => {
    let tempExtract = '';
    let asciiDir = '';
    let tempPreparedMaskGlobal = '';
    let backupPath = '';
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const path = expandHome(String(body.path || ''));
      const ext = extOf(path);
      const layerId = Number(body.layerId);
      const prompt = String(body.prompt || '').trim().slice(0, 4000);
      const layerName = String(body.layerName || '').slice(0, 200);
      if (!path || (ext !== 'psd' && ext !== 'ai' && ext !== 'svg')) { json(res, CORS, 400, { ok: false, error: '仅支持 .psd / .ai / .svg 文件' }); return; }
      if (!Number.isInteger(layerId) || layerId < 0) { json(res, CORS, 400, { ok: false, error: '缺少图层' }); return; }
      if (!prompt && typeof body.maskData !== 'string') { json(res, CORS, 400, { ok: false, error: '请输入图层修改提示词或框选蒙版' }); return; }
      const projectDir = projectDirectory(body.cwd, body.project);
      if (!projectDir) throw new Error('当前聊天没有画布项目');
      const outputDir = join(projectDir, 'outputs', '.图片编辑临时');
      await mkdir(outputDir, { recursive: true });
      const token = Date.now() + '-' + Math.random().toString(16).slice(2);
      asciiDir = join(tmpdir(), 'dsh-canvas-layer-' + token);
      await mkdir(asciiDir, { recursive: true });

      // 1) 提取图层为整幅透明 PNG，并取得画布尺寸
      tempExtract = join(outputDir, '.layer-extract-' + token + '.png');
      let extractStdout = '';
      if (ext === 'psd') {
        const python = await resolvePython(ctx);
        const r = await runProcessWithTimeout(python.executable, [...python.prefixArgs, join(PLUGIN_ROOT, 'scripts', 'psd_layers.py'), '--psd', path, '--extract', '--id', String(layerId), '--output', tempExtract], PLUGIN_ROOT, 180000);
        if (r.exitCode !== 0) throw new Error(String(r.stderr || '').trim() || '图层提取失败');
        extractStdout = String(r.stdout || '');
      } else if (ext === 'svg') {
        // 提取 = 解码 SVG 内嵌背景位图（只支持编辑 Image 图层；文字对象请在编辑器里直接改）
        const pythonSvg = await resolvePython(ctx);
        const rSvg = await runProcessWithTimeout(pythonSvg.executable, [...pythonSvg.prefixArgs, '-c',
          'import base64,json,sys,xml.etree.ElementTree as ET\n'
          + 'root=ET.parse(sys.argv[1]).getroot()\n'
          + 'imgs=[e for e in root.iter("{http://www.w3.org/2000/svg}image")]\n'
          + 'href=imgs[0].get("{http://www.w3.org/1999/xlink}href") if imgs else ""\n'
          + 'data=href.split(",",1)[1] if href.startswith("data:") else ""\n'
          + 'open(sys.argv[2],"wb").write(base64.b64decode(data))\n'
          + 'print(json.dumps({"w":root.get("width"),"h":root.get("height")}))',
          path, tempExtract], PLUGIN_ROOT, 60000);
        if (rSvg.exitCode !== 0) throw new Error(String(rSvg.stderr || '').trim().slice(0, 200) || 'SVG 背景提取失败');
        const mSvg = /^\{"w":"?(\d+)"?,\s*"h":"?(\d+)"?\}$/.exec(String(rSvg.stdout || '').trim().replace(/\s+/g, ' '));
        extractStdout = mSvg ? JSON.stringify({ w: Number(mSvg[1]), h: Number(mSvg[2]) }) : String(rSvg.stdout || '');
      } else {
        if (!isMac) throw new Error('AI 文件图层编辑需要 macOS 上的 Illustrator');
        await ensureAiSavedClosed(path, outputDir);
        // 第一步只做「提取该图层」：打开 ASCII 副本（不碰用户稿件）、不抢前台、按文件精确关闭。
        // 原来这里是 'var states=[].'（语法错误）→ 整段 JSX 解析失败，.ai 图层编辑必然报
        // “Illustrator 图层提取失败”，且因为错误被吞掉看不出原因。
        const readCopyAi = join(asciiDir, 'source-ai-read.ai');
        await cp(path, readCopyAi);
        const body2 = [
          'var doc=app.open(new File(' + JSON.stringify(readCopyAi) + '));',
          'var ab=doc.artboards[0].artboardRect; var W=ab[2]-ab[0], H=ab[1]-ab[3];',
          'var items=doc.pageItems; var n=items.length;',
          'if(' + layerId + '>=n){ return "ERR layer index "+' + layerId + '+" of "+n; }',
          'var states=[];',
          'for(var i=0;i<n;i++){ try{ states.push(items[i].hidden); }catch(eST){ states.push(false); } }',
          'for(var j=0;j<n;j++){ try{ items[j].hidden=(j===' + layerId + ')?false:true; }catch(eH){} }',
          'var terr="";',
          'try{ var opts=new ImageCaptureOptions(); opts.resolution=72; opts.transparency=true;',
          '  doc.imageCapture(new File(' + JSON.stringify(tempExtract) + '), [ab[0], ab[1], ab[0]+W, ab[1]-H], opts); }',
          'catch(e1){ terr=("res72 "+String(e1)).replace(/[\\t\\r\\n]+/g," ");',
          '  try{ doc.imageCapture(new File(' + JSON.stringify(tempExtract) + '), [ab[0], ab[1], ab[0]+W, ab[1]-H]); terr=""; }',
          '  catch(e2){ terr=("plain "+String(e2)).replace(/[\\t\\r\\n]+/g," "); } }',
          'for(var k=0;k<n;k++){ try{ items[k].hidden=states[k]; }catch(eRS){} }',
          'var cs="none";',
          'try{ doc.close(SaveOptions.DONOTSAVECHANGES); cs="SaveOptions"; }',
          'catch(eC1){ try{ doc.close(CloseOptions.DONTSAVECHANGES); cs="CloseOptions"; }',
          'catch(eC2){ try{ doc.close(2); cs="num2"; }',
          'catch(eC3){ try{ doc.close(); cs="noarg"; }catch(eC4){ cs=("fail "+String(eC4)).replace(/[\\t\\r\\n]+/g," "); } } } }',
          'return Math.round(W)+"x"+Math.round(H)+"\\t"+cs+"\\t"+terr;'
        ].join('\n');
        const r = await runIllustratorJsx(body2, asciiDir, 240000, { openPath: readCopyAi });
        const parts = String(r.stdout || '').trim().split('\t');
        const capErr = String(parts[2] || '').trim();
        await writeAiDiag({ route: 'edit-layer/extract', file: path, copy: readCopyAi, layerId, size: parts[0] || '', close: parts[1] || '', err: capErr, stdoutHead: String(r.stdout || '').slice(0, 300) });
        if (capErr) throw new Error('Illustrator 图层截屏失败：' + capErr);
        const m = /^(\d+)x(\d+)$/.exec(String(parts[0] || '').trim());
        if (!m) throw new Error('Illustrator 图层提取失败：' + String(r.stdout || r.stderr || '').trim().slice(0, 200));
        extractStdout = JSON.stringify({ w: Number(m[1]), h: Number(m[2]) });
      }
      const extracted = await readFile(tempExtract);
      if (!extracted.length) throw new Error('图层提取结果为空');
      let canvasW = 0, canvasH = 0;
      try {
        const lines = extractStdout.trim().split(/\r?\n/).filter(Boolean);
        const payload = JSON.parse(lines[lines.length - 1] || '{}');
        canvasW = Number(payload.canvas && payload.canvas[0]) || Number(payload.w) || 0;
        canvasH = Number(payload.canvas && payload.canvas[1]) || Number(payload.h) || 0;
      } catch (err) {}
      if (!canvasW || !canvasH) throw new Error('无法确定画布尺寸');

      // 2) 引擎编辑整幅；带蒙版时走擦除语义（膨胀 + 合成保护未选区域）
      let tempPreparedMask = '';
      if (typeof body.maskData === 'string' && body.maskData.startsWith('data:image/')) {
        try {
          const decodedMask = decodeImageData(body.maskData);
          if (!decodedMask) throw new Error('蒙版数据无效');
          const rawMask = join(outputDir, '.layer-mask-raw-' + token + '.png');
          await writeFile(rawMask, decodedMask.bytes);
          tempPreparedMask = join(outputDir, '.layer-mask-' + token + '.png');
          const pythonM = await resolvePython(ctx);
          const prepared = await runProcessWithTimeout(pythonM.executable, [...pythonM.prefixArgs, join(PLUGIN_ROOT, 'scripts', 'prepare_mask.py'), '--source', tempExtract, '--mask', rawMask, '--output', tempPreparedMask], PLUGIN_ROOT, 120000);
          await unlink(rawMask).catch(() => {});
          if (prepared.exitCode !== 0) tempPreparedMask = '';
        } catch (err) { tempPreparedMask = ''; }
      }
      tempPreparedMaskGlobal = tempPreparedMask;
      const editPrompt = '用户正在编辑设计稿的其中一个图层，下图是该图层在整幅画布上的独立呈现（其余图层已隐藏）。' + (tempPreparedMask
        ? ('这是严格局部的擦除任务，透明蒙版区域是唯一允许编辑的区域。' + (prompt ? ('用户要求：' + prompt + '。') : '请擦除所选区域并按四周内容智能补全背景。') + '区域外逐像素保持不变，不要生成新文字。')
        : ('用户要求：' + prompt + '。请只针对该图层内容修改；保持画布尺寸、构图与未提及内容不变，不要添加文字或装饰，输出与输入同尺寸的图片。'));
      const engineSettings = await readImageEngineSettings();
      const generated = await generateImage({ ctx, image: extracted, prompt: editPrompt, mask: tempPreparedMask ? await readFile(tempPreparedMask) : undefined, engine: engineSettings.engine, signal: AbortSignal.timeout(900000) });

      // 3) 规范化：模型输出可能是 WEBP/JPEG 字节且分辨率常与画布不一致 → 真 PNG + 缩放回画布尺寸，落 ASCII 目录
      const asciiSource = join(asciiDir, 'source.' + ext);
      await cp(path, asciiSource);
      const tempRaw = join(asciiDir, 'edited.raw');
      const tempEdited = join(asciiDir, 'edited.png');
      await writeFile(tempRaw, generated.bytes);
      let normalizeInput = tempRaw;
      if (tempPreparedMask) {
        const composited = join(asciiDir, 'composited.png');
        const pythonC = await resolvePython(ctx);
        const comp = await runProcessWithTimeout(pythonC.executable, [...pythonC.prefixArgs, join(PLUGIN_ROOT, 'scripts', 'composite_edit.py'), '--source', tempExtract, '--generated', tempRaw, '--mask', tempPreparedMask, '--output', composited], PLUGIN_ROOT, 120000);
        if (comp.exitCode === 0) normalizeInput = composited;
      }
      const python2 = await resolvePython(ctx);
      const norm = await runProcessWithTimeout(python2.executable, [...python2.prefixArgs, join(PLUGIN_ROOT, 'scripts', 'normalize_image.py'), '--input', normalizeInput, '--output', tempEdited, '--resize', canvasW + 'x' + canvasH], PLUGIN_ROOT, 120000);
      await unlink(tempRaw).catch(() => {});
      if (norm.exitCode !== 0) throw new Error('模型输出规范化失败：' + String(norm.stderr || '').trim().slice(0, 160));

      // 4) Adobe 原位写回（ASCII 目录内完成）
      const originalName = safeImageName(body.name || basename(path));
      const dot = originalName.lastIndexOf('.');
      const base = dot > 0 ? originalName.slice(0, dot) : originalName;
      const tempOut = join(asciiDir, 'out.' + ext);
      if (ext === 'psd') await ensurePsdSavedClosed(path, outputDir);
      if (ext === 'psd') {
        const jsx = '#target photoshop\n'
          + '(function(){\n'
          + 'var step="start";\n'
          + 'function findLayer(c,n){for(var i=0;i<c.artLayers.length;i++){if(c.artLayers[i].name===n)return c.artLayers[i];}for(var j=0;j<c.layerSets.length;j++){var r=findLayer(c.layerSets[j],n);if(r)return r;}return null;}\n'
          + 'try{\n'
          + '  app.preferences.rulerUnits=Units.PIXELS;\n'
          + '  var prevD=app.displayDialogs; app.displayDialogs=DialogModes.NO;\n'
          + '  step="open-psd"; var doc=app.open(new File(' + JSON.stringify(asciiSource) + '));\n'
          + '  step="open-png"; var png=app.open(new File(' + JSON.stringify(tempEdited) + '));\n'
          + '  step="flatten-copy"; try{png.flatten();}catch(e0){} png.selection.selectAll(); png.selection.copy(); png.close(SaveOptions.DONOTSAVECHANGES);\n'
          + '  step="paste"; app.activeDocument=doc; var pasted=doc.paste(); pasted.name="__dsh_layer_update__";\n'
          + '  step="translate"; var b=pasted.bounds; pasted.translate(-b[0].as("px"), -b[1].as("px"));\n'
          // 与 .ai 相同语义（用户拍板）：不删除原图层，修改结果作为新层叠加在原图层之上；
          // move 后用 itemIndex 读回自检（成功时 pasted.index === target 原 index，target 顺延 +1）
          + '  step="replace"; var target=findLayer(doc,' + JSON.stringify(layerName || '__none__') + ');\n'
          + '  var zi=-1, ti=-1;\n'
          + '  if(target){ try{ ti=Number(target.itemIndex); }catch(eI){} pasted.move(target, ElementPlacement.PLACEBEFORE); try{ zi=Number(pasted.itemIndex); }catch(eI2){} pasted.name=' + JSON.stringify((layerName || '图层') + ' 修改版') + '; }\n'
          + '  else { pasted.name=' + JSON.stringify((layerName || '图层') + ' 修改版') + '; }\n'
          + '  step="save"; doc.saveAs(new File(' + JSON.stringify(tempOut) + '), new PhotoshopSaveOptions(), true, Extension.LOWERCASE);\n'
          + '  step="close"; doc.close(SaveOptions.DONOTSAVECHANGES);\n'
          + '  app.displayDialogs=prevD;\n'
          + '  return "OK z="+zi+"/"+ti;\n'
          + '}catch(err){ try{app.displayDialogs=prevD;}catch(eR){} return "ERR at "+step+": "+String(err); }\n'
          + '})();\n';
        const r = await runPhotoshopJsx(jsx, asciiDir, 300000, { closeNames: ['source.psd', 'edited.png'] });
        const out = await readFile(tempOut).catch(() => null);
        if (!String(r.stdout || '').trim().startsWith('OK') || !out || out.length < 1024) {
          throw new Error('Photoshop 写回失败：' + String(r.stdout || r.stderr || '').trim().slice(0, 200));
        }
      } else if (ext === 'svg') {
        const pythonSvg2 = await resolvePython(ctx);
        const rSvg2 = await runProcessWithTimeout(pythonSvg2.executable, [...pythonSvg2.prefixArgs, join(PLUGIN_ROOT, 'scripts', 'svg_layers.py'), '--svg', asciiSource, '--replace-image', '--input', tempEdited, '--output', tempOut], PLUGIN_ROOT, 120000);
        if (rSvg2.exitCode !== 0) throw new Error('SVG 写回失败：' + String(rSvg2.stderr || '').trim().slice(0, 200));
      } else {
        if (ext === 'ai') await ensureAiSavedClosed(path, outputDir);
        const body3 = [
          'var doc=app.open(new File(' + JSON.stringify(asciiSource) + '));',
          'var ab=doc.artboards[0].artboardRect; var W=ab[2]-ab[0], H=ab[1]-ab[3];',
          // 死链接修复通道：带失效链接的 .ai 访问 pageItems 会抛 “No such element”，
          // 这类项在画布上只显示“链接缺失”占位。探测到坏文档就移除失效 placedItem，
          // 并按层名重定位目标（旧索引已因移位失效）。
          'var probe=-1; try{ probe=doc.pageItems.length; }catch(eProbe){}',
          'var repaired=0, byName=String(' + JSON.stringify(layerName || '') + ');',
          'if(probe<0){',
          '  try{',
          '    for(var q=doc.placedItems.length-1;q>=0;q--){',
          '      var pl=null; try{ pl=doc.placedItems[q]; }catch(eP){}',
          '      if(!pl){ continue; }',
          '      var bad=false;',
          '      try{ var pf=pl.file; var pb=pl.bounds; if(!pf){ bad=true; } }catch(eF){ bad=true; }',
          '      if(bad){ try{ pl.remove(); repaired++; }catch(eR){} }',
          '    }',
          '  }catch(eAll){}',
          '}',
          'var n=-1; try{ n=doc.pageItems.length; }catch(eN){ return "ERR pageItems-unreadable "+String(eN); }',
          'var idx=' + layerId + ';',
          'if(repaired>0){',
          '  idx=-1;',
          '  for(var s2=n-1;s2>=0;s2--){ var it2=null; try{ it2=doc.pageItems[s2]; }catch(eI2){}',
          '    if(it2&&String(it2.name||"")===byName){ idx=s2; break; } }',
          '  if(idx<0){ return "ERR target-not-found-after-repair name="+byName; }',
          '} else if(idx>=n){ return "ERR layer index "+idx+" of "+n; }',
          'var target=null; try{ target=doc.pageItems[idx]; }catch(eT){}',
          'if(!target){ return "ERR target-invalid idx="+idx; }',
          'var next=null, prev=null;',
          'try{ if(idx+1<n){ next=doc.pageItems[idx+1]; } }catch(eNx){}',
          'try{ if(idx-1>=0){ prev=doc.pageItems[idx-1]; } }catch(ePv){}',
          // 用户选定语义：不删原图层，修改结果作为新层叠加在原图层之上。
          'var P0=-1; try{ P0=doc.placedItems.length; }catch(eC0){}',
          'var pi=doc.placedItems.add(); pi.file=new File(' + JSON.stringify(tempEdited) + ');',
          'try{ pi.width=W; pi.height=H; }catch(e1){}',
          'pi.left=ab[0]; pi.top=ab[1];',
          // 锚点在 embed 前打上：embed 会替换底层对象使旧引用失效，之后按名字重取。
          'var anchor="__dsh_layeredit_"+String(Date.now());',
          'try{ pi.name=anchor; }catch(eN0){}',
          'try{ pi.embed(); }catch(e2){}',
          // embed 验证：placedItems 数量应回到加图前。没回去 = 仍是链接 → 中止，
          // 绝不保存带死链接的文件（上一版就是这里静默失败产出“链接图片缺失”）。
          'var P1=-1; try{ P1=doc.placedItems.length; }catch(eC1){}',
          'if(P0>=0&&P1>=0&&P1>P0){ return "ERR embed-failed P0="+P0+" P1="+P1; }',
          'var pi2=null;',
          'for(var f2=0;f2<doc.pageItems.length;f2++){ var it4=null; try{ it4=doc.pageItems[f2]; }catch(eI4){}',
          '  if(it4){ try{ if(String(it4.name)===anchor){ pi2=it4; break; } }catch(eN4){} } }',
          'if(!pi2){ pi2=pi; }',
          // 层叠自检：锚点名 + move 后读回索引；四种语义逐个试，索引等于 idx 才算成功
          'function ziOf2(){ var a=doc.pageItems; for(var q2=0;q2<a.length;q2++){ try{ if(String(a[q2].name)===anchor){ return q2; } }catch(eQ2){} } return -1; }',
          'var zi=-1; var moved="none";',
          'function tryMove(rel, pos, label){ if(moved!=="none"||!rel){ return; } try{ pi2.move(rel, pos); }catch(eM){ return; } var z=ziOf2(); if(z===idx){ zi=z; moved=label; } }',
          'tryMove(target, ElementPlacement.PLACEBEFORE, "before-target");',
          'tryMove(prev, ElementPlacement.PLACEAFTER, "after-prev");',
          'tryMove(target, ElementPlacement.PLACEAFTER, "after-target");',
          'tryMove(next, ElementPlacement.PLACEBEFORE, "before-next");',
          'if(moved==="none"){ try{ pi2.move(doc.pageItems[doc.pageItems.length-1], ElementPlacement.PLACEATEND); }catch(e8){} zi=ziOf2(); moved="atend"; }',
          'try{ pi2.name=' + JSON.stringify((layerName || '图层') + ' 修改版') + '; }catch(e5){}',
          'var opts=new IllustratorSaveOptions(); try{opts.pdfCompatible=true;}catch(e6){}',
          'doc.saveAs(new File(' + JSON.stringify(tempOut) + '), opts);',
          'var cs="none";',
          'try{ doc.close(SaveOptions.DONOTSAVECHANGES); cs="SaveOptions"; }',
          'catch(e7){ try{ doc.close(2); cs="num2"; }',
          'catch(e9){ cs=("close-fail "+String(e9)).replace(/[\\t\\r\\n]+/g," "); } }',
          'return "OK "+cs+" z="+zi+"/"+idx+" "+moved+" repaired="+repaired;'
        ].join('\n');
        const r = await runIllustratorJsx(body3, asciiDir, 300000, { openPath: tempOut });
        await writeAiDiag({ route: 'edit-layer/writeback', file: path, out: tempOut, close: String(r.stdout || '').trim(), stdoutHead: String(r.stdout || '').slice(0, 300) });
        const out = await readFile(tempOut).catch(() => null);
        if (!String(r.stdout || '').trim().startsWith('OK') || !out || out.length < 1024) {
          throw new Error('Illustrator 写回失败：' + String(r.stdout || r.stderr || '').trim().slice(0, 200));
        }
      }

      // 5) 落盘
      //    .ai：按用户选择**直接写回原文件**（原图层保留、修改结果作为新层叠加在上面）。
      //         这是唯一会改动用户原始素材的路径，所以覆盖前先把原文件备份到项目里的「画布备份/」。
      //    .psd：与 .ai 相同（用户拍板同语义）。.svg：另存 -图层编辑 新版本，不动原文件。
      const bytes = await readFile(tempOut);
      let saved;
      let writeMode = 'version';
      if (ext === 'ai' || ext === 'psd') {
        // .psd 与 .ai 同语义：直接写回原文件（原图层保留、修改版叠加在上），覆盖前备份
        const backupDir = join(projectDir, '画布备份');
        await mkdir(backupDir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '');
        backupPath = join(backupDir, base + '-图层编辑前-' + stamp + '.' + ext);
        await cp(path, backupPath);
        await writeFile(path, bytes);
        const info = await stat(path);
        saved = { path, name: basename(path), mtime: info.mtimeMs, size: info.size, kind: ext, managed: true, url: previewUrl(path, info.mtimeMs) };
        writeMode = 'inplace';
      } else {
        saved = await writeManagedSource(projectDir, base + '-图层编辑.' + ext, bytes, ext);
      }
      const savedInfo = await stat(saved.path);
      json(res, CORS, 200, {
        ok: true,
        engine: generated.engine,
        mode: writeMode,
        backup: backupPath,
        layer: layerName || ('#' + layerId),
        maskWarning: tempPreparedMask ? '' : (typeof body.maskData === 'string' ? '蒙版未生效，已按整层编辑' : ''),
        // 与 /edit-image 保持同一形状：客户端靠 image.url 取图。
        // mode=version 时走 iframe 的原子替换（image-edit-result）就地换掉占位图；
        // mode=inplace 时源文件本身就是目标，客户端改为刷新画布上那份元素。
        image: { ...saved, kind: ext, mtimeMs: savedInfo.mtimeMs }
      });
    } catch (err) {
      json(res, CORS, 500, { ok: false, error: String((err && err.message) || err) });
    } finally {
      await unlink(tempExtract).catch(() => {});
      if (tempPreparedMaskGlobal) await unlink(tempPreparedMaskGlobal).catch(() => {});
      if (asciiDir && !process.env.DSH_KEEP_TEMPS) await rm(asciiDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  // ── 提取图层为临时画布图（可视化编辑的入口；提交后由 edit-layer 写回） ─────
  router.add({ method: 'POST', path: '/dsh-canvas/extract-layer', prefix: false }, async (req, res, { CORS }) => {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const path = expandHome(String(body.path || ''));
      const ext = extOf(path);
      const layerId = Number(body.layerId);
      if (!path || (ext !== 'psd' && ext !== 'ai' && ext !== 'svg') || !Number.isInteger(layerId) || layerId < 0) {
        respond(res, 400, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: false, error: '参数无效' }));
        return;
      }
      const projectDir = projectDirectory(body.cwd, body.project);
      if (!projectDir) throw new Error('当前聊天没有画布项目');
      const outputDir = join(projectDir, 'outputs', '.图片编辑临时');
      await mkdir(outputDir, { recursive: true });
      const token = Date.now() + '-' + Math.random().toString(16).slice(2);
      const out = join(outputDir, '.layer-src-' + token + '.png');
      let wTmp = 0, hTmp = 0;
      let stdout = '';
      if (ext === 'psd') await ensurePsdSavedClosed(path, outputDir);
      if (ext === 'ai') await ensureAiSavedClosed(path, outputDir);
      if (ext === 'psd') {
        const python = await resolvePython(ctx);
        const r = await runProcessWithTimeout(python.executable, [...python.prefixArgs, join(PLUGIN_ROOT, 'scripts', 'psd_layers.py'), '--psd', path, '--extract', '--id', String(layerId), '--output', out], PLUGIN_ROOT, 180000);
        if (r.exitCode !== 0) throw new Error(String(r.stderr || '').trim().slice(0, 200) || '图层提取失败');
        stdout = String(r.stdout || '');
      } else if (ext === 'svg') {
        const python = await resolvePython(ctx);
        const r = await runProcessWithTimeout(python.executable, [...python.prefixArgs, '-c',
          'import base64,sys,xml.etree.ElementTree as ET\n'
          + 'root=ET.parse(sys.argv[1]).getroot()\n'
          + 'imgs=[e for e in root.iter("{http://www.w3.org/2000/svg}image")]\n'
          + 'href=imgs[0].get("{http://www.w3.org/1999/xlink}href") if imgs else ""\n'
          + 'data=href.split(",",1)[1] if href.startswith("data:") else ""\n'
          + 'if not data: sys.exit("SVG 中没有内嵌位图")\n'
          + 'open(sys.argv[2],"wb").write(base64.b64decode(data))\n'
          + 'print(root.get("width")+"x"+root.get("height"))',
          path, out], PLUGIN_ROOT, 60000);
        if (r.exitCode !== 0) throw new Error(String(r.stderr || '').trim().slice(0, 200) || 'SVG 背景提取失败');
        stdout = String(r.stdout || '');
      } else {
        if (!isMac) throw new Error('AI 文件图层提取需要 macOS 上的 Illustrator');
        await ensureAiSavedClosed(path, outputDir);
        // 打开的是 ASCII 临时副本（不碰用户稿件），截屏也落在副本目录，字节随后搬回项目。
        // 只读流程不 activate：不再把 Illustrator 抢到前台再关掉，用户不会看到“打开又关闭”的闪烁。
        const readDir = join(tmpdir(), 'dsh-canvas-ai-extract-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
        await mkdir(readDir, { recursive: true });
        const readCopy = join(readDir, 'source.ai');
        const shotPath = join(readDir, 'layer.png');
        try {
          const t0 = Date.now();
          await cp(path, readCopy);
          const t1 = Date.now();
          const body2 = [
            'var doc=app.open(new File(' + JSON.stringify(readCopy) + '));',
            'var ab=doc.artboards[0].artboardRect; var W=ab[2]-ab[0], H=ab[1]-ab[3];',
            'var items=doc.pageItems; var n=items.length;',
            'if(' + layerId + '>=n){ return "ERR layer index "+' + layerId + '+" of "+n; }',
            'var states=[];',
            'for(var i=0;i<n;i++){ try{ states.push(items[i].hidden); }catch(eST){ states.push(false); } }',
            'for(var j=0;j<n;j++){ try{ items[j].hidden=(j===' + layerId + ')?false:true; }catch(eH){} }',
            'var terr="";',
            'try{ var opts=new ImageCaptureOptions(); opts.resolution=72; opts.transparency=true;',
            '  doc.imageCapture(new File(' + JSON.stringify(shotPath) + '), [ab[0], ab[1], ab[0]+W, ab[1]-H], opts); }',
            'catch(e1){ terr=("res72 "+String(e1)).replace(/[\\t\\r\\n]+/g," ");',
            '  try{ doc.imageCapture(new File(' + JSON.stringify(shotPath) + '), [ab[0], ab[1], ab[0]+W, ab[1]-H]); terr=""; }',
            '  catch(e2){ terr=("plain "+String(e2)).replace(/[\\t\\r\\n]+/g," "); } }',
            'for(var k=0;k<n;k++){ try{ items[k].hidden=states[k]; }catch(eRS){} }',
            'var cs="none";',
            'try{ doc.close(SaveOptions.DONOTSAVECHANGES); cs="SaveOptions"; }',
            'catch(eC1){ try{ doc.close(CloseOptions.DONTSAVECHANGES); cs="CloseOptions"; }',
            'catch(eC2){ try{ doc.close(2); cs="num2"; }',
            'catch(eC3){ try{ doc.close(); cs="noarg"; }catch(eC4){ cs=("fail "+String(eC4)).replace(/[\\t\\r\\n]+/g," "); } } } }',
            'return Math.round(W)+"x"+Math.round(H)+"\\t"+cs+"\\t"+terr;'
          ].join('\n');
          const r = await runIllustratorJsx(body2, readDir, 240000, { openPath: readCopy });
          const t2 = Date.now();
          const raw = String(r.stdout || '').trim();
          const parts = raw.split('\t');
          const capErr = String(parts[2] || '').trim();
          await writeAiDiag({ route: 'extract-layer', file: path, copy: readCopy, layerId, size: parts[0] || '', close: parts[1] || '', err: capErr, msCopy: t1 - t0, msJsx: t2 - t1, stdoutHead: raw.slice(0, 300) });
          if (capErr) throw new Error('Illustrator 图层截屏失败：' + capErr);
          stdout = parts[0] || '';
          if (!/^\d+x\d+$/.test(stdout)) throw new Error('Illustrator 图层提取失败：' + raw.slice(0, 160));
          await cp(shotPath, out);
          // 每次提取都会在项目里留一份 2–3MB 的临时图；清掉 6 小时前的旧份（只碰本功能自己的文件）。
          try {
            for (const name of await readdir(outputDir)) {
              if (!name.startsWith('.layer-src-') || !name.endsWith('.png')) continue;
              const stale = join(outputDir, name);
              if (stale === out) continue;
              const info = await stat(stale).catch(() => null);
              if (info && Date.now() - info.mtimeMs > 6 * 3600 * 1000) await unlink(stale).catch(() => {});
            }
          } catch (err) {}
        } finally {
          await rm(readDir, { recursive: true, force: true }).catch(() => {});
        }
      }
      // 画布尺寸：psd 输出 JSON（canvas 或 bounds 后接），svg/ai 输出 WxH
      {
        const mJson = /"canvas":\s*\[(\d+),\s*(\d+)\]/.exec(stdout) || /"bounds":\s*\[\d+,\s*\d+,\s*(\d+),\s*(\d+)\]/.exec(stdout) || /^(\d+)x(\d+)$/.exec(stdout.trim());
        if (mJson) { wTmp = Number(mJson[1]); hTmp = Number(mJson[2]); }
      }
      const info = await stat(out);
      const w = wTmp, h = hTmp;
      const m = /"(\d+)"?"?,\s*"?(\d+)"?\}?$/.exec(stdout.trim()) || /^(\d+)x(\d+)$/.exec(stdout.trim());
      try { const mm = /^\{.*"w":\s*"?(\d+)"?.*"h":\s*"?(\d+)"/.exec(stdout.trim()) || /^"??(\d+)"?x"?(\d+)/.exec(stdout.trim()); if (mm) { w = Number(mm[1]); h = Number(mm[2]); } } catch (err) {}
      respond(res, 200, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: true, path: out, mtimeMs: info.mtimeMs, w, h }));
    } catch (err) {
      respond(res, 500, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: false, error: String((err && err.message) || err) }));
    }
  });
}
