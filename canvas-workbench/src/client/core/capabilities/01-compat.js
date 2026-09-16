    // ---- plugin ----
    function compatibilityLogger(ctx, level, message, error) {
      try {
        const logger = ctx && ctx.logger;
        const fn = logger && (logger[level] || logger.info);
        if (typeof fn === 'function') fn.call(logger, '[canvas-workbench] ' + message + (error ? ': ' + (error.message || String(error)) : ''));
        else if (typeof console !== 'undefined' && console[level]) console[level]('[canvas-workbench] ' + message, error || '');
      } catch (e) {}
    }
    function safeEffect(ctx, label, setup) {
      try {
        if (ctx && typeof ctx.effect === 'function') return ctx.effect(() => {
          try { return setup(); }
          catch (error) { compatibilityLogger(ctx, 'warn', label + ' 已停用', error); return () => {}; }
        });
        const dispose = setup();
        return typeof dispose === 'function' ? dispose : () => {};
      } catch (error) {
        compatibilityLogger(ctx, 'warn', label + ' 注册失败', error);
        return () => {};
      }
    }
    function safeSlot(ctx, name, registration, useEffect) {
      const install = () => {
        if (!ctx || !ctx.slots || typeof ctx.slots.inject !== 'function' || typeof ctx.slots.register !== 'function') {
          compatibilityLogger(ctx, 'warn', '当前 DSH 不提供插槽 ' + name);
          return () => {};
        }
        const result = ctx.slots.inject(name, () => {
          try { return ctx.slots.register(registration.options, registration.component); }
          catch (error) { compatibilityLogger(ctx, 'warn', '插槽 ' + name + ' 注册失败', error); return () => {}; }
        });
        if (result && typeof result.catch === 'function') result.catch((error) => compatibilityLogger(ctx, 'warn', '插槽 ' + name + ' 注入失败', error));
        return typeof result === 'function' ? result : () => {};
      };
      return useEffect === false ? install() : safeEffect(ctx, '插槽 ' + name, install);
    }
