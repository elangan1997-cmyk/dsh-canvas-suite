import assert from 'node:assert/strict';
import { buildReconstructionPlan, validateReconstruction } from '../canvas-workbench/lib/reconstruction-model.js';
import { rankFontCandidates } from '../canvas-workbench/lib/font-matcher.js';

const plan = buildReconstructionPlan({
  width: 2000,
  height: 1200,
  clusterThreshold: 40,
  selections: [
    { id: 'selection-a', x: 100, y: 120, width: 240, height: 90 },
    { id: 'selection-b', x: 350, y: 120, width: 240, height: 90 },
    { id: 'selection-c', x: 1600, y: 900, width: 180, height: 60 }
  ],
  blocks: [
    { id: 'text-a', sourceSelectionId: 'selection-a', text: '标题', x: 120, y: 140, width: 180, height: 54, confidence: 96, removalMode: 'text_only' },
    { id: 'text-b', sourceSelectionId: 'selection-b', text: '副标题', x: 370, y: 140, width: 180, height: 54, confidence: 93, removalMode: 'text_container' },
    { id: 'text-c', sourceSelectionId: 'selection-c', text: '参数', x: 1610, y: 910, width: 120, height: 32, confidence: 91, removalMode: 'component' }
  ]
});

assert.equal(plan.textObjects.length, 3);
assert.deepEqual(plan.textObjects.map((item) => item.sourceSelectionId), ['selection-a', 'selection-b', 'selection-c']);
assert.equal(plan.repairClusters.length, 2, 'nearby selections should share one repair cluster');
assert.equal(plan.repairClusters[0].source, 'original-image');
assert.equal(plan.masks[0].textMask.hardBinary, true);
assert.equal(plan.masks[1].containerMask.enabled, true);
assert.equal(plan.masks[2].componentMask.enabled, true);
assert.ok(plan.jobs.some((item) => item.type === 'font_match'));
assert.ok(plan.jobs.some((item) => item.type === 'typography'));

const validation = validateReconstruction(plan, {
  typography: plan.textObjects.map((item) => ({ textObjectId: item.id, actual: item.geometry.bbox })),
  repair: plan.repairClusters.map((item) => ({ repairClusterId: item.id, residue: 0, seamDelta: 0 }))
});
assert.equal(validation.status, 'completed');
assert.ok(rankFontCandidates([{ family: 'Noto Sans', weight: 700, italic: false, stretch: 'condensed' }], { category: 'sans-serif', width: 'condensed', weight: 'bold' })[0].score > 0);

console.log('reconstruction model checks passed');

