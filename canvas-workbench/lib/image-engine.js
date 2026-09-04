import { access, chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { homedir } from 'node:os';

const DEFAULT_API_BASE_URL = 'https://ai-pixel.online';
const DEFAULT_API_MODEL = 'gpt-image-2';
const ENGINE_VALUES = new Set(['dsh-codex', 'api']);
const PIXEL_BROWSER_USER_AGENT = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36 DSH-Canvas/1.4';

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh');
}

export function imageEngineSettingsPath() {
  return join(dshHome(), 'canvas-workbench', 'image-engine.json');
}

export function normalizeImageEngine(value) {
  return ENGINE_VALUES.has(String(value || '').trim()) ? String(value).trim() : 'dsh-codex';
}

function normalizeApiBaseUrl(value, fallback = DEFAULT_API_BASE_URL) {
  const clean = String(value || '').trim().replace(/\/+$/, '').replace(/\/v1$/i, '');
  return clean || fallback;
}

function normalizeExecutablePath(value) {
  return String(value || '').trim().slice(0, 1024);
}

export async function readImageEngineSettings() {
  const defaults = {
    engine: 'dsh-codex',
    apiBaseUrl: DEFAULT_API_BASE_URL,
    apiModel: DEFAULT_API_MODEL,
    photoshopPath: '',
    illustratorPath: ''
  };
  try {
    const parsed = JSON.parse(await readFile(imageEngineSettingsPath(), 'utf8'));
    if (!parsed || typeof parsed !== 'object') return defaults;
    return {
      ...defaults,
      ...parsed,
      engine: normalizeImageEngine(parsed.engine),
      apiBaseUrl: normalizeApiBaseUrl(parsed.apiBaseUrl, defaults.apiBaseUrl),
      apiModel: String(parsed.apiModel || defaults.apiModel).trim() || defaults.apiModel,
      photoshopPath: normalizeExecutablePath(parsed.photoshopPath),
      illustratorPath: normalizeExecutablePath(parsed.illustratorPath),
    };
  } catch {
    return defaults;
  }
}

export async function writeImageEngineSettings(patch = {}) {
  const current = await readImageEngineSettings();
  const next = {
    ...current,
    ...patch,
    engine: normalizeImageEngine(patch.engine ?? current.engine),
    apiBaseUrl: normalizeApiBaseUrl(patch.apiBaseUrl ?? current.apiBaseUrl),
    apiModel: String(patch.apiModel ?? current.apiModel).trim() || DEFAULT_API_MODEL,
    photoshopPath: normalizeExecutablePath(patch.photoshopPath ?? current.photoshopPath),
    illustratorPath: normalizeExecutablePath(patch.illustratorPath ?? current.illustratorPath),
  };
  const filename = imageEngineSettingsPath();
  await mkdir(dirname(filename), { recursive: true, mode: 0o700 });
  await writeFile(filename, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return next;
}

function collectApiValue(value, names) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  for (const name of names) if (typeof value[name] === 'string' && value[name].trim()) return value[name].trim();
  return '';
}

export async function readLegacyApiAuth() {
  const filename = join(homedir(), '.codex-pixel', 'auth.json');
  try {
    const value = JSON.parse(await readFile(filename, 'utf8'));
    const apiKey = collectApiValue(value, ['OPENAI_API_KEY', 'apiKey', 'api_key', 'token', 'key'])
      || collectApiValue(value.credentials, ['OPENAI_API_KEY', 'apiKey', 'api_key', 'token', 'key']);
    const baseUrl = collectApiValue(value, ['OPENAI_BASE_URL', 'BASE_URL', 'baseUrl', 'base_url']);
    return { filename, configured: Boolean(apiKey), apiKey, baseUrl };
  } catch {
    return { filename, configured: false, apiKey: '', baseUrl: '' };
  }
}

export async function writeLegacyApiAuth({ apiKey, baseUrl, clear = false } = {}) {
  const filename = join(homedir(), '.codex-pixel', 'auth.json');
  let current = {};
  try {
    const parsed = JSON.parse(await readFile(filename, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) current = parsed;
  } catch {}
  const next = { ...current };
  const cleanKey = String(apiKey || '').trim();
  const cleanBase = normalizeApiBaseUrl(baseUrl, '');
  if (clear) {
    for (const key of ['OPENAI_API_KEY', 'apiKey', 'api_key', 'token', 'key']) delete next[key];
    if (next.credentials && typeof next.credentials === 'object') {
      next.credentials = { ...next.credentials };
      for (const key of ['OPENAI_API_KEY', 'apiKey', 'api_key', 'token', 'key']) delete next.credentials[key];
    }
  } else if (cleanKey) {
    next.OPENAI_API_KEY = cleanKey;
  }
  if (cleanBase) next.OPENAI_BASE_URL = cleanBase;
  await mkdir(dirname(filename), { recursive: true, mode: 0o700 });
  await writeFile(filename, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmod(filename, 0o600).catch(() => {});
  return { filename, configured: Boolean(collectApiValue(next, ['OPENAI_API_KEY', 'apiKey', 'api_key', 'token', 'key']) || collectApiValue(next.credentials, ['OPENAI_API_KEY', 'apiKey', 'api_key', 'token', 'key'])) };
}

async function moduleCandidates() {
  const root = dshHome();
  const candidates = [
    process.env.DSH_CODEX_MODULE_PATH,
    join(root, 'profiles', 'web', 'node_modules', 'dsh-codex', 'lib', 'index.js'),
    join(root, 'profiles', 'desktop', 'node_modules', 'dsh-codex', 'lib', 'index.js'),
    join(root, 'profiles', 'node_modules', 'dsh-codex', 'lib', 'index.js'),
  ].filter(Boolean);
  try {
    const profiles = await (await import('node:fs/promises')).readdir(join(root, 'profiles'), { withFileTypes: true });
    for (const profile of profiles) {
      if (!profile.isDirectory()) continue;
      candidates.push(join(root, 'profiles', profile.name, 'node_modules', 'dsh-codex', 'lib', 'index.js'));
    }
  } catch {}
  return [...new Set(candidates)];
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

export function imageMediaType(bytes) {
  const b = Buffer.from(bytes);
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (b.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return 'image/jpeg';
  if (b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (b.subarray(0, 6).toString('ascii') === 'GIF87a' || b.subarray(0, 6).toString('ascii') === 'GIF89a') return 'image/gif';
  return 'application/octet-stream';
}

function dataUrl(bytes) {
  const mediaType = imageMediaType(bytes);
  if (!mediaType.startsWith('image/')) throw new Error('图片输入格式无效');
  return `data:${mediaType};base64,${Buffer.from(bytes).toString('base64')}`;
}

function effectiveApiBase(settings, auth) {
  const configuredBase = String(settings.apiBaseUrl || '').trim();
  return normalizeApiBaseUrl(configuredBase && configuredBase !== DEFAULT_API_BASE_URL
    ? configuredBase
    : (auth.baseUrl || configuredBase || DEFAULT_API_BASE_URL));
}

function modelIdsFromPayload(payload) {
  const values = payload && Array.isArray(payload.data)
    ? payload.data
    : payload && Array.isArray(payload.models) ? payload.models : [];
  return [...new Set(values.map((item) => typeof item === 'string' ? item : item && (item.id || item.model || item.name)).filter(Boolean).map(String))];
}

function parseImagePayload(payload) {
  const item = payload && Array.isArray(payload.data) ? payload.data[0] : null;
  if (!item || typeof item !== 'object') throw new Error('API 未返回图片数据');
  if (typeof item.b64_json === 'string' && item.b64_json.trim()) return Buffer.from(item.b64_json.trim(), 'base64');
  if (typeof item.url === 'string' && item.url.trim()) return fetch(item.url).then(async (response) => {
    if (!response.ok) throw new Error(`图片下载失败（HTTP ${response.status}）`);
    return Buffer.from(await response.arrayBuffer());
  });
  throw new Error('API 未返回可读取的图片数据');
}

const RETRYABLE_IMAGE_API_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524]);

function imageApiRetryDelay(response, attempt) {
  const raw = response && response.headers ? response.headers.get('retry-after') : '';
  if (raw !== null && raw !== '') {
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(20000, Math.round(seconds * 1000));
    const at = Date.parse(raw);
    if (Number.isFinite(at)) return Math.min(20000, Math.max(0, at - Date.now()));
  }
  // Pixel 的 502/52x 通常是上游短时窗口；2s/5s 连续重试只会
  // 再次命中同一故障。给网关留出恢复时间，最长不超过 40s。
  return Math.min(40000, 10000 * (2 ** Math.max(0, attempt - 1)));
}

function waitForImageApiRetry(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(signal.reason || new Error('请求已取消'));
    const timer = setTimeout(done, Math.max(0, ms));
    function done() { if (signal) signal.removeEventListener('abort', aborted); resolve(); }
    function aborted() { clearTimeout(timer); if (signal) signal.removeEventListener('abort', aborted); reject(signal.reason || new Error('请求已取消')); }
    if (signal) signal.addEventListener('abort', aborted, { once: true });
  });
}

async function generateWithApi({ image, mask, prompt, settings, signal }) {
  const auth = await readLegacyApiAuth();
  if (!auth.configured) throw new Error(`未配置 image2 API 密钥：${auth.filename}`);
  // 保留旧版 auth.json 中的自定义网关；只有设置文件明确改过默认地址时才覆盖它。
  const base = effectiveApiBase(settings, auth);
  // 图片网关失败时不要让用户等待多轮长重试；一次重试足以覆盖短暂的
  // 502/429，同时把真实错误尽快展示在画布状态栏。
  const maxAttempts = 2;
  let lastFailure = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const form = new FormData();
    form.append('model', String(settings.apiModel || DEFAULT_API_MODEL));
    form.append('prompt', prompt);
    form.append('quality', 'high');
    if (image && image.length) form.append('image', new Blob([image], { type: imageMediaType(image) }), 'input.png');
    if (image && image.length && mask) form.append('mask', new Blob([mask], { type: 'image/png' }), 'mask.png');
    let response;
    try {
      // 图片网关在高峰期可能需要 3-5 分钟；单次调用必须小于外层任务总预算，
      // 但不能沿用旧的 180 秒，否则请求会在网关受理前/生成中途被本机主动切断。
      const timeoutSignal = AbortSignal.timeout(180000);
      response = await fetch(`${base}/v1/images/${image && image.length ? 'edits' : 'generations'}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${auth.apiKey}`,
          accept: 'application/json',
          'user-agent': PIXEL_BROWSER_USER_AGENT,
        },
        body: form,
        signal: signal && typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
      });
    } catch (error) {
      if (signal && signal.aborted) throw new Error('画布图片任务超过总等待时间，本机已停止请求；API 可能尚未受理，请在恢复的窗口中重试');
      lastFailure = error && error.name === 'TimeoutError' ? '请求超时' : String((error && error.message) || error);
      // A timed-out generation may still be running upstream. Retrying it
      // immediately doubles both the wait (previously ~370s) and the chance
      // of being billed twice, while the Desktop UI looks frozen. Retry one
      // transient connection failure, but surface a full 180s timeout now.
      if (error && error.name === 'TimeoutError') {
        throw new Error('image2 API 生成超过 180 秒，已停止等待且不会自动重复提交；请检查模型、输入尺寸和服务商任务状态后重试');
      }
      if (attempt < maxAttempts) { await waitForImageApiRetry(Math.min(40000, 10000 * (2 ** Math.max(0, attempt - 1))), signal); continue; }
      throw new Error(`image2 API 连接失败：${lastFailure}（已自动重试 ${maxAttempts - 1} 次）`);
    }
    let payload = null;
    try { payload = await response.json(); } catch {}
    if (response.ok) {
      if (!payload) throw new Error(`image2 API 返回无效响应（HTTP ${response.status}，响应为空或不是 JSON）`);
      const bytes = Buffer.from(await parseImagePayload(payload));
      if (!bytes.length || !imageMediaType(bytes).startsWith('image/')) throw new Error('image2 API 返回了空数据或不可识别的图片格式');
      if (bytes.byteLength > 32 * 1024 * 1024) throw new Error('image2 API 返回图片超过 32MB，已拒绝写入');
      return bytes;
    }
    const detail = payload && payload.error && typeof payload.error.message === 'string' ? payload.error.message : '';
    lastFailure = `HTTP ${response.status}${detail ? `：${detail}` : ''}`;
    if (RETRYABLE_IMAGE_API_STATUSES.has(response.status) && attempt < maxAttempts) {
      await waitForImageApiRetry(imageApiRetryDelay(response, attempt), signal);
      continue;
    }
    const retried = RETRYABLE_IMAGE_API_STATUSES.has(response.status) ? `（已自动重试 ${attempt - 1} 次）` : '';
    throw new Error(`image2 API 请求失败（${lastFailure}）${retried}`);
  }
  throw new Error(`image2 API 请求失败：${lastFailure || '未知错误'}（已自动重试 ${maxAttempts - 1} 次）`);
}

export async function testImageApiConnection() {
  const settings = await readImageEngineSettings();
  const auth = await readLegacyApiAuth();
  if (!auth.configured) throw new Error('请先填写并保存 API Key');
  const baseUrl = effectiveApiBase(settings, auth);
  const started = Date.now();
  let response;
  try {
    response = await fetch(`${baseUrl}/v1/models`, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${auth.apiKey}`,
        accept: 'application/json',
        'user-agent': PIXEL_BROWSER_USER_AGENT,
      },
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    throw new Error(`无法连接 API 地址：${error && error.name === 'TimeoutError' ? '连接超时' : String((error && error.message) || error)}`);
  }
  if (response.status === 401 || response.status === 403) throw new Error(`API Key 未通过认证（HTTP ${response.status}）`);
  if (response.status >= 500) throw new Error(`API 服务暂不可用（HTTP ${response.status}）`);
  let payload = null;
  try { payload = await response.json(); } catch {}
  const modelIds = response.ok ? modelIdsFromPayload(payload) : [];
  const selectedModel = String(settings.apiModel || DEFAULT_API_MODEL).trim();
  const modelAvailable = !modelIds.length || modelIds.includes(selectedModel);
  if (response.ok && modelIds.length && !modelAvailable) {
    throw new Error(`API 密钥已通过认证，但当前分组未提供模型 ${selectedModel}；请在服务商后台为该密钥绑定支持此模型的分组`);
  }
  // 部分图片网关只实现 /v1/images/*，models 返回 404/405 仍能证明地址可达；
  // 真正的编辑请求仍会在首次使用时校验模型与额度。
  return {
    ok: response.ok,
    reachable: true,
    authAccepted: response.status !== 401 && response.status !== 403,
    endpointSupported: response.status !== 404 && response.status !== 405,
    status: response.status,
    latencyMs: Date.now() - started,
    baseUrl,
    model: selectedModel,
    modelAvailable,
    availableModelCount: modelIds.length,
  };
}

async function generateWithDshCodex({ ctx, image, images, mask, prompt, signal }) {
  const module = await loadCodexModule();
  const service = typeof ctx.get === 'function' ? ctx.get('openAICodex') : null;
  const credentials = service && service.credentials
    ? service.credentials
    : module.OpenAICodexCredentialStore ? new module.OpenAICodexCredentialStore() : null;
  if (!credentials || !module.OpenAICodexImageClient) throw new Error('当前 dsh-codex 未提供图片编辑客户端，请重启 DSH 后重试');
  const client = new module.OpenAICodexImageClient(credentials);
  const inputImages = Array.isArray(images) && images.length ? images.slice() : (image && image.length ? [image] : []);
  // The Codex image endpoint has no multipart `mask` field like the API
  // endpoint.  Preserve the user's selection by sending the prepared mask as
  // a second, explicit reference image and describe its alpha convention in
  // the prompt.  Previously mask was silently dropped here, so both erase and
  // masked edit appeared to succeed while returning the unchanged source.
  if (mask && mask.length) inputImages.push(mask);
  const references = inputImages.filter((item) => item && item.length).map((item) => dataUrl(item));
  const routedPrompt = mask && mask.length
    ? String(prompt || '') + '\n遮罩输入说明：第一张图片是原图，最后一张图片是与原图同尺寸的 PNG 遮罩；遮罩透明区域（alpha=0）是唯一允许修改/擦除的区域，遮罩不透明区域必须保持原样。不要把遮罩本身当作设计内容，不要在遮罩外重绘。'
    : prompt;
  return Buffer.from(await client.generate(routedPrompt, references, signal || AbortSignal.timeout(180000)));
}

export async function generateImage({ ctx, image, images, mask, prompt, engine, signal }) {
  const settings = await readImageEngineSettings();
  const selected = normalizeImageEngine(engine || settings.engine);
  const bytes = Buffer.from(image || []);
  if (selected === 'dsh-codex') return { engine: selected, bytes: await generateWithDshCodex({ ctx, image: bytes, images, mask, prompt, signal }) };
  if (!bytes.length && selected !== 'api') throw new Error('图片输入为空');
  return { engine: selected, bytes: await generateWithApi({ image: bytes, mask, prompt, settings, signal }) };
}

export async function imageEngineHealth(ctx) {
  const settings = await readImageEngineSettings();
  const auth = await readLegacyApiAuth();
  let codexInstalled = false;
  try { await loadCodexModule(); codexInstalled = true; } catch {}
  let codexAuthenticated = false;
  try {
    const service = typeof ctx.get === 'function' ? ctx.get('openAICodex') : null;
    if (service && typeof service.authStatus === 'function') codexAuthenticated = Boolean((await service.authStatus()).authenticated);
    else if (codexInstalled) {
      const module = await loadCodexModule();
      if (module.openAICodexAuthStatus) codexAuthenticated = Boolean((await module.openAICodexAuthStatus()).authenticated);
    }
  } catch {}
  return {
    engine: settings.engine,
    api: { configured: auth.configured, baseUrl: effectiveApiBase(settings, auth), model: settings.apiModel, ready: auth.configured },
    dshCodex: { installed: codexInstalled, authenticated: codexAuthenticated, ready: codexInstalled && codexAuthenticated },
    settingsPath: imageEngineSettingsPath(),
  };
}
