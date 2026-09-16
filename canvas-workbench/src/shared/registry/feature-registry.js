// Feature Registry（执行文档 §4）+ Capability 判定（§5）。共享模块：无 DOM / Node 依赖，Host 与 Client 都可用。
// Feature 定义：{ id, name, capabilities: string[], commands?, toolbarItems?, panels?, initialize?(ctx), dispose?() }
export function createFeatureRegistry() {
  const features = new Map();
  const enabledIds = new Set();
  return {
    register(feature) {
      if (!feature || typeof feature.id !== 'string' || !feature.id) throw new Error('feature 缺少 id');
      if (features.has(feature.id)) throw new Error('feature 重复注册：' + feature.id);
      features.set(feature.id, { capabilities: [], commands: [], toolbarItems: [], panels: [], inspectors: [], contextMenuItems: [], ...feature });
      return features.get(feature.id);
    },
    unregister(id) {
      const f = features.get(id);
      if (f && enabledIds.has(id)) { try { if (typeof f.dispose === 'function') f.dispose(); } catch {} enabledIds.delete(id); }
      return features.delete(id);
    },
    get(id) { return features.get(id) || null; },
    list() { return [...features.values()]; },
    /** 给定 capability 集合（Set / 数组 / {name:boolean}），返回可启用的 feature：其所需 capabilities 全部为真。 */
    enabled(capabilities) {
      const has = capabilityPredicate(capabilities);
      return this.list().filter((f) => f.capabilities.every(has));
    },
    /** 按 capability 集合启用/停用，调用 initialize/dispose；返回 { enabled, disabled }。 */
    apply(capabilities, ctx) {
      const has = capabilityPredicate(capabilities);
      const enabled = [], disabled = [];
      for (const f of this.list()) {
        const ok = f.capabilities.every(has);
        if (ok && !enabledIds.has(f.id)) { try { if (typeof f.initialize === 'function') f.initialize(ctx); } catch {} enabledIds.add(f.id); enabled.push(f.id); }
        else if (!ok && enabledIds.has(f.id)) { try { if (typeof f.dispose === 'function') f.dispose(); } catch {} enabledIds.delete(f.id); disabled.push(f.id); }
      }
      return { enabled, disabled };
    },
    isEnabled(id) { return enabledIds.has(id); }
  };
}

export function capabilityPredicate(capabilities) {
  if (capabilities instanceof Set) return (c) => capabilities.has(c);
  if (Array.isArray(capabilities)) { const s = new Set(capabilities); return (c) => s.has(c); }
  if (capabilities && typeof capabilities === 'object') return (c) => Boolean(capabilities[c]);
  return () => false;
}

/** 1.8.0 已有能力的 Feature 声明（数据层清单：谁需要什么能力）。 */
export const BUILTIN_FEATURES = Object.freeze([
  { id: 'canvas-core', name: '无限画布', capabilities: ['canvas.basic'] },
  { id: 'project-browser', name: '项目管理', capabilities: ['canvas.basic', 'project.store'] },
  { id: 'material-library', name: '素材库', capabilities: ['canvas.basic', 'materials.list'] },
  { id: 'chat-image-output', name: '聊天图片输出', capabilities: ['chat.turnTail'] },
  { id: 'image-generation', name: '图片生成', capabilities: ['image.generate'] },
  { id: 'image-edit', name: '编辑图片 / 智能擦除', capabilities: ['image.edit'] },
  { id: 'background-remove', name: '去除背景', capabilities: ['python.available'] },
  { id: 'vectorize', name: '转矢量', capabilities: ['python.available'] },
  { id: 'text-edit', name: '文字识别与重建', capabilities: ['text.recognition'] },
  { id: 'psd-export', name: 'PSD 导出', capabilities: ['text.psd-export', 'python.available'] },
  { id: 'export', name: 'PNG 导出', capabilities: ['canvas.basic'] },
  { id: 'video-generation', name: '视频生成（预留）', capabilities: ['video.generate'] }
]);

/** 由 /dsh-canvas/health 的返回推导 capability 集合（Client 侧用；Host 侧可直接构造）。 */
export function capabilitiesFromHealth(health = {}) {
  const caps = { 'canvas.basic': true };
  const c = health.capabilities || {};
  caps['project.store'] = c.webServer !== false;
  caps['materials.list'] = c.webServer !== false;
  caps['image.generate'] = Boolean(health.imageEngine && ((health.imageEngine.dshCodex && health.imageEngine.dshCodex.ready) || (health.imageEngine.api && health.imageEngine.api.ready)));
  caps['image.edit'] = caps['image.generate'];
  caps['text.recognition'] = Boolean(c.llm && c.attachments);
  caps['python.available'] = health.platform ? health.platform.localPythonFeatures !== 'unavailable' : false;
  caps['text.psd-export'] = caps['python.available'];
  caps['video.generate'] = false;
  return caps;
}
