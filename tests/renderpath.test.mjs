// resolveRenderPath(...) contract (js/render/renderPolicy.js). Written from
// the ТЗ, not the impl:
//   resolveRenderPath({ relFx, cubeWanted, cubeReady }) ->
//     { path: 'cube'|'wide'|'plain', relEnabled, cubeEnabled, useSourceCamera }
//
// Context (ГРАБЛИ.md #2, real past regression): base render always goes into
// a wide 90° sourceCamera, cropped to 60° ONLY by the 2D rel-pass shader. If
// the source is wide but the cropping pass is off, the world renders at 90°
// instead of 60° ("отзумило"). T1 below is the machine-checkable version of
// "the wide source camera is on iff the cropping pass is on".
import assert from 'node:assert/strict';
import { resolveRenderPath } from '../js/render/renderPolicy.js';

const BOOLS = [false, true];
const combos = [];
for (const relFx of BOOLS) {
  for (const cubeWanted of BOOLS) {
    for (const cubeReady of BOOLS) {
      combos.push({ relFx, cubeWanted, cubeReady });
    }
  }
}
assert.equal(combos.length, 8, 'must enumerate all 8 boolean combinations');

// T6 — full truth table, spelled out explicitly so a future edit can't
// silently swap branches. Key = `${relFx}|${cubeWanted}|${cubeReady}`.
const EXPECTED_PATH = {
  'false|false|false': 'plain',
  'false|false|true': 'plain',
  'false|true|false': 'plain',
  'false|true|true': 'plain',
  'true|false|false': 'wide',
  'true|false|true': 'wide',
  'true|true|false': 'wide',  // cube wanted but not ready yet -> degrade to wide, not black
  'true|true|true': 'cube',
};

for (const c of combos) {
  const key = `${c.relFx}|${c.cubeWanted}|${c.cubeReady}`;
  const r = resolveRenderPath(c);

  // T1 — crop invariant, the main one: the wide source camera is engaged
  // iff the cropping rel-pass is engaged. No combination may violate this.
  assert.equal(r.useSourceCamera, r.relEnabled,
    `T1 useSourceCamera must equal relEnabled for ${key}: got useSourceCamera=${r.useSourceCamera}, relEnabled=${r.relEnabled}`);

  // T2 — mutual exclusion: rel (2D wide) and cube paths never both active.
  assert.ok(!(r.relEnabled && r.cubeEnabled),
    `T2 relEnabled and cubeEnabled must never both be true for ${key}`);

  // T5 — cubeEnabled implies plain source camera and path 'cube'.
  if (r.cubeEnabled) {
    assert.equal(r.useSourceCamera, false, `T5 cubeEnabled=>useSourceCamera=false for ${key}`);
    assert.equal(r.path, 'cube', `T5 cubeEnabled=>path=cube for ${key}`);
  }

  // T6 — full truth table.
  assert.equal(r.path, EXPECTED_PATH[key], `T6 path mismatch for ${key}`);
}

// T3 — relFx===false must fully disable everything, regardless of what cube
// wants/has ready. Includes the specific "main risk" combo named by the
// owner: relFx=off + cubeWanted=on + cubeReady=on.
for (const cubeWanted of BOOLS) {
  for (const cubeReady of BOOLS) {
    const r = resolveRenderPath({ relFx: false, cubeWanted, cubeReady });
    assert.equal(r.relEnabled, false, `T3 relFx=false => relEnabled=false (cubeWanted=${cubeWanted},cubeReady=${cubeReady})`);
    assert.equal(r.cubeEnabled, false, `T3 relFx=false => cubeEnabled=false (cubeWanted=${cubeWanted},cubeReady=${cubeReady})`);
    assert.equal(r.useSourceCamera, false, `T3 relFx=false => useSourceCamera=false (cubeWanted=${cubeWanted},cubeReady=${cubeReady})`);
    assert.equal(r.path, 'plain', `T3 relFx=false => path=plain (cubeWanted=${cubeWanted},cubeReady=${cubeReady})`);
  }
}

// T4 — degrade without resources: relFx&&cubeWanted&&!cubeReady must fall
// back to 'wide', not a black frame, during the gap between key-press and
// render-target allocation.
{
  const r = resolveRenderPath({ relFx: true, cubeWanted: true, cubeReady: false });
  assert.equal(r.path, 'wide', 'T4 relFx&&cubeWanted&&!cubeReady => path=wide');
}

console.log('renderpath.test.mjs OK');
