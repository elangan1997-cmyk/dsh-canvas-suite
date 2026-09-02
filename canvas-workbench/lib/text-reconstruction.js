/**
 * Shared, model-agnostic geometry records for Visual Typography
 * Reconstruction. All rectangles are original-image pixel coordinates; the
 * normalized rectangle is stored only as a reversible transport form.
 */

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeSelection(value, index = 0, imageWidth = 1, imageHeight = 1) {
  const width = Math.max(0, number(value && value.width));
  const height = Math.max(0, number(value && value.height));
  const x = Math.max(0, number(value && value.x));
  const y = Math.max(0, number(value && value.y));
  const id = String((value && (value.id || value.selectionId)) || ('selection-' + String(index + 1).padStart(3, '0')));
  return {
    ...(value && typeof value === 'object' ? value : {}),
    id,
    order: number(value && value.order, index + 1),
    x, y, width, height,
    originalImageRect: { x, y, width, height },
    normalizedRect: { x: x / Math.max(1, imageWidth), y: y / Math.max(1, imageHeight), width: width / Math.max(1, imageWidth), height: height / Math.max(1, imageHeight) },
    rotation: number(value && value.rotation),
    selected: value ? value.selected !== false : true,
    enabled: value ? value.enabled !== false : true,
    status: String((value && value.status) || 'idle'),
    createdAt: number(value && value.createdAt, Date.now())
  };
}

export function normalizeSelections(values, imageWidth = 1, imageHeight = 1) {
  const list = Array.isArray(values) ? values : (values ? [values] : []);
  return list.filter((item) => item && number(item.width) >= 6 && number(item.height) >= 6)
    .map((item, index) => normalizeSelection(item, index, imageWidth, imageHeight));
}

function gapBetween(a, b) {
  const ax = number(a && a.x), ay = number(a && a.y), aw = number(a && a.width), ah = number(a && a.height);
  const bx = number(b && b.x), by = number(b && b.y), bw = number(b && b.width), bh = number(b && b.height);
  const dx = Math.max(0, Math.max(ax, bx) - Math.min(ax + aw, bx + bw));
  const dy = Math.max(0, Math.max(ay, by) - Math.min(ay + ah, by + bh));
  return Math.sqrt(dx * dx + dy * dy);
}

/** Group nearby/overlapping selections into repair/vision context clusters. */
export function clusterSelections(values, threshold = 96) {
  const selections = normalizeSelections(values);
  const parent = selections.map((_, index) => index);
  const find = (index) => { while (parent[index] !== index) { parent[index] = parent[parent[index]]; index = parent[index]; } return index; };
  const union = (a, b) => { const left = find(a), right = find(b); if (left !== right) parent[right] = left; };
  for (let i = 0; i < selections.length; i += 1) for (let j = i + 1; j < selections.length; j += 1) {
    if (gapBetween(selections[i], selections[j]) <= Math.max(0, threshold)) union(i, j);
  }
  const groups = new Map();
  selections.forEach((item, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, { id: 'repair-cluster-' + String(groups.size + 1).padStart(3, '0'), selectionIds: [], selections: [] });
    const group = groups.get(root);
    group.selectionIds.push(item.id);
    group.selections.push(item);
  });
  return [...groups.values()].map((group) => {
    const left = Math.min(...group.selections.map((item) => item.x));
    const top = Math.min(...group.selections.map((item) => item.y));
    const right = Math.max(...group.selections.map((item) => item.x + item.width));
    const bottom = Math.max(...group.selections.map((item) => item.y + item.height));
    return { ...group, cropRect: { x: left, y: top, width: right - left, height: bottom - top }, repairType: 'generative', status: 'pending' };
  });
}

/** Match semantic VLM rows to detector geometry by reading order, not IDs. */
export function fuseTextGeometry(textObjects, detectedRegions) {
  const rows = Array.isArray(textObjects) ? textObjects : [];
  const regions = (Array.isArray(detectedRegions) ? detectedRegions : []).slice().sort((a, b) => number(a && a.bbox && a.bbox.y) - number(b && b.bbox && b.bbox.y) || number(a && a.bbox && a.bbox.x) - number(b && b.bbox && b.bbox.x));
  const used = new Set();
  const pickDetector = (row, index) => {
    // When the VLM did return a useful hint, prefer the detector box that
    // overlaps it.  Only fall back to reading order when the hint is a
    // placeholder or the detector has no spatial relation to it.  This
    // avoids the fragile “array index = text line” binding on mixed layouts.
    const hint = row && row.geometry && row.geometry.bbox ? row.geometry.bbox : row;
    const hx = number(hint && hint.x), hy = number(hint && hint.y), hw = number(hint && hint.width), hh = number(hint && hint.height);
    let best = null, bestScore = 0;
    if (hw > 2 && hh > 2) {
      regions.forEach((candidate, candidateIndex) => {
        if (used.has(candidateIndex) || !candidate || !candidate.bbox) return;
        const box = candidate.bbox;
        const ix = Math.max(0, Math.min(hx + hw, number(box.x) + number(box.width)) - Math.max(hx, number(box.x)));
        const iy = Math.max(0, Math.min(hy + hh, number(box.y) + number(box.height)) - Math.max(hy, number(box.y)));
        const score = (ix * iy) / Math.max(1, hw * hh);
        if (score > bestScore) { bestScore = score; best = { candidate, candidateIndex }; }
      });
    }
    if (best && bestScore >= 0.12) return best;
    const fallback = regions.map((candidate, candidateIndex) => ({ candidate, candidateIndex })).find((item) => !used.has(item.candidateIndex));
    return fallback || { candidate: regions[index], candidateIndex: index };
  };
  return rows.map((row, index) => {
    const picked = pickDetector(row, index);
    const detector = picked && picked.candidate;
    if (picked && Number.isInteger(picked.candidateIndex)) used.add(picked.candidateIndex);
    if (!detector || !detector.bbox) return { ...row, geometryConfidence: number(row.geometryConfidence, 0.35), needsReview: true };
    const bbox = detector.bbox;
    const measuredHeight = Math.max(1, number(bbox.height));
    // VLMs sometimes emit the schema minimum (fontSize=1/8) even when the
    // text is legible.  Once a detector has measured the glyph region, use a
    // cap-height-aware estimate rather than carrying the placeholder into
    // Photoshop. The user can still override it in the review panel.
    const suppliedFontSize = number(row.fontSize);
    const fontSize = suppliedFontSize > 8 ? suppliedFontSize : Math.max(8, Math.round(measuredHeight * 0.82));
    return { ...row, x: number(bbox.x), y: number(bbox.y), width: Math.max(1, number(bbox.width)), height: measuredHeight, fontSize, lineHeight: number(row.lineHeight) > 8 ? number(row.lineHeight) : Math.round(fontSize * 1.15), rotation: number(detector.rotation, number(row.rotation)), geometryConfidence: number(detector.detectorConfidence, 0), needsReview: number(detector.detectorConfidence, 0) < 0.55 };
  });
}
