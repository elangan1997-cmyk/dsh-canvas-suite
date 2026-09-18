// 自 lib/index.js 机械迁移（v1.8 Phase 2），函数体逐字未改。
import { basename, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';

const MATERIAL_TAG_COLORS = new Set(['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray']);

function materialTagsPath() {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'canvas-workbench', 'material-tags.json');
}

async function readMaterialTags() {
  try {
    const parsed = JSON.parse(await readFile(materialTagsPath(), 'utf8'));
    if (parsed && typeof parsed === 'object' && parsed.tags && typeof parsed.tags === 'object') return parsed.tags;
  } catch (err) {}
  return {};
}

async function writeMaterialTags(tags) {
  const path = materialTagsPath();
  const value = JSON.stringify({ version: 1, updatedAt: Date.now(), tags });
  await mkdir(dirname(path), { recursive: true });
  const temporary = path + '.hosttmp';
  try {
    await writeFile(temporary, value, 'utf8');
    await rename(temporary, path);
  } catch (err) {
    await writeFile(path, value, 'utf8').catch(() => {});
    await unlink(temporary).catch(() => {});
  }
}

function tagsForDirectory(tags, directory) {
  const prefix = String(directory || '').replace(/[\\/]+$/, '') + '/';
  const result = {};
  for (const [path, color] of Object.entries(tags)) {
    if (typeof path === 'string' && path.startsWith(prefix)) result[basename(path)] = color;
  }
  return result;
}

export { MATERIAL_TAG_COLORS, materialTagsPath, readMaterialTags, writeMaterialTags, tagsForDirectory };
