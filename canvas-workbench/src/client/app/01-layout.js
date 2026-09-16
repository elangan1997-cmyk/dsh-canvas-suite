    // ---- right-docked overlay panel ----
    // ---- real split-pane: push the app content left by the panel width ----
    function findAppFrame() {
      const layer = document.querySelector('[data-shell-overlay]');
      return layer && layer.parentElement ? layer.parentElement : null;
    }
    let layoutPulseFrame = 0;
    let layoutPulseTimer = 0;
    let layoutPulseLateTimer = 0;
    let framePaddingToken = 0;
    function notifySplitLayout() {
      cancelAnimationFrame(layoutPulseFrame);
      clearTimeout(layoutPulseTimer);
      clearTimeout(layoutPulseLateTimer);
      layoutPulseFrame = requestAnimationFrame(() => {
        layoutPulseFrame = requestAnimationFrame(() => {
          // DSH 的聊天列表和输入框会缓存可用宽度；主动模拟一次窗口尺寸变化，
          // 等价于用户手动拖动分隔条，但不会移动实际窗口。
          window.dispatchEvent(new Event('resize'));
          if (window.visualViewport) window.visualViewport.dispatchEvent(new Event('resize'));
        });
      });
      // 字体、会话输入框等异步布局完成后再校正一次。
      layoutPulseTimer = setTimeout(() => window.dispatchEvent(new Event('resize')), 180);
      layoutPulseLateTimer = setTimeout(() => window.dispatchEvent(new Event('resize')), 720);
    }
    function applyFramePadding(px) {
      const frame = findAppFrame();
      const token = ++framePaddingToken;
      if (frame) {
        frame.style.boxSizing = px ? 'border-box' : '';
        frame.style.minWidth = px ? '0' : '';
        // 刷新恢复时用 1px 无感几何变化触发聊天区真实 ResizeObserver，
        // 再回到目标宽度；等价于用户轻拉一次分隔条。
        frame.style.paddingRight = px ? (px + 1) + 'px' : '';
        void frame.offsetWidth;
        if (px) requestAnimationFrame(() => {
          if (token !== framePaddingToken || findAppFrame() !== frame) return;
          frame.style.paddingRight = px + 'px';
          void frame.offsetWidth;
          notifySplitLayout();
        });
      }
      notifySplitLayout();
    }

    function canvasPathWithin(parent, child) {
      const base = String(parent || '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/+$/g, '');
      const target = String(child || '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/+$/g, '');
      if (!base || !target) return false;
      const insensitive = /^[A-Za-z]:\//.test(base) || /^[A-Za-z]:\//.test(target);
      const left = insensitive ? base.toLowerCase() : base;
      const right = insensitive ? target.toLowerCase() : target;
      return right === left || right.indexOf(left + '/') === 0;
    }

    class CanvasOverlayBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
      }
      static getDerivedStateFromError(error) {
        return { error };
      }
      componentDidCatch(error) {
        try { console.error('[canvas-workbench] CanvasOverlay render failed', error); } catch (_) {}
      }
      render() {
        if (!this.state.error) return React.createElement(CanvasOverlay, this.props);
        const message = String(this.state.error && this.state.error.message || this.state.error || 'unknown error');
        return React.createElement('div', {
          style: { position: 'fixed', top: 0, right: 0, bottom: 0, width: '420px', zIndex: 1000, background: '#15171c', color: '#fecaca', padding: '24px', boxSizing: 'border-box', font: '13px/1.5 sans-serif', whiteSpace: 'pre-wrap', overflow: 'auto', pointerEvents: 'auto' }
        }, 'Canvas overlay failed\\n' + message);
      }
    }

