// Engine comparison: order-of-magnitude trip estimates for five propulsion types.
// Straight-line flight over distance D, NO solar gravity, classical mechanics (not SR).
// Pure functions, SI units; no DOM, no state. Planet routes also get the Hohmann reference.
import { C, G0, AU, LY } from './constants.js';
import { ENGINES, ROUTES, SAIL_EFF } from '../data/engines.js';

export { AU, LY, ENGINES, ROUTES, SAIL_EFF };
export const MU_SUN = 1.32712440018e20;   // m^3/s^2
export const SOLAR_CONST = 1361;          // W/m^2 at 1 AU

const okPos = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
const needPayload = (p) => { if (!okPos(p)) throw new RangeError('payload must be a finite number > 0 (kg)'); };
const isSail = (e) => e.kind === 'sail';

// Hohmann transfer between circular coplanar orbits r1 -> r2 around mu.
export function hohmann(r1, r2, mu = MU_SUN) {
  if (!okPos(r1) || !okPos(r2) || !okPos(mu)) throw new RangeError('hohmann: r1, r2, mu must be finite > 0');
  const dv1 = Math.sqrt(mu / r1) * (Math.sqrt(2 * r2 / (r1 + r2)) - 1);
  const dv2 = Math.sqrt(mu / r2) * (1 - Math.sqrt(2 * r1 / (r1 + r2)));
  const a = (r1 + r2) / 2;
  return { dv1, dv2, dv: Math.abs(dv1) + Math.abs(dv2), t: Math.PI * Math.sqrt(a * a * a / mu) };
}

export function stageMasses(engine, payload) {
  needPayload(payload);
  const mDry = payload + engine.engineMass + engine.tankMass;
  return { m0: mDry + engine.propMass, mDry };
}

// Tsiolkovsky budget; a sail spends no propellant.
export function dvBudget(engine, payload) {
  if (isSail(engine)) return 0;
  const { m0, mDry } = stageMasses(engine, payload);
  return engine.isp * G0 * Math.log(m0 / mDry);
}

// g(x) = 1 - e^-x - x e^-x = e^-x (e^x - 1 - x); series for small x avoids cancellation.
function gFun(x) {
  if (x < 0.05) {
    let term = x * x / 2, sum = term;
    for (let k = 3; k <= 9; k++) { term *= x / k; sum += term; }
    return Math.exp(-x) * sum;
  }
  return 1 - Math.exp(-x) - x * Math.exp(-x);
}

// Constant-thrust burn from rest gaining dv: mdot = F/ve, m1 = m0 e^(-dv/ve),
// t = (m0 - m1)/mdot, s = ve t - (ve m1/mdot) ln(m0/m1).  (algebraically; evaluated cancellation-safe)
export function burnTimeAndDistance(m0, F, ve, dv) {
  const x = dv / ve;
  return {
    t: ve * m0 * (-Math.expm1(-x)) / F,
    s: ve * ve * m0 * gFun(x) / F,
    m1: m0 * Math.exp(-x),
  };
}

// thrust-phase totals for cruise speed vc (accelerate, optionally brake)
function phases(m0, F, ve, vc, brake) {
  const a = burnTimeAndDistance(m0, F, ve, vc);
  if (!brake) return { tAcc: a.t, tDec: 0, dist: a.s };
  const d = burnTimeAndDistance(a.m1, F, ve, vc);
  return { tAcc: a.t, tDec: d.t, dist: a.s + (vc * d.t - d.s) };
}

export function propulsiveTrip(engine, payload, D, { brake = true } = {}) {
  needPayload(payload);
  if (!okPos(D)) throw new RangeError('distance must be a finite number > 0');
  const flags = brake ? [] : ['flyby'];
  const B = dvBudget(engine, payload);
  if (!(B > 0)) return { time: Infinity, dvUsed: 0, vCruise: 0, tBurn: 0, flags: [...flags, 'noBudget'] };
  const { m0 } = stageMasses(engine, payload);
  const ve = engine.isp * G0, F = engine.F;
  const k = brake ? 2 : 1;                    // how many equal-Δv burns
  let vc = B / k;
  let ph = phases(m0, F, ve, vc, brake);
  let time;
  if (ph.dist <= D) {
    time = ph.tAcc + ph.tDec + (D - ph.dist) / vc;
  } else {
    // thrust phases alone overshoot D: lower the cruise speed until they fit exactly (no coast)
    let lo = 0, hi = vc;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (phases(m0, F, ve, mid, brake).dist > D) hi = mid; else lo = mid;
      if ((hi - lo) <= 1e-13 * hi) break;
    }
    vc = (lo + hi) / 2;
    ph = phases(m0, F, ve, vc, brake);
    time = ph.tAcc + ph.tDec;
  }
  if (vc > 0.1 * C) flags.push('relativistic');
  return { time, dvUsed: k * vc, vCruise: vc, tBurn: ph.tAcc + ph.tDec, flags };
}

// Solar sail from rest at r0, radiation pressure ~ 1/r^2, flyby only.
export function sailTrip(engine, payload, r0, D) {
  needPayload(payload);
  if (!okPos(r0) || !okPos(D)) throw new RangeError('r0 and D must be finite > 0');
  const sailMass = engine.arealDensity * engine.area;
  const aC = SAIL_EFF * 2 * SOLAR_CONST / C * engine.area / (payload + sailMass);
  const kk = aC * r0 * r0;
  const r = r0 + D;
  const v = Math.sqrt(2 * kk * (1 / r0 - 1 / r));
  const time = Math.sqrt(r0 / (2 * kk)) * (Math.sqrt(r * (r - r0)) + r0 * Math.log((Math.sqrt(r) + Math.sqrt(r - r0)) / Math.sqrt(r0)));
  return { time, dvUsed: v, vCruise: v, aChar: aC, flags: ['flyby'] };
}

// One row per engine, fixed order chemical, ion, ntr, fusion, sail.
export function compareEngines(routeId, payload, { brake = true } = {}) {
  const route = ROUTES.find((r) => r.id === routeId);
  if (!route) throw new RangeError('unknown route: ' + routeId);
  needPayload(payload);
  return ENGINES.map((e) => {
    if (isSail(e)) {
      const s = sailTrip(e, payload, route.r0, route.D);
      return { id: e.id, time: s.time, dvUsed: s.dvUsed, dvBudget: 0, vCruise: s.vCruise, flags: s.flags };
    }
    const t = propulsiveTrip(e, payload, route.D, { brake });
    return { id: e.id, time: t.time, dvUsed: t.dvUsed, dvBudget: dvBudget(e, payload), vCruise: t.vCruise, flags: t.flags };
  });
}
