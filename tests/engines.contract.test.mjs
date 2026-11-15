// "Engine comparison" page — CONTRACT tests, written from CONTRACT.md without reading the implementation.
// Modules: js/physics/engines.js, js/data/engines.js, js/verify/engines-view.js.
// Every physics check is against an INDEPENDENT reference: textbook vis-viva values, RK4 integration of the
// rocket ODE, Simpson integration of dr/v with the r = r0 + u^2 substitution, and identities between outputs.
import assert from 'node:assert/strict';
import { C, G0, AU, YEAR, DAY, LY } from '../js/physics/constants.js';
import {
  MU_SUN, SOLAR_CONST, hohmann, stageMasses, dvBudget, burnTimeAndDistance,
  propulsiveTrip, sailTrip, compareEngines,
} from '../js/physics/engines.js';
import { ENGINES, ROUTES } from '../js/data/engines.js';
import { sliderToPayload, payloadToSlider, barFraction } from '../js/verify/engines-view.js';

let checks = 0;
const rel = (a, b) => Math.abs(a - b) / (Math.abs(b) || 1);
const near = (a, b, tol, msg) => { checks++; assert.ok(rel(a, b) <= tol, `${msg}: ${a} vs ${b} (rel ${rel(a, b)})`); };
const ok = (c, msg) => { checks++; assert.ok(c, msg); };

const asList = (x) => (Array.isArray(x) ? x : Object.values(x));
const ENG = asList(ENGINES);
const RTS = asList(ROUTES);
const engById = (id) => ENG.find((e) => e.id === id);
const routeById = (id) => RTS.find((r) => r.id === id);
const REACTIVE = ['chemical', 'ion', 'ntr', 'fusion'];
const ORDER = ['chemical', 'ion', 'ntr', 'fusion', 'sail'];
const PAYLOADS = [100, 300, 1e3, 3e3, 1e4, 1e5, 1e6];
const ROUTE_IDS = ['mars', 'jupiter', 'pluto', 'sgl', 'alphacen'];

// Clone an engine overriding thrust under every plausible field name (the contract fixes only
// isp/engineMass/tankMass/propMass names), plus any key still holding the original thrust value.
function withEngine(base, { thrust, propMass, isp }) {
  const e = { ...base };
  for (const k of ['F', 'thrust', 'thrustN', 'force']) e[k] = thrust ?? e[k];
  if (thrust !== undefined) for (const [k, v] of Object.entries(base)) if (v === 110000 || v === 7.54e6 || v === 0.236) e[k] = thrust;
  if (propMass !== undefined) e.propMass = propMass;
  if (isp !== undefined) e.isp = isp;
  return e;
}
const thrustOf = (e) => e.F ?? e.thrust ?? e.thrustN ?? e.force;

// ---------- independent numerics ----------
function simpson(f, lo, hi, n) {
  const h = (hi - lo) / n; let s = f(lo) + f(hi);
  for (let i = 1; i < n; i++) s += f(lo + i * h) * (i % 2 ? 4 : 2);
  return s * h / 3;
}
// RK4 on (v, x) with m(t) = m0 - mdot t, v' = F/m, x' = v, from rest to time T.
function rk4Burn(m0, F, ve, T, n = 4000) {
  const mdot = F / ve; const h = T / n; let v = 0, x = 0, t = 0;
  const a = (tt) => F / (m0 - mdot * tt);
  for (let i = 0; i < n; i++) {
    const k1v = a(t), k1x = v;
    const k2v = a(t + h / 2), k2x = v + h / 2 * k1v;
    const k3v = a(t + h / 2), k3x = v + h / 2 * k2v;
    const k4v = a(t + h), k4x = v + h * k3v;
    v += h / 6 * (k1v + 2 * k2v + 2 * k3v + k4v);
    x += h / 6 * (k1x + 2 * k2x + 2 * k3x + k4x);
    t += h;
  }
  return { v, x };
}

// =====================================================================================
// (0) constants
// =====================================================================================
near(AU, 1.495978707e11, 1e-15, 'AU is the IAU value (re-exported or equal)');
near(MU_SUN, 1.32712440018e20, 1e-15, 'MU_SUN');
near(SOLAR_CONST, 1361, 1e-15, 'SOLAR_CONST');

// =====================================================================================
// (1) hohmann
// =====================================================================================
{
  const mars = hohmann(1 * AU, 1.524 * AU);
  near(mars.dv / 1000, 5.59, 0.01, 'Earth->Mars total dv ~5.59 km/s');
  near(mars.t / DAY, 259, 0.01, 'Earth->Mars transfer ~259 d');
  const jup = hohmann(1 * AU, 5.203 * AU);
  near(jup.dv / 1000, 14.4, 0.01, 'Earth->Jupiter total dv ~14.4 km/s');
  near(jup.t / YEAR, 2.73, 0.01, 'Earth->Jupiter ~2.73 y');
  ok(mars.dv1 > 0 && mars.dv2 > 0, 'outward transfer: both burns prograde');

  // independent vis-viva derivation on a grid of radii (both directions)
  for (const r1 of [0.3, 1, 1.524, 5.2]) for (const r2 of [0.5, 1.2, 3, 10, 39.48, 550]) {
    const a1 = r1 * AU, a2 = r2 * AU;
    const at = (a1 + a2) / 2;
    const vc1 = Math.sqrt(MU_SUN / a1), vc2 = Math.sqrt(MU_SUN / a2);
    const vp = Math.sqrt(MU_SUN * (2 / a1 - 1 / at)), va = Math.sqrt(MU_SUN * (2 / a2 - 1 / at));
    const h = hohmann(a1, a2);
    near(h.dv, Math.abs(vp - vc1) + Math.abs(vc2 - va), 1e-9, `hohmann dv vis-viva r1=${r1} r2=${r2}`);
    near(h.t, Math.PI * Math.sqrt(at ** 3 / MU_SUN), 1e-12, `hohmann t Kepler r1=${r1} r2=${r2}`);
    near(h.dv, Math.abs(h.dv1) + Math.abs(h.dv2), 1e-12, 'dv = |dv1|+|dv2|');
    // symmetric in swapping endpoints
    const hr = hohmann(a2, a1);
    near(hr.dv, h.dv, 1e-9, 'dv symmetric under swap');
    near(hr.t, h.t, 1e-12, 't symmetric under swap');
    if (r2 > r1) ok(h.dv1 > 0 && h.dv2 > 0, 'outward: dv1,dv2 > 0'); else ok(h.dv1 < 0 && h.dv2 < 0, 'inward: dv1,dv2 < 0');
  }
  const same = hohmann(AU, AU);
  ok(Math.abs(same.dv) < 1e-9, 'r1 == r2 -> zero dv');
  // custom mu is honoured: dv scales as sqrt(mu), t as 1/sqrt(mu)
  const h4 = hohmann(AU, 2 * AU, 4 * MU_SUN), h1 = hohmann(AU, 2 * AU);
  near(h4.dv, 2 * h1.dv, 1e-12, 'mu x4 -> dv x2');
  near(h4.t, h1.t / 2, 1e-12, 'mu x4 -> t /2');
}

// =====================================================================================
// (2) burnTimeAndDistance vs RK4 + small-dv limit
// =====================================================================================
{
  const cases = [];
  for (const m0 of [1e3, 2.4e4, 5e7]) for (const F of [0.236, 1.1e5, 7.5e6]) for (const ve of [4.5e3, 4.1e4, 1.06e7]) for (const x of [0.01, 0.3, 1, 2.5]) cases.push({ m0, F, ve, dv: x * ve });
  for (const { m0, F, ve, dv } of cases) {
    const r = burnTimeAndDistance(m0, F, ve, dv);
    const mdot = F / ve;
    near(r.m1, m0 * Math.exp(-dv / ve), 1e-12, 'm1 = m0 e^(-dv/ve)');
    near(r.t, (m0 - r.m1) / mdot, 1e-12, 't = (m0-m1)/mdot');
    const num = rk4Burn(m0, F, ve, r.t);
    near(num.v, dv, 1e-9, `RK4 velocity at end equals dv (m0=${m0},F=${F},ve=${ve},dv=${dv})`);
    near(r.s, num.x, 1e-8, `distance vs RK4 (m0=${m0},F=${F},ve=${ve},dv=${dv})`);
    ok(r.s > 0 && r.s < dv * r.t, 'distance positive and below v_final * t');
  }
  // dv = 0 -> nothing happens
  const z = burnTimeAndDistance(1000, 100, 3000, 0);
  ok(z.t === 0 && Math.abs(z.s) < 1e-12 && z.m1 === 1000, 'dv=0: t=0, s=0, m1=m0');
  // small-dv (Newtonian, constant mass) limit: t = dv m0 / F, s = a t^2 / 2 with a = F/m0
  for (const [m0, F, ve] of [[1e4, 5e4, 4.5e3], [100, 0.2, 4e4], [5e7, 7e6, 1e7]]) {
    const dv = 1e-3 * ve;
    const r = burnTimeAndDistance(m0, F, ve, dv);
    const t0 = dv * m0 / F;
    near(r.t, t0, 2e-3, 'small-dv t ~ dv m0/F');
    near(r.s, 0.5 * (F / m0) * t0 * t0, 3e-3, 'small-dv s ~ a t^2/2');
  }
  // monotone in dv
  let prev = { t: -1, s: -1 };
  for (const x of [0.01, 0.1, 0.5, 1, 2, 4]) {
    const r = burnTimeAndDistance(2e4, 1e5, 4.5e3, x * 4.5e3);
    ok(r.t > prev.t && r.s > prev.s, 'burn time and distance strictly increase with dv'); prev = r;
  }
}

// =====================================================================================
// (3) data: engines & routes
// =====================================================================================
{
  ok(ENG.length === 5, '5 engines');
  ok(JSON.stringify(ENG.map((e) => e.id)) === JSON.stringify(ORDER), 'engine ids in contract order');
  ok(RTS.length === 5, '5 routes');
  ok(JSON.stringify(RTS.map((r) => r.id).sort()) === JSON.stringify([...ROUTE_IDS].sort()), 'route ids');
  const checkSources = (o, what) => {
    ok(Array.isArray(o.sources) && o.sources.length >= 1, `${what}: >=1 source`);
    for (const s of o.sources) {
      ok(typeof s.title === 'string' && s.title.trim().length > 0, `${what}: non-empty source title`);
      ok(typeof s.url === 'string' && s.url.startsWith('https://'), `${what}: https url ${s.url}`);
      let u = null; try { u = new URL(s.url); } catch { /* */ }
      ok(u && u.hostname.includes('.'), `${what}: parseable url ${s.url}`);
    }
  };
  const checkNames = (o, what) => {
    const n = o.name;
    ok(n && typeof n.ru === 'string' && n.ru.trim() && typeof n.en === 'string' && n.en.trim(), `${what}: name.ru and name.en`);
    ok(/[А-Яа-яЁё]/.test(n.ru), `${what}: RU name is Cyrillic`);
    ok(/[A-Za-z]/.test(n.en), `${what}: EN name is Latin`);
  };
  for (const e of ENG) { checkSources(e, `engine ${e.id}`); checkNames(e, `engine ${e.id}`); }
  for (const r of RTS) { checkSources(r, `route ${r.id}`); checkNames(r, `route ${r.id}`); }
  ok(new Set(ENG.map((e) => e.id)).size === 5 && new Set(RTS.map((r) => r.id)).size === 5, 'unique ids');

  for (const id of REACTIVE) {
    const e = engById(id);
    for (const k of ['isp', 'engineMass', 'tankMass', 'propMass']) ok(Number.isFinite(e[k]) && e[k] > 0, `${id}.${k} positive finite`);
    ok(thrustOf(e) === undefined || thrustOf(e) > 0, `${id} thrust positive`);
  }
  // headline contract numbers (isp)
  near(engById('chemical').isp, 465, 1e-9, 'RL10B-2 isp'); near(engById('ion').isp, 4190, 1e-9, 'NEXT-C isp');
  near(engById('ntr').isp, 841, 1e-9, 'NERVA isp'); near(engById('fusion').isp * G0, 1.06e7, 1e-2, 'Daedalus ve ~10 600 km/s');

  // routes
  for (const r of RTS) {
    near(r.r0, AU, 1e-9, `${r.id}: r0 = 1 AU in metres`);
    ok(r.D > 0 && Number.isFinite(r.D), `${r.id}: D > 0`);
    ok(typeof r.hohmann === 'boolean', `${r.id}: hohmann is boolean`);
    ok(r.hohmann === (r.rTo !== null && r.rTo !== undefined), `${r.id}: hohmann flag <=> rTo present`);
  }
  for (const [id, ratio] of [['mars', 1.524], ['jupiter', 5.203], ['pluto', 39.48]]) {
    const r = routeById(id);
    ok(r.hohmann === true, `${id} has Hohmann reference`);
    near(r.rTo / r.r0, ratio, 1e-9, `${id} rTo/r0`);
    near(r.D, r.rTo - r.r0, 1e-9, `${id} D = rTo - r0`);
  }
  ok(routeById('sgl').hohmann === false && routeById('alphacen').hohmann === false, 'sgl, alphacen: no Hohmann');
  near(routeById('sgl').D / AU, 550, 0.1, 'SGL focus ~550 AU');
  near(routeById('alphacen').D / LY, 4.37, 0.02, 'Alpha Cen ~4.37 ly');
}

// =====================================================================================
// (4) stageMasses, dvBudget
// =====================================================================================
for (const e of ENG) {
  for (const p of PAYLOADS) {
    if (e.id === 'sail') { ok(dvBudget(e, p) === 0, 'sail dvBudget = 0'); continue; }
    const sm = stageMasses(e, p);
    near(sm.mDry, p + e.engineMass + e.tankMass, 1e-12, `${e.id} mDry`);
    near(sm.m0, sm.mDry + e.propMass, 1e-12, `${e.id} m0`);
    near(dvBudget(e, p), e.isp * G0 * Math.log(sm.m0 / sm.mDry), 1e-12, `${e.id} dvBudget Tsiolkovsky`);
    ok(dvBudget(e, p) > 0, `${e.id} budget > 0`);
  }
}
for (const id of REACTIVE) {
  const e = engById(id); let prev = Infinity;
  for (const p of PAYLOADS) { const b = dvBudget(e, p); ok(b < prev, `${id}: budget strictly decreases with payload`); prev = b; }
}
{
  const b = dvBudget(engById('chemical'), 1000) / 1000;
  near(b, 8.37, 0.01, 'chemical stage, 1 t payload: ~8.4 km/s');
}

// =====================================================================================
// (5) propulsiveTrip
// =====================================================================================
const FLAGS = (r) => new Set(r.flags);
// reference phase geometry using the (separately tested) burn formula
function phases(e, p, vc, brake) {
  const ve = e.isp * G0, F = thrustOf(e), { m0 } = stageMasses(e, p);
  const a = burnTimeAndDistance(m0, F, ve, vc);
  if (!brake) return { s: a.s, t: a.t, tAcc: a.t, tDec: 0, sAcc: a.s, sDec: 0 };
  const d = burnTimeAndDistance(a.m1, F, ve, vc);
  const sDec = vc * d.t - d.s;
  return { s: a.s + sDec, t: a.t + d.t, tAcc: a.t, tDec: d.t, sAcc: a.s, sDec };
}
const realThrustKnown = REACTIVE.every((id) => thrustOf(engById(id)) > 0);

for (const id of REACTIVE) for (const rid of ROUTE_IDS) for (const brake of [true, false]) {
  const e = engById(id), D = routeById(rid).D;
  let prevTime = 0, prevV = Infinity;
  for (const p of PAYLOADS) {
    const r = propulsiveTrip(e, p, D, { brake });
    const B = dvBudget(e, p), div = brake ? 2 : 1;
    const tag = `${id}/${rid}/brake=${brake}/p=${p}`;
    ok(Number.isFinite(r.time) && r.time > 0, `${tag}: finite positive time`);
    ok(r.vCruise > 0 && r.vCruise <= B / div * (1 + 1e-12), `${tag}: vCruise within budget`);
    near(r.dvUsed, div * r.vCruise, 1e-12, `${tag}: dvUsed = ${div} v_c`);
    ok(r.dvUsed <= B * (1 + 1e-12), `${tag}: dvUsed <= budget`);
    ok(r.time * r.vCruise >= D * (1 - 1e-9), `${tag}: cannot beat cruise speed over D`);
    ok(r.tBurn >= 0 && r.tBurn <= r.time * (1 + 1e-12), `${tag}: 0 <= tBurn <= time`);
    ok(FLAGS(r).has('flyby') === !brake, `${tag}: flyby flag iff !brake`);
    ok(FLAGS(r).has('relativistic') === (r.vCruise > 0.1 * C), `${tag}: relativistic flag iff v_c > 0.1c`);
    ok(!FLAGS(r).has('noBudget'), `${tag}: no noBudget flag`);
    // monotonicity in payload (heavier payload never faster; slower cruise)
    ok(r.time >= prevTime * (1 - 1e-12), `${tag}: time non-decreasing with payload`);
    ok(r.vCruise <= prevV * (1 + 1e-12), `${tag}: v_c non-increasing with payload`);
    prevTime = r.time; prevV = r.vCruise;

    if (realThrustKnown) {
      // geometric consistency: either all phases fit with coast at full budget, or they are squeezed to exactly D
      const vFull = B / div;
      const ph = phases(e, p, vFull, brake);
      if (ph.s <= D) {
        near(r.vCruise, vFull, 1e-9, `${tag}: coast branch uses full budget`);
        near(r.time, ph.t + (D - ph.s) / vFull, 1e-9, `${tag}: time = burns + coast/v_c`);
      } else {
        const pc = phases(e, p, r.vCruise, brake);
        near(pc.s, D, 1e-9, `${tag}: squeezed branch phase distances sum to D`);
        near(r.time, pc.t, 1e-9, `${tag}: squeezed branch has zero coast`);
        ok(r.vCruise < vFull, `${tag}: squeezed v_c below full`);
      }
    }
  }
}

// flyby beats braking, other things equal
for (const id of REACTIVE) for (const rid of ROUTE_IDS) for (const p of [100, 1e3, 1e5]) {
  const e = engById(id), D = routeById(rid).D;
  const b = propulsiveTrip(e, p, D, { brake: true }), f = propulsiveTrip(e, p, D, { brake: false });
  ok(f.time <= b.time * (1 + 1e-12), `${id}/${rid}/${p}: flyby not slower than braking`);
  ok(f.vCruise >= b.vCruise * (1 - 1e-12), `${id}/${rid}/${p}: flyby cruise >= braking cruise`);
}
{
  // concrete: chemical to Mars has a long coast, so flyby (2x v_c) is strictly faster and dvUsed = v_c = budget
  const e = engById('chemical'), D = routeById('mars').D, B = dvBudget(e, 1000);
  const b = propulsiveTrip(e, 1000, D), f = propulsiveTrip(e, 1000, D, { brake: false });
  const bExplicit = propulsiveTrip(e, 1000, D, { brake: true });
  near(b.time, bExplicit.time, 1e-15, 'brake defaults to true');
  ok(f.time < b.time, 'flyby strictly faster with coast');
  near(f.dvUsed, f.vCruise, 1e-12, 'flyby dvUsed = v_c');
  near(f.vCruise, B, 1e-9, 'flyby uses whole budget when phases fit');
  near(b.vCruise, B / 2, 1e-9, 'braking cruise = budget/2');
  near(b.dvUsed, B, 1e-9, 'braking dvUsed = budget');
}

// synthetic engines: branch coverage independent of the data file
{
  const base = engById('chemical');
  // (a) squeezed: weak thrust, short D, big budget -> burn phases cannot fit
  for (const brake of [true, false]) {
    const e = withEngine(base, { thrust: 2000, propMass: 2e5 });
    const D = 5e6, p = 1000;
    const r = propulsiveTrip(e, p, D, { brake });
    const B = dvBudget(e, p), div = brake ? 2 : 1;
    ok(phases(e, p, B / div, brake).s > D, `squeezed setup really does not fit (brake=${brake})`);
    ok(r.vCruise < B / div, 'squeezed: v_c reduced below full');
    ok(r.dvUsed < B, 'squeezed: dvUsed below budget');
    const pc = phases(e, p, r.vCruise, brake);
    near(pc.s, D, 1e-9, `squeezed: sum of phase distances = D (brake=${brake})`);
    near(r.time, pc.t, 1e-9, 'squeezed: no coast, time = burn time');
    near(r.dvUsed, div * r.vCruise, 1e-12, 'squeezed dvUsed');
  }
  // (b) huge thrust: coast dominates
  for (const brake of [true, false]) {
    const e = withEngine(base, { thrust: 1e12 });
    const D = 1e10, p = 1000, B = dvBudget(e, p), div = brake ? 2 : 1;
    const r = propulsiveTrip(e, p, D, { brake });
    near(r.vCruise, B / div, 1e-12, 'huge thrust: full budget used');
    const ph = phases(e, p, B / div, brake);
    near(r.time, ph.t + (D - ph.s) / (B / div), 1e-9, 'huge thrust: time = burns + coast');
    near(r.time, D / r.vCruise, 1e-3, 'huge thrust: time ~ D / v_c');
  }
  // (c) more propellant (bigger budget) never slower — ONLY in the coast-dominated regime.
  // Contract fix 2026-11-16: at fixed thrust extra propellant is extra mass, so on a short D
  // (burn phases squeezed into D) a heavier tank lowers acceleration and the trip gets SLOWER.
  // That is physics, not a bug — pinned explicitly in (c2) below.
  for (const brake of [true, false]) for (const D of [1e11, 1e13]) {
    let prev = Infinity, prevB = 0;
    for (const pm of [2e3, 5e3, 1e4, 2e4, 4e4, 8e4]) {
      const e = withEngine(base, { propMass: pm });
      const B = dvBudget(e, 1000);
      ok(B > prevB, 'more propellant -> larger budget');
      const r = propulsiveTrip(e, 1000, D, { brake });
      ok(r.time <= prev * (1 + 1e-9), `more budget => time non-increasing (D=${D}, brake=${brake}, prop=${pm})`);
      prev = r.time; prevB = B;
    }
  }
  // (c2) short D: more propellant can be slower (mass penalty at fixed thrust)
  {
    const tLight = propulsiveTrip(withEngine(base, { propMass: 4e4 }), 1000, 1e7, { brake: true }).time;
    const tHeavy = propulsiveTrip(withEngine(base, { propMass: 8e4 }), 1000, 1e7, { brake: true }).time;
    ok(tHeavy > tLight, 'short D: heavier tank at fixed thrust is slower (squeezed regime)');
  }
  // (d) noBudget
  const dead = withEngine(base, { propMass: 0 });
  for (const brake of [true, false]) {
    const r = propulsiveTrip(dead, 1000, routeById('mars').D, { brake });
    ok(r.time === Infinity, 'no propellant -> time Infinity');
    ok(FLAGS(r).has('noBudget'), 'noBudget flag set');
    ok(FLAGS(r).has('flyby') === !brake, 'flyby flag still follows brake');
  }
  // (e) relativistic flag with an exhaust velocity of 0.2 c
  const fast = withEngine(base, { thrust: 1e9, isp: 0.2 * C / G0, propMass: 1e6 });
  const rf = propulsiveTrip(fast, 1000, 1e17, { brake: false });
  ok(rf.vCruise > 0.1 * C && FLAGS(rf).has('relativistic'), 'v_c > 0.1c is flagged relativistic');
  const slow = propulsiveTrip(base, 1000, routeById('mars').D, { brake: true });
  ok(!FLAGS(slow).has('relativistic'), 'chemical is not relativistic');
}

// =====================================================================================
// (6) sailTrip
// =====================================================================================
{
  const sail = engById('sail');
  const r0 = AU;
  const sailMassOf = sail.arealDensity * sail.area;
  const flux = 2 * SOLAR_CONST / C; // N/m^2 at 1 AU for a perfect mirror
  let prevT = 0, prevV = Infinity, prevA = Infinity;
  for (const p of PAYLOADS) {
    const eff = null; void eff;
    for (const rid of ROUTE_IDS) {
      const D = routeById(rid).D;
      const r = sailTrip(sail, p, r0, D);
      const tag = `sail/${rid}/p=${p}`;
      ok(FLAGS(r).has('flyby'), `${tag}: flyby flag`);
      ok(!FLAGS(r).has('noBudget'), `${tag}: sail has no propellant budget flag`);
      // a_c: efficiency factor independent of payload and equal to the contract's 0.9
      const effEff = r.aChar * (p + sailMassOf) / (sail.area * flux);
      near(effEff, 0.9, 1e-9, `${tag}: a_c = 0.9 * 2S/c * A/(m_pl + sigma A)`);
      const k = r.aChar * r0 * r0;
      near(r.vCruise, Math.sqrt(2 * k * (1 / r0 - 1 / (r0 + D))), 1e-9, `${tag}: v(r) formula`);
      near(r.dvUsed, r.vCruise, 1e-12, `${tag}: dvUsed = flyby speed`);
      // independent time: t = int_{r0}^{r0+D} dr / v(r); r = r0 + u^2 removes the 1/sqrt singularity
      const g = (u) => 2 * Math.sqrt(r0 * (r0 + u * u) / (2 * k));
      near(r.time, simpson(g, 0, Math.sqrt(D), 4000), 1e-8, `${tag}: t(r) vs numeric integral`);
      ok(r.vCruise < C, `${tag}: speed below c`);
    }
    // monotone in payload (use Pluto)
    const rp = sailTrip(sail, p, r0, routeById('pluto').D);
    ok(rp.time > prevT, 'sail: time strictly increases with payload');
    ok(rp.vCruise < prevV, 'sail: flyby speed strictly decreases with payload');
    ok(rp.aChar < prevA, 'sail: characteristic acceleration strictly decreases with payload');
    prevT = rp.time; prevV = rp.vCruise; prevA = rp.aChar;
  }
  // small-D limit: constant acceleration a_c, t = sqrt(2 D / a_c)
  for (const p of [100, 1e4]) {
    const D = 1e-4 * r0, r = sailTrip(sail, p, r0, D);
    near(r.time, Math.sqrt(2 * D / r.aChar), 1e-3, 'small-D: t ~ sqrt(2D/a)');
    near(r.vCruise, Math.sqrt(2 * r.aChar * D), 1e-3, 'small-D: v ~ sqrt(2aD)');
  }
  // far field: speed saturates at escape-like sqrt(2k/r0)
  const far = sailTrip(sail, 1000, r0, 1e6 * AU);
  const kf = far.aChar * r0 * r0;
  near(far.vCruise, Math.sqrt(2 * kf / r0), 1e-5, 'D -> infinity: v -> sqrt(2k/r0)');
  // time increases with D
  let pt = 0;
  for (const rid of ['mars', 'jupiter', 'pluto', 'sgl', 'alphacen']) {
    const t = sailTrip(sail, 1000, r0, routeById(rid).D).time; ok(t > pt, 'sail time increases with distance'); pt = t;
  }
}

// =====================================================================================
// (7) compareEngines
// =====================================================================================
for (const rid of ROUTE_IDS) for (const brake of [true, false]) {
  let prev = null;
  for (const p of PAYLOADS) {
    const rows = compareEngines(rid, p, { brake });
    const tag = `compare/${rid}/brake=${brake}/p=${p}`;
    ok(Array.isArray(rows) && rows.length === 5, `${tag}: 5 rows`);
    ok(JSON.stringify(rows.map((x) => x.id)) === JSON.stringify(ORDER), `${tag}: engine order`);
    for (const x of rows) {
      ok(typeof x.time === 'number' && !Number.isNaN(x.time) && x.time > 0, `${tag}/${x.id}: time > 0, not NaN`);
      ok(Array.isArray(x.flags), `${tag}/${x.id}: flags array`);
      ok(['dvUsed', 'dvBudget', 'vCruise'].every((k) => typeof x[k] === 'number' && !Number.isNaN(x[k])), `${tag}/${x.id}: numeric fields`);
      if (x.id !== 'sail') near(x.dvBudget, dvBudget(engById(x.id), p), 1e-12, `${tag}/${x.id}: dvBudget matches`);
      else { ok(x.dvBudget === 0, `${tag}: sail dvBudget 0`); ok(FLAGS(x).has('flyby'), `${tag}: sail always flyby`); }
    }
    if (rid === 'mars') for (const x of rows) ok(Number.isFinite(x.time), `${tag}/${x.id}: finite time to Mars`);
    // agrees with the primitive calls
    const D = routeById(rid).D;
    for (const id of REACTIVE) {
      const direct = propulsiveTrip(engById(id), p, D, { brake });
      const row = rows.find((x) => x.id === id);
      near(row.time, direct.time, 1e-12, `${tag}/${id}: matches propulsiveTrip`);
    }
    const srow = rows.find((x) => x.id === 'sail');
    near(srow.time, sailTrip(engById('sail'), p, routeById(rid).r0, D).time, 1e-12, `${tag}: sail matches sailTrip`);
    // monotone in payload
    if (prev) for (const x of rows) {
      const q = prev.find((y) => y.id === x.id);
      if (x.id === 'sail') ok(x.time > q.time, `${tag}/sail: time strictly increases with payload`);
      else { ok(x.dvBudget < q.dvBudget, `${tag}/${x.id}: budget strictly decreases`); ok(x.time >= q.time * (1 - 1e-12), `${tag}/${x.id}: time non-decreasing`); }
    }
    prev = rows;
  }
}

// =====================================================================================
// (8) engines-view helpers
// =====================================================================================
{
  const sLo = payloadToSlider(100), sHi = payloadToSlider(1e6);
  ok(Number.isFinite(sLo) && Number.isFinite(sHi) && sHi > sLo, 'slider range ascending, 100 kg -> 1e6 kg');
  near(sliderToPayload(sLo), 100, 1e-9, 'slider min -> 100 kg');
  near(sliderToPayload(sHi), 1e6, 1e-9, 'slider max -> 1e6 kg');
  // log scale: slider midpoint = geometric mean, equal decade spacing
  near(sliderToPayload((sLo + sHi) / 2), 1e4, 1e-9, 'slider midpoint = 10^4 kg (log scale)');
  const dec = (payloadToSlider(1e3) - payloadToSlider(1e2));
  for (const lo of [1e2, 1e3, 1e4, 1e5]) near(payloadToSlider(lo * 10) - payloadToSlider(lo), dec, 1e-9, 'equal slider step per decade');
  let prevP = 0, prevS = -Infinity;
  for (let i = 0; i <= 200; i++) {
    const s = sLo + (sHi - sLo) * i / 200;
    const p = sliderToPayload(s);
    ok(p >= 100 * (1 - 1e-12) && p <= 1e6 * (1 + 1e-12), `payload in 100..1e6 at s=${s}`);
    ok(p > prevP, 'sliderToPayload strictly increasing'); prevP = p;
    near(payloadToSlider(p), s, 1e-9, 'slider -> payload -> slider roundtrip') ;
  }
  for (let i = 0; i <= 120; i++) {
    const p = 100 * Math.pow(1e4, i / 120);
    const s = payloadToSlider(p);
    ok(s > prevS || i === 0, 'payloadToSlider strictly increasing'); prevS = s;
    near(sliderToPayload(s), p, 1e-9, 'payload -> slider -> payload roundtrip');
  }
}
{
  const min = 1e-1, max = 1e9;
  const grid = [];
  for (let e = -4; e <= 14; e += 0.25) grid.push(10 ** e);
  let prev = -1;
  for (const v of grid) {
    const f = barFraction(v, min, max);
    ok(Number.isFinite(f) && f >= 0 && f <= 1, `barFraction in [0,1] for ${v}`);
    ok(f >= prev, 'barFraction monotone non-decreasing');
    if (v > min && v < max) ok(f > prev || prev < 0, 'strictly increasing inside (min,max)');
    prev = f;
  }
  // strict inside, log-shaped: ordering of decades
  const a = barFraction(1, min, max), b = barFraction(1e3, min, max), c = barFraction(1e6, min, max);
  ok(0 < a && a < b && b < c && c < 1, 'interior values strictly ordered within (0,1)');
  near(barFraction(Math.sqrt(min * max), min, max), 0.5, 1e-9, 'geometric mean at half of a log bar');
  near(barFraction(max, min, max), 1, 1e-9, 'max -> 1');
  ok(Math.abs(barFraction(min, min, max)) < 1e-9, 'min -> 0');
  ok(barFraction(Infinity, min, max) === 1, 'Infinity -> 1');
}

console.log(`engines.contract: ${checks} checks OK`);
