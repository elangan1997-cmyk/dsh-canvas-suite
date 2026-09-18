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

    /** srcdoc「→Ps / →Ai」→ 写发件箱；host 会顺手远程置入运行中的 PS/AI（用户不必开面板）。detail: { app, items:[…] } */
    function requestAdobeBridgeReturn(current, detail, setFeedback) {
      const app = ADOBE_BRIDGE_APPS.includes(detail && detail.app) ? detail.app : 'photoshop';
      const label = ADOBE_BRIDGE_APP_LABELS[app];
      const items = Array.isArray(detail && detail.items) ? detail.items : [];
      setFeedback('正在把 ' + items.length + ' 张图片送回 ' + label + '…');
      return adobeBridgeJson('/dsh-canvas/adobe-bridge/return', { cwd: current.cwd || '', project: current.project || '', app, items })
        .then((result) => {
          if (!result.ok || !result.data || !result.data.ok) throw new Error((result.data && result.data.error) || '写入发件箱失败');
          const d = result.data;
          const remote = d.remote || {};
          const originName = d.origin ? ((d.origin.layer && d.origin.layer.name) || (d.origin.document && d.origin.document.name) || '') : '';
          let tail;
          if (Number(remote.placed) > 0) tail = '已直接置入 ' + label + (originName ? '并归位到「' + originName + '」' : '') + '（' + remote.placed + ' 项）';
          else if (remote.attempted && !remote.running) tail = label + ' 未运行——打开它后在「文件 → 脚本 → DSH画布桥接」面板点「置入」';
          else if (remote.error) tail = '自动置入失败：' + remote.error + '；可在 ' + label + ' 面板点「置入」';
          else tail = '在 ' + label + ' 面板点「置入」';
          setFeedback('✓ ' + tail + '（发件箱 #' + d.seq + '，' + (d.files || []).length + ' 个文件）');
        })
        .catch((err) => setFeedback('⚠ 返回 ' + label + ' 失败：' + String((err && err.message) || err)));
    }

    /** 顶栏「取 Ps 图层 / 取 Ai 对象」：远程让运行中的 PS/AI 把当前选区送进收件箱，轮询器随后自动上画布。 */
    function pullFromAdobe(current, app, setFeedback, opts) {
      const label = ADOBE_BRIDGE_APP_LABELS[app] || app;
      const what = app === 'photoshop' ? '图层' : '对象';
      setFeedback('正在从 ' + label + ' 取当前选中的' + what + '…');
      return adobeBridgeJson('/dsh-canvas/adobe-bridge/pull', { cwd: current.cwd || '', project: current.project || '', sessionId: current.sessionId || '', app, merged: !!(opts && opts.merged), dpi: opts && opts.dpi })
        .then((result) => {
          const d = result.data || {};
          if (!result.ok || !d.ok) throw new Error(d.error || '取回失败');
          setFeedback('✓ 已从 ' + label + ' 取到 ' + d.count + ' 项' + what + '，几秒内出现在画布上');
        })
        .catch((err) => setFeedback('⚠ 从 ' + label + ' 取' + what + '失败：' + String((err && err.message) || err)));
    }

    /** 「更多」里的两个安装入口。
     *  elevate=false：只刷新用户副本（远程驱动 / 「浏览…」用它；DSH 启动时也自动做）。
     *  elevate=true（macOS）：PS/AI 的应用脚本目录都是 root 权限，弹系统管理员密码框把脚本装进菜单——
     *  密码由 macOS 自己的对话框收集，插件接触不到。实测 PS 2025 不扫描用户级目录，菜单入口只有这条路。 */
    function installAdobeBridgeScripts(setFeedback, elevate) {
      setFeedback(elevate ? '请在系统弹出的对话框里输入 Mac 管理员密码…' : '正在刷新桥接脚本副本…');
      return adobeBridgeJson('/dsh-canvas/adobe-bridge/install-scripts', { elevate: !!elevate })
        .then((result) => {
          const d = result.data || {};
          if (!result.ok || !d.ok) throw new Error(d.error || '安装失败');
          const okNames = (d.installed || []).map((i) => i.name).join('、');
          if (!elevate) {
            setFeedback('✓ 脚本副本已刷新：' + (d.userCopyDir || '') + (okNames ? '；菜单目录也已更新（' + okNames + '）' : '；要进 PS/AI 菜单请点「🔐 安装 PS / AI 菜单面板」'));
            return;
          }
          const badText = (d.errors || []).map((e) => (e.name ? e.name + '：' : '') + e.error).join('；');
          setFeedback((okNames ? '✓ 已装进 ' + okNames + ' 的脚本菜单。重启 PS/AI 后在「文件 → 脚本」里就有「DSH画布桥接」' : '⚠ 没有装进任何 Adobe 菜单目录。' + (d.manualHint || '')) + (badText ? '。未成功：' + badText : ''));
        })
        .catch((err) => setFeedback('⚠ ' + (elevate ? '安装菜单面板' : '刷新脚本副本') + '失败：' + String((err && err.message) || err)));
    }
