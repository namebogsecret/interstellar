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

// Thrust scaling (assumption, stated on the page): k times the thrust needs k times the
// engines, so the propulsion hardware mass scales with k (constant thrust-to-mass of the engine;
// tanks and propellant load unchanged). A sail's thrust scales with its area, sail mass with it.
export const THRUST_SCALE_MIN = 0.1, THRUST_SCALE_MAX = 10;
export function scaleThrust(engine, k) {
  if (!okPos(k)) throw new RangeError('thrust scale must be a finite number > 0');
  if (isSail(engine)) return { ...engine, area: engine.area * k, thrustScale: k };
  return { ...engine, F: engine.F * k, engineMass: engine.engineMass * k, thrustScale: k };
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

// Sail: characteristic acceleration at r0 and the elapsed time to reach radius r (a = kk/r^2, from rest at r0).
function sailAccelAtR0(engine, payload, r0) {
  const sailMass = engine.arealDensity * engine.area;
  return SAIL_EFF * 2 * SOLAR_CONST / C * engine.area / (payload + sailMass);
}
function sailTimeTo(kk, r0, r) {
  return Math.sqrt(r0 / (2 * kk)) * (Math.sqrt(r * (r - r0)) + r0 * Math.log((Math.sqrt(r) + Math.sqrt(r - r0)) / Math.sqrt(r0)));
}

// Solar sail from rest at r0, radiation pressure ~ 1/r^2, flyby only.
export function sailTrip(engine, payload, r0, D) {
  needPayload(payload);
  if (!okPos(r0) || !okPos(D)) throw new RangeError('r0 and D must be finite > 0');
  const aC = sailAccelAtR0(engine, payload, r0);
  const kk = aC * r0 * r0;
  const r = r0 + D;
  const v = Math.sqrt(2 * kk * (1 / r0 - 1 / r));
  const time = sailTimeTo(kk, r0, r);
  return { time, dvUsed: v, vCruise: v, aChar: aC, flags: ['flyby'] };
}

// Acceleration along the flight, a(t) = F/m(t), for one engine. Points {t, a, m, phase}, t in s from launch,
// phase 'accel' | 'coast' | 'brake' | 'sail'. Rockets: constant thrust, mass falls by mdot = F/ve, so a rises
// during each burn; coast has a = 0. Burn samples are geometric in t (log time axis), brake samples linear.
// Sail: points parametrised by radius, a = a(r0)(r0/r)^2, m constant. Same flight as propulsiveTrip/sailTrip.
export function accelProfile(engine, payload, D, { brake = true, r0 = AU, n = 48 } = {}) {
  needPayload(payload);
  if (!okPos(D) || !okPos(r0)) throw new RangeError('D and r0 must be finite > 0');
  if (isSail(engine)) {
    const aC = sailAccelAtR0(engine, payload, r0), kk = aC * r0 * r0;
    const m = payload + engine.arealDensity * engine.area;
    const r1 = r0 + D, points = [{ t: 0, a: aC, m, phase: 'sail', r: r0 }];   // exact start at rest
    for (let i = 0; i <= n; i++) {
      const r = r0 + D * Math.pow(10, -9 * (1 - i / n));   // geometric in r - r0, ends exactly at r0 + D
      points.push({ t: sailTimeTo(kk, r0, r), a: kk / (r * r), m, phase: 'sail', r });
    }
    return { time: sailTimeTo(kk, r0, r1), points, flags: ['flyby'] };
  }
  const trip = propulsiveTrip(engine, payload, D, { brake });
  if (!Number.isFinite(trip.time)) return { time: Infinity, points: [], flags: trip.flags };
  const { m0 } = stageMasses(engine, payload);
  const ve = engine.isp * G0, F = engine.F, mdot = F / ve, vc = trip.vCruise;
  const points = [];
  const burn = (tStart, mStart, phase, geometric) => {
    const dur = ve * mStart * (-Math.expm1(-vc / ve)) / F;
    if (geometric) points.push({ t: tStart, a: F / mStart, m: mStart, phase });   // exact t = 0 start
    for (let i = 0; i <= n; i++) {
      const u = geometric ? Math.pow(10, -6 * (1 - i / n)) : i / n;
      const m = i === n ? mStart * Math.exp(-vc / ve) : mStart - mdot * dur * u;
      points.push({ t: tStart + dur * u, a: F / m, m, phase });
    }
    return { dur, mEnd: mStart * Math.exp(-vc / ve) };
  };
  const a = burn(0, m0, 'accel', true);
  if (brake) {
    points.push({ t: a.dur, a: 0, m: a.mEnd, phase: 'coast' });
    const dDec = ve * a.mEnd * (-Math.expm1(-vc / ve)) / F;
    const tB = Math.max(a.dur, trip.time - dDec);   // no coast when the burns fill the whole trip
    points.push({ t: tB, a: 0, m: a.mEnd, phase: 'coast' });
    burn(tB, a.mEnd, 'brake', false);
  } else if (trip.time > a.dur) {
    points.push({ t: a.dur, a: 0, m: a.mEnd, phase: 'coast' }, { t: trip.time, a: 0, m: a.mEnd, phase: 'coast' });
  }
  return { time: trip.time, points, flags: trip.flags };
}

// One row per engine, fixed order chemical, ion, ntr, fusion, sail. thrustScale multiplies every engine's
// thrust (see scaleThrust). Extra fields: mdot (kg/s), propUsed (kg), mEnd (kg), aStart (m/s^2).
export function compareEngines(routeId, payload, { brake = true, thrustScale = 1 } = {}) {
  const route = ROUTES.find((r) => r.id === routeId);
  if (!route) throw new RangeError('unknown route: ' + routeId);
  needPayload(payload);
  return ENGINES.map((e0) => {
    const e = thrustScale === 1 ? e0 : scaleThrust(e0, thrustScale);
    if (isSail(e)) {
      const s = sailTrip(e, payload, route.r0, route.D);
      return { id: e.id, time: s.time, dvUsed: s.dvUsed, dvBudget: 0, vCruise: s.vCruise, flags: s.flags,
        mdot: 0, propUsed: 0, mEnd: payload + e.arealDensity * e.area, aStart: s.aChar };
    }
    const t = propulsiveTrip(e, payload, route.D, { brake });
    const { m0 } = stageMasses(e, payload);
    const mEnd = m0 * Math.exp(-t.dvUsed / (e.isp * G0));
    return { id: e.id, time: t.time, dvUsed: t.dvUsed, dvBudget: dvBudget(e, payload), vCruise: t.vCruise, flags: t.flags,
      mdot: e.F / (e.isp * G0), propUsed: m0 - mEnd, mEnd, aStart: e.F / m0 };
  });
}

// a(t) profiles for all engines on a route (for the acceleration chart).
export function compareProfiles(routeId, payload, { brake = true, thrustScale = 1 } = {}) {
  const route = ROUTES.find((r) => r.id === routeId);
  if (!route) throw new RangeError('unknown route: ' + routeId);
  needPayload(payload);
  return ENGINES.map((e0) => {
    const e = thrustScale === 1 ? e0 : scaleThrust(e0, thrustScale);
    return { id: e.id, ...accelProfile(e, payload, route.D, { brake, r0: route.r0 }) };
  });
}
