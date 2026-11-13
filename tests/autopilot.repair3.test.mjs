// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION — repair round 3, R3-1 (high): Hohmann (Shift+N) whose TARGET
// radius lies outside the reference body's dominance.
//
// Defect: engage checks dominance only at the SHIP's position. A Hohmann from
// low Earth orbit to the Moon's radius engages (dominance at the ship is huge),
// burns the departure impulse, and then fails FAILED(ref-changed) in flight when
// the transfer leaves the sphere of dominance. Contract: REFUSE at engage.
//
// EXPECTED API (to be added by the implementer; tests are red until then):
//   buildObs(ship, bodies, positions, byName, simTime, inputSeq, dtReal, targetRadius)
//     — NEW optional 8th (last) parameter `targetRadius` (number | undefined,
//       the same value main.js passes in the goal: selected target's orbit
//       radius about the ref body, NaN/undefined when none / circularize).
//     — result gains `obs.dominanceAtTarget` (number):
//         dominanceRatio(P, refBody, bodies, positions), where
//         P = refBodyPos + unit(rVec) * targetRadius  (point on the target
//         radius along the ship's CURRENT direction from the ref body).
//       When targetRadius is not a finite positive number → Infinity.
//   engageAutopilot(goal{kind:'hohmann'}, obs): if obs.dominanceAtTarget is
//     DEFINED and !(obs.dominanceAtTarget >= DOM_MIN_HOLD) → phase REFUSED,
//     reason REASONS.PERTURBED, no impulse. Undefined → NOT refused (back-compat
//     with all existing tests that build obs without the field).
//   circularize ignores the field.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import assert from 'node:assert/strict';
import {
  PHASES, REASONS, engageAutopilot, makeObs, circularState, MU_EARTH, MOON,
} from './autopilot.harness.mjs';
import { buildObs, DOM_MIN_HOLD } from '../js/physics/autopilot.js';
import { BODIES, byName } from '../js/data/bodies.js';
import { absolutePosition, dominanceRatio, bodyVelocity } from '../js/physics/orbits.js';
import { Ship } from '../js/physics/ship.js';

const R_LEO = 7.0e6;
const goalH = { kind: 'hohmann', bodyName: 'Earth', targetRadius: MOON.a };
const baseObs = (over = {}) => {
  const st = circularState(MU_EARTH, R_LEO);
  return makeObs(st.r, st.v, over);
};

// (a) dominance at the target below the hold threshold → REFUSED(perturbed)
{
  const st = engageAutopilot(goalH, baseObs({ dominanceAtTarget: 4.9 }));
  assert.equal(st.phase, PHASES.REFUSED, `(R3-1a) got ${st.phase}`);
  assert.equal(st.reason, REASONS.PERTURBED);
  assert.equal(REASONS.PERTURBED, 'perturbed');
  assert.ok(!(st.dvSpent > 0), '(R3-1a) no impulse may be spent');
}
// (a') boundary: exactly DOM_MIN_HOLD is acceptable, NaN is not
{
  const ok = engageAutopilot(goalH, baseObs({ dominanceAtTarget: DOM_MIN_HOLD }));
  assert.notEqual(ok.phase, PHASES.REFUSED, `(R3-1a') == DOM_MIN_HOLD must pass, got ${ok.reason}`);
  const nan = engageAutopilot(goalH, baseObs({ dominanceAtTarget: NaN }));
  assert.equal(nan.phase, PHASES.REFUSED, '(R3-1a\') NaN dominance must refuse');
  assert.equal(nan.reason, REASONS.PERTURBED);
}
// (b) ample dominance → engages as before; absent field → back-compat
for (const over of [{ dominanceAtTarget: 1e6 }, { dominanceAtTarget: Infinity }, {}]) {
  const st = engageAutopilot(goalH, baseObs(over));
  assert.ok(st.phase === PHASES.WAIT || st.phase === PHASES.BURN,
    `(R3-1b) ${JSON.stringify(over)} → ${st.phase}/${st.reason}`);
}
// (b') circularize ignores the field
{
  const st = engageAutopilot({ kind: 'circularize', bodyName: 'Earth' }, baseObs({ dominanceAtTarget: 0.1 }));
  assert.notEqual(st.reason, REASONS.PERTURBED, '(R3-1b\') circularize must ignore dominanceAtTarget');
}

// (c) REAL bodies: ship on a circular orbit r=8e6 about Earth, heading of the
// radius vector toward the Moon, target = Moon's orbital radius.
{
  const positions = new Map();
  for (const b of BODIES) {
    const p = new THREE.Vector3();
    if (b.parent) absolutePosition(b, 0, byName, p);
    positions.set(b.name, p);
  }
  const earth = byName('Earth');
  const ep = positions.get('Earth');
  const dir = new THREE.Vector3().subVectors(positions.get('Moon'), ep).normalize();
  const ship = new Ship();
  const bv = new THREE.Vector3();
  bodyVelocity(earth, 0, byName, bv);
  const tang = new THREE.Vector3(0, 0, 1).cross(dir).normalize();
  ship.pos.copy(ep).addScaledVector(dir, 8e6);
  ship.v.copy(bv).addScaledVector(tang, Math.sqrt(MU_EARTH / 8e6));
  ship.refBody = earth;
  ship.mode = 'arcade';

  const obs = buildObs(ship, BODIES, positions, byName, 0, 0, 1 / 60, MOON.a);
  assert.equal(typeof obs.dominanceAtTarget, 'number', '(R3-1c) buildObs must set dominanceAtTarget');
  assert.ok(obs.dominanceAtTarget < DOM_MIN_HOLD,
    `(R3-1c) dominanceAtTarget=${obs.dominanceAtTarget} must be < ${DOM_MIN_HOLD}`);
  // independent recomputation of the contract formula
  const P = new THREE.Vector3().copy(ep).addScaledVector(dir, MOON.a);
  const expect = dominanceRatio(P, earth, BODIES, positions);
  assert.ok(Math.abs(obs.dominanceAtTarget - expect) <= 1e-9 * Math.max(1, expect),
    `(R3-1c) ${obs.dominanceAtTarget} vs formula ${expect}`);
  const st = engageAutopilot({ kind: 'hohmann', bodyName: 'Earth', targetRadius: MOON.a }, obs);
  assert.equal(st.phase, PHASES.REFUSED, `(R3-1c) engage got ${st.phase}/${st.reason}`);
  assert.equal(st.reason, REASONS.PERTURBED);

  // no target radius (circularize) → Infinity / not refused
  const obs2 = buildObs(ship, BODIES, positions, byName, 0, 0, 1 / 60);
  assert.ok(obs2.dominanceAtTarget === undefined || obs2.dominanceAtTarget === Infinity,
    '(R3-1c) no targetRadius → undefined or Infinity');
  const st2 = engageAutopilot({ kind: 'circularize', bodyName: 'Earth' }, obs2);
  assert.notEqual(st2.reason, REASONS.PERTURBED, '(R3-1c) circularize from r=8e6 must not be perturbed');

  // a target well inside Earth's dominance (r=2e7) must still be accepted
  const obs3 = buildObs(ship, BODIES, positions, byName, 0, 0, 1 / 60, 2e7);
  assert.ok(obs3.dominanceAtTarget >= DOM_MIN_HOLD, `(R3-1c) 2e7 target dominance ${obs3.dominanceAtTarget}`);
}
console.log('autopilot.repair3: OK');
