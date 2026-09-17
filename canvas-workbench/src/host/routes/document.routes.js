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
import { cp, mkdir, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { expandHome } from '../../shared/utils/paths.js';
import { readBody, respond } from '../server/http.js';
import { isMac, resolvePython } from '../../../lib/platform.js';
import { extOf } from '../../shared/utils/image-types.js';
import { safeImageName } from '../../shared/utils/data-url.js';
import { generateImage } from '../../providers/image-engine.js';
import { readImageEngineSettings } from '../../host/services/image-engine-settings.js';
import { PLUGIN_ROOT } from '../vendor-assets.js';

export function register(router, h) {
  const { ctx, projectDirectory, runProcessWithTimeout, writeManagedSource } = h;
  const json = (res, CORS, status, payload) => respond(res, status, { ...CORS, 'content-type': 'application/json' }, JSON.stringify(payload));
  const jsonNoStore = (res, CORS, status, payload) => respond(res, status, { ...CORS, 'content-type': 'application/json', 'cache-control': 'no-store' }, JSON.stringify(payload));

  /** 运行 Illustrator JSX 主体（body-only）：自动包 #target、禁弹窗、恢复；stdout 为脚本返回值。 */
  async function runIllustratorJsx(body, workDir, timeoutMs = 240000) {
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
    await writeFile(appleScriptPath, 'tell application id "com.adobe.Illustrator"\nactivate\ndo javascript (read POSIX file ' + JSON.stringify(jsxPath) + ' as «class utf8»)\nend tell\n', 'utf8');
    try {
      return await runProcessWithTimeout(osascript, [appleScriptPath], workDir, timeoutMs);
    } finally {
      await unlink(jsxPath).catch(() => {});
      await unlink(appleScriptPath).catch(() => {});
    }
  }

  /** 运行 Photoshop JSX（完整脚本字符串）。 */
  async function runPhotoshopJsx(jsx, workDir, timeoutMs = 300000) {
    const osascript = await ctx.subprocess.resolveExecutable('osascript');
    const jsxPath = join(workDir, '.dsh-ps-jsx-' + Date.now() + '-' + Math.random().toString(16).slice(2) + '.jsx');
    const appleScriptPath = jsxPath + '.applescript';
    await writeFile(jsxPath, jsx, 'utf8');
    await writeFile(appleScriptPath, 'tell application id "com.adobe.Photoshop"\nactivate\ndo javascript (read POSIX file ' + JSON.stringify(jsxPath) + ' as «class utf8»)\nend tell\n', 'utf8');
    try {
      return await runProcessWithTimeout(osascript, [appleScriptPath], workDir, timeoutMs);
    } finally {
      await unlink(jsxPath).catch(() => {});
      await unlink(appleScriptPath).catch(() => {});
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
        const body2 = [
          'var doc=app.open(new File(' + JSON.stringify(path) + '));',
          'var ab=doc.artboards[0].artboardRect; var W=ab[2]-ab[0], H=ab[1]-ab[3];',
          'var out=[];',
          'for(var i=0;i<doc.pageItems.length;i++){',
          '  var it=doc.pageItems[i]; var vb=it.visibleBounds;',
          '  var nm=String(it.name||("图层 "+(i+1))).replace(/[\\t\\r\\n]/g," ");',
          '  out.push([i,nm,it.typename,(it.hidden!==true)?"1":"0",Math.round(vb[0]-ab[0]),Math.round(ab[1]-vb[1]),Math.round(vb[2]-vb[0]),Math.round(vb[1]-vb[3]),Math.round(W),Math.round(H)].join("\\t"));',
          '}',
          'try{doc.close(CloseOptions.DONTSAVECHANGES);}catch(e){try{doc.close(2);}catch(e2){}}',
          'return "LAYERS\\n"+out.join("\\n");'
        ].join('\n');
        const r = await runIllustratorJsx(body2, dirname(path));
        const out = String(r.stdout || '').trim();
        if (!out.startsWith('LAYERS')) throw new Error('Illustrator 图层读取失败：' + String(out || r.stderr || '').trim().slice(0, 200));
        layers = out.split(/\r?\n/).slice(1).filter(Boolean).map((line) => {
          const f = line.split('\t');
          return f.length >= 10 ? { id: Number(f[0]), name: f[1], kind: f[2], visible: f[3] === '1', x: Number(f[4]), y: Number(f[5]), w: Number(f[6]), h: Number(f[7]), canvas: [Number(f[8]), Number(f[9])] } : null;
        }).filter(Boolean);
      }
      jsonNoStore(res, CORS, 200, { ok: true, layers, kind: ext });
    } catch (err) {
      json(res, CORS, 500, { ok: false, error: String((err && err.message) || err) });
    }
  });

  // ── 图层编辑 + 原位写回 ─────────────────────────────────────────────────
  router.add({ method: 'POST', path: '/dsh-canvas/edit-layer', prefix: false }, async (req, res, { CORS }) => {
    let tempExtract = '';
    let asciiDir = '';
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const path = expandHome(String(body.path || ''));
      const ext = extOf(path);
      const layerId = Number(body.layerId);
      const prompt = String(body.prompt || '').trim().slice(0, 4000);
      const layerName = String(body.layerName || '').slice(0, 200);
      if (!path || (ext !== 'psd' && ext !== 'ai' && ext !== 'svg')) { json(res, CORS, 400, { ok: false, error: '仅支持 .psd / .ai / .svg 文件' }); return; }
      if (!Number.isInteger(layerId) || layerId < 0) { json(res, CORS, 400, { ok: false, error: '缺少图层' }); return; }
      if (!prompt) { json(res, CORS, 400, { ok: false, error: '请输入图层修改提示词' }); return; }
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
        const body2 = [
          'var doc=app.open(new File(' + JSON.stringify(path) + '));',
          'var ab=doc.artboards[0].artboardRect; var W=ab[2]-ab[0], H=ab[1]-ab[3];',
          'var states=[].',
          'for(var i=0;i<doc.pageItems.length;i++){ states.push(doc.pageItems[i].hidden); doc.pageItems[i].hidden=(i===' + layerId + ')?false:true; }',
          'var opts=new ImageCaptureOptions(); try{opts.resolution=72;opts.transparency=true;}catch(e){}',
          'doc.imageCapture(new File(' + JSON.stringify(tempExtract) + '), [ab[0], ab[1], ab[0]+W, ab[1]-H], opts);',
          'for(var j=0;j<doc.pageItems.length;j++){ try{doc.pageItems[j].hidden=states[j];}catch(e2){} }',
          'try{doc.close(CloseOptions.DONTSAVECHANGES);}catch(e3){try{doc.close(2);}catch(e4){}}',
          'return Math.round(W)+"x"+Math.round(H);'
        ].join('\n');
        const r = await runIllustratorJsx(body2, outputDir);
        const out = String(r.stdout || '').trim();
        const m = /^(\d+)x(\d+)$/.exec(out);
        if (!m) throw new Error('Illustrator 图层提取失败：' + String(out || r.stderr || '').trim().slice(0, 200));
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

      // 2) 引擎编辑整幅（模型带全画布上下文）
      const editPrompt = '用户正在编辑设计稿的其中一个图层，下图是该图层在整幅画布上的独立呈现（其余图层已隐藏）。用户要求：'
        + prompt
        + '。请只针对该图层内容修改；保持画布尺寸、构图与未提及内容不变，不要添加文字或装饰，输出与输入同尺寸的图片。';
      const engineSettings = await readImageEngineSettings();
      const generated = await generateImage({ ctx, image: extracted, prompt: editPrompt, engine: engineSettings.engine, signal: AbortSignal.timeout(900000) });

      // 3) 规范化：模型输出可能是 WEBP/JPEG 字节且分辨率常与画布不一致 → 真 PNG + 缩放回画布尺寸，落 ASCII 目录
      const asciiSource = join(asciiDir, 'source.' + ext);
      await cp(path, asciiSource);
      const tempRaw = join(asciiDir, 'edited.raw');
      const tempEdited = join(asciiDir, 'edited.png');
      await writeFile(tempRaw, generated.bytes);
      const python2 = await resolvePython(ctx);
      const norm = await runProcessWithTimeout(python2.executable, [...python2.prefixArgs, join(PLUGIN_ROOT, 'scripts', 'normalize_image.py'), '--input', tempRaw, '--output', tempEdited, '--resize', canvasW + 'x' + canvasH], PLUGIN_ROOT, 120000);
      await unlink(tempRaw).catch(() => {});
      if (norm.exitCode !== 0) throw new Error('模型输出规范化失败：' + String(norm.stderr || '').trim().slice(0, 160));

      // 4) Adobe 原位写回（ASCII 目录内完成）
      const originalName = safeImageName(body.name || basename(path));
      const dot = originalName.lastIndexOf('.');
      const base = dot > 0 ? originalName.slice(0, dot) : originalName;
      const tempOut = join(asciiDir, 'out.' + ext);
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
          + '  step="replace"; var target=findLayer(doc,' + JSON.stringify(layerName || '__none__') + ');\n'
          + '  if(target){ pasted.move(target, ElementPlacement.PLACEBEFORE); target.remove(); pasted.name=' + JSON.stringify(layerName || '图层更新') + '; }\n'
          + '  else { pasted.name=' + JSON.stringify(layerName || '图层更新') + '; }\n'
          + '  step="save"; doc.saveAs(new File(' + JSON.stringify(tempOut) + '), new PhotoshopSaveOptions(), true, Extension.LOWERCASE);\n'
          + '  step="close"; doc.close(SaveOptions.DONOTSAVECHANGES);\n'
          + '  app.displayDialogs=prevD;\n'
          + '  return "OK";\n'
          + '}catch(err){ try{app.displayDialogs=prevD;}catch(eR){} return "ERR at "+step+": "+String(err); }\n'
          + '})();\n';
        const r = await runPhotoshopJsx(jsx, asciiDir);
        const out = await readFile(tempOut).catch(() => null);
        if (!String(r.stdout || '').trim().startsWith('OK') || !out || out.length < 1024) {
          throw new Error('Photoshop 写回失败：' + String(r.stdout || r.stderr || '').trim().slice(0, 200));
        }
      } else if (ext === 'svg') {
        const pythonSvg2 = await resolvePython(ctx);
        const rSvg2 = await runProcessWithTimeout(pythonSvg2.executable, [...pythonSvg2.prefixArgs, join(PLUGIN_ROOT, 'scripts', 'svg_layers.py'), '--svg', asciiSource, '--replace-image', '--input', tempEdited, '--output', tempOut], PLUGIN_ROOT, 120000);
        if (rSvg2.exitCode !== 0) throw new Error('SVG 写回失败：' + String(rSvg2.stderr || '').trim().slice(0, 200));
      } else {
        const body3 = [
          'var doc=app.open(new File(' + JSON.stringify(asciiSource) + '));',
          'var ab=doc.artboards[0].artboardRect; var W=ab[2]-ab[0], H=ab[1]-ab[3];',
          'var items=doc.pageItems; var idx=' + layerId + ';',
          'if(idx>=items.length){ return "ERR layer index"; }',
          'var target=items[idx]; var prev=null;',
          'for(var p=idx-1;p>=0;p--){ if(items[p]){ prev=items[p]; break; } }',
          'try{ target.remove(); }catch(eR){ return "ERR remove "+String(eR); }',
          'var pi=doc.placedItems.add(); pi.file=new File(' + JSON.stringify(tempEdited) + ');',
          'try{ pi.width=W; pi.height=H; }catch(e1){}',
          'pi.left=ab[0]; pi.top=ab[1];',
          'try{ pi.embed(); }catch(e2){}',
          'if(prev){ try{ pi.move(prev, ElementPlacement.PLACEAFTER); }catch(e3){} } else { try{ pi.move(doc.pageItems[doc.pageItems.length-1], ElementPlacement.PLACEATEND); }catch(e4){} }',
          'try{ pi.name=' + JSON.stringify(layerName || '图层更新') + '; }catch(e5){}',
          'var opts=new IllustratorSaveOptions(); try{opts.pdfCompatible=true;}catch(e6){}',
          'doc.saveAs(new File(' + JSON.stringify(tempOut) + '), opts);',
          'try{doc.close(CloseOptions.DONTSAVECHANGES);}catch(e7){try{doc.close(2);}catch(e8){}}',
          'return "OK";'
        ].join('\n');
        const r = await runIllustratorJsx(body3, asciiDir, 300000);
        const out = await readFile(tempOut).catch(() => null);
        if (!String(r.stdout || '').trim().startsWith('OK') || !out || out.length < 1024) {
          throw new Error('Illustrator 写回失败：' + String(r.stdout || r.stderr || '').trim().slice(0, 200));
        }
      }

      // 5) 新版本落盘到项目并返回
      const bytes = await readFile(tempOut);
      const saved = await writeManagedSource(projectDir, base + '-图层编辑.' + ext, bytes, ext);
      const savedInfo = await stat(saved.path);
      json(res, CORS, 200, {
        ok: true,
        engine: generated.engine,
        layer: layerName || ('#' + layerId),
        image: { path: saved.path, name: saved.name, mtime: savedInfo.mtimeMs, kind: ext, managed: true }
      });
    } catch (err) {
      json(res, CORS, 500, { ok: false, error: String((err && err.message) || err) });
    } finally {
      await unlink(tempExtract).catch(() => {});
      if (asciiDir && !process.env.DSH_KEEP_TEMPS) await rm(asciiDir, { recursive: true, force: true }).catch(() => {});
    }
  });
}
