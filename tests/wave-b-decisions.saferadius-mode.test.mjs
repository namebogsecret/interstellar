// Q2 — SAFE_MARGIN_MODE contract (js/physics/orbits.js, safeRadius()).
// See РЕШЕНИЕ-ВОЛНА-B.md: 318 km (5% of Earth's radius, current/shipped) vs
// 200 km (a fixed, textbook LEO floor) is an open decision. The code is meant
// to answer it with ONE constant flip (SAFE_MARGIN_MODE) — no logic rewrite —
// so this test exercises BOTH values of that constant against the real
// module, not a hand-copied formula.
//
// 'conservative' (shipped default) is checked via a normal import: the
// formula for EVERY body, Earth included, must be bit-identical to before
// this change (autopilot.refuse.test.mjs's SAFE_R_EARTH depends on this).
//
// 'earth-leo-200km' cannot be exercised via a normal import — SAFE_MARGIN_MODE
// is a plain module-level const (by design: a human flips it, not a runtime
// caller), and an imported const binding can't be reassigned from outside.
// So this test re-imports the REAL orbits.js source with only that one
// string flipped — exactly the edit a human would make to pick this option —
// via a `data:` URL module (no temp files, nothing written to disk). This
// runs the actual safeRadius() implementation under the alternate value, not
// a reimplementation of it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BODIES, byName } from '../js/data/bodies.js';
import { safeRadius, SAFE_MARGIN_MODE } from '../js/physics/orbits.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const orbitsPath = path.join(here, '..', 'js', 'physics', 'orbits.js');

const EARTH = byName('Earth');
const MOON = byName('Moon');
const MARS = byName('Mars');
assert.ok(EARTH && MOON && MARS, 'test fixtures: Earth/Moon/Mars must exist in js/data/bodies.js');

// ---------------------------------------------------------------------
// Shipped default: mode is 'conservative', current behaviour untouched.
// ---------------------------------------------------------------------
assert.equal(SAFE_MARGIN_MODE, 'conservative',
  'shipped default must stay conservative — flipping this constant is the entire Q2 decision, not a code change');

function conservativeFormula(b) {
  const atmoH = (b.atmosphere && b.atmosphere.height) || 0;
  return b.radius + Math.max(atmoH, 0.05 * b.radius);
}

for (const b of [EARTH, MOON, MARS]) {
  assert.equal(safeRadius(b), conservativeFormula(b),
    `conservative mode must match the pre-existing 5%-of-radius formula for ${b.name}`);
}
// The number the ТЗ names explicitly: ~318 km margin for Earth under the
// current default (6.371e6 * 0.05 = 318 550 m > atmoH=1e5, so the fraction wins).
assert.ok(Math.abs((safeRadius(EARTH) - EARTH.radius) - 318550) < 1,
  `Earth's conservative-mode margin must be ~318550 m, got ${safeRadius(EARTH) - EARTH.radius}`);

// ---------------------------------------------------------------------
// 'earth-leo-200km' mode: patch-and-reimport the real module.
// ---------------------------------------------------------------------
const src = fs.readFileSync(orbitsPath, 'utf8');
const NEEDLE = "const SAFE_MARGIN_MODE = 'conservative';";
assert.ok(src.includes(NEEDLE), 'orbits.js must declare SAFE_MARGIN_MODE exactly as expected by this test');
const patched = src.replace(NEEDLE, "const SAFE_MARGIN_MODE = 'earth-leo-200km';");
const dataUrl = 'data:text/javascript;charset=utf-8,' + encodeURIComponent(patched);
const leoModule = await import(dataUrl);

assert.equal(leoModule.SAFE_MARGIN_MODE, 'earth-leo-200km', 'sanity: the patched module must report the flipped mode');

// Earth: fixed 200 km floor, not 5% of radius (atmoH=1e5 < 200000, so the
// floor — not the atmosphere height either — wins).
const earthLeo = leoModule.safeRadius(EARTH);
assert.equal(earthLeo, EARTH.radius + 200000,
  `earth-leo-200km mode must give exactly a 200000 m margin for Earth, got margin=${earthLeo - EARTH.radius}`);
assert.notEqual(earthLeo, safeRadius(EARTH), 'earth-leo-200km must actually change Earth\'s number vs conservative');

// Every other body: untouched by the mode (same formula, same number).
for (const b of [MOON, MARS]) {
  const leoVal = leoModule.safeRadius(b);
  const conservativeVal = safeRadius(b);
  assert.equal(leoVal, conservativeVal,
    `earth-leo-200km must NOT change safeRadius(${b.name}) — got ${leoVal} vs conservative ${conservativeVal}`);
}

console.log('wave-b-decisions.saferadius-mode.test.mjs OK');
