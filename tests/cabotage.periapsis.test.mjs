// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION — NEVER DELETE, NEVER WEAKEN.
// Locks ТЗ INV-B1 (no-overshoot) against a CONFIRMED latent hole in the §5
// min-radius periapsis guard of cabotage.js, found by adversarial review:
//
//   `periapsisInArc = (rvStart < 0 && rvEnd > 0)` — an endpoint radial-velocity
//   SIGN FLIP — OR `dt >= one full period`. This misses any arc that crosses
//   periapsis exactly once AND ALSO crosses apoapsis in between: apoapsis
//   flips the sign back a second time, so the two endpoints share the SAME
//   sign even though periapsis genuinely happened inside the arc. When that
//   happens `minRad = min(r0, rEnd)` is evaluated from the (apoapsis-region)
//   ENDPOINTS instead of the true periapsis, so a step that dips through the
//   atmosphere/surface at periapsis is wrongly treated as safe and COMMITTED —
//   violating INV-B1 ("no overshoot"), which the code's own comment claims
//   holds unconditionally.
//
// Concrete case (verified against the current cabotage.js in a scratch run
// before writing this test — reproduces the hole):
//   mu = Earth GM, e = 0.5, rPeri = 7.0e6, rApo = 2.1e7 (rApo=rPeri(1+e)/(1-e)),
//   a = 1.4e7, T ≈ 16485.5 s. Ship starts at true anomaly ν0 = 183°
//   (just past apoapsis, INBOUND: r0·v0 < 0), dt = 0.98·T (< one period, so the
//   dt≥period branch of periapsisInArc never fires). Both |r0| ≈ 2.097e7 and
//   |rEnd| ≈ 2.100e7 sit near apoapsis, and BOTH have negative radial velocity
//   (confirmed numerically: sign(r·v) is -1 at t0 AND at t0+dt) — yet the arc
//   sweeps all the way through periapsis (7.0e6) in between. rSafe is placed at
//   1.05e7 (strictly between rPeri and rApo: 7.0e6 < 1.05e7 < 2.1e7) via an
//   intentionally oversized `atmosphere.height` on a realistic Earth radius —
//   the body's SOLID radius (6.371e6) stays below rPeri so the orbit never
//   dips inside the actual body, only inside its (test-exaggerated) safety
//   margin, isolating the min-radius guard from unrelated surface-collision
//   logic.
//
// EXPECTED (per ТЗ INV-B1): tryAnalyticCoast(...) must return FALSE and mutate
// NOTHING (numeric loop handles the periapsis/atmosphere dip instead).
// OBSERVED against current code (scratch-verified): returns TRUE and commits
// the step (ship.pos/v/properTime all change) — this test must FAIL until the
// implementer hardens periapsisInArc with a genuine time-to-periapsis /
// apses-crossed-count check instead of endpoint-sign-flip alone.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { tryAnalyticCoast } from '../js/physics/cabotage.js';
import { Ship } from '../js/physics/ship.js';
import { momentumFromV } from '../js/physics/relativity.js';
import assert from 'node:assert/strict';

const mu = 3.986004418e14;      // Earth GM
const e = 0.5;
const rPeri = 7.0e6;
const rApo = rPeri * (1 + e) / (1 - e);      // = 2.1e7
const a = (rPeri + rApo) / 2;                 // = 1.4e7
const T = 2 * Math.PI * Math.sqrt(a * a * a / mu);   // ≈ 16485.5 s

// Perifocal state vector at true anomaly nu (deg), prograde, xy-plane.
function perifocal(nuDeg) {
  const nu = nuDeg * Math.PI / 180;
  const p = a * (1 - e * e);
  const rmag = p / (1 + e * Math.cos(nu));
  const cn = Math.cos(nu), sn = Math.sin(nu);
  const rhat = new THREE.Vector3(cn, sn, 0);
  const that = new THREE.Vector3(-sn, cn, 0);
  const s = Math.sqrt(mu / p);
  const r = rhat.clone().multiplyScalar(rmag);
  const v = rhat.clone().multiplyScalar(s * e * sn).add(that.clone().multiplyScalar(s * (1 + e * cn)));
  return { r, v };
}

// Earth's real radius; atmosphere.height is intentionally exaggerated so
// rSafe = radius + max(atmoHeight, 0.05·radius) lands at 1.05e7 — strictly
// between rPeri (7.0e6) and rApo (2.1e7). The solid radius (6.371e6) stays
// below rPeri, so the conic never physically enters the body — only its
// (test-widened) safety margin — keeping this test isolated to the
// min-radius/periapsis guard, not surface collision.
const earth = {
  name: 'Earth', GM: mu, radius: 6.371e6,
  atmosphere: { height: 4.129e6, color: 0, density0: 1.225, scaleHeight: 8.5e3 },
};
const bodies = [earth];
const byName = (n) => bodies.find(b => b.name === n);
const rSafeEarth = earth.radius + Math.max(earth.atmosphere.height, 0.05 * earth.radius);
assert.ok(rPeri < rSafeEarth && rSafeEarth < rApo,
  `sanity: rPeri < rSafe < rApo required (rPeri=${rPeri}, rSafe=${rSafeEarth}, rApo=${rApo})`);

// ── build the ship: nu0 = 183° (just past apoapsis, inbound), dt = 0.98·T ──
const { r: r0Vec, v: v0Vec } = perifocal(183);
assert.ok(r0Vec.dot(v0Vec) < 0, 'sanity: start state is INBOUND (r0·v0 < 0)');

const ship = new Ship();
ship.mode = 'arcade';
ship.throttle = 0;
ship.landed = false;
ship.pos.copy(r0Vec);
ship.v.copy(v0Vec);
momentumFromV(ship.v, ship.w);
ship.altitude = r0Vec.length() - earth.radius;
ship.properTime = 0;

const dt = 0.98 * T;

// Independently confirm (from the RELATIVE state, mirroring §5's own math) that
// the endpoint radial-velocity sign does NOT flip, yet the arc truly crosses
// periapsis — i.e. this is genuinely the double-crossing loophole case, not a
// mistaken setup.
{
  const h = new THREE.Vector3().crossVectors(r0Vec, v0Vec).length();
  const eps = 0.5 * v0Vec.lengthSq() - mu / r0Vec.length();
  const aFromState = -mu / (2 * eps);
  const TFromState = 2 * Math.PI * Math.sqrt(aFromState ** 3 / mu);
  assert.ok(Math.abs(TFromState - T) / T < 1e-6, 'sanity: derived period matches T');
  assert.ok(dt < TFromState, 'sanity: dt < one period (dt>=period branch must not fire)');
}

const posSnap = ship.pos.clone();
const vSnap = ship.v.clone();
const wSnap = ship.w.clone();
const ptSnap = ship.properTime;

const ok = tryAnalyticCoast(ship, earth, bodies, byName, 0, dt);

// ── THE regression assertions (INV-B1) ──
assert.equal(ok, false,
  'INV-B1: arc crosses periapsis (7.0e6 < rSafe=1.05e7) via a double radial-velocity-sign flip ' +
  '(apoapsis-region endpoints share the same sign) — tryAnalyticCoast MUST refuse and fall back to numeric, ' +
  'but the current periapsisInArc check (endpoint sign-flip OR dt>=period) misses this case and commits');
assert.ok(
  ship.pos.equals(posSnap) && ship.v.equals(vSnap) && ship.w.equals(wSnap) && ship.properTime === ptSnap,
  'INV-B1: on refusal, cabotage must mutate NOTHING (pos/v/w/properTime byte-identical to pre-call snapshot)'
);

console.log('cabotage.periapsis.test.mjs OK');
