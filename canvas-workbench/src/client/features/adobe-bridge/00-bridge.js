    // Adobe 桥接（客户端半边）。协议契约：adobe-bridge/PROTOCOL.md；纯函数/常量来自内联的
    // shared/utils/adobe-bridge.js（ADOBE_BRIDGE_APP_LABELS / isAdobeBridgePath …）。
    //
    //   收件：createAdobeBridgePoller —— 画布可见且已绑项目时每 3s：心跳 activate → 拉取 inbound
    //         → 未在画布的文件 add-image（customData.dshBridge 打印出处）→ ack 清单。
    //   发件：requestAdobeBridgeReturn —— srcdoc「→Ps / →Ai」按钮的 request-bridge-return 消息 → host /return。
    //   安装：installAdobeBridgeScripts —— 「更多」菜单按钮 → host /install-scripts。
    //
    // 通用"项目新文件自动上画布"会跳过 ADOBE桥接/ 下的路径（isAdobeBridgePath），避免与这里重复添加。
    const ADOBE_BRIDGE_POLL_MS = 3000;
    const adobeBridgeQuery = (current) => 'cwd=' + encodeURIComponent(current.cwd || '') + '&project=' + encodeURIComponent(current.project || '');
    const adobeBridgeJson = (url, body) => fetch(url, body === undefined
      ? { cache: 'no-store' }
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    ).then((r) => r.json().then((data) => ({ ok: r.ok, data })));

    /**
     * @param {object} deps
     * @param {() => {cwd?:string, project?:string, sessionId?:string}} deps.getProject
     * @param {(path:string) => boolean} deps.isLinked 画布上是否已有该源文件
     * @param {(path:string) => boolean} deps.isQueued 是否已在加入队列
     * @param {(items: object[]) => void} deps.addImages 交给 pendingRef + flushPending
     * @param {(text:string) => void} deps.setFeedback
     */
    function createAdobeBridgePoller({ getProject, isLinked, isQueued, addImages, setFeedback }) {
      let timer = 0;
      let disposed = false;
      let busy = false;
      const schedule = () => {
        if (disposed) return;
        clearTimeout(timer);
        timer = setTimeout(tick, ADOBE_BRIDGE_POLL_MS);
      };
      const tick = async () => {
        if (disposed) return;
        const current = getProject() || {};
        if (busy || document.visibilityState !== 'visible' || !current.project) { schedule(); return; }
        busy = true;
        try {
          const heartbeat = { cwd: current.cwd || '', project: current.project || '', sessionId: current.sessionId || '' };
          await adobeBridgeJson('/dsh-canvas/adobe-bridge/activate', heartbeat).catch(() => null);
          const result = await adobeBridgeJson('/dsh-canvas/adobe-bridge/inbound?' + adobeBridgeQuery(current));
          if (disposed || !result.ok || !result.data || !result.data.ok || !Array.isArray(result.data.jobs)) return;
          for (const job of result.data.jobs) {
            const items = Array.isArray(job.items) ? job.items : [];
            const fresh = items.filter((item) => item && item.path && !isLinked(item.path) && !isQueued(item.path));
            if (fresh.length) {
              addImages(fresh.map((item) => ({
                path: item.path, name: item.name, mtime: item.mtime, size: item.size, kind: item.kind, url: item.url, managed: true, explicit: true,
                customData: { dshBridge: { jobId: job.jobId, app: job.app, layer: item.layer && item.layer.name || '', document: job.document && job.document.name || '' } }
              })));
            }
            await adobeBridgeJson('/dsh-canvas/adobe-bridge/ack', { ...heartbeat, manifest: job.manifestName }).catch(() => null);
            const label = ADOBE_BRIDGE_APP_LABELS[job.app] || job.app;
            const names = items.map((item) => (item.layer && item.layer.name) || item.name).join('、');
            setFeedback('✓ 已从 ' + label + ' 接收 ' + items.length + ' 张图片' + (fresh.length !== items.length ? '（' + (items.length - fresh.length) + ' 张已在画布）' : '') + '：' + names);
          }
        } catch (err) {
          // 轮询失败静默重试；host 不在线时 fetch 直接 reject，不打扰用户。
        } finally {
          busy = false;
          schedule();
        }
      };
      return {
        start() { disposed = false; clearTimeout(timer); void tick(); },
        stop() { disposed = true; clearTimeout(timer); }
      };
    }

    /** srcdoc「→Ps / →Ai」→ 写发件箱。detail: { app, items:[{sourcePath, dataURL, name, bridge}] } */
    function requestAdobeBridgeReturn(current, detail, setFeedback) {
      const app = ADOBE_BRIDGE_APPS.includes(detail && detail.app) ? detail.app : 'photoshop';
      const label = ADOBE_BRIDGE_APP_LABELS[app];
      const items = Array.isArray(detail && detail.items) ? detail.items : [];
      setFeedback('正在把 ' + items.length + ' 张图片放入 ' + label + ' 发件箱…');
      return adobeBridgeJson('/dsh-canvas/adobe-bridge/return', { cwd: current.cwd || '', project: current.project || '', app, items })
        .then((result) => {
          if (!result.ok || !result.data || !result.data.ok) throw new Error((result.data && result.data.error) || '写入发件箱失败');
          const d = result.data;
          const originName = d.origin ? ((d.origin.layer && d.origin.layer.name) || (d.origin.document && d.origin.document.name) || '') : '';
          const hint = '在 ' + label + ' 里打开「文件 → 脚本 → DSH画布桥接」面板，点「刷新」后「置入」或「打开」';
          setFeedback('✓ 已放入 ' + label + ' 发件箱 #' + d.seq + '（' + (d.files || []).length + ' 个文件' + (originName ? '，可归位到「' + originName + '」' : '') + '）；' + hint);
        })
        .catch((err) => setFeedback('⚠ 返回 ' + label + ' 失败：' + String((err && err.message) || err)));
    }

    /** 「更多 → 安装 Adobe 桥接脚本」：把 adobe-bridge/*.jsx 拷进本机 PS/AI 的 Scripts 目录。
     *  权限不足的目录（macOS 的 /Applications 通常是 root）会给出 sudo 命令；用户副本永远可用「浏览…/其它脚本…」打开。 */
    function installAdobeBridgeScripts(setFeedback) {
      setFeedback('正在安装 Adobe 桥接脚本面板…');
      return adobeBridgeJson('/dsh-canvas/adobe-bridge/install-scripts', {})
        .then((result) => {
          const d = result.data || {};
          if (!result.ok || !d.ok) throw new Error(d.error || '安装失败');
          const okNames = (d.installed || []).map((i) => i.name).join('、');
          const badText = (d.errors || []).map((e) => (e.name ? e.name + '：' : '') + e.error + (e.hint ? '（' + e.hint + '）' : '')).join('；');
          const head = okNames
            ? '✓ 桥接脚本已安装到 ' + okNames + '。重启 PS/AI 后在「文件 → 脚本」打开「DSH画布桥接」面板'
            : '⚠ 没有装进任何 Adobe 菜单目录。' + (d.manualHint || '');
          setFeedback(head + (badText ? '。其余：' + badText : '') + (okNames && d.userCopyDir ? '。用户副本：' + d.userCopyDir : ''));
        })
        .catch((err) => setFeedback('⚠ 安装桥接脚本失败：' + String((err && err.message) || err)));
    }
