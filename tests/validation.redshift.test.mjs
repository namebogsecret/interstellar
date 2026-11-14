// ─────────────────────────────────────────────────────────────────────────────
// Регресс к validation/: эталоны красного смещения (доплер СТО + гравитационный
// фактор слабого поля). NEVER WEAKEN без ADR.
//
// Конвенция dopplerFactor(vRadial) (по докстрингу relativity.js): vRadial>0 =
// сближение; фактор умножает наблюдаемую частоту (>1 синее, <1 красное):
//   D(β)=√((1+β)/(1−β)) = e^{atanh β}  (e^{быстрота}).
// Инварианты: D(0)=1; D(β)·D(−β)=1; D(β1⊕β2)=D(β1)·D(β2) (релятивистское сложение
// скоростей); монотонность. Допуск 1e-12 отн.: чистая формула, ошибка — округление
// (clamp ±1−1e-9 не задевается при |β|≤0.9999).
// Связка с интегратором: у корабля с постоянным α из покоя D(speed)=e^{ατ/c}.
//
// Гравитация: dτ/dt = √(1−2GM/(rc²)) (на поверхности Земли и Солнца, точечная
// масса, ship в покое). Ship.step даёт √(1+2Φ/c²−β²) с Φ=−GM/r: то же выражение,
// допуск — только β² за шаг (v=g·dt, учитываем явно) и округление (1e-15 абс.).
// Слабополевое 1-е приближение 1+Φ/c² отличается на ≤ (Φ/c²)² (остаток ряда
// √(1+2x)=1+x−x²/2+x³/2…, |x|≪1), допуск (Φ/c²)² + 1e-15 (~9 ulp double около 1).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import assert from 'node:assert/strict';
import { dopplerFactor } from '../js/physics/relativity.js';
import { gravitationalPotential } from '../js/physics/gravity.js';
import { Ship, MODES } from '../js/physics/ship.js';
import { C, G0 } from '../js/physics/constants.js';
import { approxRel, approxAbs } from './helpers.mjs';

// ── Доплер ──
const betas = [0, 1e-6, 0.01, 0.1, 0.5, 0.9, 0.99, 0.9999];
for (const b of betas) {
  approxRel(dopplerFactor(b * C), Math.sqrt((1 + b) / (1 - b)), 1e-12, `D(${b})`);
  approxRel(dopplerFactor(b * C) * dopplerFactor(-b * C), 1, 1e-12, `D(β)D(−β), β=${b}`);
  approxRel(dopplerFactor(b * C), Math.exp(Math.atanh(b)), 1e-12, `D=e^rapidity, β=${b}`);
}
assert.equal(dopplerFactor(0), 1, 'D(0)=1');
assert.ok(dopplerFactor(0.5 * C) > 1 && dopplerFactor(-0.5 * C) < 1, 'approach=blue, recede=red');
for (let i = 1; i < betas.length; i++)
  assert.ok(dopplerFactor(betas[i] * C) > dopplerFactor(betas[i - 1] * C), 'D monotone in β');
for (const [b1, b2] of [[0.3, 0.4], [0.9, 0.9], [0.5, -0.7]]) {
  const bs = (b1 + b2) / (1 + b1 * b2);
  approxRel(dopplerFactor(bs * C), dopplerFactor(b1 * C) * dopplerFactor(b2 * C), 1e-12, `D composition ${b1},${b2}`);
}

// Корабль: D(v) = e^{ατ/c} при гиперболическом полёте (шаг интегратора точен по w).
{
  const alpha = 1000 * G0, rho = 3;
  const T = (C / alpha) * Math.sinh(rho);
  const s = new Ship(); s.mode = MODES[0]; s.maxAccelArcade = alpha; s.throttle = 1;
  const N = 2000;
  for (let i = 0; i < N; i++) s.step(T / N, [], new Map(), new THREE.Vector3(1, 0, 0));
  approxRel(dopplerFactor(s.speed), Math.exp(rho), 1e-8, 'ship: D(v)=e^{ατ/c}');
}

// ── Гравитационный фактор ──
const rs = (GM) => 2 * GM / (C * C);
const bodiesTbl = [
  ['Earth', 3.986004418e14, 6.371e6],
  ['Sun',   1.32712440018e20, 6.957e8],
];
for (const [name, GM, R] of bodiesTbl) {
  const body = { name, GM, radius: R };
  const positions = new Map([[name, new THREE.Vector3()]]);
  const x = -GM / (R * C * C);                       // Φ/c²
  approxRel(gravitationalPotential(new THREE.Vector3(R, 0, 0), [body], positions), -GM / R, 1e-12, `${name}: Φ=−GM/r`);

  const ship = new Ship(); ship.mode = MODES[0]; ship.throttle = 0;
  ship.pos.set(R, 0, 0);
  const dt = 1;
  ship.step(dt, [body], positions, new THREE.Vector3());
  const ratio = ship.properTime / dt;
  const beta2 = ship.v.lengthSq() / (C * C);
  approxAbs(ratio, Math.sqrt(1 - rs(GM) / R - beta2), 1e-15, `${name}: dτ/dt=√(1−2GM/rc²)`);
  approxAbs(ratio, Math.sqrt(1 - rs(GM) / R), 1e-15 + beta2, `${name}: dτ/dt (static)`);
  approxAbs(ratio, 1 + x, x * x + 1e-15, `${name}: weak-field 1+Φ/c² within O((Φ/c²)²)`);
  assert.ok(ratio < 1, `${name}: clock runs slow in well`);
  // Потенциал аддитивен и глубже у центра: часы ближе — медленнее.
  const near = gravitationalPotential(new THREE.Vector3(R, 0, 0), [body], positions);
  const far  = gravitationalPotential(new THREE.Vector3(10 * R, 0, 0), [body], positions);
  assert.ok(near < far && far < 0, `${name}: Φ ordering`);
}
console.log('validation.redshift.test.mjs OK');
