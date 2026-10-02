// Validation of the PROJECT's relativistic flight code against analytic references.
// Everything "simulated" below is produced by the real modules:
//   js/physics/ship.js (Ship.step: w=gamma*v integrator + proper time),
//   js/physics/relativity.js (dopplerFactor, gammaFromW/V), js/physics/gravity.js
//   (via Ship.step), js/data/bodies.js (GM, radius). No formula is re-implemented
//   on the "simulated" side. Analytic references are written independently below.
//
// Output (deterministic bytes): results/{table.md,table.csv,results.json}.
// Non-deterministic metadata (node version, git commit, date) -> results/env.json ONLY.
//
// TOLERANCE POLICY (every tolerance is derived, never fitted to the observed value):
//  * "exact" quantities (w, gamma, beta, tau in inertial flight, Doppler): the scheme
//    has no truncation error there, so tolerance is a floating-point roundoff bound
//    ROUNDOFF(N) = 64*N*eps  (N accumulated additions, eps=2^-52; 64 = safety factor
//    covering gamma^2 cancellation in 1-beta^2 and sum-order effects).
//  * Integrated quantities (tau, x): Ship.step is  w += a*dt (exact for const. a);
//    x += v(w_new)*dt ; tau += dt/gamma(w_new)  i.e. a RIGHT-ENDPOINT rule of the
//    exact integrand f(t) over each constant-thrust phase. Euler-Maclaurin gives
//       sum - integral = dt/2*(f(b)-f(a)) + dt^2/12*(f'(b)-f'(a)) + O(dt^4)
//    (per phase, f = v or 1/gamma). Tolerance = 2*|that estimate| + ROUNDOFF(N)
//    (factor 2 = margin for the neglected O(dt^4) term). This is a prediction from
//    the scheme, so a degradation of the integrator order/accuracy is caught while
//    an improvement still passes (one-sided bound).
//  * Convergence order: scheme is first order => observed order must be >= 0.9
//    (0.1 slack for pre-asymptotic effects); drop to <0.9 flags degraded order.
//  * Doppler: input quantisation vRadial=beta*C then /C injects |db|<=eps*beta,
//    amplified by dD/D = db/(1-b^2): tol = 4*eps/(1-beta^2) + 8*eps.
//  * Weak-field gravity: the code uses dtau/dt = sqrt(1+2Phi/c^2-beta^2) which for a
//    static observer equals the Schwarzschild sqrt(1-2GM/(rc^2)) exactly; the
//    a-priori allowance for a weak-field treatment is O((Phi/c^2)^2) in dtau/dt, i.e.
//    relative to the effect u=|Phi|/c^2 : u. Plus measurement noise eps/u (the effect
//    is 1-dtau/dt, a difference of numbers near 1). tol_rel = u + 4*eps/u.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import * as THREE from 'three';
import { C, G0, YEAR, AU } from '../js/physics/constants.js';
import { Ship } from '../js/physics/ship.js';
import { dopplerFactor, gammaFromV, momentumFromV } from '../js/physics/relativity.js';
import { BODIES } from '../js/data/bodies.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, 'results');
const EPS = Number.EPSILON;
const roundoff = (N) => 64 * N * EPS;

const rows = [];
const fmt = (x) => (Number.isFinite(x) ? x.toExponential(6) : String(x));
const num = (x) => (Number.isFinite(x) ? Number(x.toExponential(6)) : String(x));

// kind 'rel': pass iff rel_err <= tol  (rel_err = |sim-an|/|an|, or |sim-an| if an==0
//             -> quantities with analytic 0 are dimensionless/normalised on purpose)
function addRel(c, q, analytic, simulated, tol) {
  const abs = Math.abs(simulated - analytic);
  const rel = analytic !== 0 ? abs / Math.abs(analytic) : abs;
  rows.push({ case: c, quantity: q, analytic, simulated, abs_err: abs, rel_err: rel,
    tolerance: tol, tol_kind: 'rel', status: rel <= tol ? 'PASS' : 'FAIL' });
}
function addMin(c, q, analytic, simulated, minVal) {
  const abs = Math.abs(simulated - analytic);
  rows.push({ case: c, quantity: q, analytic, simulated, abs_err: abs,
    rel_err: abs / Math.abs(analytic), tolerance: minVal, tol_kind: 'min',
    status: simulated >= minVal ? 'PASS' : 'FAIL' });
}
function addNotCovered(c, q, why) {
  rows.push({ case: c, quantity: q, analytic: null, simulated: null, abs_err: null,
    rel_err: null, tolerance: null, tol_kind: 'none', status: 'NOT_COVERED', note: why });
}

// ---------------------------------------------------------------- harness
// Real Ship, arcade mode, no bodies (=> no gravity, no atmosphere, phi=0).
function makeShip(alpha) {
  const s = new Ship();
  s.mode = 'arcade';
  s.maxAccelArcade = alpha;           // felt proper acceleration at throttle 1
  return s;
}
// Run constant-thrust phases. phase = {dir: +1|-1|0 (thrust along +x), T: coordinate
// seconds, N: steps}. Returns total coordinate time (sum of dt).
function run(ship, phases) {
  const bodies = [], positions = new Map();
  const thrust = new THREE.Vector3();
  let t = 0;
  for (const ph of phases) {
    ship.throttle = ph.dir === 0 ? 0 : 1;
    thrust.set(ph.dir === 0 ? 1 : ph.dir, 0, 0);
    const dt = ph.T / ph.N;
    for (let i = 0; i < ph.N; i++) { ship.step(dt, bodies, positions, thrust); t += dt; }
  }
  return t;
}
// Euler-Maclaurin estimate of (right-endpoint sum - integral) over analytic phases.
// phases: {dir, T, N}; w0 tracked analytically (w = w0 + dir*alpha*t, specific momentum).
function schemeError(phases, alpha, which) {
  let w0 = 0, est = 0;
  for (const ph of phases) {
    const dt = ph.T / ph.N, a = ph.dir * alpha;
    const at = (w) => {
      const g = Math.sqrt(1 + (w * w) / (C * C));
      return which === 'x'
        ? { f: w / g, d: a / (g * g * g) }                       // v, dv/dt
        : { f: 1 / g, d: -(w / (C * C)) * a / (g * g * g) };     // 1/gamma, d(1/gamma)/dt
    };
    const w1 = w0 + a * ph.T;
    const A = at(w0), B = at(w1);
    est += (dt / 2) * (B.f - A.f) + (dt * dt / 12) * (B.d - A.d);
    w0 = w1;
  }
  return est;
}

// ---------------------------------------------------------------- Case A
// Hyperbolic motion from rest, constant proper acceleration alpha, 1-D.
// Reference (tau form): gamma=cosh(a tau/c), beta=tanh(a tau/c), t=(c/a) sinh(a tau/c),
//   x=(c^2/a)(cosh(a tau/c)-1), w=gamma*v=a*t.
// The simulation is stepped in coordinate time, so it is run for T = t(tau*) and the
// ship's own clock/state is compared with the references at tau*.
function hyperbolic(name, alpha, tauStar, N) {
  const th = (alpha * tauStar) / C;
  const T = (C / alpha) * Math.sinh(th);
  const ph = [{ dir: 1, T, N }];
  const ship = makeShip(alpha);
  run(ship, ph);
  const gam = Math.cosh(th), bet = Math.tanh(th);
  const x = ((C * C) / alpha) * (Math.cosh(th) - 1);
  const rf = roundoff(N);
  addRel(name, 'gamma', gam, ship.gamma, rf);
  addRel(name, 'beta', bet, ship.beta, rf);
  addRel(name, 'w=gamma*v [m/s]', alpha * T, ship.w.x, rf);
  const tauAn = tauStar;
  addRel(name, 'tau [s]', tauAn, ship.properTime,
    2 * Math.abs(schemeError(ph, alpha, 'tau')) / tauAn + rf);
  addRel(name, 'x [m]', x, ship.pos.x,
    2 * Math.abs(schemeError(ph, alpha, 'x')) / x + rf);
}
hyperbolic('A1_hyperbolic_1g_1yr', G0, YEAR, 20000);
// 1000 g up to gamma=13 (same point as tests/longitudinal.regression): cosh(a tau/c)=13
hyperbolic('A2_hyperbolic_1000g_gamma13', 1000 * G0, (C / (1000 * G0)) * Math.acosh(13), 4000);

// Convergence: same problem as A1 with N, 2N, 4N steps.
{
  const alpha = G0, tauStar = YEAR, th = (alpha * tauStar) / C;
  const T = (C / alpha) * Math.sinh(th);
  const xAn = ((C * C) / alpha) * (Math.cosh(th) - 1);
  const errs = { tau: [], x: [] };
  for (const N of [1000, 2000, 4000]) {
    const s = makeShip(alpha);
    run(s, [{ dir: 1, T, N }]);
    errs.tau.push(Math.abs(s.properTime - tauStar) / tauStar);
    errs.x.push(Math.abs(s.pos.x - xAn) / xAn);
  }
  for (const k of ['tau', 'x']) {
    const p1 = Math.log2(errs[k][0] / errs[k][1]);
    const p2 = Math.log2(errs[k][1] / errs[k][2]);
    addMin('A3_convergence_1g_N1000-2000-4000', `convergence_order_${k}`, 1, Math.min(p1, p2), 0.9);
  }
}

// ---------------------------------------------------------------- Case B
// Twin paradox: accel a*tau1 -> coast tau_c -> brake tau1 -> accel back tau1 -> coast
// tau_c -> brake tau1; back at start, at rest. Coordinate durations: accel/brake
// T1=(c/a)sinh(a tau1/c); coast tauC*cosh(a tau1/c) (gamma at cruise).
// Reference: tau_ship=4 tau1+2 tauC; t_earth=4(c/a)sinh(a tau1/c)+2 cosh(a tau1/c) tauC;
//   dtau = t_earth - tau_ship; x_far = 2(c^2/a)(cosh-1) + c sinh(a tau1/c) tauC.
{
  const name = 'B1_twin_1g_tau1=2yr_tauC=1yr';
  const alpha = G0, tau1 = 2 * YEAR, tauC = 1 * YEAR;
  const th = (alpha * tau1) / C;
  const T1 = (C / alpha) * Math.sinh(th), Tc = Math.cosh(th) * tauC;
  const N1 = 10000, Nc = Math.round(N1 * Tc / T1);
  const ph = [
    { dir: 1, T: T1, N: N1 }, { dir: 0, T: Tc, N: Nc }, { dir: -1, T: T1, N: N1 },
    { dir: -1, T: T1, N: N1 }, { dir: 0, T: Tc, N: Nc }, { dir: 1, T: T1, N: N1 },
  ];
  const ship = makeShip(alpha);
  // phases 1-3 -> far point, then 4-6 -> home
  const tFar = run(ship, ph.slice(0, 3));
  const xFarSim = ship.pos.x, wFar = ship.w.x, tauFar = ship.properTime;
  const tHome = tFar + run(ship, ph.slice(3));
  const Ntot = ph.reduce((s, p) => s + p.N, 0);
  const rf = roundoff(Ntot);
  const tauShipAn = 4 * tau1 + 2 * tauC;
  const tEarthAn = 4 * (C / alpha) * Math.sinh(th) + 2 * Math.cosh(th) * tauC;
  const xFarAn = 2 * ((C * C) / alpha) * (Math.cosh(th) - 1) + C * Math.sinh(th) * tauC;
  const errTau = (phs) => Math.abs(schemeError(phs, alpha, 'tau'));
  addRel(name, 'tau_ship [s]', tauShipAn, ship.properTime, 2 * errTau(ph) / tauShipAn + rf);
  addRel(name, 'dtau=t_earth-tau_ship [s]', tEarthAn - tauShipAn, tHome - ship.properTime,
    (2 * errTau(ph) + 64 * Ntot * EPS * tEarthAn) / (tEarthAn - tauShipAn));
  addRel(name, 'tau_at_turnaround [s]', 2 * tau1 + tauC, tauFar,
    2 * errTau(ph.slice(0, 3)) / (2 * tau1 + tauC) + rf);
  addRel(name, 'x_turnaround [m]', xFarAn, xFarSim,
    2 * Math.abs(schemeError(ph.slice(0, 3), alpha, 'x')) / xFarAn + rf);
  addRel(name, 'w_turnaround/c', 0, wFar / C, 64 * Ntot * EPS * Math.sinh(th));
  addRel(name, 'x_final/x_turnaround', 0, ship.pos.x / xFarAn,
    2 * Math.abs(schemeError(ph, alpha, 'x')) / xFarAn + rf);
  addRel(name, 'w_final/c', 0, ship.w.x / C, 64 * Ntot * EPS * Math.sinh(th));
}
// Inertial twin leg (initial velocity set through the real momentumFromV): tau=t/gamma.
for (const beta of [0.8, 0.99]) {
  const name = `B2_inertial_beta=${beta}`;
  const s = new Ship();
  s.mode = 'arcade'; s.throttle = 0;
  momentumFromV(new THREE.Vector3(beta * C, 0, 0), s.w);
  s.v.set(beta * C / gammaFromV(beta * C), 0, 0);   // consistent cached v for the first step
  const T = 10 * YEAR, N = 1000;
  run(s, [{ dir: 0, T, N }]);
  const g = 1 / Math.sqrt(1 - beta * beta);
  const rf = roundoff(N) * g * g;                    // 1-beta^2 cancellation ~ gamma^2*eps
  addRel(name, 'tau=t/gamma [s]', T / g, s.properTime, rf);
  addRel(name, 'x=beta*c*t [m]', beta * C * T, s.pos.x, rf);
}

// ---------------------------------------------------------------- Case C
// C(i) Convention (read from relativity.js): dopplerFactor(vRadial), vRadial>0 = source
// APPROACHING; returns nu_obs/nu_src = sqrt((1+b)/(1-b)); >1 blueshift, <1 redshift.
for (const beta of [0.1, 0.5, 0.9, 0.99]) {
  const tol = (4 * EPS) / (1 - beta * beta) + 8 * EPS;
  addRel('C1_doppler_approach', `D(beta=${beta})`, Math.sqrt((1 + beta) / (1 - beta)),
    dopplerFactor(beta * C), tol);
  addRel('C1_doppler_recede', `D(beta=-${beta})`, Math.sqrt((1 - beta) / (1 + beta)),
    dopplerFactor(-beta * C), tol);
}
// C(ii) Transverse Doppler 1/gamma needs an angular Doppler form. In JS only the radial
// dopplerFactor and aberratedCos exist; D=sqrt(1-b^2)/(1-b cos th') lives in the GLSL.
addNotCovered('C2_transverse_doppler', '1/gamma at cos(theta\')=0',
  'angular Doppler form exists only in GLSL (relativisticPass.js), not in node-testable JS');

// C(iii) Gravitational redshift via the real Ship.step proper-time term.
// Static point: ship placed at r from a single body, one tiny step (dt=1e-3 s, speed
// afterwards g*dt << c so beta^2 < 1e-18 and negligible). Effect = 1 - dtau/dt.
{
  const byName = Object.fromEntries(BODIES.map((b) => [b.name, b]));
  const cases = [
    ['C3_grav_Earth_surface', byName.Earth, byName.Earth.radius],
    ['C3_grav_Sun_surface', byName.Sun, byName.Sun.radius],
    ['C3_grav_Sun_at_1AU', byName.Sun, AU],
  ];
  for (const [name, b, r] of cases) {
    const body = { name: b.name, GM: b.GM, radius: b.radius };   // no atmosphere
    const s = new Ship();
    s.mode = 'arcade'; s.throttle = 0;
    s.pos.set(r, 0, 0);
    const positions = new Map([[b.name, new THREE.Vector3(0, 0, 0)]]);
    const dt = 1e-3;
    s.step(dt, [body], positions, new THREE.Vector3(1, 0, 0));
    const sim = 1 - s.properTime / dt;
    const u = b.GM / (r * C * C);                 // |Phi|/c^2
    const x = 2 * u;                              // 2GM/(r c^2)
    const an = x / (1 + Math.sqrt(1 - x));        // 1 - sqrt(1-x), cancellation-free
    addRel(name, '1-dtau/dt (Schwarzschild exact)', an, sim, u + (4 * EPS) / u);
  }
}
addNotCovered('C4_aberration_shader', 'GLSL aberration/Doppler pixels',
  'shader math is not executed under node; only aberratedCos mirror is tested in tests/relativity.test.mjs');

// ---------------------------------------------------------------- output
const COLS = ['case', 'quantity', 'analytic', 'simulated', 'abs_err', 'rel_err', 'tolerance', 'status'];
function tolText(r) {
  if (r.tol_kind === 'rel') return `rel<=${fmt(r.tolerance)}`;
  if (r.tol_kind === 'min') return `value>=${fmt(r.tolerance)}`;
  return 'n/a';
}
function cell(r, k) {
  if (k === 'tolerance') return tolText(r);
  if (k === 'case' || k === 'quantity' || k === 'status') return r[k];
  return r[k] === null ? 'n/a' : fmt(r[k]);
}
const lines = rows.map((r) => COLS.map((k) => cell(r, k)));
const md = ['| ' + COLS.join(' | ') + ' |', '|' + COLS.map(() => '---').join('|') + '|',
  ...lines.map((l) => '| ' + l.join(' | ')+ ' |')].join('\n') + '\n';
const csv = [COLS.join(','), ...lines.map((l) => l.map((c) => (/[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(','))].join('\n') + '\n';
const json = JSON.stringify(rows.map((r) => ({
  case: r.case, quantity: r.quantity, analytic: r.analytic === null ? null : num(r.analytic),
  simulated: r.simulated === null ? null : num(r.simulated),
  abs_err: r.abs_err === null ? null : num(r.abs_err), rel_err: r.rel_err === null ? null : num(r.rel_err),
  tolerance: r.tolerance === null ? null : num(r.tolerance), tolerance_kind: r.tol_kind,
  status: r.status, ...(r.note ? { note: r.note } : {}),
})), null, 2) + '\n';

const failed = rows.filter((r) => r.status === 'FAIL');
const check = process.argv.includes('--check');
if (check) {
  let drift = false;
  for (const [f, content] of [['table.md', md], ['table.csv', csv], ['results.json', json]]) {
    let disk = null;
    try { disk = fs.readFileSync(path.join(OUT, f), 'utf8'); } catch { /* missing */ }
    if (disk !== content) { console.error(`DRIFT: validation/results/${f} differs from fresh run`); drift = true; }
  }
  if (drift) { console.error('VALIDATION CHECK: DRIFT'); process.exit(1); }
} else {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'table.md'), md);
  fs.writeFileSync(path.join(OUT, 'table.csv'), csv);
  fs.writeFileSync(path.join(OUT, 'results.json'), json);
  let commit = 'unknown';
  try { commit = execSync('git rev-parse HEAD', { cwd: path.join(here, '..') }).toString().trim(); } catch { /* no git */ }
  fs.writeFileSync(path.join(OUT, 'env.json'), JSON.stringify(
    { node: process.version, git_commit: commit, date: new Date().toISOString() }, null, 2) + '\n');
}
console.log(md);
const n = (s) => rows.filter((r) => r.status === s).length;
console.log(`validation: ${n('PASS')} PASS, ${n('FAIL')} FAIL, ${n('NOT_COVERED')} NOT_COVERED`);
if (failed.length) { console.error('VALIDATION: FAIL'); process.exit(1); }
console.log('VALIDATION: PASS');
