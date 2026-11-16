// "Twin paradox" module — CONTRACT tests, written from the contract WITHOUT reading js/physics/twins.js.
// Every number is checked against an independent reference computed here (closed-form hyperbolic motion in
// units c = 1, years, light-years) or against an identity between outputs (dx/dt = beta, dtau/dt = 1/gamma).
import assert from 'node:assert/strict';
import { C, YEAR, LY, G0 } from '../js/physics/constants.js';
import { gammaOf, cruiseTrip, accelTrip, clocksAt, sampleTrip } from '../js/physics/twins.js';

let checks = 0;
const rel = (a, b) => Math.abs(a - b) / (Math.abs(b) || 1);
const near = (a, b, tol, msg) => { checks++; assert.ok(rel(a, b) <= tol, `${msg}: ${a} vs ${b} (rel ${rel(a, b)})`); };
const nearAbs = (a, b, tol, msg) => { checks++; assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (abs ${Math.abs(a - b)})`); };
const ok = (c, msg) => { checks++; assert.ok(c, msg); };
const throwsRange = (fn, msg) => { checks++; assert.throws(fn, (e) => e instanceof RangeError, msg); };

// Independent reference: constant proper acceleration, units c=1, years, ly. A = a/c in 1/yr.
const accA = (g) => (g * G0 * YEAR) / C;
const refTau = (A, t) => Math.asinh(A * t) / A;
const refX = (A, t) => (Math.sqrt(1 + (A * t) ** 2) - 1) / A;
const refBeta = (A, t) => (A * t) / Math.sqrt(1 + (A * t) ** 2);
function refAccel(g, T, t) { // returns {tau, x, beta} for 4-phase accelerate/decelerate/accelerate/decelerate
  const A = accA(g), q = T / 4;
  const tauq = refTau(A, q), xq = refX(A, q);
  if (t <= q) return { tau: refTau(A, t), x: refX(A, t), beta: refBeta(A, t) };
  if (t <= 2 * q) { const s = 2 * q - t; return { tau: 2 * tauq - refTau(A, s), x: 2 * xq - refX(A, s), beta: refBeta(A, s) }; }
  if (t <= 3 * q) { const s = t - 2 * q; return { tau: 2 * tauq + refTau(A, s), x: 2 * xq - refX(A, s), beta: refBeta(A, s) }; }
  const s = 4 * q - t; return { tau: 4 * tauq - refTau(A, s), x: refX(A, s), beta: refBeta(A, s) };
}

// ---------- gammaOf ----------
near(gammaOf(0), 1, 1e-12, 'gamma(0)');
near(gammaOf(0.6), 1.25, 1e-12, 'gamma(0.6)');
near(gammaOf(0.8), 5 / 3, 1e-12, 'gamma(0.8)');
near(gammaOf(0.99), 7.0888120500833, 1e-9, 'gamma(0.99)');
for (const b of [-0.1, -1e-9, 1, 1.0000001, 2, NaN, Infinity, -Infinity]) {
  ok(Number.isNaN(gammaOf(b)), `gamma(${b}) must be NaN`);
}
{ let prev = 0.999999; // monotone increasing in beta
  for (const b of [0, 0.1, 0.5, 0.9, 0.99, 0.999, 0.99999]) { const g = gammaOf(b); ok(g >= 1 && g > prev - 1, 'gamma>=1'); prev = g; }
  ok(gammaOf(0.9) < gammaOf(0.99) && gammaOf(0.5) < gammaOf(0.9), 'gamma increasing'); }

// ---------- cruiseTrip: golden + identities ----------
{
  const t = cruiseTrip({ beta: 0.99, earthYears: 10 });
  ok(t.mode === 'cruise', 'mode');
  near(t.shipYears, 1.4106735979665894, 1e-9, 'cruise 0.99/10 shipYears');
  near(t.gamma, 7.088812050083354, 1e-9, 'cruise gamma');
  near(t.turnaroundLy, 0.99 * 10 / 2, 1e-12, 'cruise turnaround');
  ok(t.beta === 0.99 && t.maxBeta === 0.99 && t.earthYears === 10, 'echoed inputs');
  nearAbs(t.ageGapYears, 10 - t.shipYears, 1e-12, 'ageGap = earth - ship');
}
for (const beta of [0, 0.1, 0.5, 0.6, 0.8, 0.9, 0.99, 0.999]) for (const T of [0.01, 1, 10, 100, 1e4]) {
  const t = cruiseTrip({ beta, earthYears: T });
  near(t.shipYears, T * Math.sqrt(1 - beta * beta), 1e-12, `cruise ship b=${beta} T=${T}`);
  nearAbs(t.shipYears + t.ageGapYears, T, 1e-9 * T, 'ship + gap = earth');
  ok(t.ageGapYears >= 0 && t.shipYears > 0 && t.shipYears <= T, 'ship in (0,T]');
  near(t.turnaroundLy, beta * T / 2, 1e-12, 'turnaroundLy');
}
{ const t = cruiseTrip({ beta: 0, earthYears: 10 }); near(t.shipYears, 10, 1e-12, 'beta=0 no dilation'); nearAbs(t.turnaroundLy, 0, 1e-12, 'beta=0 no travel'); }
{ // ageGap grows with beta at fixed T
  let prev = -1;
  for (const b of [0, 0.1, 0.3, 0.5, 0.7, 0.9, 0.99, 0.999]) { const g = cruiseTrip({ beta: b, earthYears: 10 }).ageGapYears; ok(g > prev, `ageGap monotone in beta at ${b}`); prev = g; } }

// ---------- accelTrip: golden + formulas ----------
{
  const t = accelTrip({ accelG: 1, earthYears: 10 });
  ok(t.mode === 'accel', 'mode');
  near(t.shipYears, 6.497389632179972, 1e-9, 'accel 1g/10y shipYears');
  near(t.maxBeta, 0.9324458532301458, 1e-9, 'accel maxBeta');
  near(t.turnaroundLy, 3.424811500978825, 1e-9, 'accel turnaroundLy');
  near(t.gamma, gammaOf(t.maxBeta), 1e-9, 'accel gamma = gamma(maxBeta)');
  nearAbs(t.ageGapYears, 10 - t.shipYears, 1e-12, 'accel gap');
  ok(t.accelG === 1 && t.earthYears === 10, 'echoed inputs');
}
for (const g of [0.01, 0.1, 0.5, 1, 2, 5]) for (const T of [0.1, 1, 4, 10, 40, 100]) {
  const t = accelTrip({ accelG: g, earthYears: T });
  const A = accA(g), q = T / 4;
  near(t.shipYears, 4 * refTau(A, q), 1e-9, `accel ship g=${g} T=${T}`);
  near(t.maxBeta, refBeta(A, q), 1e-9, 'accel maxBeta formula');
  near(t.turnaroundLy, 2 * refX(A, q), 1e-9, 'accel turnaroundLy formula');
  ok(t.maxBeta >= 0 && t.maxBeta < 1, 'maxBeta in [0,1)');
  ok(t.shipYears > 0 && t.shipYears <= T, 'ship in (0,T]');
  nearAbs(t.shipYears + t.ageGapYears, T, 1e-9 * T, 'ship + gap = earth');
}
{ // Newtonian limit a*T/c -> 0: ship -> T, turnaround -> 2 * (a tq^2 / 2) / LY
  for (const [g, T] of [[1, 0.01], [1e-3, 1], [1e-2, 0.1]]) {
    const t = accelTrip({ accelG: g, earthYears: T });
    const a = g * G0, tq = (T / 4) * YEAR;
    near(t.shipYears, T, 1e-4, `newtonian ship g=${g} T=${T}`);
    near(t.turnaroundLy, (2 * (a * tq * tq / 2)) / LY, 1e-3, `newtonian turnaround g=${g} T=${T}`);
    near(t.maxBeta, (a * tq) / C, 1e-3, 'newtonian maxBeta');
  } }
{ // accel ship time grows with T, but slower than T (dilation strictly accumulates)
  let prev = null;
  for (const T of [1, 2, 4, 8, 16, 32, 64]) {
    const s = accelTrip({ accelG: 1, earthYears: T }).shipYears;
    if (prev) { ok(s > prev.s, 'ship grows with T'); ok(s - prev.s < T - prev.T, `ship grows slower than T (${prev.T}->${T})`); }
    prev = { T, s };
  } }
{ // maxBeta grows with a and with T
  ok(accelTrip({ accelG: 2, earthYears: 10 }).maxBeta > accelTrip({ accelG: 1, earthYears: 10 }).maxBeta, 'maxBeta up with a');
  ok(accelTrip({ accelG: 1, earthYears: 20 }).maxBeta > accelTrip({ accelG: 1, earthYears: 10 }).maxBeta, 'maxBeta up with T'); }

// ---------- clocksAt / sampleTrip properties ----------
const TRIPS = [];
for (const beta of [0.1, 0.6, 0.9, 0.99, 0.9999]) for (const T of [0.5, 10, 200]) TRIPS.push({ label: `cruise b=${beta} T=${T}`, trip: cruiseTrip({ beta, earthYears: T }) });
for (const g of [0.1, 1, 3]) for (const T of [0.5, 10, 200]) TRIPS.push({ label: `accel g=${g} T=${T}`, trip: accelTrip({ accelG: g, earthYears: T }) });

for (const { label, trip } of TRIPS) {
  const T = trip.earthYears, n = 200, dt = T / n;
  const pts = sampleTrip(trip, n);
  ok(pts.length === n + 1, `${label}: sampleTrip length n+1`);
  nearAbs(pts[0].t, 0, 1e-12, `${label}: first t=0`);
  nearAbs(pts[n].t, T, 1e-9 * T, `${label}: last t=T`);
  for (let i = 0; i <= n; i++) nearAbs(pts[i].t, i * dt, 1e-9 * T, `${label}: uniform t[${i}]`);
  ok(pts.length === sampleTrip(trip).length - 0 && sampleTrip(trip).length === 201, `${label}: default n=200`);

  nearAbs(pts[0].tau, 0, 1e-12, `${label}: tau(0)=0`);
  nearAbs(pts[0].x, 0, 1e-9, `${label}: x(0)=0`);
  nearAbs(pts[n].x, 0, 1e-8 * Math.max(1, trip.turnaroundLy), `${label}: x(T)=0`);
  near(pts[n].tau, trip.shipYears, 1e-9, `${label}: tau(T)=shipYears`);

  let maxX = 0;
  for (let i = 0; i <= n; i++) {
    const p = pts[i];
    ok(p.x >= -1e-12, `${label}: x>=0 at ${i}`);
    ok(p.beta >= 0 && p.beta < 1, `${label}: beta in [0,1) at ${i}`);
    ok(p.tau <= p.t * (1 + 1e-12) + 1e-15, `${label}: tau<=t at ${i}`);
    if (i > 0) ok(p.tau > 0, `${label}: tau>0 for t>0 at ${i}`);
    ok(p.phase === (p.t <= T / 2 ? 'out' : 'back'), `${label}: phase at t=${p.t}`);
    if (i > 0) {
      const q = pts[i - 1];
      ok(p.tau >= q.tau - 1e-12, `${label}: tau monotone at ${i}`);
      ok(p.tau - q.tau <= dt * (1 + 1e-9), `${label}: dtau<=dt at ${i}`);
      ok(Math.abs(p.x - q.x) <= dt * (1 + 1e-9) + 1e-12, `${label}: |dx/dt|<=c at ${i} (also continuity)`);
    }
    maxX = Math.max(maxX, p.x);
  }
  near(maxX, trip.turnaroundLy, 1e-9, `${label}: max x = turnaroundLy`);
  near(clocksAt(trip, T / 2).x, trip.turnaroundLy, 1e-9, `${label}: x(T/2)=turnaroundLy`);
  ok(clocksAt(trip, T / 2).phase === 'out', `${label}: phase at exactly T/2 is out`);
  ok(clocksAt(trip, T / 2 + dt).phase === 'back', `${label}: phase after T/2 is back`);

  // clamping
  for (const [tin, tout] of [[-5, 0], [-1e-9, 0], [T + 1e-6 * T + 1, T], [1e9, T]]) {
    const a = clocksAt(trip, tin), b = clocksAt(trip, tout);
    nearAbs(a.t, tout, 1e-9 * T, `${label}: clamp t(${tin})`);
    nearAbs(a.tau, b.tau, 1e-9, `${label}: clamp tau(${tin})`);
    nearAbs(a.x, b.x, 1e-9, `${label}: clamp x(${tin})`);
  }
  // kinematic identities on a fine grid: dx/dt = +-beta, dtau/dt = sqrt(1-beta^2) (trapezoid, away from the turnaround)
  const isAccel = trip.mode === 'accel';
  if (isAccel && T > 10) continue; // trapezoid reference needs a step small vs c/a; long trips covered pointwise below
  const N = 2000, h = T / N;
  const fine = sampleTrip(trip, N);
  for (let i = 1; i <= N; i++) {
    const p = fine[i - 1], q = fine[i];
    const outStep = q.t <= T / 2 + 1e-12, backStep = p.t >= T / 2 - 1e-12;
    if (!outStep && !backStep) continue; // straddles the turnaround (N even => never happens)
    const bAvg = (p.beta + q.beta) / 2;
    const sgn = outStep ? 1 : -1;
    const tol = isAccel ? 2e-3 : 1e-9;
    nearAbs((q.x - p.x) / h, sgn * bAvg, tol, `${label}: dx/dt=+-beta at step ${i}`);
    nearAbs((q.tau - p.tau) / h, Math.sqrt(1 - bAvg * bAvg) , isAccel ? 3e-3 : 1e-9, `${label}: dtau/dt=1/gamma at step ${i}`);
  }
}

// ---------- cruise: exact piecewise-linear shape ----------
for (const beta of [0.3, 0.9, 0.99]) for (const T of [1, 10, 37]) {
  const trip = cruiseTrip({ beta, earthYears: T }), g = gammaOf(beta);
  for (const f of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
    const t = f * T, c = clocksAt(trip, t);
    nearAbs(c.tau, t / g, 1e-12 * Math.max(1, T), `cruise tau b=${beta} T=${T} f=${f}`);
    nearAbs(c.x, t <= T / 2 ? beta * t : beta * (T - t), 1e-12 * Math.max(1, T), `cruise x b=${beta} T=${T} f=${f}`);
    if (f > 0 && f < 1) nearAbs(c.beta, beta, 1e-12, 'cruise beta const');
    near(c.t, t, 1e-12, 'echo t');
  }
}

// ---------- accel: pointwise vs independent hyperbolic reference ----------
for (const g of [0.3, 1, 2]) for (const T of [2, 10, 60]) {
  const trip = accelTrip({ accelG: g, earthYears: T });
  const fr = [0, 0.05, 0.2, 0.25, 0.3, 0.45, 0.5, 0.55, 0.7, 0.75, 0.8, 0.95, 1];
  for (const f of fr) {
    const t = f * T, c = clocksAt(trip, t), r = refAccel(g, T, t);
    nearAbs(c.tau, r.tau, 1e-9 * Math.max(1, T), `accel tau g=${g} T=${T} f=${f}`);
    nearAbs(c.x, r.x, 1e-9 * Math.max(1, trip.turnaroundLy), `accel x g=${g} T=${T} f=${f}`);
    nearAbs(c.beta, r.beta, 1e-9, `accel beta g=${g} T=${T} f=${f}`);
  }
  near(clocksAt(trip, T / 4).beta, trip.maxBeta, 1e-9, 'beta(T/4)=maxBeta');
  nearAbs(clocksAt(trip, T / 2).beta, 0, 1e-9, 'beta(T/2)=0 (stopped at turnaround)');
  near(clocksAt(trip, T / 2).tau, trip.shipYears / 2, 1e-9, 'tau(T/2) = half the ship time (symmetry)');
}

// ---------- error contract ----------
for (const b of [-0.1, 1, 1.5, NaN, Infinity, -Infinity]) throwsRange(() => cruiseTrip({ beta: b, earthYears: 10 }), `cruise beta=${b}`);
for (const T of [0, -1, NaN, Infinity, -Infinity]) {
  throwsRange(() => cruiseTrip({ beta: 0.5, earthYears: T }), `cruise T=${T}`);
  throwsRange(() => accelTrip({ accelG: 1, earthYears: T }), `accel T=${T}`);
}
for (const g of [0, -1, -1e-9]) throwsRange(() => accelTrip({ accelG: g, earthYears: 10 }), `accel g=${g}`);

console.log(`twins.contract: ${checks} checks passed`);
