import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendStartupLog, startupLogPath, summarizeEnvironment, tailLines } from '../windows-installer/launcher-startup-diagnostics.mjs';

const root = mkdtempSync(join(tmpdir(), 'dsh-launcher-diagnostics-'));
const env = {
  LOCALAPPDATA: root,
  PATH: `C:\\bundled\\bin;C:\\Windows\\System32`,
  DSH_HOME: 'C:\\Users\\Test\\.dsh',
  API_KEY: 'should-not-be-copied',
};
const summary = summarizeEnvironment(env);
assert.deepEqual(summary.relevant.PATH, ['C:\\bundled\\bin', 'C:\\Windows\\System32']);
assert.equal(summary.keys.includes('API_KEY'), true);
assert.equal(summary.relevant.API_KEY, undefined);
assert.equal(tailLines('a\r\nb\r\nc\r\n', 2), 'b\nc');
const logPath = startupLogPath(env);
appendStartupLog('spawn', { executable: 'C:\\DSH\\DeepSeek Harness.exe', args: ['web'], cwd: 'C:\\Users\\Test', env: summary }, env);
assert.equal(existsSync(logPath), true);
const line = JSON.parse(readFileSync(logPath, 'utf8').trim());
assert.equal(line.event, 'spawn');
assert.equal(line.executable, 'C:\\DSH\\DeepSeek Harness.exe');
console.log('launcher diagnostics checks passed');
