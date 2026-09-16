// 最小事件总线（执行文档 §24）：Feature / Job / Asset 之间只通过事件通信，不互相 import 内部实现。
export function createEventBus() {
  const listeners = new Map();
  return {
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return () => listeners.get(event)?.delete(fn);
    },
    once(event, fn) {
      const off = this.on(event, (payload) => { off(); fn(payload); });
      return off;
    },
    emit(event, payload) {
      let count = 0;
      for (const fn of [...(listeners.get(event) || [])]) { count += 1; try { fn(payload); } catch (err) { /* 监听器异常不影响发布方 */ } }
      for (const fn of [...(listeners.get('*') || [])]) { try { fn({ event, payload }); } catch {} }
      return count;
    },
    listenerCount(event) { return listeners.get(event)?.size || 0; },
    clear() { listeners.clear(); }
  };
}
