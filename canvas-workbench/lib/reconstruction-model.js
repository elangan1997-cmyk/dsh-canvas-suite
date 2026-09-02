/**
 * Pure data helpers for Visual Typography Reconstruction.
 *
 * The host keeps all rectangles in original-image pixels.  Normalized values
 * are transport metadata only; no screen/CSS/zoom coordinate is accepted by
 * these helpers.  The module intentionally does not call an OCR or image
 * model, which keeps routing and validation deterministic and testable.
 */

import { clusterSelections } from './text-reconstruction.js';

const REMOVAL_MODES = new Set(['text_only', 'text_container', 'component']);

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }

function rect(value) {
  return {
    x: Math.max(0, number(value && value.x)),
    y: Math.max(0, number(value && value.y)),
    width: Math.max(0, number(value && value.width)),
    height: Math.max(0, number(value && value.height)),
  };
}

function overlap(a, b) {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

function gap(a, b) {
  const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width));
  const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height));
  return Math.sqrt(dx * dx + dy * dy);
}

function unionRect(rects) {
  const list = rects.map(rect).filter((item) => item.width > 0 && item.height > 0);
  if (!list.length) return { x: 0, y: 0, width: 0, height: 0 };
  const left = Math.min(...list.map((item) => item.x));
  const top = Math.min(...list.map((item) => item.y));
  const right = Math.max(...list.map((item) => item.x + item.width));
  const bottom = Math.max(...list.map((item) => item.y + item.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function expandRect(value, width, height, margin) {
  const source = rect(value);
  const safeWidth = Math.max(1, number(width, 1));
  const safeHeight = Math.max(1, number(height, 1));
  const pad = Math.max(0, number(margin));
  const left = clamp(source.x - pad, 0, safeWidth);
  const top = clamp(source.y - pad, 0, safeHeight);
  const right = clamp(source.x + source.width + pad, 0, safeWidth);
  const bottom = clamp(source.y + source.height + pad, 0, safeHeight);
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

export function inferComponentType(textObject = {}) {
  const declared = String(textObject.componentType || '').trim();
  if (['text_only', 'badge', 'label', 'button', 'text_with_icon', 'graphic_group', 'unknown'].includes(declared) && declared !== 'unknown') return declared;
  const mode = String(textObject.removalMode || 'text_only');
  if (mode === 'component') return 'graphic_group';
  if (mode === 'text_container') {
    const hint = String(textObject.backgroundHint || '').toLowerCase();
    if (/button|按钮/.test(hint)) return 'button';
    if (/badge|标签|贴纸/.test(hint)) return 'badge';
    return 'label';
  }
  return 'text_only';
}

export function buildTextObjects(blocks, selections = [], imageWidth = 1, imageHeight = 1) {
  const regions = Array.isArray(selections) ? selections : [];
  const safeWidth = Math.max(1, number(imageWidth, 1));
  const safeHeight = Math.max(1, number(imageHeight, 1));
  return (Array.isArray(blocks) ? blocks : []).map((item, index) => {
    const sourceSelectionId = String(item && (item.sourceSelectionId || item.selectionId) || '').trim()
      || (regions.length === 1 ? String(regions[0].id || '') : '');
    const geometry = rect(item);
    const removalMode = REMOVAL_MODES.has(String(item && item.removalMode)) ? String(item.removalMode) : 'text_only';
    const recognition = clamp(number(item && item.confidence, 0) / 100, 0, 1);
    const geometryConfidence = clamp(number(item && item.geometryConfidence, item && item.confidence != null ? recognition : 0), 0, 1);
    const fontMatch = clamp(number(item && item.fontMatchConfidence, 0), 0, 1);
    const normalizedBBox = {
      x: geometry.x / safeWidth,
      y: geometry.y / safeHeight,
      width: geometry.width / safeWidth,
      height: geometry.height / safeHeight,
    };
    return {
      id: String(item && item.id || `text-${String(index + 1).padStart(3, '0')}`),
      sourceSelectionId: sourceSelectionId || null,
      content: String(item && (item.content || item.text) || '').trim(),
      text: String(item && item.text || item && item.content || '').trim(),
      role: String(item && item.role || '').trim() || undefined,
      readingOrder: Number.isFinite(Number(item && item.readingOrder)) ? Number(item.readingOrder) : index + 1,
      geometry: {
        polygon: Array.isArray(item && item.polygon) ? item.polygon : [],
        bbox: geometry,
        normalizedBBox,
        rotation: number(item && item.rotation),
      },
      // Keep the flat fields for the existing PSD and review UI.
      x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height,
      componentType: String(item && item.componentType || '').trim() || undefined,
      containerType: String(item && item.containerType || '').trim() || undefined,
      appearance: {
        color: String(item && item.color || '#111111'),
        fontStyle: {
          category: String(item && item.fontFamily || 'sans-serif'),
          width: String(item && item.fontWidth || 'normal'),
          weight: String(item && item.fontWeight || 'normal'),
          italic: String(item && item.fontStyle || 'normal') === 'italic',
        },
        alignment: String(item && item.textAlign || 'left'),
        trackingHint: String(item && item.letterSpacing != null ? item.letterSpacing : ''),
      },
      fontSize: Math.max(1, number(item && item.fontSize, geometry.height * 0.9)),
      fontCategory: String(item && (item.fontCategory || item.fontFamily) || 'sans-serif'),
      fontCandidates: Array.isArray(item && item.fontCandidates) ? item.fontCandidates.slice(0, 5) : [],
      fontFamily: String(item && item.fontFamily || 'sans-serif'),
      fontPostScript: String(item && item.fontPostScript || ''),
      fontWeight: String(item && item.fontWeight || 'normal'),
      color: String(item && item.color || '#111111'),
      textAlign: String(item && item.textAlign || 'left'),
      lineHeight: Math.max(0, number(item && item.lineHeight)),
      letterSpacing: number(item && item.letterSpacing),
      removalMode,
      backgroundHint: String(item && item.backgroundHint || '').trim(),
      confidence: { recognition, geometry: geometryConfidence, fontMatch },
      recognitionConfidence: recognition,
      geometryConfidence,
      fontMatchConfidence: fontMatch,
      needsReview: Boolean(item && item.needsReview) || recognition < 0.65 || geometryConfidence < 0.65,
      enabled: item ? item.enabled !== false : true,
    };
  }).filter((item) => item.content);
}

/** Infer semantic components without guessing pixels. Overlapping/nearby rows
 * and explicit component IDs are fused, while each source selection remains
 * traceable. */
export function buildVisualComponents(textObjects, selections = [], threshold = 96) {
  const rows = Array.isArray(textObjects) ? textObjects : [];
  const regions = Array.isArray(selections) ? selections : [];
  const groups = [];
  for (const row of rows) {
    const bbox = rect(row.geometry && row.geometry.bbox || row);
    const explicit = String(row.componentId || '').trim();
    let target = groups.find((group) => explicit && group.key === explicit);
    if (!target) target = groups.find((group) => group.rows.some((item) => gap(bbox, rect(item.geometry && item.geometry.bbox || item)) <= Math.max(0, threshold)));
    if (!target) { target = { key: explicit || `component-${String(groups.length + 1).padStart(3, '0')}`, rows: [] }; groups.push(target); }
    target.rows.push(row);
  }
  return groups.map((group, index) => {
    const sourceSelectionIds = [...new Set(group.rows.map((item) => item.sourceSelectionId).filter(Boolean))];
    const boxes = group.rows.map((item) => rect(item.geometry && item.geometry.bbox || item));
    const box = unionRect(boxes);
    const type = group.rows.some((item) => inferComponentType(item) !== 'text_only')
      ? inferComponentType(group.rows.find((item) => inferComponentType(item) !== 'text_only'))
      : 'text_only';
    const confidence = group.rows.reduce((sum, item) => sum + number(item.confidence && item.confidence.recognition), 0) / Math.max(1, group.rows.length);
    const selection = regions.find((item) => sourceSelectionIds.includes(String(item.id || '')));
    return {
      id: `component-${String(index + 1).padStart(3, '0')}`,
      sourceSelectionIds,
      textObjectIds: group.rows.map((item) => item.id),
      type,
      container: type === 'text_only' ? undefined : { type: type === 'button' ? 'rounded_rectangle' : 'unknown' },
      // A text-only selection is a measurement hint, not permission to erase
      // the entire hand-drawn rectangle. Only container/component scopes may
      // widen the component bounds to the user's selection.
      bbox: type === 'text_only' ? box : (selection ? unionRect([box, rect(selection)]) : box),
      confidence: clamp(confidence, 0, 1),
    };
  });
}

/** Return descriptors for the four distinct mask roles. Actual pixels are
 * generated by the existing image scripts; this plan prevents a text mask
 * from being confused with a component/repair mask. */
export function buildComponentMasks(textObjects, components, imageWidth, imageHeight) {
  const width = Math.max(1, number(imageWidth, 1));
  const height = Math.max(1, number(imageHeight, 1));
  const shortEdge = Math.min(width, height);
  const dilatePx = Math.max(2, Math.min(24, Math.round(shortEdge * 0.0035)));
  return (Array.isArray(components) ? components : []).map((component) => {
    const rows = (Array.isArray(textObjects) ? textObjects : []).filter((item) => component.textObjectIds.includes(item.id));
    const textRect = unionRect(rows.map((item) => item.geometry && item.geometry.bbox || item));
    const ownerSelectionIds = [...new Set(component.sourceSelectionIds || [])];
    const includeContainer = rows.some((item) => item.removalMode === 'text_container' || item.removalMode === 'component');
    const includeComponent = rows.some((item) => item.removalMode === 'component');
    const componentRect = rect(component.bbox && component.bbox.width ? component.bbox : textRect);
    const mask = (role, bounds, enabled) => ({
      role, enabled, ownerSelectionIds, hardBinary: true, bbox: bounds,
      normalizedBBox: { x: bounds.x / width, y: bounds.y / height, width: bounds.width / width, height: bounds.height / height },
      dilatePx, featherPx: 0, seamBlend: role === 'M_repair' ? 'narrow-ring-after-inpaint' : 'none'
    });
    return {
      componentId: component.id,
      ownerSelectionIds,
      textMask: mask('M_text', textRect, true),
      containerMask: mask('M_container', includeContainer ? componentRect : { x: 0, y: 0, width: 0, height: 0 }, includeContainer),
      componentMask: mask('M_component', includeComponent ? componentRect : { x: 0, y: 0, width: 0, height: 0 }, includeComponent),
      repairMask: mask('M_repair', includeComponent || includeContainer ? componentRect : textRect, true),
    };
  });
}

function classifyHint(value) {
  const hint = String(value || '').toLowerCase();
  if (/纯色|solid|单色|白色|黑色|纯白|纯黑/.test(hint)) return 'solid';
  if (/渐变|gradient|过渡/.test(hint)) return 'gradient';
  if (/纹理|texture|颗粒|布纹|木纹|水纹/.test(hint)) return 'texture';
  return 'complex';
}

export function chooseBackgroundRoute(textObjects = [], component = {}) {
  const rows = (Array.isArray(textObjects) ? textObjects : []).filter((item) => (component.textObjectIds || []).includes(item.id));
  const types = rows.map((item) => classifyHint(item.backgroundHint));
  if (types.length && types.every((item) => item === 'solid')) return 'solid';
  if (types.length && types.every((item) => item === 'solid' || item === 'gradient')) return 'gradient';
  if (types.some((item) => item === 'texture')) return 'opencv';
  return 'generative';
}

export function buildReconstructionPlan({ selections = [], blocks = [], width = 1, height = 1, clusterThreshold = 96 } = {}) {
  const normalizedSelections = (Array.isArray(selections) ? selections : []).map((item, index) => {
    const source = item && typeof item === 'object' ? item : {};
    const original = source.originalImageRect && typeof source.originalImageRect === 'object' ? source.originalImageRect : source;
    const x = Math.max(0, number(original.x));
    const y = Math.max(0, number(original.y));
    const itemWidth = Math.max(0, number(original.width));
    const itemHeight = Math.max(0, number(original.height));
    return {
      ...source,
      id: String(source.id || source.selectionId || `selection-${String(index + 1).padStart(3, '0')}`),
      x, y, width: itemWidth, height: itemHeight,
      originalImageRect: { x, y, width: itemWidth, height: itemHeight },
      normalizedRect: {
        x: x / Math.max(1, number(width, 1)), y: y / Math.max(1, number(height, 1)),
        width: itemWidth / Math.max(1, number(width, 1)), height: itemHeight / Math.max(1, number(height, 1))
      },
      enabled: source.enabled !== false,
      selected: source.selected !== false,
      status: String(source.status || 'idle')
    };
  });
  const textObjects = buildTextObjects(blocks, normalizedSelections, width, height);
  const components = buildVisualComponents(textObjects, normalizedSelections, clusterThreshold);
  const masks = buildComponentMasks(textObjects, components, width, height);
  // Reuse the DSU-based clustering implementation used by the OCR route so
  // transitive/overlapping selections (A touches B, B touches C) are kept in
  // one repair cluster instead of depending on insertion order.
  const selectionClusters = clusterSelections(normalizedSelections, Math.max(0, number(clusterThreshold, 96)));
  const repairClusters = selectionClusters.map((cluster) => {
    const related = components.filter((item) => item.sourceSelectionIds.some((id) => cluster.selectionIds.includes(id)));
    const crop = expandRect(cluster.cropRect, width, height, Math.max(16, Math.min(256, Math.min(width, height) * 0.08)));
    const routes = related.map((item) => chooseBackgroundRoute(textObjects, item));
    const clusterMasks = masks.filter((item) => (item.ownerSelectionIds || []).some((id) => cluster.selectionIds.includes(id)));
    const repairMaskRect = unionRect(clusterMasks.map((item) => item.repairMask && item.repairMask.bbox).filter(Boolean));
    const seamRingPx = Math.max(4, Math.min(24, Math.round(Math.min(width, height) * 0.0025)));
    return {
      ...cluster,
      componentIds: related.map((item) => item.id),
      cropRect: crop,
      maskRect: repairMaskRect.width > 0 ? repairMaskRect : rect(cluster.cropRect),
      contextMarginPx: Math.max(16, Math.round(Math.min(width, height) * 0.08)),
      seamRingPx,
      repairType: routes.includes('generative') ? 'generative' : routes[0] || 'generative',
      source: 'original-image',
      composition: 'unified-after-independent-repair',
      status: 'pending'
    };
  });
  const jobs = repairClusters.flatMap((cluster) => ['vision', 'detection', 'fusion', 'component', 'mask', 'repair', 'font_match', 'typography', 'validation'].map((type) => ({ id: `${cluster.id}:${type}`, selectionIds: cluster.selectionIds, type, status: 'pending', retries: 0 })));
  return {
    schemaVersion: 1,
    image: { width: Math.max(1, number(width, 1)), height: Math.max(1, number(height, 1)) },
    selections: normalizedSelections,
    textObjects,
    components,
    masks,
    repairClusters,
    jobs,
    validation: {
      status: 'pending',
      thresholds: { center: 0.05, width: 0.1, height: 0.1, residue: 0.08, seamDelta: 0.12 },
      text: textObjects.map((item) => ({ textObjectId: item.id, status: item.needsReview ? 'needs_review' : 'pending' })),
      repair: repairClusters.map((item) => ({ repairClusterId: item.id, status: 'pending' }))
    },
    status: textObjects.some((item) => item.needsReview) ? 'partial_error' : 'idle',
  };
}

export function validateTypography(target, actual, thresholds = {}) {
  const expected = rect(target);
  const observed = rect(actual);
  const centerError = Math.hypot((expected.x + expected.width / 2) - (observed.x + observed.width / 2), (expected.y + expected.height / 2) - (observed.y + observed.height / 2));
  const shortEdge = Math.max(1, Math.min(expected.width, expected.height));
  const widthError = Math.abs(observed.width - expected.width) / Math.max(1, expected.width);
  const heightError = Math.abs(observed.height - expected.height) / Math.max(1, expected.height);
  const ok = centerError <= shortEdge * number(thresholds.center, 0.05) && widthError <= number(thresholds.width, 0.1) && heightError <= number(thresholds.height, 0.1);
  return { ok, needsReview: !ok, centerError, widthError, heightError };
}

export function validateRepair({ residue = 0, seamDelta = 0, thresholds = {} } = {}) {
  const residueLimit = number(thresholds.residue, 0.08);
  const seamLimit = number(thresholds.seamDelta, 0.12);
  return { ok: residue <= residueLimit && seamDelta <= seamLimit, residue, seamDelta, needsRetry: residue > residueLimit || seamDelta > seamLimit };
}

/**
 * Turn optional post-render measurements into a non-destructive validation
 * report.  Missing measurements stay `pending`—a preview must never be
 * labelled failed merely because Photoshop or a pixel validator is absent.
 * Callers may pass `{ typography: [{ textObjectId, actual }], repair: [{
 * repairClusterId, residue, seamDelta }] }` after a real render.
 */
export function validateReconstruction(plan, measurements = {}) {
  const source = plan && typeof plan === 'object' ? plan : {};
  const thresholds = source.validation && source.validation.thresholds || { center: 0.05, width: 0.1, height: 0.1, residue: 0.08, seamDelta: 0.12 };
  const textRows = Array.isArray(source.textObjects) ? source.textObjects : [];
  const typographyMeasurements = new Map((Array.isArray(measurements.typography) ? measurements.typography : []).map((item) => [String(item && item.textObjectId || ''), item]));
  const typography = textRows.map((item) => {
    const measured = typographyMeasurements.get(String(item.id));
    if (!measured || !measured.actual) return { textObjectId: item.id, status: 'pending' };
    const result = validateTypography(item.geometry && item.geometry.bbox || item, measured.actual, thresholds);
    return { textObjectId: item.id, status: result.ok ? 'completed' : 'needs_retry', ...result };
  });
  const repairMeasurements = new Map((Array.isArray(measurements.repair) ? measurements.repair : []).map((item) => [String(item && item.repairClusterId || ''), item]));
  const repair = (Array.isArray(source.repairClusters) ? source.repairClusters : []).map((item) => {
    const measured = repairMeasurements.get(String(item.id));
    if (!measured) return { repairClusterId: item.id, status: 'pending' };
    const result = validateRepair({ residue: measured.residue, seamDelta: measured.seamDelta, thresholds });
    return { repairClusterId: item.id, status: result.ok ? 'completed' : 'needs_retry', ...result };
  });
  const hasRetry = typography.some((item) => item.status === 'needs_retry') || repair.some((item) => item.status === 'needs_retry');
  const hasPending = typography.some((item) => item.status === 'pending') || repair.some((item) => item.status === 'pending');
  return { status: hasRetry ? 'failed' : hasPending ? 'pending' : 'completed', thresholds, typography, repair, needsRetry: hasRetry };
}

export function sessionStatus(plan, failedSelectionIds = []) {
  const failed = new Set((Array.isArray(failedSelectionIds) ? failedSelectionIds : []).map(String));
  if (failed.size) return 'partial_error';
  if (plan && Array.isArray(plan.textObjects) && plan.textObjects.some((item) => item.needsReview)) return 'partial_error';
  if (plan && plan.validation && (plan.validation.status === 'failed' || plan.validation.needsRetry)) return 'partial_error';
  return 'completed';
}
