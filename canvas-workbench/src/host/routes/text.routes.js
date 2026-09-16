// 自 lib/index.js apply() 机械迁移（v1.8 Phase 2）：每个 handler 体逐字未改，
// 原来的 `if (pathname === … && req.method === …) { … }` 外壳由 router 负责。
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { access, mkdir, open, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { isMac, isWindows, openWithSystem, resolvePython } from '../../../lib/platform.js';
import { generateImage, readImageEngineSettings } from '../../../lib/image-engine.js';
import { readBody, respond } from '../server/http.js';
import { decodeImageData, normalizeTextLayerText, safeImageName } from '../../shared/utils/data-url.js';
import { analyzeTextWithCurrentModel, visionBlocks } from '../services/text-analysis.js';
import { PLUGIN_ROOT } from '../vendor-assets.js';
import { name } from '../plugin-meta.js';

export function register(router, h) {
  const { ctx, previewUrl, projectDirectory, runProcess, runProcessWithTimeout, writeManagedSource } = h;
  router.add({ method: 'POST', path: '/dsh-canvas/ocr-image', prefix: false }, async (req, res, { pathname, query, CORS, sameOriginRequest }) => {
          let tempInput = '';
          try {
            const body = JSON.parse(await readBody(req) || '{}');
            const uploaded = decodeImageData(body.imageData);
            if (!uploaded) throw new Error('图片数据无效或超过 32MB');
            let visionWarning = '';
            const validCrop = (item) => item && typeof item === 'object' && Number(item.width || 0) >= 6 && Number(item.height || 0) >= 6;
            const requestedCrops = Array.isArray(body.crops) ? body.crops.filter(validCrop).slice(0, 24) : (validCrop(body.crop) ? [body.crop] : []);
            // 用户先框选，再由聊天输入框当前模型理解选区内文字与背景。
            if (requestedCrops.length && body.provider && body.model) {
              let analyzed = null, visionErr = '';
              // 两次尝试：第一次按选区任务；空结果/失败后自动换简化指令重试一次
              for (let attempt = 0; attempt < 2 && !analyzed; attempt++) {
                try {
                  analyzed = await analyzeTextWithCurrentModel(ctx, uploaded, body, attempt === 1);
                } catch (err) { visionErr = String((err && err.message) || err); }
              }
              if (!analyzed) {
                visionWarning = '当前聊天模型(' + String(body.provider || '') + '/' + String(body.model || '') + ')识别失败，已自动切换本地 OCR：' + visionErr;
              } else {
                const intersects = (block, region) => Math.max(0, Math.min(block.x + block.width, region.x + region.width) - Math.max(block.x, region.x))
                  * Math.max(0, Math.min(block.y + block.height, region.y + region.height) - Math.max(block.y, region.y)) > 0;
                const allBlocks = visionBlocks(analyzed.value, analyzed.width, analyzed.height);
                const blocks = allBlocks.filter((block) => requestedCrops.some((region) => intersects(block, region)));
                let cropWarning = '';
                if (!blocks.length) {
                  // 模型识别到了文字但坐标与选区不重叠：返回全部结果由用户逐条排除
                  cropWarning = '模型返回的 ' + allBlocks.length + ' 个文字块与选区坐标不重叠，已列出全部结果，请排除选区外的项';
                }
                respond(res, 200, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({
                  ok: true, width: analyzed.width, height: analyzed.height, blocks: blocks.length ? blocks : allBlocks, crops: requestedCrops,
                  erasePrompt: String(analyzed.value.erasePrompt || '').slice(0, 1200),
                  engine: 'current-chat-model', provider: analyzed.provider, model: analyzed.model, styleEngine: 'current-chat-model',
                  warning: cropWarning
                }));
                return;
              }
            } else if (requestedCrops.length) {
              visionWarning = '未取得聊天输入框的当前模型，已使用本地 OCR';
            }
            const outputDir = join(tmpdir(), 'dsh-canvas-text-rebuild');
            await mkdir(outputDir, { recursive: true });
            tempInput = join(outputDir, '.ocr-input-' + Date.now() + '-' + Math.random().toString(16).slice(2) + '.' + uploaded.ext);
            await writeFile(tempInput, uploaded.bytes);
            const pluginRoot = PLUGIN_ROOT;
            const script = join(pluginRoot, 'scripts', 'ocr_image.py');
            await access(script);
            const python = await resolvePython(ctx);
            const runOcr = async (crop) => {
              // Sparse-text mode is more reliable for a selected artwork area:
              // psm 6 treats the whole crop as one uniform paragraph and can
              // turn a Chinese line into Latin-looking noise (for example
              // “STL”).  Keep an explicit caller override, but default both
              // full-image and crop OCR to the sparse layout detector.
              const ocrArgs = [script, '--input', tempInput, '--lang', String(body.lang || 'chi_sim+eng'), '--psm', String(body.psm || '11')];
              if (crop) ocrArgs.push('--crop', JSON.stringify(crop));
              const result = await runProcessWithTimeout(python.executable, [...python.prefixArgs, ...ocrArgs], pluginRoot, 120000);
              const lines = String(result.stdout || '').trim().split(/\r?\n/).filter(Boolean);
              let payload = null;
              try { payload = lines.length ? JSON.parse(lines[lines.length - 1]) : null; } catch (err) { payload = null; }
              if (result.exitCode !== 0 || !payload || payload.success !== true) throw new Error((payload && payload.error) || result.stderr.trim() || (result.timedOut ? 'OCR 识别超时' : 'OCR 识别失败'));
              return payload;
            };
            const payloads = requestedCrops.length ? [] : [await runOcr(null)];
            for (const crop of requestedCrops) payloads.push(await runOcr(crop));
            const payload = payloads[0] || { width: 1, height: 1 };
            let blocks = [];
            const seenBlocks = new Set();
            for (const item of payloads.flatMap((entry) => Array.isArray(entry.blocks) ? entry.blocks : [])) {
              const key = [String(item.text || '').trim(), Math.round(Number(item.x || 0)), Math.round(Number(item.y || 0)), Math.round(Number(item.width || 0)), Math.round(Number(item.height || 0))].join('|');
              if (!seenBlocks.has(key)) { seenBlocks.add(key); blocks.push(item); }
            }
            blocks.sort((a, b) => Number(a.y || 0) - Number(b.y || 0) || Number(a.x || 0) - Number(b.x || 0));
            // OCR only returns geometry.  Add a conservative, local visual
            // estimate for font family/weight/size/color so the review panel
            // starts with usable values instead of an unavailable font name.
            let styleEngine = 'unavailable';
            try {
              const styleScript = join(pluginRoot, 'scripts', 'infer_text_style.py');
              await access(styleScript);
              const styled = await runProcessWithTimeout(python.executable, [...python.prefixArgs, styleScript, '--input', tempInput, '--blocks', JSON.stringify(blocks)], pluginRoot, 120000);
              const styleLines = String(styled.stdout || '').trim().split(/\r?\n/).filter(Boolean);
              let stylePayload = null;
              try { stylePayload = styleLines.length ? JSON.parse(styleLines[styleLines.length - 1]) : null; } catch (err) { stylePayload = null; }
              if (styled.exitCode === 0 && stylePayload && stylePayload.success === true && Array.isArray(stylePayload.blocks)) {
                blocks = stylePayload.blocks;
                styleEngine = stylePayload.engine || 'local-font-heuristic';
              }
            } catch (err) {}
            respond(res, 200, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: true, width: payload.width, height: payload.height, blocks, crops: requestedCrops, engine: 'tesseract', styleEngine, warning: visionWarning }));
          } catch (err) {
            respond(res, 500, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: false, error: String((err && err.message) || err) }));
          } finally {
            if (tempInput) await unlink(tempInput).catch(() => {});
          }
          return;
  });

  router.add({ method: 'POST', path: '/dsh-canvas/export-text-psd', prefix: false }, async (req, res, { pathname, query, CORS, sameOriginRequest }) => {
          let tempInput = '';
          let tempMask = '';
          let tempGenerated = '';
          let tempClean = '';
          let draftPsd = '';
          let finalPsd = '';
          let jsxPath = '';
          let appleScriptPath = '';
          try {
            const body = JSON.parse(await readBody(req) || '{}');
            const projectDir = projectDirectory(body.cwd, body.project);
            if (!projectDir) throw new Error('当前聊天没有画布项目');
            const uploaded = decodeImageData(body.imageData);
            if (!uploaded) throw new Error('图片数据无效或超过 32MB');
            const blocks = (Array.isArray(body.blocks) ? body.blocks.slice(0, 200) : []).map((item) => {
              if (!item || typeof item !== 'object') return item;
              return { ...item, text: normalizeTextLayerText(item.text) };
            });
            const validRegion = (item) => item && typeof item === 'object'
              && Number(item.width || 0) >= 6 && Number(item.height || 0) >= 6;
            const selections = (Array.isArray(body.selections) ? body.selections : (validRegion(body.selection) ? [body.selection] : []))
              .filter(validRegion).slice(0, 24);
            const intersectsSelection = (block, region) => {
              const bx = Number(block && block.x || 0), by = Number(block && block.y || 0);
              const bw = Number(block && block.width || 0), bh = Number(block && block.height || 0);
              const rx = Number(region && region.x || 0), ry = Number(region && region.y || 0);
              const rw = Number(region && region.width || 0), rh = Number(region && region.height || 0);
              const iw = Math.max(0, Math.min(bx + bw, rx + rw) - Math.max(bx, rx));
              const ih = Math.max(0, Math.min(by + bh, ry + rh) - Math.max(by, ry));
              if (iw <= 0 || ih <= 0) return false;
              const area = iw * ih;
              const blockArea = Math.max(1, bw * bh);
              const centerX = bx + bw / 2, centerY = by + bh / 2;
              return area >= blockArea * 0.15 || (centerX >= rx && centerX <= rx + rw && centerY >= ry && centerY <= ry + rh);
            };
            // A full-image OCR pass provides the candidate list.  Only rows
            // inside user-drawn regions are eligible for removal; without a
            // region we generate a non-destructive PSD with the source intact.
            const exportBlocks = selections.length
              ? blocks.map((item) => item && typeof item === 'object'
                ? { ...item, enabled: item.enabled !== false && selections.some((region) => intersectsSelection(item, region)) }
                : item)
              : blocks.map((item) => item && typeof item === 'object' ? { ...item, enabled: false } : item);
            // Photoshop ExtendScript 在部分版本中无法 app.open 中文目录下的
            // 临时文件；先在 ASCII 系统临时目录完成 JSX/PSD，再把最终字节
            // 写回项目 assets，避免路径编码导致原生文字层分支失败。
            const outputDir = join(tmpdir(), 'dsh-canvas-text-psd');
            await mkdir(outputDir, { recursive: true });
            const token = Date.now() + '-' + Math.random().toString(16).slice(2);
            // 不使用点开头的隐藏文件名：Photoshop 2025 ExtendScript 对
            // 隐藏 PSD 的 app.open() 会误报“打开选项不正确”。
            tempInput = join(outputDir, 'text-psd-input-' + token + '.' + uploaded.ext);
            draftPsd = join(outputDir, 'text-psd-draft-' + token + '.psd');
            finalPsd = join(outputDir, 'text-psd-final-' + token + '.psd');
            jsxPath = join(outputDir, 'text-psd-' + token + '.jsx');
            appleScriptPath = join(outputDir, 'text-psd-' + token + '.applescript');
            await writeFile(tempInput, uploaded.bytes);
            const pluginRoot = PLUGIN_ROOT;
            const script = join(pluginRoot, 'scripts', 'export_text_psd.py');
            await access(script);
            const python = await resolvePython(ctx);
            let cleanInput = '';
            let cleanupEngine = '';
            let cleanupWarning = '';
            const enabledBlocks = exportBlocks.filter((item) => item && item.enabled !== false && String(item.text || '').trim());
            // Build a narrow mask from the reviewed OCR rows and run the same
            // model chain as normal image editing: Codex/gpt-image-2 first,
            // Pixel image2 API second.  The final composite copies every pixel
            // outside the mask from the source, so a model cannot redraw the
            // whole poster or silently alter the product.
            if (body.cleanBackground !== false && selections.length) {
              try {
                const maskScript = join(pluginRoot, 'scripts', 'prepare_text_mask.py');
                const compositeScript = join(pluginRoot, 'scripts', 'composite_edit.py');
                await access(maskScript);
                await access(compositeScript);
                tempMask = join(outputDir, 'text-psd-mask-' + token + '.png');
                const preparedMask = await runProcessWithTimeout(python.executable, [...python.prefixArgs, maskScript, '--source', tempInput, '--blocks', JSON.stringify(exportBlocks), '--regions', JSON.stringify(selections), '--output', tempMask], pluginRoot, 120000);
                const maskLines = String(preparedMask.stdout || '').trim().split(/\r?\n/).filter(Boolean);
                let maskPayload = null;
                try { maskPayload = maskLines.length ? JSON.parse(maskLines[maskLines.length - 1]) : null; } catch (err) { maskPayload = null; }
                if (preparedMask.exitCode !== 0 || !maskPayload || maskPayload.success !== true || (Number(maskPayload.regions || 0) < 1 && Number(maskPayload.blocks || 0) < 1)) throw new Error('文字遮罩生成失败');

                const width = Math.max(1, Number(body.width || 1));
                const height = Math.max(1, Number(body.height || 1));
                const selectedTexts = Array.from(new Set(enabledBlocks.map((item) => String(item.text || '').replace(/\s+/g, ' ').trim()).filter(Boolean))).slice(0, 40);
                const selectedTextJson = JSON.stringify(selectedTexts, null, 0);
                const reasonedErasePrompt = String(body.erasePrompt || '').trim().slice(0, 1200);
                const cleanPrompt = '这是严格局部的文字擦除与背景修复任务。用户明确框选了 ' + selections.length + ' 个区域；透明遮罩就是唯一允许编辑的区域。\n'
                  + '需要擦除的已识别文字候选为：' + selectedTextJson + '。识别结果可能不完整或有错，因此仍须删除遮罩区域内所有属于原文字的内容，包括完整文字、残缺偏旁、半个字形、笔画、标点、抗锯齿边缘、描边、阴影、发光和压缩残影；不要生成任何替代文字。\n'
                  + (reasonedErasePrompt ? ('视觉模型对选区的局部理解：' + reasonedErasePrompt + '\n') : '')
                  + '擦除后，根据每个框选区域四周紧邻像素，推断并延续文字出现之前的真实背景。保持原有颜色、渐变、材质纹理、光照、噪声、透视、颗粒尺度及连续线条，形成自然 clean plate。框选区域内若存在非文字的产品、人物、图形或结构，只修补被文字覆盖的部分，不改变其形状与位置。\n'
                  + '框选区域之外必须逐像素保持原图不变。禁止重绘、缩放、美化或锐化整图，禁止改变其他文字、产品、人物、构图、颜色和清晰度，禁止生成新文字、图标、色块或装饰。输出尺寸必须与原图完全一致，边缘自然无接缝、无白块、无光晕、无重复纹理。';
                const engineSettings = await readImageEngineSettings();
                const generated = await generateImage({
                  ctx,
                  image: uploaded.bytes,
                  mask: await readFile(tempMask),
                  prompt: cleanPrompt,
                  engine: engineSettings.engine,
                  signal: AbortSignal.timeout(900000)
                });
                cleanupEngine = generated.engine;
                tempGenerated = join(outputDir, 'text-psd-generated-' + token + '.png');
                await writeFile(tempGenerated, generated.bytes);
                tempClean = join(outputDir, 'text-psd-clean-' + token + '.png');
                const composite = await runProcessWithTimeout(python.executable, [...python.prefixArgs, compositeScript, '--source', tempInput, '--generated', tempGenerated, '--mask', tempMask, '--output', tempClean], pluginRoot, 180000);
                if (composite.exitCode === 0) {
                  try { const cleanInfo = await stat(tempClean); if (cleanInfo.isFile() && cleanInfo.size > 0) cleanInput = tempClean; } catch (err) {}
                }
                if (!cleanInput) {
                  cleanupWarning = '局部背景合成失败，已保留原图作为 PSD 底层';
                  cleanupEngine = '';
                }
              } catch (err) {
                cleanupWarning = String((err && err.message) || err);
                cleanupEngine = '';
              }
            } else if (body.cleanBackground !== false && !selections.length) {
              cleanupWarning = '没有框选文字区域，跳过 image2 背景清理';
            }
            const generatedArgs = [script, '--input', tempInput, '--output', draftPsd, '--blocks', JSON.stringify(exportBlocks)];
            if (cleanInput) generatedArgs.push('--clean-input', cleanInput);
            const generated = await runProcessWithTimeout(python.executable, [...python.prefixArgs, ...generatedArgs], pluginRoot, 180000);
            const generatedLines = String(generated.stdout || '').trim().split(/\r?\n/).filter(Boolean);
            let generatedPayload = null;
            try { generatedPayload = generatedLines.length ? JSON.parse(generatedLines[generatedLines.length - 1]) : null; } catch (err) { generatedPayload = null; }
            if (generated.exitCode !== 0 || !generatedPayload || generatedPayload.success !== true) throw new Error((generatedPayload && generatedPayload.error) || generated.stderr.trim() || (generated.timedOut ? 'PSD 草稿生成超时' : 'PSD 草稿生成失败'));

            let photoshop = false;
            let photoshopWarning = '';
            const jsxPayload = JSON.stringify({ input: draftPsd, output: finalPsd, blocks: exportBlocks, cleanBackground: Boolean(cleanInput) });
            const jsx = '#target photoshop\n(function(){\n'
              + 'var cfg=' + jsxPayload + ';\n'
              + 'function rgb(value){var m=String(value||"#111827").replace("#",""); if(m.length!==6)m="111827"; var c=new SolidColor(); c.rgb.red=parseInt(m.substr(0,2),16); c.rgb.green=parseInt(m.substr(2,2),16); c.rgb.blue=parseInt(m.substr(4,2),16); return c;}\n'
              + 'try{var doc=app.open(new File(cfg.input)); var list=cfg.blocks||[]; for(var i=0;i<list.length;i++){var b=list[i]||{}; if(b.enabled===false||!String(b.text||"").replace(/^[\\s\\r\\n]+|[\\s\\r\\n]+$/g,""))continue; var layer=doc.artLayers.add(); layer.kind=LayerKind.TEXT; layer.name="OCR text "+(i+1)+" (review before enabling)"; var ti=layer.textItem; ti.contents=String(b.text||""); ti.position=[Number(b.x||0),Number(b.y||0)+Math.max(8,Number(b.fontSize||24))]; ti.size=Math.max(8,Number(b.fontSize||24)); try{ti.font=String(b.fontPostScript||b.fontFamily||"AlibabaPuHuiTi_3_55_Regular");}catch(fontErr){try{ti.font="ArialMT";}catch(fontFallbackErr){}} ti.color=rgb(b.color); try{ti.justification=Justification.LEFT;}catch(justErr){} layer.visible=false;} for(var g=0;g<doc.layerSets.length;g++){try{if(String(doc.layerSets[g].name)==="OCR text preview - replace in Photoshop")doc.layerSets[g].visible=false;}catch(groupErr){}} var opts=new PhotoshopSaveOptions(); opts.layers=true; doc.saveAs(new File(cfg.output),opts,true,Extension.LOWERCASE); doc.close(SaveOptions.DONOTSAVECHANGES); }catch(err){try{if(doc)doc.close(SaveOptions.DONOTSAVECHANGES);}catch(closeErr){} throw err;}\n})();\n';
            await writeFile(jsxPath, jsx, 'utf8');
            // Explicit UTF-8 decoding prevents Chinese `contents` from being
            // interpreted with the host's legacy Mac encoding.
            const appleScript = 'tell application id "com.adobe.Photoshop"\nactivate\ndo javascript (read POSIX file ' + JSON.stringify(jsxPath) + ' as «class utf8»)\nend tell\n';
            await writeFile(appleScriptPath, appleScript, 'utf8');
            if (body.openPhotoshop !== false && isMac) {
              try {
                const osascript = await ctx.subprocess.resolveExecutable('osascript');
                const scripted = await runProcessWithTimeout(osascript, [appleScriptPath], outputDir, 120000);
                try { await stat(finalPsd); photoshop = scripted.exitCode === 0; } catch (err) {}
                if (!photoshop) photoshopWarning = String(scripted.stderr || '').trim() || '未能调用 Photoshop 原生文字层，已使用 PSD 草稿兜底';
              } catch (err) {
                photoshopWarning = String((err && err.message) || err);
              }
            } else if (body.openPhotoshop === false) {
              photoshopWarning = '已生成 PSD 草稿（未调用 Photoshop），原图与 OCR 文字预览均已保留';
            } else {
              photoshopWarning = 'Windows 初级版已生成可打开的 PSD；原生 Photoshop 文字层自动化暂仅支持 macOS';
            }
            const sourcePsd = photoshop ? finalPsd : draftPsd;
            const bytes = await readFile(sourcePsd);
            const originalName = safeImageName(body.name || '画布图片.png');
            const dot = originalName.lastIndexOf('.');
            const base = dot > 0 ? originalName.slice(0, dot) : originalName;
            const saved = await writeManagedSource(projectDir, base + '-文字编辑.psd', bytes, 'psd');
            let opened = false;
            if (body.openPhotoshop !== false) {
              try {
                if (isWindows) {
                  const result = await openWithSystem(ctx, runProcess, saved.path, dirname(saved.path));
                  opened = result.exitCode === 0;
                } else {
                  const opener = await ctx.subprocess.resolveExecutable('open');
                  const attempts = [['-b', 'com.adobe.Photoshop', saved.path], ['-a', 'Adobe Photoshop 2024', saved.path], ['-a', 'Adobe Photoshop 2025', saved.path], ['-a', 'Adobe Photoshop', saved.path]];
                  for (const args of attempts) {
                    const result = await runProcess(opener, args, dirname(saved.path));
                    if (result.exitCode === 0) { opened = true; break; }
                  }
                }
              } catch (err) {}
            }
            const info = await stat(saved.path);
            const warnings = [cleanupWarning, photoshopWarning].filter(Boolean).join('；');
            respond(res, 200, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: true, image: { path: saved.path, name: saved.name, mtime: info.mtimeMs, kind: 'psd', managed: true, url: previewUrl(saved.path, info.mtimeMs) }, photoshop, opened, cleanedBackground: Boolean(cleanInput), cleanupEngine: cleanupEngine || 'none', styleEngine: 'local-font-heuristic', warning: warnings, blockCount: enabledBlocks.length, selectionCount: selections.length }));
          } catch (err) {
            respond(res, 500, { ...CORS, 'content-type': 'application/json' }, JSON.stringify({ ok: false, error: String((err && err.message) || err) }));
          } finally {
            for (const path of [tempInput, tempMask, tempGenerated, tempClean, draftPsd, finalPsd, jsxPath, appleScriptPath]) if (path) await unlink(path).catch(() => {});
          }
          return;
  });
}
