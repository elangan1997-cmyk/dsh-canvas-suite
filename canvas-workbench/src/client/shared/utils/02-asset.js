    function basename(p) {
      const at = Math.max(String(p).lastIndexOf('/'), String(p).lastIndexOf('\\'));
      return at === -1 ? String(p) : String(p).slice(at + 1);
    }

    // DSH 历史图片有时只携带 attachmentId，没有本地文件路径。
    // 用稳定的内部标记暂存引用，渲染时通过 conversation.resolveImage() 换成 Blob URL。
    function attachmentMarker(ref) {
      if (!ref || !ref.attachmentId) return '';
      return 'dsh-attachment:' + [ref.attachmentId, ref.mediaType || 'image/png', ref.name || '']
        .map((value) => encodeURIComponent(String(value))).join(':');
    }
    function attachmentFromPath(value) {
      const match = /^dsh-attachment:([^:]*):([^:]*):(.*)$/.exec(String(value || ''));
      if (!match) return null;
      try {
        return {
          attachmentId: decodeURIComponent(match[1]),
          mediaType: decodeURIComponent(match[2]) || 'image/png',
          name: decodeURIComponent(match[3]) || ''
        };
      } catch (e) {
        return null;
      }
    }
    function imageName(path) {
      const ref = attachmentFromPath(path);
      return ref ? (ref.name || '生成图片') : basename(path);
    }

    function dataURLToFile(dataURL, name) {
      const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/.exec(String(dataURL || ''));
      if (!match) throw new Error('画布图片数据无效');
      const raw = atob(match[2]);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
      const ext = match[1] === 'image/jpeg' ? 'jpg' : (match[1].split('/')[1] || 'png').replace('svg+xml', 'svg');
      return new File([bytes], String(name || 'canvas-selection').replace(/\.[a-zA-Z0-9]+$/, '') + '.' + ext, { type: match[1] });
    }

    function rasterizeSVGForChat(item, index) {
      const dataURL = String(item && item.dataURL || '');
      const sourceName = String(item && item.name || ('canvas-selection-' + (index + 1) + '.svg'));
      const mime = ((/^data:([^;,]+)/i.exec(dataURL) || [])[1] || '').toLowerCase();
      if (mime !== 'image/svg+xml') return Promise.resolve(dataURLToFile(dataURL, sourceName));
      return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
          try {
            const sourceWidth = Math.max(1, Number(image.naturalWidth || item.width || 1600));
            const sourceHeight = Math.max(1, Number(image.naturalHeight || item.height || 1200));
            const preferredSide = 2048;
            const maxSide = 4096;
            const maxPixels = 16000000;
            const sourceMaxSide = Math.max(sourceWidth, sourceHeight);
            const scale = Math.min(
              Math.max(1, preferredSide / sourceMaxSide),
              maxSide / sourceMaxSide,
              Math.sqrt(maxPixels / (sourceWidth * sourceHeight))
            );
            const width = Math.max(1, Math.round(sourceWidth * scale));
            const height = Math.max(1, Math.round(sourceHeight * scale));
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext('2d');
            if (!context) throw new Error('当前窗口无法创建 SVG 预览图');
            // SVG、AI 与 PDF 在画布中使用透明 SVG 预览。聊天模型不接受
            // image/svg+xml，因此只在附件边界转成 PNG，源文件与画布数据不变。
            context.clearRect(0, 0, width, height);
            context.drawImage(image, 0, 0, width, height);
            canvas.toBlob((blob) => {
              if (!blob) { reject(new Error('SVG 转 PNG 失败')); return; }
              const pngName = sourceName.replace(/\.(?:svg|ai|pdf)$/i, '') + '.png';
              resolve(new File([blob], pngName, { type: 'image/png' }));
            }, 'image/png');
          } catch (err) { reject(err); }
        };
        image.onerror = () => reject(new Error('SVG 预览无法转换为聊天图片'));
        image.src = dataURL;
      });
    }

    // ---- image path extraction ----
    function resolveImagePath(value, cwdOverride) {
      let p = String(value || '').trim().replace(/^file:\/\//i, '');
      if (/^\/[A-Za-z]:[\\/]/.test(p)) p = p.slice(1);
      if (!p || p.indexOf('data:image/') === 0) return p;
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(p)) return '';
      if (isLocalAbsolutePath(p)) return p;
      // 工具输出常带 ./ 前缀；先去掉再判断是否是被截掉首斜杠的 macOS 绝对路径。
      p = p.replace(/^\.\//, '');
      // 某些工具/模型在 XML 或富文本中会丢掉 macOS 绝对路径的首个 `/`，
      // 例如把 `/private/tmp/a.png` 输出成 `private/tmp/a.png`；不能再拼到项目 cwd 下。
      if (/^(?:private|tmp|Users|Volumes|Applications|Library|System|var|opt|usr|home|dev|etc|mnt|run)\//i.test(p)) return '/' + p;
      // 事件回放可能早于设计模式 dock 挂载。没有 cwd 时先保留原始相对路径，
      // 等会话上下文到达后在渲染阶段再次解析，避免“模型只显示路径”的丢图。
      // 聊天图像引擎的固定归档目录在画布项目内；模型最终回复常只写
      // 文件名。有当前画布项目时，裸文件名应优先指向该归档目录。
      if (p.indexOf('/') < 0 && p.indexOf('\\') < 0 && activeCanvasProjectPath) {
        return String(activeCanvasProjectPath).replace(/[\\/]+$/, '') + '/DSH聊天生成图片/' + p;
      }
      const cwd = String(cwdOverride || activeChatCwd || '').trim();
      if (!cwd) return p;
      const cwdNormalized = cwd.replace(/\\/g, '/');
      const drive = /^([A-Za-z]:)\//.exec(cwdNormalized);
      const parts = (cwdNormalized.replace(/[\\/]+$/, '') + '/' + p.replace(/^\.\//, '')).split('/');
      const normalized = [];
      for (const part of parts) {
        if (!part || part === '.') continue;
        if (part === '..') normalized.pop();
        else normalized.push(part);
      }
      if (drive) return drive[1] + '/' + normalized.slice(normalized[0] === drive[1] ? 1 : 0).join('/');
      return '/' + normalized.join('/');
    }
