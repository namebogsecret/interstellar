// Drake presets/sources: structure and honesty (every parameter of every preset cites a source).
import assert from 'node:assert/strict';
import { KEYS, validateParams, summarize } from '../js/physics/drake.js';
import { PRESETS, PARAM_META, SOURCES, presetParams } from '../js/data/drake.js';

const ids = PRESETS.map((p) => p.id);
for (const need of ['pessimist', 'optimist', 'drake1961', 'sdo2018']) assert.ok(ids.includes(need), 'preset ' + need);
assert.equal(new Set(ids).size, ids.length, 'unique preset ids');

for (const p of PRESETS) {
  assert.ok(p.name.en && p.name.ru && p.note.en && p.note.ru, p.id + ' bilingual name/note');
  validateParams(presetParams(p)); // ranges valid (min<=max, >0, fractions <=1)
  for (const k of KEYS) {
    const pr = p.params[k];
    assert.ok(Array.isArray(pr.src) && pr.src.length >= 1, `${p.id}.${k} has a source`);
    for (const s of pr.src) assert.ok(SOURCES[s] && SOURCES[s].cite.length > 20, `${p.id}.${k} source ${s} is defined`);
    assert.ok(['measured', 'model', 'assumption'].includes(pr.basis), `${p.id}.${k} basis`);
    // fl, fi, fc, L must never be tagged "measured" (honesty rule)
    if (['fl', 'fi', 'fc', 'L'].includes(k)) assert.notEqual(pr.basis, 'measured', `${p.id}.${k} cannot be measured`);
    // range fits the page's slider domain, so the preset is representable
    const m = PARAM_META[k];
    assert.ok(Math.log10(pr.min) >= m.lo - 1e-9 && Math.log10(pr.max) <= m.hi + 1e-9, `${p.id}.${k} within slider domain`);
  }
}
for (const k of KEYS) {
  const m = PARAM_META[k];
  assert.ok(m.label.en && m.label.ru && m.hint.en && m.hint.ru && m.unit.en && m.unit.ru, 'meta bilingual ' + k);
  assert.ok(m.lo < m.hi);
}
// the four unmeasured factors are flagged in their hints
for (const k of ['fl', 'fi', 'fc', 'L']) assert.ok(/NOT measured/.test(PARAM_META[k].hint.en) && /НЕ измерено/.test(PARAM_META[k].hint.ru), 'hint flags unmeasured ' + k);
// sources: URLs are only https arXiv links
for (const [id, s] of Object.entries(SOURCES)) {
  if (s.url) assert.ok(/^https:\/\/arxiv\.org\/abs\/\d{4}\.\d{4,5}$/.test(s.url), id + ' url');
}
// honesty rules: measured/model entries carry a non-empty caveat (bilingual); an 'assumption' is never
// presented as confirmed by an arXiv paper, except in the preset that is a reconstruction of that very paper.
for (const p of PRESETS) for (const k of KEYS) {
  const pr = p.params[k];
  if (pr.basis === 'measured' || pr.basis === 'model') {
    assert.ok(pr.caveat && pr.caveat.en.length > 20 && pr.caveat.ru.length > 20, `${p.id}.${k} (${pr.basis}) needs a caveat`);
  }
  if (pr.basis === 'assumption' && p.id !== 'sdo2018') {
    assert.ok(pr.src.every((s) => !SOURCES[s].url), `${p.id}.${k} assumption must not cite an arXiv link as confirmation`);
  }
  if (pr.caveat) assert.ok(pr.caveat.en && pr.caveat.ru, `${p.id}.${k} caveat bilingual`);
}
// specific corrections: R* is a conversion, not a measurement; Westby is not attached to the optimist L; Cassan not to a low fp
const pess = PRESETS.find((p) => p.id === 'pessimist').params, opt = PRESETS.find((p) => p.id === 'optimist').params;
assert.notEqual(pess.R.basis, 'measured'); assert.notEqual(opt.R.basis, 'measured');
assert.ok(!opt.L.src.includes('westby2020'), 'optimist L must not cite Westby');
assert.ok(pess.L.src.includes('westby2020'));
assert.ok(!pess.fp.src.includes('cassan2012'), 'pessimist fp must not cite Cassan');
assert.ok(/OBSERVABLE UNIVERSE/.test(PRESETS.find((p) => p.id === 'pessimist').note.en), 'Frank & Sullivan threshold is scoped to the observable Universe');
for (const k of ['ne']) for (const p of [pess, opt]) assert.ok(/Sun-like/.test(p[k].caveat.en), 'ne caveat mentions per Sun-like star');
// every defined source is used by some preset (no dead entries)
const used = new Set(PRESETS.flatMap((p) => KEYS.flatMap((k) => p.params[k].src)));
for (const id of Object.keys(SOURCES)) assert.ok(used.has(id), 'source used: ' + id);
// Drake 1961 preset: the headline values (R*=1, fl=fi=1)
const d = PRESETS.find((p) => p.id === 'drake1961').params;
assert.equal(d.R.min, 1); assert.equal(d.R.max, 1); assert.equal(d.fl.min, 1); assert.equal(d.fi.max, 1);
// SDO preset: P(N<1) is substantial, that is the paper's point
assert.ok(summarize(presetParams(PRESETS.find((p) => p.id === 'sdo2018')), 5000, 1).pLessThanOne > 0.3, 'SDO: large P(N<1)');
console.log('drake.data.test: OK (' + PRESETS.length + ' presets)');
