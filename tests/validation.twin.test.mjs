// ─────────────────────────────────────────────────────────────────────────────
// Регресс к validation/: эталон «парадокс близнецов» (разгон-дрейф-торможение
// туда и обратно, α const, без тел). NEVER WEAKEN без ADR.
//
// Эталон: τ_ship = 4τ1 + 2τc;  t_earth = 4(c/α) sinh(ατ1/c) + 2 cosh(ατ1/c)·τc;
// финальные x≈0, v≈0; Δτ = t_earth − τ_ship > 0 и строго растёт с τc
// (dΔτ/dτc = 2(cosh(ατ1/c) − 1) > 0).
// Фазы переключаются по КООРДИНАТНОМУ времени: разгон/торможение t1=(c/α)sinh ρ1,
// дрейф γc·τc (γc=cosh ρ1).
// Допуски (схема: w точно, pos += v_{i+1}dt, τ += dt·f(v_{i+1}); ошибка фазы
// (dt/2)(f_end − f_start), разгон и торможение входят с противоположными знаками
// и сокращаются, но консервативно берём без сокращения):
//   • t_earth: сумма dt — точна до округления (rel 1e-9).
//   • τ_ship: ≤ 4·(dt/2)(1−1/γc)·1.5 + округление.
//   • x_final: ≤ 4·(dt/2)·v_peak·1.5  (v_peak=c·tanh ρ1).
//   • v_final: |w|/γ: w после торможения — только округление: ≤ 1e-6·w_peak.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import assert from 'node:assert/strict';
import { Ship, MODES } from '../js/physics/ship.js';
import { C, G0 } from '../js/physics/constants.js';
import { approxRel } from './helpers.mjs';

function twin(alpha, tau1, tauC, N) {
  const rho1 = alpha * tau1 / C;
  const t1 = (C / alpha) * Math.sinh(rho1);
  const gc = Math.cosh(rho1);
  const tc = gc * tauC;
  const ship = new Ship();
  ship.mode = MODES[0];
  ship.maxAccelArcade = alpha;
  const X = (s) => new THREE.Vector3(s, 0, 0);
  let tEarth = 0;
  const phase = (thr, sign, dur, n) => {
    ship.throttle = thr;
    const dt = dur / n;
    for (let i = 0; i < n; i++) { ship.step(dt, [], new Map(), X(sign)); tEarth += dt; }
  };
  phase(1, +1, t1, N); phase(0, +1, tc, N); phase(1, -1, t1, N);   // туда
  phase(1, -1, t1, N); phase(0, -1, tc, N); phase(1, +1, t1, N);   // обратно
  return { ship, tEarth, rho1, t1, gc, dt: t1 / N };
}

const cases = [
  ['1g',    G0,        0.25 * 365.25 * 86400, 0.5 * 365.25 * 86400],
  ['1000g', 1000 * G0, 3e4,                    5e4],
];
const N = 2000;
for (const [label, alpha, tau1, tauC] of cases) {
  const r = twin(alpha, tau1, tauC, N);
  const tauShip = 4 * tau1 + 2 * tauC;
  const tEarthA = 4 * (C / alpha) * Math.sinh(r.rho1) + 2 * r.gc * tauC;
  approxRel(r.tEarth, tEarthA, 1e-9, `${label}: t_earth`);
  const tauTol = 1.5 * 4 * (r.dt / 2) * (1 - 1 / r.gc) + 1e-9 * tauShip;
  assert.ok(Math.abs(r.ship.properTime - tauShip) <= tauTol,
    `${label}: τ_ship ${r.ship.properTime} vs ${tauShip} (tol ${tauTol})`);
  const vPeak = C * Math.tanh(r.rho1), wPeak = alpha * r.t1;
  assert.ok(Math.abs(r.ship.pos.x) <= 1.5 * 4 * (r.dt / 2) * vPeak,
    `${label}: final x ${r.ship.pos.x}`);
  assert.ok(Math.abs(r.ship.w.x) <= 1e-6 * wPeak, `${label}: final w ${r.ship.w.x}`);
  assert.ok(r.ship.speed <= 1e-6 * vPeak, `${label}: final v ${r.ship.speed}`);
  assert.ok(Math.abs(r.ship.pos.y) + Math.abs(r.ship.pos.z) === 0, `${label}: no transverse drift`);
  const dTau = r.tEarth - r.ship.properTime;
  assert.ok(dTau > 0, `${label}: Δτ>0`);
  approxRel(dTau, tEarthA - tauShip, 2e-3, `${label}: Δτ value`);

  // Монотонность: Δτ растёт с τc (и совпадает с производной 2(γc−1) по порядку).
  let prev = 0;
  for (const k of [0, 0.5, 1, 2, 4]) {
    const q = twin(alpha, tau1, k * tauC, 400);
    const d = q.tEarth - q.ship.properTime;
    assert.ok(d > prev, `${label}: Δτ monotone at τc×${k}: ${d} <= ${prev}`);
    prev = d;
  }
}
console.log('validation.twin.test.mjs OK');
