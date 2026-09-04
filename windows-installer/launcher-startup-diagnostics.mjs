import { appendFileSync, mkdirSync } from 'node:fs';
import { delimiter, join } from 'node:path';

const SENSITIVE_NAME = /(token|secret|password|credential|cookie|authorization|api[_-]?key)/i;
const RELEVANT_ENV = new Set([
  'ALL_PROXY',
  'DSH_HOME',
  'ELECTRON_RUN_AS_NODE',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NODE_OPTIONS',
  'NODE_PATH',
  'NODE_USE_ENV_PROXY',
  'PATH',
  'PATHEXT',
  'PYTHONHOME',
  'PYTHONPATH',
]);

/** Absolute per-user startup log requested by the Windows launcher contract. */
export function startupLogPath(env = process.env) {
  const localAppData = env.LOCALAPPDATA ?? join(env.APPDATA ?? '.', '..', 'Local');
  return join(localAppData, 'DSH', 'Logs', 'startup.log');
}

/** Redact secrets while retaining enough environment detail to diagnose PATH/runtime issues. */
export function summarizeEnvironment(env = process.env) {
  const keys = Object.keys(env).sort();
  const relevant = {};
  const keyLookup = new Map(keys.map((key) => [key.toLowerCase(), key]));
  for (const name of RELEVANT_ENV) {
    const actualName = keyLookup.get(name.toLowerCase());
    if (actualName === undefined) continue;
    const value = String(env[actualName] ?? '');
    if (SENSITIVE_NAME.test(name)) {
      relevant[name] = '<redacted>';
    } else if (name === 'PATH') {
      relevant[name] = value.split(delimiter).filter(Boolean);
    } else if (name === 'HTTP_PROXY' || name === 'HTTPS_PROXY' || name === 'ALL_PROXY') {
      relevant[name] = value ? '<set>' : '<empty>';
    } else {
      relevant[name] = value;
    }
  }
  return { keyCount: keys.length, keys, relevant };
}

/** Append one structured event; startup diagnostics must survive a GUI crash. */
export function appendStartupLog(event, payload = {}, env = process.env) {
  const path = startupLogPath(env);
  try {
    mkdirSync(join(path, '..'), { recursive: true });
    appendFileSync(path, `${JSON.stringify({
      timestamp: new Date().toISOString(),
      event,
      ...payload,
    })}\n`, 'utf8');
  } catch {
    // Logging must never prevent the Desktop shell from attempting to start.
  }
  return path;
}

export function tailLines(value, count = 10) {
  const lines = String(value ?? '').replace(/\r\n/g, '\n').split('\n');
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.slice(-count).join('\n');
}

export function startupFailure(message, details = {}) {
  const error = new Error(message);
  error.startupDetails = details;
  return error;
}
