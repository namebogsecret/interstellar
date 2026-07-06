// ─────────────────────────────────────────────────────────────────────────────
// CABOTAGE PROPER-TIME (dτ) CONSISTENCY — analytic coast vs numeric integrator.
// Locks ТЗ INV-T1 (analytic dτ over Δt matches a CONVERGED fine numeric reference
// to 1e-6 rel) and INV-T2 (single-frame: no properTime step-jump when toggling
// analytic↔numeric). Catalog: INV-PHYS-01/INV-PHYS-07 (proper-time integral uses
// the SAME gravitationalPotential the integrator uses).
//
// Black-box through the frozen public API: dτ_analytic is observed as the
// ship.properTime advance produced by tryAnalyticCoast (which commits the analytic
// step + accumulates dτ). The reference is many small ship.step() coasts over the
// IDENTICAL initial state — the real integrator, same dτ formula.
//
// Single body fixed at the origin (no parent/period ⇒ absolutePosition = 0,
// bodyVelocity = 0): hermetic, and gravitationalPotential = −μ/r in both paths.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { tryAnalyticCoast } from '../js/physics/cabotage.js';
import { Ship } from '../js/physics/ship.js';
import { momentumFromV } from '../js/physics/relativity.js';
import assert from 'node:assert/strict';

const mu = 3.986004418e14;              // Earth GM
const earth = {
  name: 'Earth', GM: mu, radius: 6.371e6,
  atmosphere: { height: 1.0e5, color: 0, density0: 1.225, scaleHeight: 8.5e3 },
};
const bodies = [earth];
const byName = (n) => bodies.find(b => b.name === n);
const positions = new Map([['Earth', new THREE.Vector3(0, 0, 0)]]);

// Eccentric orbit, START AT PERIGEE outbound so r, |v| and Φ all vary along the
// arc (non-trivial dτ integral that actually exercises the adaptive-K quadrature);
// rPeri chosen safely above rSafe so cabotage engages.
const e = 0.3;
const rPeri = 7.5e6;                    // > rSafe(Earth) ≈ 6.69e6
const aOrb = rPeri / (1 - e);
const vPeri = Math.sqrt(mu * (1 + e) / rPeri);
const T = 2 * Math.PI * Math.sqrt(aOrb * aOrb * aOrb / mu);

function freshShip() {
  const s = new Ship();
  s.mode = 'arcade';
  s.throttle = 0;                       // coasting
  s.landed = false;
  s.pos.set(rPeri, 0, 0);
  s.v.set(0, vPeri, 0);
  momentumFromV(s.v, s.w);
  s.altitude = rPeri - earth.radius;
  s.properTime = 0;
  return s;
}

// Fine numeric reference dτ: many small ship.step coasts over the same Δt.
function numericDtau(dt, subDt) {
  const s = freshShip();
  const thrust = new THREE.Vector3(0, 0, 0);   // unused (throttle 0)
  const n = Math.round(dt / subDt);
  const h = dt / n;
  for (let i = 0; i < n; i++) s.step(h, bodies, positions, thrust, null);
  return s.properTime;
}

// ── INV-T1: analytic dτ over a long coast vs a converged fine numeric dτ ──
{
  const dt = 500;                        // one warp-frame's worth of coast (s)
  const ref = numericDtau(dt, 0.05);     // converged reference (10000 substeps)

  const ship = freshShip();
  const pt0 = ship.properTime;
  const ok = tryAnalyticCoast(ship, earth, bodies, byName, 0, dt);
  assert.ok(ok, 'INV-T1: tryAnalyticCoast must engage on a clean high eccentric orbit');
  const analytic = ship.properTime - pt0;

  assert.ok(analytic > 0 && Number.isFinite(analytic), 'INV-T1: analytic dτ finite & positive');
  const rel = Math.abs(analytic - ref) / ref;
  assert.ok(rel <= 1e-6, `INV-T1: |dτ_analytic − dτ_ref|/dτ_ref = ${rel} > 1e-6 (ref=${ref}, analytic=${analytic})`);
  // dτ is time-dilated below coordinate time (deep in Earth's well + orbital speed).
  assert.ok(analytic < dt, 'INV-T1: dτ < dt (gravitational + velocity time dilation)');
}

// ── INV-T2: single frame — no properTime step-jump across an analytic↔numeric switch ──
{
  const dt = 30;                         // one real warp substep (s)
  const ref = numericDtau(dt, 0.01);     // fine reference over the identical frame

  const ship = freshShip();
  const pt0 = ship.properTime;
  const ok = tryAnalyticCoast(ship, earth, bodies, byName, 0, dt);
  assert.ok(ok, 'INV-T2: tryAnalyticCoast engages for the single frame');
  const analytic = ship.properTime - pt0;

  const rel = Math.abs(analytic - ref) / ref;
  assert.ok(rel <= 1e-6, `INV-T2: single-frame |Δdτ|/dτ = ${rel} > 1e-6 (toggling analytic↔numeric must not jump properTime)`);
}

console.log('cabotage.dtau.test.mjs OK');
