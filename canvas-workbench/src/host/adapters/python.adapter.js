// Python Tool Registry（执行文档 §20）：业务代码不再写死脚本路径，统一按 id 解析与调用。
// 现有 10 个脚本仍在 scripts/ 根目录（物理重组见 §20.1，待路由改为经注册表调用后再搬，避免同一提交里
// 既动路径又动调用方）。
import { join } from 'node:path';

export const PYTHON_TOOLS = Object.freeze([
  { id: 'image.pixel-edit', script: 'scripts/pixel_edit.py', group: 'image' },
  { id: 'image.composite-edit', script: 'scripts/composite_edit.py', group: 'image' },
  { id: 'image.prepare-mask', script: 'scripts/prepare_mask.py', group: 'image' },
  { id: 'image.prepare-model-input', script: 'scripts/prepare_model_input.py', group: 'image' },
  { id: 'text.ocr', script: 'scripts/ocr_image.py', group: 'text' },
  { id: 'text.infer-style', script: 'scripts/infer_text_style.py', group: 'text' },
  { id: 'text.prepare-mask', script: 'scripts/prepare_text_mask.py', group: 'text' },
  { id: 'background.remove', script: 'scripts/remove_background.py', group: 'background' },
  { id: 'vector.vectorize', script: 'scripts/vectorize_image.py', group: 'vector' },
  { id: 'psd.export-text', script: 'scripts/export_text_psd.py', group: 'psd' }
]);

/**
 * @param {object} opts
 * @param {string} opts.pluginRoot 插件根目录
 * @param {(ctx) => Promise<string>} opts.resolvePython 解析 python 可执行文件（platform adapter）
 * @param {(executable, args, cwd, timeoutMs?) => Promise<{exitCode, stdout, stderr}>} opts.run 子进程执行
 */
export function createPythonToolRegistry({ pluginRoot, resolvePython, run }) {
  const tools = new Map();
  const api = {
    register(tool) {
      if (!tool || !tool.id || !tool.script) throw new Error('python tool 需要 id 与 script');
      tools.set(tool.id, { ...tool, path: join(pluginRoot, tool.script) });
      return tools.get(tool.id);
    },
    resolve(id) {
      const tool = tools.get(id);
      if (!tool) throw new Error('未注册的 Python 工具：' + id);
      return tool;
    },
    list() { return [...tools.values()].map((t) => ({ id: t.id, script: t.script, group: t.group, path: t.path })); },
    async run(id, { ctx, args = [], cwd, timeoutMs } = {}) {
      const tool = api.resolve(id);
      const python = await resolvePython(ctx);
      return run(python, [tool.path, ...args], cwd, timeoutMs);
    }
  };
  for (const tool of PYTHON_TOOLS) api.register(tool);
  return api;
}
