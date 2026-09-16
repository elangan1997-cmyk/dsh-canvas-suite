// Generation Provider Registry（执行文档 §9）。
// Provider 只需实现 { id, capabilities, generate(input), health(ctx?) }；
// 异步视频类 Provider 未来补 submit/getStatus/cancel/getResult（§26）。
export function createProviderRegistry() {
  const providers = new Map();
  return {
    register(provider) {
      if (!provider || typeof provider.id !== 'string' || !provider.id) throw new Error('provider 缺少 id');
      if (typeof provider.generate !== 'function') throw new Error(`provider ${provider.id} 缺少 generate()`);
      providers.set(provider.id, provider);
      return provider;
    },
    unregister(id) { return providers.delete(id); },
    get(id) { return providers.get(id); },
    require(id) {
      const provider = providers.get(id);
      if (!provider) throw new Error(`未注册的生成引擎：${id}`);
      return provider;
    },
    list() { return [...providers.values()]; },
    findByCapability(capability) { return this.list().filter((p) => (p.capabilities || []).includes(capability)); }
  };
}
