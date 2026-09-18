// dsh-codex 图像 Provider（自 lib/image-engine.js 逐字迁移，v1.8 Phase 3）。
// 只处理输入/状态/输出/错误，不感知 UI（执行文档 §3.3）。
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dshHome } from '../../host/services/image-engine-settings.js';
import { dataUrl } from '../../shared/utils/image-bytes.js';

async function moduleCandidates() {
  const root = dshHome();
  const candidates = [];
  // Resolve from the canvas plugin that is currently loaded by DSH first. This
  // keeps chat inference and canvas image generation on the exact same
  // dsh-codex build/profile instead of accidentally finding another profile's
  // stale copy during the fallback directory scan below.
  try {
    const resolved = import.meta.resolve('dsh-codex');
    if (resolved && resolved.startsWith('file:')) candidates.push(fileURLToPath(resolved));
  } catch {}
  candidates.push(
    process.env.DSH_CODEX_MODULE_PATH,
    join(process.cwd(), 'node_modules', 'dsh-codex', 'lib', 'index.js'),
    join(root, 'profiles', 'web', 'node_modules', 'dsh-codex', 'lib', 'index.js'),
    join(root, 'profiles', 'desktop', 'node_modules', 'dsh-codex', 'lib', 'index.js'),
    join(root, 'profiles', 'node_modules', 'dsh-codex', 'lib', 'index.js'),
  );
  try {
    const profiles = await (await import('node:fs/promises')).readdir(join(root, 'profiles'), { withFileTypes: true });
    for (const profile of profiles) {
      if (!profile.isDirectory()) continue;
      candidates.push(join(root, 'profiles', profile.name, 'node_modules', 'dsh-codex', 'lib', 'index.js'));
    }
  } catch {}
  return [...new Set(candidates.filter(Boolean))];
}

async function loadCodexModule() {
  for (const filename of await moduleCandidates()) {
    try {
      await access(filename);
      return await import(pathToFileURL(filename).href);
    } catch {}
  }
  throw new Error('未找到 dsh-codex，请先在当前 DSH profile 安装 dsh-codex');
}

async function generateWithDshCodex({ ctx, image, prompt, signal }) {
  const module = await loadCodexModule();
  const service = typeof ctx.get === 'function' ? ctx.get('openAICodex') : null;
  const credentials = service && service.credentials
    ? service.credentials
    : module.OpenAICodexCredentialStore ? new module.OpenAICodexCredentialStore() : null;
  if (!credentials || !module.OpenAICodexImageClient) throw new Error('当前 dsh-codex 未提供图片编辑客户端，请重启 DSH 后重试');
  const client = new module.OpenAICodexImageClient(credentials);
  const images = Array.isArray(image) ? image : image ? [image] : [];
  return Buffer.from(await client.generate(prompt, images.map(dataUrl), signal || AbortSignal.timeout(360000)));
}

export const dshCodexProvider = {
  id: 'dsh-codex',
  capabilities: ['image.generate', 'image.edit'],
  loadCodexModule,
  async generate({ ctx, images, prompt, signal }) {
    return generateWithDshCodex({ ctx, image: images, prompt, signal });
  },
  async health(ctx) {
    let installed = false;
    try { await loadCodexModule(); installed = true; } catch {}
    let authenticated = false;
    try {
      const service = typeof ctx.get === 'function' ? ctx.get('openAICodex') : null;
      if (service && typeof service.authStatus === 'function') authenticated = Boolean((await service.authStatus()).authenticated);
      else if (installed) {
        const module = await loadCodexModule();
        if (module.openAICodexAuthStatus) authenticated = Boolean((await module.openAICodexAuthStatus()).authenticated);
      }
    } catch {}
    return { installed, authenticated, ready: installed && authenticated };
  }
};
