    // ---- v1.8 内核对象：Feature Registry / Command Bus / History ----
    // 仅创建并挂到 window.__dshCanvas 供诊断与后续 Feature 接入；不改变现有 UI 行为。
    const dshFeatureRegistry = createFeatureRegistry();
    for (const feature of BUILTIN_FEATURES) dshFeatureRegistry.register(feature);
    const dshHistory = createHistoryManager({ limit: 100 });
    const dshCommandBus = createCommandBus({ history: dshHistory });
    try {
      window.__dshCanvas = Object.assign(window.__dshCanvas || {}, {
        features: dshFeatureRegistry,
        commands: dshCommandBus,
        history: dshHistory,
        Command,
        capabilitiesFromHealth,
        fromExcalidrawElement
      });
    } catch (e) {}
