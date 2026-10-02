// ─────────────────────────────────────────────────────────────────────────────
// Регресс к validation/: эталон «гиперболическое движение» (SR, постоянное
// собственное ускорение α из покоя, без гравитирующих тел). NEVER WEAKEN без ADR.
//
// Аналитика (c=299792458, ρ=ατ/c):
//   γ=cosh ρ, β=tanh ρ, t=(c/α) sinh ρ, x=(c²/α)(cosh ρ −1), w=γv=αt.
// Реальный Ship.step интегрирует по КООРДИНАТНОМУ времени t с шагом dt, поэтому
// эталон параметризуем t: w=αt, γ=√(1+(αt/c)²), τ=(c/α)·asinh(αt/c),
// x=(c²/α)(γ−1) (тождественно формулам выше при t=(c/α)sinh ρ).
//
// Допуски (из схемы шага: w += a·dt точно; pos += v_{i+1}·dt; τ += dt·f(v_{i+1})):
//   • w: аддитивное накопление, ошибка только округления → rel 1e-9; γ,β — след.
//   • x: правоконечная сумма Эйлера ⇒ err = (dt/2)(v_T − v_0) + O(dt²) ⇒ первый
//     порядок. Допуск 1.5·(dt/2)·v_T (запас 50% на O(dt²)).
//   • τ: то же с f=1/γ ⇒ err = (dt/2)(1/γ_T − 1); допуск 1.5·(dt/2)·|1/γ_T −1|.
//   • сходимость: ошибка при dt/2 / ошибка при dt ≈ 0.5 (1-й порядок) ⇒ требуем
//     отношение ≤ 0.6 (то есть наблюдаемый порядок ≥ ~0.74).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import assert from 'node:assert/strict';
import { Ship, MODES } from '../js/physics/ship.js';
import { C, G0, YEAR } from '../js/physics/constants.js';
import { approxRel } from './helpers.mjs';

function fly(alpha, T, N) {
  const ship = new Ship();
  ship.mode = MODES[0];                       // arcade: α = maxAccelArcade·throttle
  ship.maxAccelArcade = alpha;
  ship.throttle = 1;
  const thrust = new THREE.Vector3(1, 0, 0);
  const dt = T / N;
  for (let i = 0; i < N; i++) ship.step(dt, [], new Map(), thrust);
  return { ship, dt };
}

function analytic(alpha, T) {
  const rho = alpha * T / C;
  const gamma = Math.sqrt(1 + rho * rho);
  return {
    w: alpha * T, gamma, beta: rho / gamma,
    tau: (C / alpha) * Math.asinh(rho),
    x: (C * C / alpha) * (gamma - 1),
  };
}

// [label, α, ρ_final=ατ/c]   1 g ≈ 1 год собственного времени; 1000 g (γ до ~74).
const cases = [
  ['1g, τ≈1 yr', G0, G0 * YEAR / C],
  ['1000g, ρ=1', 1000 * G0, 1],
  ['1000g, ρ=5', 1000 * G0, 5],
];

for (const [label, alpha, rho] of cases) {
  const tauP = rho * C / alpha;
  const T = (C / alpha) * Math.sinh(rho);     // t(τ)=(c/α) sinh(ατ/c)
  const N = 4000;
  const { ship, dt } = fly(alpha, T, N);
  const A = analytic(alpha, T);

  approxRel(ship.w.x, A.w, 1e-9, `${label}: w=αt`);
  approxRel(ship.gamma, Math.cosh(rho), 1e-9, `${label}: γ=cosh(ατ/c)`);
  approxRel(ship.beta, Math.tanh(rho), 1e-9, `${label}: β=tanh(ατ/c)`);
  assert.ok(Math.abs(ship.w.y) < 1e-6 * A.w && Math.abs(ship.w.z) < 1e-6 * A.w, `${label}: no transverse w`);
  assert.ok(ship.speed < C, `${label}: |v|<c`);

  const vT = ship.speed;
  assert.ok(Math.abs(ship.pos.x - A.x) <= 1.5 * (dt / 2) * vT, `${label}: x err ${ship.pos.x - A.x}`);
  assert.ok(Math.abs(ship.properTime - A.tau) <= 1.5 * (dt / 2) * Math.abs(1 / A.gamma - 1) + 1e-9 * A.tau,
    `${label}: τ err ${ship.properTime - A.tau}`);
  // τ(t) аналитики согласуется с заданным τ входа.
  approxRel(A.tau, tauP, 1e-12, `${label}: τ round trip`);

  // Сходимость (dt → dt/2): x и τ — 1-й порядок.
  const half = fly(alpha, T, 2 * N).ship;
  const ex1 = Math.abs(ship.pos.x - A.x), ex2 = Math.abs(half.pos.x - A.x);
  const et1 = Math.abs(ship.properTime - A.tau), et2 = Math.abs(half.properTime - A.tau);
  assert.ok(ex2 < 0.6 * ex1, `${label}: x convergence ${ex2} vs ${ex1}`);
  assert.ok(et2 < 0.6 * et1, `${label}: τ convergence ${et2} vs ${et1}`);
}

console.log('validation.hyperbolic.test.mjs OK');
