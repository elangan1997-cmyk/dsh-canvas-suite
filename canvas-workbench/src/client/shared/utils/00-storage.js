    function canvasDefaultBackground() {
      try { return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? '#15171c' : '#f7f8fa'; } catch (e) { return '#f7f8fa'; }
    }
    // 目录同步不需要高频轮询：可见时保持较快反馈，窗口隐藏时完全暂停，
    // 重新显示后会立即补做一次同步。这样可以显著减少 Finder/外置盘的 I/O。
    const PROJECT_SYNC_INTERVAL = 8000;

    // ---- design-mode state (module-level) ----
    function readStorageValue(storage, key) {
      try {
        const value = storage && storage.getItem(key);
        return value == null ? null : value;
      } catch (e) {
        return null;
      }
    }
    function writeStorageValue(storage, key, value) {
      try {
        if (storage) storage.setItem(key, value);
        return true;
      } catch (e) {
        return false;
      }
    }
    function removeStorageValue(storage, key) {
      try { if (storage) storage.removeItem(key); } catch (e) {}
    }
