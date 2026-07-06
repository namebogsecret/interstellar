// ─────────────────────────────────────────────────────────────────────────────
// CABOTAGE ENGAGEMENT + BOUNDARY LOOK-AHEAD — the go/no-go predicate (WI-2).
// Locks ТЗ §2 (cabotageEngaged, all 6 clauses) and §5 INV-B1 (no-overshoot:
// tryAnalyticCoast returns FALSE and mutates NOTHING whenever the true trajectory
// would touch atmosphere/surface or cross an SOI within Δt).
//
// Table-driven: each row is (setup) → expected boolean. A predicate that ignores a
// clause (e.g. still engages while landed, or across an SOI) fails a specific row.
//
// Bodies are placed via their real orbital elements so cabotage's internal
// absolutePosition(...) at simTime reproduces the intended geometry: Earth (no
// parent/period) sits at the origin; the moon (parent Earth, e=0, M0=0) sits at
// (a,0,0).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { cabotageEngaged, tryAnalyticCoast } from '../js/physics/cabotage.js';
import { Ship } from '../js/physics/ship.js';
import { momentumFromV } from '../js/physics/relativity.js';
import { DAY, DEG } from '../js/physics/constants.js';
import assert from 'node:assert/strict';

const mu = 3.986004418e14;      // Earth GM
const earth = {
  name: 'Earth', GM: mu, radius: 6.371e6,
  atmosphere: { height: 1.0e5, color: 0, density0: 1.225, scaleHeight: 8.5e3 },
};
const luna = {                  // parent Earth, e=0, M0=0 ⇒ absolutePosition = (a,0,0)
  name: 'Luna', parent: 'Earth', GM: 4.9048695e12, radius: 1.7374e6,
  a: 3.844e8, e: 0, i: 0, Omega: 0, omega: 0, period: 27.321661 * DAY, M0: 0,
};
// rSafe(Earth) = radius + max(atmoHeight 1e5, 0.05·radius 3.186e5) = 6.6896e6.
const rSafeEarth = earth.radius + Math.max(earth.atmosphere.height, 0.05 * earth.radius);

function shipAt(pos, { throttle = 0, landed = false, v = null } = {}) {
  const s = new Ship();
  s.mode = 'arcade';
  s.throttle = throttle;
  s.landed = landed;
  s.pos.copy(pos);
  if (v) { s.v.copy(v); momentumFromV(s.v, s.w); }
  s.altitude = pos.length() - earth.radius;
  return s;
}
const refAltOf = (ship) => ship.pos.length() - earth.radius;   // Earth at origin

// Perifocal state for an orbit (μ,a,e) at true anomaly ν, in the xy-plane, prograde.
function perifocal(a, e, nuDeg) {
  const nu = nuDeg * Math.PI / 180;
  const p = a * (1 - e * e);
  const rmag = p / (1 + e * Math.cos(nu));
  const cn = Math.cos(nu), sn = Math.sin(nu);
  const rhat = new THREE.Vector3(cn, sn, 0);
  const that = new THREE.Vector3(-sn, cn, 0);
  const s = Math.sqrt(mu / p);
  const r = rhat.clone().multiplyScalar(rmag);
  const v = rhat.clone().multiplyScalar(s * e * sn).add(that.clone().multiplyScalar(s * (1 + e * cn)));
  return { r, v, rmag };
}

// ── cabotageEngaged table (single body Earth unless noted) ──
const single = [earth];
const byNameSingle = (n) => single.find(b => b.name === n);

const high = new THREE.Vector3(7.5e6, 0, 0);   // clean high circular-ish altitude

// (a) high coast, warp>1, clear dominant → ENGAGE
{
  const s = shipAt(high);
  assert.equal(cabotageEngaged(s, earth, refAltOf(s), 5, single, byNameSingle, 0), true,
    '(a) high coast, warp>1, clear dominant → engage');
}
// (b) throttle>0 → FALLBACK
{
  const s = shipAt(high, { throttle: 0.4 });
  assert.equal(cabotageEngaged(s, earth, refAltOf(s), 5, single, byNameSingle, 0), false,
    '(b) throttle>0 → fallback');
}
// (c) landed → FALLBACK
{
  const s = shipAt(high, { landed: true });
  assert.equal(cabotageEngaged(s, earth, refAltOf(s), 5, single, byNameSingle, 0), false,
    '(c) landed → fallback');
}
// (d) altitude < rSafe → FALLBACK
{
  const low = new THREE.Vector3(6.4e6, 0, 0);   // ~29 km altitude, below rSafe
  const s = shipAt(low);
  assert.ok(refAltOf(s) + earth.radius < rSafeEarth, 'sanity: setup is below rSafe');
  assert.equal(cabotageEngaged(s, earth, refAltOf(s), 5, single, byNameSingle, 0), false,
    '(d) altitude < rSafe → fallback');
}
// (e) warp == 1 → FALLBACK
{
  const s = shipAt(high);
  assert.equal(cabotageEngaged(s, earth, refAltOf(s), 1, single, byNameSingle, 0), false,
    '(e) warp == 1 → fallback');
}
// (f) dominance ratio < DOM_RATIO (two bodies near SOI boundary) → FALLBACK
{
  const two = [earth, luna];
  const byNameTwo = (n) => two.find(b => b.name === n);
  // Place ship on the Earth–moon axis where GM_e/x² ≈ 3·GM_l/(d−x)²  ⇒ ratio ≈ 3 < 10.
  const d = luna.a;
  const gmRatio = earth.GM / luna.GM;                 // ≈ 81.3
  // ((d−x)/x)² = 3/gmRatio ⇒ x = d / (1 + sqrt(3/gmRatio))
  const x = d / (1 + Math.sqrt(3 / gmRatio));
  const s = shipAt(new THREE.Vector3(x, 0, 0));
  assert.equal(cabotageEngaged(s, earth, refAltOf(s), 5, two, byNameTwo, 0), false,
    '(f) dominance ratio < DOM_RATIO → fallback (numeric N-body takes over near SOI)');
}

// ── tryAnalyticCoast boundary look-ahead (INV-B1) — engagement passes, guard fires ──

// (g) eccentric orbit, Δt spanning a periapsis with rPeri < rSafe → FALSE (min-radius guard)
{
  const e = 0.3;
  const a = 6.4e6 / (1 - e);            // rPeri = 6.4e6 < rSafe 6.69e6
  assert.ok(a * (1 - e) < rSafeEarth, 'sanity: rPeri below rSafe');
  const { r, v } = perifocal(a, e, 200);   // ν=200° ⇒ inbound (r·v < 0), before perigee
  assert.ok(r.dot(v) < 0, 'sanity: state is inbound toward perigee');
  const s = shipAt(r, { v });
  const T = 2 * Math.PI * Math.sqrt(a * a * a / mu);
  const dt = 0.65 * T;                   // spans through perigee → periapsisInArc

  const posSnap = s.pos.clone(), vSnap = s.v.clone(), ptSnap = s.properTime;
  const ok = tryAnalyticCoast(s, earth, single, byNameSingle, 0, dt);
  assert.equal(ok, false, '(g) INV-B1: step dipping below rSafe → tryAnalyticCoast FALSE');
  assert.ok(s.pos.equals(posSnap) && s.v.equals(vSnap) && s.properTime === ptSnap,
    '(g) INV-B1: FALSE ⇒ nothing mutated (numeric handles the periapsis/atmosphere)');
}

// (h) end position whose dominant body differs → FALSE (SOI look-ahead)
{
  const two = [earth, luna];
  const byNameTwo = (n) => two.find(b => b.name === n);
  // Nearly-radial hyperbolic dash toward the moon: after Δt the ship sits inside
  // the moon's dominance (dominantBody(shipEnd) === Luna ≠ Earth).
  const s = shipAt(new THREE.Vector3(1.0e7, 0, 0), { v: new THREE.Vector3(4.2e4, 500, 0) });
  const dt = 8900;                       // ≈ (d − r0)/v_x ⇒ endpoint near the moon

  const posSnap = s.pos.clone(), vSnap = s.v.clone(), ptSnap = s.properTime;
  const ok = tryAnalyticCoast(s, earth, two, byNameTwo, 0, dt);
  assert.equal(ok, false, '(h) INV-B1: end dominant body ≠ refBody (SOI crossing) → FALSE');
  assert.ok(s.pos.equals(posSnap) && s.v.equals(vSnap) && s.properTime === ptSnap,
    '(h) INV-B1: FALSE ⇒ nothing mutated (numeric patched transition)');
}

console.log('cabotage.predicate.test.mjs OK');
