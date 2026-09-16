    // ---- HTTP helpers ----
    function isLocalAbsolutePath(path) {
      return /^(?:~[\\/]|[A-Za-z]:[\\/]|\\\\|\/)/.test(String(path || ''));
    }
    function imageUrl(path) {
      if (typeof path === 'string' && /^(?:data:image\/|https?:\/\/|blob:)/i.test(path)) return path;
      // 绝对 URL：iframe 与主页面都按同一 origin 解析，避免任何 base URL 歧义。
      // 本地相对路径要按当前会话 cwd 解析；事件回放可能早于设计模式 dock 挂载。
      const resolved = resolveImagePath(path);
      if (!resolved || !isLocalAbsolutePath(resolved)) return '';
      try {
        return new URL('/dsh-canvas/image?path=' + encodeURIComponent(resolved), window.location.href).href;
      } catch (e) {
        return '/dsh-canvas/image?path=' + encodeURIComponent(resolved);
      }
    }
    function previewUrl(path) {
      if (typeof path === 'string' && /^(?:data:image\/|https?:\/\/|blob:)/i.test(path)) return path;
      const resolved = resolveImagePath(path);
      if (!resolved || !isLocalAbsolutePath(resolved)) return '';
      try {
        return new URL('/dsh-canvas/preview?path=' + encodeURIComponent(resolved), window.location.href).href;
      } catch (e) {
        return '/dsh-canvas/preview?path=' + encodeURIComponent(resolved);
      }
    }
    function displaySourceUrl(path) {
      if (typeof path === 'string' && /^(?:data:image\/|https?:\/\/|blob:)/i.test(path)) return path;
      if (attachmentFromPath(path)) return '';
      const resolved = resolveImagePath(path);
      if (!resolved || !isLocalAbsolutePath(resolved)) return '';
      return /\.(?:psd|svg|pdf|ai)$/i.test(String(resolved || '')) ? previewUrl(resolved) : imageUrl(resolved);
    }

    // DSH 原生 Markdown 会把 `/Volumes/...png` 当成站内 URL，浏览器因此只显示 alt 文字。
    // 在 DOM 层将这类本地图片地址改写为插件的同源图片接口，同时覆盖历史消息。
    function localPathFromMarkdownImage(img) {
      if (!img || img.dataset.dshCanvasLocalImage === '1') return '';
      const raw = String(img.getAttribute('src') || '').trim();
      if (!raw || raw.indexOf('/dsh-canvas/') >= 0) return '';
      if (/^(?:[A-Za-z]:[\\/]|\\\\|\/Volumes\/|\/Users\/|\/private\/|\/var\/|~\/)/.test(raw)) return raw;
      try {
        const parsed = new URL(raw, window.location.href);
        if (parsed.origin === window.location.origin && /^(?:\/Volumes\/|\/Users\/|\/private\/|\/var\/)/.test(parsed.pathname)) {
          return decodeURIComponent(parsed.pathname);
        }
      } catch (e) {}
      return '';
    }
    function installLocalMarkdownImageFallback() {
      const rewrite = (img) => {
        const path = localPathFromMarkdownImage(img);
        if (!path || !IMAGE_EXT_RE.test(path)) return;
        const src = displaySourceUrl(path);
        if (!src) return;
        img.dataset.dshCanvasLocalImage = '1';
        img.src = src;
      };
      const scan = (root) => {
        if (!root || root.nodeType !== 1) return;
        if (root.tagName === 'IMG') rewrite(root);
        if (root.querySelectorAll) root.querySelectorAll('img').forEach(rewrite);
      };
      document.querySelectorAll('img').forEach(rewrite);
      const observer = new MutationObserver((records) => {
        for (const record of records) for (const node of record.addedNodes || []) scan(node);
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      const onError = (event) => {
        const target = event.target;
        if (target && target.tagName === 'IMG') rewrite(target);
      };
      window.addEventListener('error', onError, true);
      return () => {
        observer.disconnect();
        window.removeEventListener('error', onError, true);
      };
    }
    function stateEndpoint(cwd, project) {
      const q = project ? 'project=' + encodeURIComponent(project) : (cwd ? 'cwd=' + encodeURIComponent(cwd) : '');
      return '/dsh-canvas/state' + (q ? '?' + q : '');
    }
