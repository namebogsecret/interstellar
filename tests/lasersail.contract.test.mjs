// "Laser sail" page — CONTRACT tests against INDEPENDENT references (stated in js/physics/lasersail.js docstrings):
//   * hyperbolic motion under constant force (no Doppler): w = F t/(m c), gamma = 1 + F x/(m c^2), tau = (mc/F) acosh(gamma);
//   * energy/work with Doppler: d(gamma)/dx = F(beta)/(m c^2), integrated in x (a different independent variable than the module's time-RK4)
//     and the beam time via the substitution x = u^2 (removes the 1/sqrt(x) singularity at rest);
//   * Newtonian limit v^2 = 2 F L / m; scaling laws t ~ sqrt(m), L ~ sqrt(A).
// Modules: js/physics/lasersail.js, js/physics/constants.js, js/data/stars.js, js/verify/lasersail-view.js.
import assert from 'node:assert/strict';
import { C, G0, LY } from '../js/physics/constants.js';
import { STARS } from '../js/data/stars.js';
import * as LS from '../js/physics/lasersail.js';
import {
  launch, sailForce, beamLength, sailMass, newtonianFlight, dopplerFactor, betaOfW,
  D_PROXIMA, PROXIMA, HEAT_LIMIT, WAVELENGTH, TX_APERTURE, AREAL_DENSITY, BETA_MAX,
} from '../js/physics/lasersail.js';
import {
  sliderToMass, massToSlider, sliderToPower, powerToSlider, sliderToArea, areaToSlider, PRESETS,
  fmtIntensity, fmtMassKg, fmtPower, fmtBetaC, fmtPct, fmtFlight, fmtLen, fmtG, fmtDur, logFrac, curvePoints,
} from '../js/verify/lasersail-view.js';

let checks = 0;
const rel = (a, b) => Math.abs(a - b) / (Math.abs(b) || 1);
const near = (a, b, tol, msg) => { checks++; assert.ok(rel(a, b) <= tol, `${msg}: ${a} vs ${b} (rel ${rel(a, b)})`); };
const ok = (c, msg) => { checks++; assert.ok(c, msg); };

// independent model constants (written out here, not imported)
const LAMBDA = 1064e-9, DTX = 1000, SIGMA = 1e-3;
const Lref = (A) => DTX * Math.sqrt(4 * A / Math.PI) / (2.44 * LAMBDA);

// ---------- constants are imported, not copied ----------
ok(PROXIMA === STARS.find((s) => s.name === 'Proxima Centauri'), 'Proxima is the stars.js record');
near(PROXIMA.ly, 4.2465, 1e-12, 'Proxima 4.2465 ly');
near(D_PROXIMA, PROXIMA.ly * LY, 1e-15, 'D = ly * LY from constants');
ok(LS.C === C && LS.G0 === G0 && LS.LY === LY, 'constants re-exported unchanged');
ok(WAVELENGTH === LAMBDA && TX_APERTURE === DTX && AREAL_DENSITY === SIGMA && HEAT_LIMIT === 1e9, 'model constants as specified');
near(launch({ payload: 1, power: 1e6, area: 1 }).distance, D_PROXIMA, 1e-15, 'default distance is Proxima');

// ---------- force, mass, beam range ----------
near(sailForce(1e9, 0), 2e9 / C, 1e-15, 'F(0) = 2P/c');
near(sailForce(1e9, 0.5), 2e9 / C / 3, 1e-14, 'F(0.5) = 2P/c * (0.5/1.5)');
ok(sailForce(1e9, 0.999) < sailForce(1e9, 0.5) && sailForce(1e9, 0.5) < sailForce(1e9, 0), 'F falls with beta');
near(sailForce(1e9, 0.3, 0.5), 0.5 * sailForce(1e9, 0.3), 1e-15, 'eta scales F');
near(sailForce(1e9, 0.3, 1, false), 2e9 / C, 1e-15, 'doppler:false = constant force');
checks++; assert.throws(() => sailForce(1e9, 1), RangeError);
checks++; assert.throws(() => sailForce(1e9, -0.1), RangeError);
checks++; assert.throws(() => sailForce(-1, 0.1), RangeError);
near(sailMass(0.001, 10), 0.001 + SIGMA * 10, 1e-15, 'm = payload + sigma A');
for (const A of [0.1, 1, 10, 1e3, 1e6]) near(beamLength(A), Lref(A), 1e-12, 'L = Dtx Dsail/(2.44 lambda) A=' + A);
near(beamLength(4) / beamLength(1), 2, 1e-12, 'L ~ sqrt(A)');
near(dopplerFactor(0), 1, 1e-15, 'doppler(w=0) = 1');
for (const b of [0.1, 0.5, 0.9, 0.999]) { const w = b / Math.sqrt(1 - b * b); near(dopplerFactor(w), (1 - b) / (1 + b), 1e-12, 'doppler factor at beta ' + b); }

// ---------- independent integrators ----------
// gamma(x) from d(gamma)/dx = f0 * (1-b)/(1+b), b = sqrt(1-1/gamma^2), RK4 in x; also in u (x=u^2) with time and proper time.
function independent(P, m, Lend, doppler = true, n = 40000) {
  const F0mc2 = 2 * P / C / (m * C * C);
  const bet = (g1) => Math.sqrt(g1 * (2 + g1)) / (1 + g1);
  const dd = (g1) => { const b = bet(g1); return F0mc2 * (doppler ? (1 - b) / (1 + b) : 1); };
  const U = Math.sqrt(Lend), h = U / n;
  let g1 = 0, t = 0, tau = 0;
  const rhs = (u, g) => {            // [d g1/du, dt/du, dtau/du]
    const b = bet(g);
    const dt = u === 0 || b === 0 ? 2 / (C * Math.sqrt(2 * F0mc2)) : 2 * u / (C * b);
    return [2 * u * dd(g), dt, dt / (1 + g)];
  };
  // start at u = 0 exactly: dt/du has the finite limit 2/(c sqrt(2 F0mc2)) there (0/0 handled in rhs)
  let u = 0;
  for (let i = 0; i < n; i++) {
    const k1 = rhs(u, g1), k2 = rhs(u + h / 2, g1 + h / 2 * k1[0]), k3 = rhs(u + h / 2, g1 + h / 2 * k2[0]), k4 = rhs(u + h, g1 + h * k3[0]);
    g1 += h / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    t += h / 6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    tau += h / 6 * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);
    u += h;
  }
  return { gamma: 1 + g1, beta: bet(g1), t, tau };
}

// ---------- 1. Newtonian limit (beta << 1) ----------
{
  const r = launch({ payload: 1, power: 1e6, area: 1 });
  const m = 1 + SIGMA, F = 2e6 / C, L = Lref(1);
  const vN = Math.sqrt(2 * F * L / m), tN = Math.sqrt(2 * L / (F / m));
  ok(r.betaMax < 1e-4, 'nonrelativistic regime');
  near(r.betaMax * C, vN, 1e-4, 'v = sqrt(2FL/m) at beta << 1');
  near(r.tBeam, tN, 1e-4, 't_beam = sqrt(2L/a) at beta << 1');
  near(r.tFlight, tN + (D_PROXIMA - L) / vN, 1e-4, 't_flight = t_beam + coast');
  near(r.newtonian.tFlight, tN + (D_PROXIMA - L) / vN, 1e-12, 'Newtonian reference formula');
  ok(Math.abs(r.timeDiffPct) < 0.01, 'time difference ~ 0 at beta << 1: ' + r.timeDiffPct);
  near(r.gammaMax, 1, 1e-8, 'gamma = 1');
  near(r.tau / r.tFlight, 1, 1e-8, 'tau = t at beta << 1');
  ok(!r.relativistic && !r.flags.includes('relativistic'), 'no relativistic flag at low beta');
  near(r.gPeak * G0, F / m, 1e-12, 'a_proper(0) = F/m');
}

// ---------- 2. analytic: constant force, no Doppler = hyperbolic motion ----------
{
  const P = 1e12, m = 1, D = 1e15, F = 2 * P / C;
  const r = launch({ payload: m, power: P, area: 0 }, { doppler: false, beamLength: 10 * D, distance: D });
  const gam = 1 + F * D / (m * C * C), w = Math.sqrt(gam * gam - 1);
  near(r.gammaMax, gam, 1e-7, 'gamma = 1 + F x/(m c^2) (work-energy)');
  near(r.betaMax, w / gam, 1e-9, 'beta from hyperbolic motion');
  near(r.tFlight, m * C / F * w, 1e-7, 't = (mc/F) w');
  near(r.tau, m * C / F * Math.acosh(gam), 1e-7, 'tau = (mc/F) acosh(gamma)');
  ok(r.beamNeverStops && r.flags.includes('beamNeverStops'), 'beam never stops flagged');
  near(r.tBeam, r.tFlight, 1e-12, 'accelerating all the way');
  // E = (gamma-1) m c^2 equals the work F*D
  near((r.gammaMax - 1) * m * C * C, F * D, 1e-7, 'E = F * D');
  // felt acceleration is constant F/m in this case (both expressions)
  for (const p of r.profile.slice(1)) near(p.g * G0, F / m, 1e-12, 'a_proper constant');
}

// ---------- 3. with Doppler: work-energy + beam time vs independent x-integral ----------
for (const [payload, P, A] of [[1e-3, 1e13, 1], [1e-3, 1e11, 10], [1, 1e12, 100], [1e-3, 1e13, 0.1]]) {
  const m = payload + SIGMA * A, L = Lref(A);
  const r = launch({ payload, power: P, area: A });
  const ref = independent(P, m, L);
  const tag = `(${payload} kg, ${P} W, ${A} m2)`;
  near(r.beamLength, L, 1e-12, 'L ' + tag);
  near(r.gammaMax, ref.gamma, 1e-6, 'gamma_max = work integral ' + tag);
  near(r.tBeam, ref.t, 1e-5, 't_beam vs substitution integral ' + tag);
  near(r.tau - (D_PROXIMA - L) / (C * r.betaMax) / r.gammaMax, ref.tau, 1e-5, 'tau_beam ' + tag);
  near(r.betaMax, ref.beta, 1e-6, 'beta_max ' + tag);
  const coast = (D_PROXIMA - L) / (C * ref.beta);
  near(r.tFlight, ref.t + coast, 1e-5, 't_flight = t_beam + coast ' + tag);
  near(r.tau, ref.tau + coast / ref.gamma, 1e-5, 'tau_flight ' + tag);
  ok(r.tau < r.tFlight, 'craft clock slower than Earth clock ' + tag);
  near(r.dilation, r.tau / r.tFlight, 1e-12, 'dilation = tau/t');
}

// ---------- 4. beam never switches off (L >= distance) with Doppler ----------
{
  const payload = 1e-3, P = 1e13, A = 1;
  const r = launch({ payload, power: P, area: A }, { aperture: 1e12 });
  const m = payload + SIGMA * A;
  ok(r.beamLength > D_PROXIMA && r.beamNeverStops, 'L beyond the star');
  const ref = independent(P, m, D_PROXIMA);
  near(r.tFlight, ref.t, 1e-5, 't to the star while still under the beam');
  near(r.tau, ref.tau, 1e-5, 'tau while still under the beam');
  near(r.gammaMax, ref.gamma, 1e-6, 'gamma at arrival');
  near(r.tBeam, r.tFlight, 1e-12, 'no coast phase');
  near(r.xBeam, D_PROXIMA, 1e-12, 'beam runs the whole way');
  ok(r.betaMax < 1 && r.betaMax > 0.9, 'beta high but < 1: ' + r.betaMax);
}

// ---------- 5. proper acceleration: both expressions agree ----------
for (const [payload, P, A] of [[1e-3, 1e13, 1], [1e-3, 1e11, 10]]) {
  const r = launch({ payload, power: P, area: A });
  const pr = r.profile;
  let n = 0;
  for (let i = 1; i + 1 < pr.length; i++) {
    if (pr[i + 1].t > r.tBeam * 1.0000001 || pr[i - 1].t <= 0) continue;
    const a = pr[i - 1], b = pr[i + 1];
    const wMid = pr[i].w, gam = Math.sqrt(1 + wMid * wMid);
    const d = (k) => { const h1 = pr[i].t - a.t, h2 = b.t - pr[i].t;     // 3-point derivative on a non-uniform grid (exact for parabolas)
      return -h2 / (h1 * (h1 + h2)) * a[k] + (h2 - h1) / (h1 * h2) * pr[i][k] + h1 / (h2 * (h1 + h2)) * b[k]; };
    const viaW = C * d('w') / G0;                       // c dw/dt
    const viaBeta = gam ** 3 * C * d('beta') / G0;      // gamma^3 c dbeta/dt
    near(viaW, pr[i].g, 2e-3, 'c dw/dt = F(beta)/m in g');
    near(viaBeta, pr[i].g, 2e-3, 'gamma^3 c dbeta/dt = F(beta)/m in g');
    n++;
  }
  ok(n > 20, 'enough samples: ' + n);
  near(pr[0].g, r.gPeak, 1e-12, 'gPeak = sample at t = 0'); ok(pr[1].g <= pr[0].g, 'g decays after t = 0');
  near(r.gPeak * G0, 2 * P / C / (payload + SIGMA * A), 1e-12, 'gPeak = 2P/(c m)');
  near(r.gEnd, 2 * P / C * dopplerFactor(r.wMax) / r.mass / G0, 1e-12, 'g at beam end uses Doppler factor');
}

// ---------- 6. monotonicity / bounds ----------
for (const [payload, P, A] of [[1e-3, 1e13, 0.1], [1e-3, 1e11, 10], [1e3, 1e13, 1e6], [1, 1e6, 1]]) {
  const r = launch({ payload, power: P, area: A });
  const pr = r.profile;
  for (let i = 1; i < pr.length; i++) {
    ok(pr[i].t >= pr[i - 1].t && pr[i].beta >= pr[i - 1].beta && pr[i].x >= pr[i - 1].x && pr[i].tau >= pr[i - 1].tau, 'profile monotone i=' + i);
    ok(pr[i].tau <= pr[i].t, 'tau <= t i=' + i);
    ok(pr[i].beta < 1 && pr[i].beta >= 0, 'beta in [0,1)');
  }
  const gs = pr.filter((p) => p.t <= r.tBeam * 1.0000001 && p.g > 0).map((p) => p.g);
  for (let i = 1; i < gs.length; i++) ok(gs[i] <= gs[i - 1] * (1 + 1e-12), 'felt acceleration never grows under the Doppler loss');
  ok(r.profile[r.profile.length - 1].x <= D_PROXIMA * (1 + 1e-12) && Math.abs(r.profile[r.profile.length - 1].x - D_PROXIMA) < 1e-6 * D_PROXIMA, 'profile ends at the star');
  ok(r.gammaMax >= 1 && r.betaMax < 1, 'gamma >= 1, beta < 1');
}

// ---------- 7. scaling (nonrelativistic) ----------
{
  const a = launch({ payload: 1, power: 1e6, area: 0.1 }), b = launch({ payload: 4, power: 1e6, area: 0.1 });
  near(b.tBeam / a.tBeam, Math.sqrt(b.mass / a.mass), 1e-4, 't_beam ~ sqrt(m)');
  near(a.betaMax / b.betaMax, Math.sqrt(b.mass / a.mass), 1e-4, 'v ~ 1/sqrt(m)');
  const p4 = launch({ payload: 1, power: 4e6, area: 0.1 });
  near(a.tBeam / p4.tBeam, 2, 1e-4, 't_beam ~ 1/sqrt(P)');
  near(p4.betaMax / a.betaMax, 2, 1e-4, 'v ~ sqrt(P)');
  const s4 = launch({ payload: 1e3, power: 1e6, area: 4 }), s1 = launch({ payload: 1e3, power: 1e6, area: 1 });
  near(s4.beamLength / s1.beamLength, 2, 1e-12, 'beam range ~ sqrt(A)');
  near(s4.betaMax / s1.betaMax, Math.sqrt(2 * s1.mass / s4.mass), 1e-4, 'v^2 = 2 F L/m with L ~ sqrt(A)');
}

// ---------- 8. Doppler / relativity really matter (mutation sanity) ----------
{
  const inp = { payload: 1e-3, power: 1e13, area: 1 };
  const withD = launch(inp), noD = launch(inp, { doppler: false });
  ok(noD.betaMax > withD.betaMax * 1.02, `Doppler loss lowers the final beta: ${withD.betaMax} < ${noD.betaMax}`);
  ok(noD.gammaMax > withD.gammaMax, 'Doppler loss lowers gamma');
  // low beta: Doppler is a tiny effect
  const lo = { payload: 1, power: 1e6, area: 1 };
  near(launch(lo).betaMax, launch(lo, { doppler: false }).betaMax, 1e-4, 'Doppler negligible at low beta');
  // Newtonian overestimates speed when relativistic, and is slower-flight => relativistic flight is longer
  ok(withD.newtonian.betaBeam > withD.betaMax, 'Newtonian speed too high in the relativistic regime');
  ok(withD.timeDiffPct > 5, 'relativistic flight noticeably longer: ' + withD.timeDiffPct);
  ok(withD.relativistic && withD.flags.includes('relativistic'), 'relativistic flag when beta > 0.1');
  ok(withD.tau < withD.tFlight * 0.99, 'time dilation visible');
  // a no-gamma Newtonian-only integrator would give v = sqrt(2 F L / m): check it is NOT what the module returns here
  const vN = Math.sqrt(2 * (2e13 / C) * Lref(1) / (1e-3 + SIGMA));
  ok(Math.abs(withD.betaMax * C - vN) / vN > 0.1, 'module is not the Newtonian formula');
  // heavier-than-possible Newtonian speed gets flagged
  const ex = launch({ payload: 1e-3, power: 1e13, area: 1 }, { aperture: 1e12 });
  ok(ex.newtonian.exceedsC && ex.flags.includes('newtonExceedsC'), 'Newtonian speed > c flagged');
  ok(ex.betaMax < 1, 'relativistic beta still < 1');
}

// ---------- 9. heat flag (warning only) ----------
{
  const hot = launch({ payload: 1e-3, power: 1e12, area: 1 });   // 1e12 W/m2
  ok(hot.overheat && hot.flags.includes('overheat') && hot.flights, 'overheat flagged, flight still computed');
  near(hot.intensity, 1e12, 1e-12, 'intensity = P/A');
  const cool = launch({ payload: 1e-3, power: 1e8, area: 1 });
  ok(!cool.overheat && !cool.flags.includes('overheat'), 'no overheat below 1 GW/m2');
  ok(launch({ payload: 1, power: 5e9, area: 1 }, { heatLimit: 1e10 }).overheat === false, 'custom heat limit respected');
  near(launch({ payload: 1, power: 2e9, area: 1 }).intensity, 2e9, 1e-12, 'intensity 2e9');
  ok(launch({ payload: 1, power: 2e9, area: 1 }).overheat, '2 GW/m2 > 1 GW/m2');
}

// ---------- 10. edge cases ----------
const finiteOrInf = (v) => typeof v !== 'number' || !Number.isNaN(v);
for (const inp of [{ payload: 1, power: 0, area: 10 }, { payload: 1, power: 1e9, area: 0 }, { payload: 1, power: 0, area: 0 }]) {
  const r = launch(inp);
  ok(!r.flights && r.tFlight === Infinity && r.tau === Infinity, 'no thrust -> never arrives: ' + JSON.stringify(inp));
  ok(r.flags.includes('noFlight') && r.betaMax === 0 && r.gammaMax === 1, 'noFlight result is the rest state');
  for (const [k, v] of Object.entries(r)) if (typeof v === 'number') ok(!Number.isNaN(v), 'no NaN in ' + k);
  ok(r.profile.every((p) => Object.values(p).every((v) => !Number.isNaN(v))), 'no NaN in the profile');
  ok(r.timeDiffPct === null, 'no percentage when time is infinite');
}
for (const bad of [{ payload: 0, power: 1, area: 1 }, { payload: -1, power: 1, area: 1 }, { payload: NaN, power: 1, area: 1 },
  { payload: 1, power: -1, area: 1 }, { payload: 1, power: 1, area: -1 }, { payload: 1, power: Infinity, area: 1 }, { payload: 1, power: 1, area: NaN }]) {
  checks++; assert.throws(() => launch(bad), RangeError, JSON.stringify(bad));
}
// extreme magnitudes: no NaN / overflow, beta strictly < 1
for (const inp of [{ payload: 1e-3, power: 1e30, area: 0.1 }, { payload: 1e12, power: 1e-3, area: 1e12 }, { payload: 1e-30, power: 1e20, area: 1e-9 }, { payload: 1e3, power: 1e6, area: 1e6 }]) {
  const r = launch(inp);
  const tag = JSON.stringify(inp);
  ok(r.betaMax < 1 && r.betaMax >= 0, 'beta < 1 at extremes ' + tag);
  ok(r.gammaMax >= 1 && Number.isFinite(r.gammaMax), 'gamma finite ' + tag);
  for (const [k, v] of Object.entries(r)) if (typeof v === 'number') ok(!Number.isNaN(v), `no NaN in ${k} ${tag}`);
  ok(r.profile.every((p) => p.beta < 1 && Object.values(p).every((v) => !Number.isNaN(v))), 'profile clean ' + tag);
  ok(r.flights ? (r.tFlight > 0 && r.tau > 0 && r.tau <= r.tFlight * (1 + 1e-12)) : r.tFlight === Infinity, 'times consistent ' + tag);
}
ok(betaOfW(1e300) < 1 && betaOfW(1e300) === BETA_MAX, 'beta guard');
ok(betaOfW(0) === 0, 'beta(0) = 0');
// determinism
{ const a = launch({ payload: 1e-3, power: 1e11, area: 10 }), b = launch({ payload: 1e-3, power: 1e11, area: 10 });
  assert.deepEqual(a, b); checks++; }
// newtonianFlight direct
{ const n = newtonianFlight(2, 4, 100, 1000);
  near(n.aBeam, 2, 1e-15, 'a = F/m'); near(n.tBeam, Math.sqrt(100), 1e-12, 't = sqrt(2L/a)');
  near(n.vBeam, 2 * 10, 1e-12, 'v = a t'); near(n.tFlight, 10 + 900 / 20, 1e-12, 'Newtonian coast');
  ok(newtonianFlight(1, 0, 100, 1000).tFlight === Infinity, 'F = 0 -> never'); }

// ---------- 11. presets and presenter ----------
for (const p of PRESETS) {
  const r = launch({ payload: p.mass, power: p.power, area: p.area });
  ok(r.flights && Number.isFinite(r.tFlight) && Number.isFinite(r.tau), 'preset flies: ' + p.id);
}
{ const s = PRESETS.find((p) => p.id === 'starshot');
  ok(s.mass === 1e-3 && s.area === 10 && s.power === 1e11, 'Starshot preset = 1 g, 10 m2, 100 GW'); }
for (const [fs, ft, lo, hi] of [[sliderToMass, massToSlider, 1e-3, 1e3], [sliderToPower, powerToSlider, 1e6, 1e13], [sliderToArea, areaToSlider, 0.1, 1e6]]) {
  near(fs(0), lo, 1e-12, 'slider min'); near(fs(1000), hi, 1e-12, 'slider max');
  for (const v of [0, 137, 500, 999, 1000]) near(ft(fs(v)), v, 1e-9, 'slider round trip');
}
ok(fmtFlight(Infinity, 'en', 'will not arrive') === 'will not arrive', 'infinite time -> text');
ok(fmtFlight(Infinity, 'ru', 'не долетит') === 'не долетит', 'infinite time RU -> text');
ok(fmtPct(null) === '—' && fmtPct(NaN) === '—', 'fmtPct guards');
ok(fmtPct(2.5) === '+2.50%' && fmtPct(2.5, 'ru') === '+2,50%', 'fmtPct RU comma');
ok(fmtBetaC(0.0419, 'ru') === '0,042 c' && fmtBetaC(0, 'en') === '0 c' && fmtBetaC(1e-7, 'en') === '<0.0001 c', 'fmtBetaC');
ok(fmtPower(1e11, 'en').endsWith('GW') && fmtPower(1e11, 'ru').endsWith('ГВт') && fmtPower(1e13, 'en').endsWith('TW'), 'fmtPower units');
ok(fmtMassKg(1e-3, 'en').endsWith('g') && !fmtMassKg(1e-3, 'en').endsWith('kg') && fmtMassKg(5, 'ru').endsWith('кг'), 'fmtMassKg units');
for (const bad of [NaN, Infinity, -Infinity]) {
  const outs = [fmtMassKg(bad), fmtPower(bad), fmtLen(bad), fmtDur(bad), fmtBetaC(bad), fmtPct(bad)];
  ok(outs.every((s) => !/NaN|Infinity/.test(s)), 'presenter never prints NaN/Infinity: ' + outs.join('|'));
}
ok(fmtIntensity(1e10, 'en') === '10.0 GW/m²' && fmtIntensity(1e9, 'ru') === '1,00 ГВт/м²' && fmtIntensity(Infinity) === '—', 'fmtIntensity');
near(logFrac(10, 1, 100), 0.5, 1e-12, 'logFrac midpoint'); ok(logFrac(-1, 1, 100) === 0 && logFrac(1e9, 1, 100) === 1, 'logFrac clamps');
{ const r = launch({ payload: 1e-3, power: 1e11, area: 10 });
  const pts = curvePoints(r.profile, 'beta', r.profile[1].t, r.tFlight, r.betaMax * 1.1);
  ok(pts.length > 0 && !/NaN|Infinity/.test(pts), 'curve points clean'); }

ok(fmtMassKg(2.5, 'ru') === '2,50 кг' && fmtMassKg(2.5, 'en') === '2.50 kg', 'fmtMassKg decimal comma ru / point en');
ok(fmtPower(2.5e9, 'ru') === '2,50 ГВт' && fmtPower(2.5e9, 'en') === '2.50 GW', 'fmtPower decimal comma');
ok(fmtLen(2.5e9, 'ru') === '2,50 млн км' && fmtLen(2.5e9, 'en') === '2.50 million km', 'fmtLen decimal comma');
ok(fmtDur(90, 'ru') === '1,50 мин' && fmtDur(90, 'en') === '1.50 min' && fmtDur(5.5, 'ru') === '5,50 с', 'fmtDur decimal comma');
ok(!/\d\.\d/.test(fmtFlight(3.15576e7 * 4.2, 'ru', 'x')) && /\d,\d/.test(fmtG(0.123, 'ru')) && /\d\.\d/.test(fmtG(0.123, 'en')), 'time / g decimal comma');
console.log(`lasersail.contract: ${checks} checks OK`);
