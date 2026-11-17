// "Acceleration & braking to a star" module — CONTRACT tests: flip-and-burn vs flyby at constant
// proper acceleration (hyperbolic motion). References are independent: textbook closed forms in
// plain Math.acosh/sinh, a numeric integrator, and the neighbouring twins.js module.
import assert from 'node:assert/strict';
import { C, YEAR, LY, G0 } from '../js/physics/constants.js';
import { STARS } from '../js/data/stars.js';
import { accelTrip } from '../js/physics/twins.js';
import {
  G_LY_YR2, TARGETS, ACCEL_MIN_G, ACCEL_MAX_G, accelSegment, flipAndBurn, flyby, tripState,
  betaAt, sampleBeta, accelFromSlider, sliderFromAccel,
} from '../js/physics/accel.js';

let checks = 0;
const rel = (a, b) => Math.abs(a - b) / (Math.abs(b) || 1);
const near = (a, b, tol, msg) => { checks++; assert.ok(rel(a, b) <= tol, `${msg}: ${a} vs ${b} (rel ${rel(a, b)})`); };
const ok = (c, msg) => { checks++; assert.ok(c, msg); };
const throwsRange = (fn, msg) => { checks++; assert.throws(fn, (e) => e instanceof RangeError, msg); };

// ---- constants / targets (independent literals) ----
near(G_LY_YR2, 1.0323, 2e-4, '1 g ~ 1.0323 ly/yr^2');
near(G_LY_YR2, 9.80665 * 365.25 * 86400 / 299792458, 1e-14, '1 g = G0*YEAR/C');
ok(TARGETS.length === 2, 'two targets');
{
  const p = TARGETS.find((t) => t.id === 'proxima'), b = TARGETS.find((t) => t.id === 'barnard');
  near(p.ly, 4.2465, 1e-12, 'Proxima 4.2465 ly'); near(b.ly, 5.963, 1e-12, 'Barnard 5.963 ly');
  ok(STARS.some((s) => s.name === p.en && s.ly === p.ly), 'Proxima from stars.js');
  ok(STARS.some((s) => s.name === b.en && s.ly === b.ly), 'Barnard from stars.js');
  ok(p.ru && b.ru, 'Russian names present');
}
ok(ACCEL_MIN_G === 0.01 && ACCEL_MAX_G === 10, 'slider range 0.01..10 g');

// ---- independent textbook reference (plain acosh/sinh, fine for moderate gamma) ----
const refSeg = (accelG, x) => {
  const a = accelG * 9.80665 * 365.25 * 86400 / 299792458; // ly/yr^2
  const gamma = 1 + a * x;
  return { gamma, beta: Math.sqrt(1 - 1 / (gamma * gamma)), tau: Math.acosh(gamma) / a, t: Math.sinh(a * (Math.acosh(gamma) / a)) / a };
};
for (const g of [0.05, 0.3, 1, 2.5, 9]) for (const x of [0.5, 2.12325, 4.2465, 5.963]) {
  const s = accelSegment({ accelG: g, x }), r = refSeg(g, x);
  near(s.gamma, r.gamma, 1e-12, `gamma g=${g} x=${x}`);
  near(s.beta, r.beta, 1e-10, `beta g=${g} x=${x}`);
  near(s.tau, r.tau, 1e-10, `tau g=${g} x=${x}`);
  near(s.t, r.t, 1e-10, `t g=${g} x=${x}`);
}

// ---- known values: 1 g, Proxima. Hand calc: u=2.1919, gamma=3.1919, t_half=2.936, tau_half=1.771 ----
{
  const f = flipAndBurn({ accelG: 1, d: 4.2465 });
  near(f.t, 5.872, 1e-3, 'flip Proxima 1g Earth time ~5.87 yr');
  near(f.tau, 3.542, 1e-3, 'flip Proxima 1g ship time ~3.54 yr');
  near(f.peakGamma, 3.1919, 1e-3, 'flip peak gamma ~3.19');
  near(f.peakBeta, 0.9497, 1e-3, 'flip peak beta ~0.950');
  const y = flyby({ accelG: 1, d: 4.2465 });
  // u = 4.3837: gamma=5.3837, sqrt(g^2-1)=5.2900, t=5.1246, tau=ln(10.6737)/1.0323=2.2937
  near(y.peakGamma, 5.3837, 1e-3, 'flyby peak gamma'); near(y.t, 5.1246, 1e-3, 'flyby Earth time');
  near(y.tau, 2.2937, 1e-3, 'flyby ship time'); near(y.peakBeta, 0.98258, 1e-3, 'flyby beta ~0.983');
  ok(y.tau < f.tau && y.t < f.t, 'flyby faster than flip on both clocks');
  ok(y.peakBeta > f.peakBeta, 'flyby peak speed higher');
  near(y.arrivalBeta, y.peakBeta, 1e-15, 'flyby arrives at peak speed'); ok(f.arrivalBeta === 0, 'flip arrives at rest');
}

// ---- invariants over a grid ----
const gs = [0.01, 0.03, 0.1, 0.5, 1, 2, 5, 10], ds = TARGETS.map((t) => t.ly);
for (const g of gs) for (const d of ds) {
  const st = tripState({ accelG: g, d });
  for (const [k, tr] of Object.entries(st)) {
    const m = `${k} g=${g} d=${d}`;
    near(tr.peakGamma ** 2 - (tr.peakBeta * tr.peakGamma) ** 2, 1, 1e-9, 'gamma^2 - beta^2 gamma^2 = 1 ' + m);
    ok(tr.peakBeta > 0 && tr.peakBeta < 1, 'beta in (0,1) ' + m);
    ok(tr.t > d, 't_earth strictly > d ' + m);
    ok(tr.tau <= tr.t && tr.tau > 0, 'tau <= t ' + m);
  }
  ok(st.flyby.t < st.flip.t && st.flyby.tau < st.flip.tau, `flyby < flip both clocks g=${g} d=${d}`);
}

// ---- symmetry / structure of flip-and-burn ----
for (const g of [0.1, 1, 7]) for (const d of ds) {
  const f = flipAndBurn({ accelG: g, d }), h = accelSegment({ accelG: g, x: d / 2 });
  near(f.t, 2 * h.t, 1e-14, 'flip t = 2 t_half'); near(f.tau, 2 * h.tau, 1e-14, 'flip tau = 2 tau_half');
  near(f.peakBeta, h.beta, 1e-14, 'flip peak = half-way speed');
  near(betaAt(f, f.t / 2), f.peakBeta, 1e-9, 'beta at midpoint is the peak');
  for (const fr of [0.1, 0.25, 0.4]) near(betaAt(f, f.t * fr), betaAt(f, f.t * (1 - fr)), 1e-9, 'beta(t) mirror-symmetric');
  ok(betaAt(f, 0) === 0 && betaAt(f, f.t) === 0, 'rest at both ends');
  const y = flyby({ accelG: g, d });
  ok(betaAt(y, 0) === 0, 'flyby starts at rest'); near(betaAt(y, y.t), y.peakBeta, 1e-12, 'flyby ends at peak');
  ok(betaAt(y, -1) === 0 && betaAt(y, y.t * 2) === 0, 'outside the trip -> 0');
}

// ---- numeric integration: dtau = dt / gamma(t); x = int beta dt ----
function integrate(trip, N) {
  let tau = 0, x = 0;
  const dt = trip.t / N;
  const f = (t) => { const b = betaAt(trip, t); return [Math.sqrt(1 - b * b), b]; }; // [1/gamma, beta]
  let [ip, bp] = f(0);
  for (let i = 1; i <= N; i++) { const [ic, bc] = f(i * dt); tau += 0.5 * (ip + ic) * dt; x += 0.5 * (bp + bc) * dt; ip = ic; bp = bc; }
  return { tau, x };
}
for (const g of [0.1, 1, 8]) for (const d of ds) for (const fn of [flipAndBurn, flyby]) {
  const tr = fn({ accelG: g, d }), r = integrate(tr, 200000);
  near(r.tau, tr.tau, 1e-3, `numeric tau ${tr.kind} g=${g} d=${d}`);
  near(r.x, d, 1e-3, `numeric distance covered ${tr.kind} g=${g} d=${d}`);
}

// ---- Newtonian limit (a -> 0): flyby t = sqrt(2d/a), flip t = 2 sqrt(d/a), tau ~ t ----
for (const d of ds) {
  const a = 1e-6 * G_LY_YR2;
  const y = flyby({ accelG: 1e-6, d }), f = flipAndBurn({ accelG: 1e-6, d });
  near(y.t, Math.sqrt(2 * d / a), 1e-5, 'Newton flyby t'); near(f.t, 2 * Math.sqrt(d / a), 1e-5, 'Newton flip t');
  near(y.tau / y.t, 1, 1e-5, 'tau ~ t in Newton limit'); near(y.peakBeta, Math.sqrt(2 * a * d), 1e-5, 'Newton v = sqrt(2 a d)');
  near(y.t, f.t / Math.SQRT2, 1e-5, 'Newton flyby = flip / sqrt2');
}

// ---- monotonicity in a, d ----
for (const d of ds) for (const fn of [flipAndBurn, flyby]) {
  let pt = Infinity, ptau = Infinity, pb = 0;
  for (const g of [0.01, 0.02, 0.05, 0.1, 0.3, 1, 3, 10, 100, 1000]) {
    const r = fn({ accelG: g, d });
    ok(r.t < pt && r.tau < ptau, `time falls with a (${r.kind} d=${d} g=${g})`);
    ok(r.peakBeta > pb, `peak beta rises with a (${r.kind} d=${d} g=${g})`);
    pt = r.t; ptau = r.tau; pb = r.peakBeta;
  }
}
{ // farther is slower; Barnard > Proxima for every a and profile
  for (const g of gs) for (const fn of [flipAndBurn, flyby]) {
    const p = fn({ accelG: g, d: 4.2465 }), b = fn({ accelG: g, d: 5.963 });
    ok(b.t > p.t && b.tau > p.tau && b.peakBeta > p.peakBeta, `Barnard farther g=${g}`);
  }
}

// ---- exact reciprocity: swapping a and d scale (u = a x invariant) ----
near(accelSegment({ accelG: 2, x: 3 }).gamma, accelSegment({ accelG: 3, x: 2 }).gamma, 1e-14, 'gamma depends on a*x only');
near(accelSegment({ accelG: 2, x: 3 }).tau * 2, accelSegment({ accelG: 3, x: 2 }).tau * 3, 1e-12, 'tau scales as 1/a at fixed u');

// ---- cross-check against twins.js::accelTrip (four-phase round trip = 4 quarter legs) ----
for (const g of [0.5, 1, 3]) for (const T of [8, 20, 60]) {
  const tw = accelTrip({ accelG: g, earthYears: T });
  const leg = accelSegment({ accelG: g, x: tw.turnaroundLy / 2 });
  near(leg.tau * 4, tw.shipYears, 1e-9, `twins accelTrip ship time g=${g} T=${T}`);
  near(leg.t * 4, T, 1e-9, `twins accelTrip Earth time g=${g} T=${T}`);
  near(leg.beta, tw.maxBeta, 1e-9, `twins accelTrip peak beta g=${g} T=${T}`);
  near(leg.gamma, tw.gamma, 1e-9, `twins accelTrip gamma g=${g} T=${T}`);
}

// ---- extremes: no NaN / Infinity ----
for (const g of [1e-6, 1e-3, 1e3, 1e6]) for (const d of [4.2465, 5.963]) for (const fn of [flipAndBurn, flyby]) {
  const r = fn({ accelG: g, d });
  for (const k of ['t', 'tau', 'peakBeta', 'peakGamma']) ok(Number.isFinite(r[k]) && r[k] > 0, `finite ${k} ${r.kind} g=${g}`);
  ok(r.peakBeta < 1, 'beta<1 at extreme'); ok(r.tau <= r.t, 'tau<=t at extreme'); ok(r.t > d, 't > d at extreme');
}
{ // huge a: light-speed limit; t -> d, tau tiny (~ (1/a) ln(2 a x) )
  const r = flyby({ accelG: 1e3, d: 4.2465 });
  near(r.t, 4.2465, 1e-3, 'huge a: t -> d/c'); ok(r.tau < 0.01 * r.t, 'huge a: tau << t');
  const a = 1e3 * G_LY_YR2, u = a * 4.2465;
  near(r.tau, Math.log(2 * u) / a, 1e-3, 'huge a: tau ~ ln(2u)/a');
}
{ // sample curve
  const tr = flipAndBurn({ accelG: 1, d: 4.2465 }), s = sampleBeta(tr, 100);
  ok(s.length === 101 && s[0].t === 0, 'sample length and start');
  near(s[100].t, tr.t, 1e-12, 'sample last t');
  ok(s.every((p) => p.beta >= 0 && p.beta < 1 && Number.isFinite(p.t)), 'sample betas valid');
  near(Math.max(...s.map((p) => p.beta)), tr.peakBeta, 1e-9, 'sampled max = peak');
}

// ---- input validation ----
for (const bad of [0, -1, NaN, Infinity, -Infinity, '1', null, undefined]) {
  throwsRange(() => flipAndBurn({ accelG: bad, d: 4 }), `flip accelG=${bad}`);
  throwsRange(() => flipAndBurn({ accelG: 1, d: bad }), `flip d=${bad}`);
  throwsRange(() => flyby({ accelG: bad, d: 4 }), `flyby accelG=${bad}`);
  throwsRange(() => flyby({ accelG: 1, d: bad }), `flyby d=${bad}`);
  throwsRange(() => accelSegment({ accelG: 1, x: bad }), `segment x=${bad}`);
  throwsRange(() => tripState({ accelG: bad, d: 1 }), `tripState g=${bad}`);
}
throwsRange(() => flyby(), 'no args'); throwsRange(() => accelSegment(), 'no args segment');
throwsRange(() => betaAt(flyby({ accelG: 1, d: 4 }), NaN), 'betaAt NaN');
throwsRange(() => flyby({ accelG: 1e300, d: 1e300 }), 'overflow reported, not Infinity');

// ---- slider ----
near(accelFromSlider(0), 0.01, 1e-12, 'slider 0 -> 0.01 g'); near(accelFromSlider(1000), 10, 1e-12, 'slider 1000 -> 10 g');
near(accelFromSlider(500), 0.316227766, 1e-8, 'slider mid = geometric mean'); near(accelFromSlider(2000 / 3), 1, 1e-9, 'slider 666.67 -> 1 g');
near(accelFromSlider(-5), 0.01, 1e-12, 'clamped low'); near(accelFromSlider(1e9), 10, 1e-12, 'clamped high');
for (const g of [0.01, 0.1, 1, 10]) near(accelFromSlider(sliderFromAccel(g)), g, 1e-9, 'slider roundtrip');
near(sliderFromAccel(1), 2000 / 3, 1e-9, '1 g at 2/3 of slider');
throwsRange(() => accelFromSlider(NaN), 'slider NaN'); throwsRange(() => sliderFromAccel(0), 'slider g=0');

console.log(`accel.contract: PASS (${checks} checks)`);
