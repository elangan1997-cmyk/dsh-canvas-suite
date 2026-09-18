// CanvasObject 契约（执行文档 §6）：业务层对象，不再把 Excalidraw element 当唯一数据结构。
// 第一阶段通过 adapter 与旧 element 双向转换，不删除旧 element 数据（Phase 7 要求）。
export const CANVAS_OBJECT_TYPES = ['image', 'text', 'video', 'shape', 'group'];

export function createCanvasObject(input = {}) {
  const type = CANVAS_OBJECT_TYPES.includes(input.type) ? input.type : 'shape';
  const t = input.transform || {};
  return {
    id: String(input.id || ''),
    type,
    transform: {
      x: Number(t.x) || 0,
      y: Number(t.y) || 0,
      width: Number(t.width) || 0,
      height: Number(t.height) || 0,
      rotation: Number(t.rotation) || 0,
      scaleX: t.scaleX === undefined ? 1 : Number(t.scaleX) || 1,
      scaleY: t.scaleY === undefined ? 1 : Number(t.scaleY) || 1
    },
    locked: Boolean(input.locked),
    visible: input.visible === undefined ? true : Boolean(input.visible),
    metadata: input.metadata && typeof input.metadata === 'object' ? { ...input.metadata } : {}
  };
}

/** Excalidraw image element → ImageObject（保留 customData 于 metadata；assetId 暂以来源路径承载）。 */
export function fromExcalidrawElement(el) {
  if (!el || typeof el !== 'object') return null;
  const custom = el.customData && typeof el.customData === 'object' ? el.customData : {};
  const base = createCanvasObject({
    id: el.id,
    type: el.type === 'image' ? 'image' : el.type === 'text' ? 'text' : 'shape',
    transform: { x: el.x, y: el.y, width: el.width, height: el.height, rotation: el.angle, scaleX: Array.isArray(el.scale) ? el.scale[0] : 1, scaleY: Array.isArray(el.scale) ? el.scale[1] : 1 },
    locked: el.locked,
    visible: !el.isDeleted,
    metadata: { excalidraw: { fileId: el.fileId || null, version: el.version || 1, opacity: el.opacity }, customData: custom }
  });
  if (base.type === 'image') {
    return {
      ...base,
      assetId: custom.dshAssetId || (custom.dshSourcePath ? 'path:' + custom.dshSourcePath : null),
      fileName: custom.dshFileName || null,
      tagColor: custom.dshTagColor || null,
      crop: null,
      opacity: el.opacity === undefined ? 1 : Number(el.opacity) / 100
    };
  }
  if (base.type === 'text') {
    return { ...base, content: String(el.text || ''), style: { fontFamily: el.fontFamily, fontSize: el.fontSize, color: el.strokeColor, textAlign: el.textAlign || 'left', opacity: el.opacity === undefined ? 1 : Number(el.opacity) / 100 } };
  }
  return base;
}

/** 把 ImageObject 的可变字段写回 Excalidraw element（只写业务层允许改的字段，其余原样）。 */
export function applyToExcalidrawElement(el, obj) {
  if (!el || !obj) return el;
  const next = { ...el, x: obj.transform.x, y: obj.transform.y, width: obj.transform.width, height: obj.transform.height, angle: obj.transform.rotation, locked: Boolean(obj.locked), isDeleted: !obj.visible };
  if (obj.type === 'image') {
    const custom = { ...(el.customData || {}) };
    if (obj.tagColor) custom.dshTagColor = obj.tagColor; else delete custom.dshTagColor;
    if (obj.fileName) custom.dshFileName = obj.fileName;
    next.customData = custom;
  }
  return next;
}
