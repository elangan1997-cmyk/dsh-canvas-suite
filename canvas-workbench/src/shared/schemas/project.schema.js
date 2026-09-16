// 项目文件 Schema 版本与迁移（执行文档 §14）。
// v1（1.7.0）：project.json { version: 1, canvas, assets, outputs, updatedAt }，canvas.json 无版本字段。
// v2（1.8.0）：project.json 增加 schemaVersion: 2 与 assetIndex 预留；canvas.json 不变。
// 原则：只做**加字段**的迁移，旧字段全部保留；旧版插件读到 v2 文件仍能工作（忽略未知字段）。
export const CURRENT_SCHEMA_VERSION = 2;

export function detectSchemaVersion(project) {
  if (!project || typeof project !== 'object') return 0;
  if (Number.isInteger(project.schemaVersion)) return project.schemaVersion;
  if (project.version === 1) return 1;
  return 0;
}

const MIGRATIONS = {
  // v1 → v2：加 schemaVersion；保留 version:1 以兼容旧插件；预留 assetIndex
  1: (p) => ({ ...p, version: 1, schemaVersion: 2, assetIndex: p.assetIndex && typeof p.assetIndex === 'object' ? p.assetIndex : {} })
};

/** 逐级迁移到 CURRENT_SCHEMA_VERSION；返回 { project, from, to, changed }。不可识别的文件抛错而不是静默改写。 */
export function migrateProject(project) {
  const from = detectSchemaVersion(project);
  if (from === 0) throw new Error('无法识别的项目文件（缺少 version / schemaVersion）');
  if (from > CURRENT_SCHEMA_VERSION) throw new Error(`项目文件版本 ${from} 高于当前支持的 ${CURRENT_SCHEMA_VERSION}，请升级插件`);
  let current = project;
  for (let v = from; v < CURRENT_SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) throw new Error(`缺少 v${v} → v${v + 1} 的迁移`);
    current = step(current);
  }
  return { project: current, from, to: CURRENT_SCHEMA_VERSION, changed: from !== CURRENT_SCHEMA_VERSION };
}

export function newProjectMeta(now = new Date()) {
  return { version: 1, schemaVersion: CURRENT_SCHEMA_VERSION, canvas: 'canvas.json', assets: 'assets', outputs: 'outputs', assetIndex: {}, updatedAt: now.toISOString() };
}
