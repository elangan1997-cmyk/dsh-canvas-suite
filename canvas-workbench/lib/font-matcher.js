/**
 * Windows font inventory and deterministic candidate ranking.
 *
 * This is intentionally dependency-free.  It does not pretend to identify a
 * proprietary font from pixels; it narrows the installed library using the
 * visual category returned by the VLM and leaves the final glyph fit to the
 * Photoshop calibration loop.  Keeping the inventory separate also makes the
 * feature safe on machines without Photoshop or a font parser.
 */
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const WEIGHT_BY_TOKEN = [
  ['thin', 100], ['hairline', 100], ['extralight', 200], ['ultralight', 200],
  ['light', 300], ['book', 350], ['regular', 400], ['normal', 400],
  ['medium', 500], ['semibold', 600], ['demibold', 600], ['bold', 700],
  ['heavy', 800], ['black', 900]
];

function text(value) { return String(value || '').trim(); }

function parseFontName(fileName) {
  const raw = text(fileName).replace(/\.(ttf|otf|ttc|fon)$/i, '');
  const tokens = raw.split(/[ _-]+/).filter(Boolean);
  const styleTokens = new Set(['italic', 'oblique', ...WEIGHT_BY_TOKEN.map(([token]) => token)]);
  let split = tokens.length;
  while (split > 1 && styleTokens.has(tokens[split - 1].toLowerCase())) split -= 1;
  const family = tokens.slice(0, split).join(' ') || raw;
  const style = tokens.slice(split).join(' ');
  const lower = raw.toLowerCase();
  const weightToken = WEIGHT_BY_TOKEN.find(([token]) => lower.includes(token));
  return {
    family,
    postScriptName: raw.replace(/\s+/g, ''),
    weight: weightToken ? weightToken[1] : 400,
    italic: /italic|oblique/i.test(style || raw),
    stretch: /condensed|narrow|compressed/i.test(raw) ? 'condensed' : /expanded|extended/i.test(raw) ? 'expanded' : 'normal',
    path: ''
  };
}

/** Scan the real Windows Fonts directory.  The result is best-effort: an
 * inaccessible directory simply produces an empty list and never blocks the
 * canvas/PSD flow. */
export async function scanWindowsFonts({ roots = [], platform = process.platform, windir = process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows' } = {}) {
  if (platform !== 'win32') return [];
  const directories = [...new Set([join(windir, 'Fonts'), ...roots].filter(Boolean))];
  const found = [];
  for (const directory of directories) {
    let entries = [];
    try { entries = await readdir(directory, { withFileTypes: true }); } catch (_) { continue; }
    for (const entry of entries) {
      if (!entry.isFile() || !/\.(ttf|otf|ttc|fon)$/i.test(entry.name)) continue;
      const path = join(directory, entry.name);
      try { if (!(await stat(path)).isFile()) continue; } catch (_) { continue; }
      const metadata = parseFontName(entry.name);
      found.push({ ...metadata, path });
    }
  }
  const unique = new Map();
  for (const item of found) if (!unique.has(item.path.toLowerCase())) unique.set(item.path.toLowerCase(), item);
  return [...unique.values()].sort((a, b) => a.family.localeCompare(b.family) || a.weight - b.weight || a.path.localeCompare(b.path));
}

function styleValue(style, key, fallback) {
  if (!style || typeof style !== 'object') return fallback;
  return text(style[key]).toLowerCase() || fallback;
}

/** Score one installed font against the VLM's coarse visual description. */
export function scoreFontCandidate(candidate = {}, style = {}) {
  const family = text(candidate.family).toLowerCase();
  const category = styleValue(style, 'category', 'sans-serif');
  const width = styleValue(style, 'width', 'normal');
  const weightName = styleValue(style, 'weight', 'normal');
  const italic = style.italic === true || styleValue(style, 'italic', 'false') === 'true';
  let score = 0;
  if (width === 'condensed' && candidate.stretch === 'condensed') score += 0.28;
  else if (width === 'expanded' && candidate.stretch === 'expanded') score += 0.22;
  else if (width === 'normal' && candidate.stretch === 'normal') score += 0.08;
  if (italic === Boolean(candidate.italic)) score += 0.18;
  const wantedWeight = weightName === 'thin' ? 200 : weightName === 'light' ? 300 : weightName === 'medium' ? 500 : weightName === 'bold' ? 700 : 400;
  score += Math.max(0, 0.26 - Math.abs(Number(candidate.weight || 400) - wantedWeight) / 2500);
  if (category === 'monospace' && /mono|code|console|courier/i.test(family)) score += 0.2;
  if (category === 'serif' && /serif|times|song|noto.*serif|georgia|cambria/i.test(family)) score += 0.15;
  if (category === 'rounded' && /round|rounded|comic|quicksand/i.test(family)) score += 0.15;
  if (category === 'display' && /display|impact|poster|headline|bebas|oswald/i.test(family)) score += 0.12;
  if (category === 'handwriting' && /script|hand|cursive|comic/i.test(family)) score += 0.12;
  if (category === 'sans-serif' && !/serif|script|cursive/i.test(family)) score += 0.08;
  return Math.max(0, Math.min(1, score));
}

export function rankFontCandidates(fonts = [], style = {}, limit = 5) {
  return (Array.isArray(fonts) ? fonts : []).map((font) => ({
    ...font,
    score: Number(scoreFontCandidate(font, style).toFixed(4))
  })).sort((a, b) => b.score - a.score || String(a.family).localeCompare(String(b.family))).slice(0, Math.max(1, Number(limit) || 5));
}

