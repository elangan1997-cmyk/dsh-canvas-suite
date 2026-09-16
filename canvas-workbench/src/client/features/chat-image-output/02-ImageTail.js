    // ---- turn-tail inline images ----
    function ImageTail(props) {
      const images = props.matched || [];
      // 本轮开始时间由聚合节点写进每个条目；旧会话条目没有该字段时为 0，跳过新旧过滤。
      const turnStart = (images.length && images[0] && images[0].startTime) || 0;
      const [preview, setPreview] = React.useState(null);
      const [failed, setFailed] = React.useState({});
      const [swapped, setSwapped] = React.useState({});
      const [hidden, setHidden] = React.useState({});
      const [resolvedSources, setResolvedSources] = React.useState({});
      const [contextRevision, setContextRevision] = React.useState(activeChatContextRevision);
      const key = images.map((i) => i.path).join('|');
      const archivedOutputPath = (path) => activeCanvasProjectPath
        ? String(activeCanvasProjectPath).replace(/[\\/]+$/, '') + '/DSH聊天生成图片/' + imageName(path)
        : '';
      const canonicalOutputPath = (path) => {
        if (!path || attachmentFromPath(path) || isDirectImageSource(path) || !activeCanvasProjectPath) return path;
        const normalized = String(path).replace(/\\/g, '/');
        if (normalized.indexOf('/') < 0 || normalized.indexOf('/DSH聊天生成图片/') >= 0) {
          return String(activeCanvasProjectPath).replace(/[\\/]+$/, '') + '/DSH聊天生成图片/' + imageName(path);
        }
        return path;
      };
      React.useEffect(() => {
        const onContext = () => setContextRevision(activeChatContextRevision);
        window.addEventListener('dsh-canvas:project-context', onContext);
        return () => window.removeEventListener('dsh-canvas:project-context', onContext);
      }, []);
      React.useEffect(() => {
        // 原生 DSH 的 resolveImage 缓存键包含 sessionId；切换会话时也要清掉
        // 组件本地的 Blob URL，避免不同会话复用同名 attachmentId。
        setResolvedSources({});
        setFailed({});
        setSwapped({});
        setHidden({});
        setPreview(null);
      }, [key, activeChatSessionId, contextRevision]);
      React.useEffect(() => {
        // 只校验本地路径；会话附件和远程/data URL 由各自的加载逻辑处理。
        // 文件刚由模型写入时可能有短暂竞态，因此最多重试 4 次，再隐藏确实
        // 不存在的引用。这样不会把“模型提到但没有生成”的路径渲染成破图卡片。
        // 存在性通过后还做新旧判定：源文件 mtime 早于本轮开始时间（留 2 秒
        // 文件系统时间戳容差）说明只是本轮引用的旧图（read_image 对比、文字
        // 提及旧版本），不属于本轮图片输出，同样隐藏。
        let cancelled = false;
        const hide = (path) => setHidden((prev) => (prev[path] ? prev : { ...prev, [path]: true }));
        const isStale = (data) => !!turnStart && !!data && data.ok === true && typeof data.mtime === 'number' && data.mtime < turnStart - 2000;
        const localImages = images.filter((img) => img && !attachmentFromPath(img.path) && !isDirectImageSource(img.path));
        const check = (img, attempt = 0) => {
          if (cancelled || !img) return;
          const resolved = resolveImagePath(canonicalOutputPath(img.path));
          // 事件可能早于当前会话 cwd 到达；等 project-context 事件触发后再检查。
          if (!resolved || !isLocalAbsolutePath(resolved)) return;
          const url = '/dsh-canvas/image-status?path=' + encodeURIComponent(resolved);
          fetch(url, { cache: 'no-store' }).then((response) => {
            if (cancelled) return;
            if (!response.ok) {
              if (attempt < 3) {
                setTimeout(() => check(img, attempt + 1), 250 * (attempt + 1));
                return;
              }
              hide(img.path);
              return;
            }
            response.json().then((data) => {
              if (cancelled || !data || !data.ok) return;
              if (isStale(data)) hide(img.path);
            }).catch(() => {});
          }).catch(() => {
            if (cancelled) return;
            if (attempt < 3) {
              setTimeout(() => check(img, attempt + 1), 250 * (attempt + 1));
            } else {
              hide(img.path);
            }
          });
        };
        // 附件条目（imagegen / read_image 结果）用同名 sourcePath 做同样的新旧判定；
        // 没有文件可查的纯附件（DSH 原生 imagegen）无法判定，保持显示。
        const checkAttachmentAge = (img) => {
          if (cancelled || !img || !img.sourcePath || attachmentFromPath(img.sourcePath) || !turnStart) return;
          const resolved = resolveImagePath(canonicalOutputPath(img.sourcePath));
          if (!resolved || !isLocalAbsolutePath(resolved)) return;
          fetch('/dsh-canvas/image-status?path=' + encodeURIComponent(resolved), { cache: 'no-store' })
            .then((response) => (response.ok ? response.json() : null))
            .then((data) => {
              if (cancelled || !data) return;
              if (isStale(data)) hide(img.path);
            })
            .catch(() => {});
        };
        localImages.forEach((img) => {
          if (!hidden[img.path]) check(img);
        });
        images.forEach((img) => {
          if (img && img.sourcePath && !hidden[img.path]) checkAttachmentAge(img);
        });
        return () => { cancelled = true; };
      }, [key, activeChatSessionId, contextRevision, turnStart]);
      const visibleImages = images.filter((img) => !hidden[img.path]);
      React.useEffect(() => {
        let cancelled = false;
        const pending = visibleImages.filter((img) => attachmentFromPath(img.path) && !resolvedSources[img.path] && !failed[img.path]);
        if (!pending.length) return () => { cancelled = true; };
        Promise.all(pending.map((img) => resolveAttachmentSource(img.path)
          .then((url) => ({ path: img.path, url }))
          .catch(() => ({ path: img.path, error: true }))))
          .then((results) => {
            if (cancelled) return;
            const next = {};
            const errors = {};
            for (const result of results) {
              if (result.url) next[result.path] = result.url;
              if (result.error) errors[result.path] = true;
            }
            if (Object.keys(next).length) setResolvedSources((prev) => ({ ...prev, ...next }));
            if (Object.keys(errors).length) setFailed((prev) => ({ ...prev, ...errors }));
          });
        return () => { cancelled = true; };
      }, [key, activeChatSessionId, contextRevision]);
      if (!visibleImages.length) return null;
      // 附件条目的可操作文件路径：优先条目自带 sourcePath（归档真实文件），
      // 其次当前画布项目拼接路径，最后退回附件引用本身（交给附件解析）。
      const actionPathOf = (img) => {
        if (!img || !attachmentFromPath(img.path)) return canonicalOutputPath(img.path);
        return (img.sourcePath && !attachmentFromPath(img.sourcePath) && img.sourcePath) || archivedOutputPath(img.path) || img.path;
      };
      const send = (path) => dispatchResolvedImage(canonicalOutputPath(path));
      const rows = visibleImages.map((img) => {
        const canonicalPath = canonicalOutputPath(img.path);
        // 旧会话的 attachmentId 可能随 DSH 更新或会话回放失效；画布路由
        // 已同时把原图归档到项目目录，附件解析失败时直接用同名归档文件。
        // 设计模式的生图在返回附件前已原子落盘。回退源优先用条目自带的
        // sourcePath（路由归档的真实文件路径），其次才是按当前画布项目拼接
        // 的归档路径——切到别的会话/画布未绑定时，前者仍然可用，避免缩略图
        // 因 DSH 附件解析失败而整体碎图。
        const fallbackSourcePath = actionPathOf(img);
        const usingAttachmentFallback = !!(attachmentFromPath(img.path) && fallbackSourcePath);
        const attachmentFallback = usingAttachmentFallback ? displaySourceUrl(fallbackSourcePath) : '';
        const actionPath = fallbackSourcePath;
        const src = attachmentFromPath(img.path) ? ((swapped[img.path] ? '' : resolvedSources[img.path]) || attachmentFallback) : displaySourceUrl(canonicalPath);
        const loading = !src && !failed[img.path];
        return React.createElement('div', { key: img.path, className: 'dsh-canvas-image' },
          React.createElement('button', {
            className: 'dsh-canvas-image-box dsh-canvas-image-send',
            title: '点击查看大图',
            onClick: () => setPreview(img)
          },
            failed[img.path] && !src
              ? React.createElement('span', { className: 'dsh-canvas-image-loading' }, '图片加载失败')
              : loading
                ? React.createElement('span', { className: 'dsh-canvas-image-loading' }, '图片加载中…')
              : React.createElement('img', {
                src,
                alt: imageName(img.path),
                className: 'dsh-canvas-image-img',
                loading: 'lazy',
                decoding: 'async',
                referrerPolicy: 'no-referrer',
                onLoad: () => { if (!usingAttachmentFallback) setFailed((prev) => prev[img.path] ? { ...prev, [img.path]: false } : prev); },
                onError: () => {
                  // 附件解析出的 URL 加载失败（blob 失效/会话切换）时，切换到归档文件回退源再试一次。
                  if (attachmentFromPath(img.path) && !usingAttachmentFallback && attachmentFallback) {
                    setSwapped((prev) => (prev[img.path] ? prev : { ...prev, [img.path]: true }));
                    return;
                  }
                  setFailed((prev) => ({ ...prev, [img.path]: true }));
                }
              })
          ),
          React.createElement('div', { className: 'dsh-canvas-image-meta' },
            React.createElement('span', { className: 'dsh-canvas-image-name', title: actionPath }, imageName(img.path)),
            React.createElement('div', { className: 'dsh-canvas-image-actions' },
              React.createElement('button', { className: 'dsh-canvas-add-btn', title: '在系统文件管理器中选中这个文件', onClick: () => revealImageInFinder(actionPath) }, '在文件夹中显示'),
              React.createElement('button', { className: 'dsh-canvas-add-btn', onClick: () => dispatchResolvedImage(actionPath) }, '加入画布')
            )
          )
        );
      });
      const columns = visibleImages.length === 1 ? 1 : (visibleImages.length <= 4 ? 2 : 3);
      return React.createElement(React.Fragment, null,
        React.createElement('div', { key, className: 'dsh-canvas-tool-output' },
          React.createElement('div', { className: 'dsh-canvas-tool-bar' },
            React.createElement('span', { className: 'dsh-canvas-tool-title' }, '图片输出'),
            React.createElement('span', { className: 'dsh-canvas-tool-count' }, visibleImages.length + ' 张'),
            React.createElement('button', { className: 'dsh-canvas-tool-btn', onClick: () => visibleImages.forEach((img) => send(actionPathOf(img))) }, '全部加入画布')
          ),
          React.createElement('div', { className: 'dsh-canvas-images dsh-canvas-images-cols-' + columns }, rows)
        ),
        preview ? React.createElement('div', { className: 'dsh-canvas-lightbox', role: 'dialog', 'aria-modal': 'true', onClick: () => setPreview(null) },
          React.createElement('div', { className: 'dsh-canvas-lightbox-inner', onClick: (event) => event.stopPropagation() },
            (() => {
              // 大图与缩略图同源：附件优先归档文件（sourcePath 回退），避免
              // 项目未绑定时大图永远“加载中”。
              const previewActionPath = actionPathOf(preview);
              const previewSrc = attachmentFromPath(preview.path)
                ? (displaySourceUrl(previewActionPath) || resolvedSources[preview.path] || '')
                : displaySourceUrl(canonicalOutputPath(preview.path));
              return previewSrc
                ? React.createElement('img', { src: previewSrc, alt: imageName(preview.path), className: 'dsh-canvas-lightbox-image', decoding: 'async', referrerPolicy: 'no-referrer' })
                : React.createElement('span', { className: 'dsh-canvas-image-loading' }, failed[preview.path] ? '图片加载失败' : '图片加载中…');
            })(),
            React.createElement('div', { className: 'dsh-canvas-lightbox-bar' },
              React.createElement('span', { title: actionPathOf(preview) }, imageName(preview.path)),
              React.createElement('button', { onClick: () => revealImageInFinder(actionPathOf(preview)) }, '在文件夹中显示'),
              React.createElement('button', { onClick: () => send(actionPathOf(preview)) }, '加入画布'),
              React.createElement('button', { onClick: () => setPreview(null) }, '关闭')
            )
          )
        ) : null
      );
    }

