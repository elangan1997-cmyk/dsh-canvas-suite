/**
 * @local/canvas-workbench — Host half（入口薄壳）
 *
 * v1.8 起 Host 源码位于 src/host/（路由 routes/、服务 services/、共享工具 ../shared/）。
 * 本文件只负责保持 package.json main 与 DSH 加载器约定不变：导出 apply / inject / name。
 */
export { apply, inject, name } from '../src/host/index.js';
