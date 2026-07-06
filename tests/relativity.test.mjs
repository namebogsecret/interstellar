// Aberration contract (relativity.js). Written from the ТЗ, not the impl:
//   aberratedCos(cp, beta) = (cp - beta) / (1 - beta*cp)
import assert from 'node:assert/strict';
import { aberratedCos } from '../js/physics/relativity.js';
import { approxAbs } from './helpers.mjs';

// 1) θ'=60°, β=0.5 → θ=90° (cosθ=0). Classic beaming point.
approxAbs(aberratedCos(Math.cos(Math.PI / 3), 0.5), 0, 1e-9,
  'aberration θ\'=60°,β=0.5 → θ=90°');

// 2) Round-trip: the rest→ship forward map is f(x,β)=(x+β)/(1+β·x); aberratedCos
//    is its inverse, so aberratedCos(f(x,β),β) ≈ x for all x,β.
const fwd = (x, b) => (x + b) / (1 + b * x);
for (const x of [-0.9, -0.3, 0, 0.3, 0.9]) {
  for (const b of [0.1, 0.5, 0.9]) {
    approxAbs(aberratedCos(fwd(x, b), b), x, 1e-9,
      `aberration round-trip x=${x} β=${b}`);
  }
}

// 3) Monotonic increasing in cp for fixed β (d/dcp = (1-β²)/(1-β·cp)² > 0).
for (const b of [0.1, 0.5, 0.9]) {
  let prev = -Infinity;
  for (let cp = -1; cp <= 1.0000001; cp += 0.1) {
    const y = aberratedCos(cp, b);
    assert.ok(y > prev, `aberration must be increasing in cp (β=${b}, cp=${cp}): ${y} !> ${prev}`);
    prev = y;
  }
}

console.log('relativity.test.mjs OK');
