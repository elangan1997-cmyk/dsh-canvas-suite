    let mode = false;
    // 设计模式原先只写 sessionStorage，导致重启后右侧画布又关闭。
    // localStorage 是主存储；保留 sessionStorage 作为旧版本迁移来源。
    const storedMode = readStorageValue(window.localStorage, MODE_KEY);
    const legacyMode = readStorageValue(window.sessionStorage, MODE_KEY);
    mode = storedMode === '1' || (storedMode == null && legacyMode === '1');
    if (storedMode == null && legacyMode === '1') writeStorageValue(window.localStorage, MODE_KEY, '1');
    const modeListeners = new Set();
    function getMode() { return mode; }
    function setMode(v) {
      mode = !!v;
      if (mode) {
        writeStorageValue(window.localStorage, MODE_KEY, '1');
        // 兼容同一页面内仍在运行的旧 client 副本。
        writeStorageValue(window.sessionStorage, MODE_KEY, '1');
      } else {
        removeStorageValue(window.localStorage, MODE_KEY);
        removeStorageValue(window.sessionStorage, MODE_KEY);
      }
      for (const fn of [...modeListeners]) fn(mode);
    }
    function toggleMode() { setMode(!mode); }
    function subscribeMode(fn) { modeListeners.add(fn); return () => { modeListeners.delete(fn); }; }
