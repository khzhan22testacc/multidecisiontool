// Aggregation engine: works out which canonical variables the selected scores
// need (each asked once), and computes whatever can be computed.
import { VAR, VARIABLES, GROUPS } from './variables.js';
import { SCORE } from './scores.js';

/** Ordered, de-duplicated inputs for a set of score ids. */
export function requiredInputs(scoreIds) {
  const map = new Map(); // varId -> { usedBy: [], optional: bool }
  for (const id of scoreIds) {
    const s = SCORE[id];
    for (const [list, opt] of [[s.needs, false], [s.optional || [], true]]) {
      for (const vid of list) {
        const e = map.get(vid) || { usedBy: [], optional: true };
        e.usedBy.push(s.name);
        if (!opt) e.optional = false;
        map.set(vid, e);
      }
    }
  }
  const out = [];
  for (const g of GROUPS) {
    const vars = VARIABLES.filter(v => v.group === g.id && map.has(v.id))
      .map(v => ({ ...v, ...map.get(v.id) }));
    if (vars.length) out.push({ ...g, vars });
  }
  return out;
}

/** Value used for scoring: booleans default to false, numbers may carry a default. */
export function resolve(values, vid) {
  const v = VAR[vid], x = values[vid];
  if (x !== undefined && x !== null && x !== '') return x;
  if (v.kind === 'bool') return false;
  if (v.def !== undefined) return v.def;
  return null;
}

export function evaluate(scoreId, values) {
  const s = SCORE[scoreId];
  const v = {}, missing = [];
  for (const vid of s.needs) {
    v[vid] = resolve(values, vid);
    if (v[vid] === null) missing.push(VAR[vid].label);
  }
  for (const vid of s.optional || []) v[vid] = resolve(values, vid);
  if (missing.length) return { score: s, missing };
  return { score: s, result: s.compute(v) };
}

/** Plausibility check for a numeric entry. Returns a warning string or ''. */
export function rangeWarning(vid, x) {
  const v = VAR[vid];
  if (v.kind !== 'num' || x === null || x === undefined || x === '') return '';
  if (x < v.min || x > v.max) return `Outside the expected range (${v.min}–${v.max} ${v.unit}). Check the value and units.`;
  return '';
}
