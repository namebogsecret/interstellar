// Interstellar dust and gas against a relativistic craft: impact energy, shield erosion along a route,
// shield mass against the craft. Pure functions, SI units; no DOM, no state. NEVER throws: bad input
// -> { valid:false, reason }.
// Model (stated on dust.html): the whole route is flown at the cruise beta (upper bound: acceleration and
// braking legs are slower); ALL kinetic energy of the dust goes into ablation of the shield (pessimistic);
// gas only sputters the shield with a fixed yield SPUTTER_YIELD (its energy goes into heat / dose and is
// reported separately). Constant density along the route, no deflection, no secondary cascades.
// Order-of-magnitude reference: Hoang et al. 2017, ApJ 837, 5 "Interaction of relativistic spacecraft with
// the interstellar medium".
import { C, LY } from './constants.js';
import { NEIGHBORS } from '../data/neighbors.js';

export { NEIGHBORS };

export const M_H = 1.6735575e-27;        // kg, hydrogen atom
export const MU_GAS = 1.4;               // gas mass per H atom (helium included), in units of M_H
export const BETA_MIN = 0.05, BETA_MAX = 0.5;
export const GRAIN_DENSITY = 2500;       // kg/m^3
export const GRAIN_RADIUS_DEFAULT = 0.1e-6;   // m
export const DUST_TO_GAS = 0.01;         // by mass
export const N_H_DEFAULT = 0.1;          // cm^-3 (= 1e5 m^-3)
export const TNT_KG_J = 4.184e6;         // J per kg of TNT
export const EV_J = 1.602176634e-19;     // J
export const N_A = 6.02214076e23;        // 1/mol
export const SPUTTER_YIELD = 0.01;       // shield atoms per incoming gas atom (order-of-magnitude, pessimistic)
export const SAFETY = 2;                 // thickness margin
// rho kg/m^3, Q specific ablation / vaporisation energy J/kg, A molar mass g/mol
export const MATERIALS = {
  graphite: { rho: 2200, Q: 5.9e7, A: 12.011 },
  beryllium: { rho: 1850, Q: 3.3e7, A: 9.012 },
  aluminium: { rho: 2700, Q: 1.2e7, A: 26.98 },
};
export const MATERIAL_IDS = Object.keys(MATERIALS);
export const DEFAULTS = { area_m2: 10, payload_kg: 1000 };

const C2 = C * C;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const okPos = (v) => isNum(v) && v > 0;
const refuse = (reason) => ({ valid: false, reason });
const def = (v, d) => (v === undefined ? d : v);

export function gammaOfBeta(beta) {
  if (!isNum(beta) || beta < 0 || beta >= 1) return NaN;
  return 1 / Math.sqrt(1 - beta * beta);
}

// (gamma - 1) without cancellation: beta^2 / (s (1 + s)), s = sqrt(1 - beta^2)
function gammaMinusOne(beta) {
  if (!isNum(beta) || beta < 0 || beta >= 1) return NaN;
  const s = Math.sqrt(1 - beta * beta);
  return (beta * beta) / (s * (1 + s));
}

/** Relativistic kinetic energy (gamma - 1) m c^2, J. Bad input -> NaN (never throws). */
export function kineticEnergy(m, beta) {
  if (!isNum(m) || m < 0) return NaN;
  return gammaMinusOne(beta) * m * C2;
}

/** Mass of a spherical grain, kg. Bad input -> NaN. */
export function grainMass(radius_m, rho = GRAIN_DENSITY) {
  if (!okPos(radius_m) || !okPos(rho)) return NaN;
  return (4 / 3) * Math.PI * radius_m * radius_m * radius_m * rho;
}

const betaError = (beta) => (!isNum(beta) ? 'beta must be a finite number'
  : beta < BETA_MIN || beta > BETA_MAX ? 'beta must be within [' + BETA_MIN + ', ' + BETA_MAX + ']' : null);

function safe(fn, p) {
  try {
    return fn(p ?? {});
  } catch (e) {
    return refuse('calculation failed: ' + (e && e.message ? e.message : String(e)));
  }
}

/** Energy of one hydrogen atom and one dust grain hitting the craft at beta. */
export const impact = (p = {}) => safe(impactRaw, p);
function impactRaw(p) {
  const beta = p.beta, grainRadius = def(p.grainRadius, GRAIN_RADIUS_DEFAULT);
  const be = betaError(beta);
  if (be) return refuse(be);
  if (!okPos(grainRadius)) return refuse('grain radius must be a finite number > 0 (m)');
  const k = gammaMinusOne(beta) * C2;              // J per kg
  const hJ = k * M_H;
  const mass = grainMass(grainRadius);
  const gJ = k * mass;
  if (![hJ, mass, gJ].every(isNum)) return refuse('result not finite');
  return {
    valid: true, beta, gamma: gammaOfBeta(beta),
    hydrogen: { J: hJ, eV: hJ / EV_J, MeV: hJ / EV_J / 1e6 },
    grain: { radius: grainRadius, mass, J: gJ, tntKg: gJ / TNT_KG_J },
  };
}

/** Shield erosion per unit frontal area along a route of `ly` light-years. */
export const erosion = (p = {}) => safe(erosionRaw, p);
function erosionRaw(p) {
  const beta = p.beta, ly = p.ly;
  const nH_cm3 = def(p.nH_cm3, N_H_DEFAULT);
  const material = def(p.material, 'graphite');
  const grainRadius = def(p.grainRadius, GRAIN_RADIUS_DEFAULT);
  const dustToGas = def(p.dustToGas, DUST_TO_GAS);
  const be = betaError(beta);
  if (be) return refuse(be);
  if (!okPos(ly)) return refuse('distance must be a finite number > 0 (ly)');
  if (!isNum(nH_cm3) || nH_cm3 < 0) return refuse('density must be a finite number >= 0 (cm^-3)');
  if (typeof material !== 'string' || !Object.prototype.hasOwnProperty.call(MATERIALS, material)) return refuse('unknown material: ' + String(material));
  if (!okPos(grainRadius)) return refuse('grain radius must be a finite number > 0 (m)');
  if (!isNum(dustToGas) || dustToGas < 0) return refuse('dust-to-gas ratio must be a finite number >= 0');
  const mat = MATERIALS[material];
  const k = gammaMinusOne(beta) * C2;              // J per kg of swept matter
  const L = ly * LY;
  const nH = nH_cm3 * 1e6;
  const columnH = nH * L;
  const gasMassPerArea = columnH * MU_GAS * M_H;
  const dustMassPerArea = dustToGas * gasMassPerArea;
  const energyPerArea = { gas: k * gasMassPerArea, dust: k * dustMassPerArea };
  energyPerArea.total = energyPerArea.gas + energyPerArea.dust;
  const erodedMassPerArea = { dust: energyPerArea.dust / mat.Q, gas: SPUTTER_YIELD * columnH * mat.A * 1e-3 / N_A };
  erodedMassPerArea.total = erodedMassPerArea.dust + erodedMassPerArea.gas;
  const depth = erodedMassPerArea.total / mat.rho;
  const grainHitsPerArea = dustMassPerArea / grainMass(grainRadius);
  const all = [L, nH, columnH, gasMassPerArea, dustMassPerArea, energyPerArea.total, erodedMassPerArea.total, depth, grainHitsPerArea];
  if (!all.every(isNum)) return refuse('result not finite');
  return {
    valid: true, beta, gamma: gammaOfBeta(beta), ly, material, grainRadius, dustToGas, nH_cm3,
    L, nH, columnH, gasMassPerArea, dustMassPerArea, energyPerArea, erodedMassPerArea, depth, grainHitsPerArea,
  };
}

/** Shield sized for the route: thickness = safety * depth over a frontal area, mass against the payload. */
export const shield = (p = {}) => safe(shieldRaw, p);
function shieldRaw(p) {
  const area = def(p.area_m2, DEFAULTS.area_m2);
  const payload = def(p.payload_kg, DEFAULTS.payload_kg);
  const safety = def(p.safety, SAFETY);
  const e = erosionRaw(p);
  if (!e.valid) return e;
  if (!okPos(area)) return refuse('frontal area must be a finite number > 0 (m^2)');
  if (!okPos(payload)) return refuse('payload must be a finite number > 0 (kg)');
  if (!okPos(safety)) return refuse('safety factor must be a finite number > 0');
  const rho = MATERIALS[e.material].rho;
  const thickness = safety * e.depth;
  const shieldMass = rho * area * thickness;
  const massRatio = shieldMass / payload;
  const extraKE = kineticEnergy(shieldMass, e.beta);
  if (![thickness, shieldMass, massRatio, extraKE].every(isNum)) return refuse('result not finite');
  return { ...e, area_m2: area, payload_kg: payload, safety, thickness, shieldMass, massRatio,
    heavierThanCraft: shieldMass > payload, extraKE };
}

/** n points of beta from BETA_MIN to BETA_MAX inclusive: [{beta, thickness, shieldMass, massRatio}]. Bad input -> []. */
export function sweepBeta(params = {}, n = 46) {
  try {
    if (!Number.isInteger(n) || n < 2) return [];
    const out = [];
    for (let i = 0; i < n; i++) {
      const beta = i === n - 1 ? BETA_MAX : BETA_MIN + (BETA_MAX - BETA_MIN) * i / (n - 1);
      const s = shieldRaw({ ...(params ?? {}), beta });
      if (!s.valid) return [];
      out.push({ beta, thickness: s.thickness, shieldMass: s.shieldMass, massRatio: s.massRatio });
    }
    return out;
  } catch (e) {
    return [];
  }
}

/** Clamp a mission beta into the model range: { beta, clamped:'below'|'above'|null }. */
export function clampBeta(b) {
  if (!isNum(b)) return { beta: NaN, clamped: null };
  if (b < BETA_MIN) return { beta: BETA_MIN, clamped: 'below' };
  if (b > BETA_MAX) return { beta: BETA_MAX, clamped: 'above' };
  return { beta: b, clamped: null };
}

/**
 * Shield for a mission.js plan: route = plan.target.ly, beta = clamp(plan.betaMax, BETA_MIN, BETA_MAX),
 * payload = plan.payload if present, else opts.payload (else DEFAULTS.payload_kg).
 */
export function fromMission(plan, opts = {}) {
  try {
    if (!plan || !plan.valid) return refuse('mission plan is not valid' + (plan && plan.reason ? ': ' + plan.reason : ''));
    const o = opts ?? {};
    const ly = plan.target && plan.target.ly;
    if (!okPos(ly)) return refuse('mission plan has no target distance');
    if (!isNum(plan.betaMax) || plan.betaMax < 0) return refuse('mission plan has no peak beta');
    const { beta, clamped } = clampBeta(plan.betaMax);
    const payload = okPos(plan.payload) ? plan.payload : def(o.payload, DEFAULTS.payload_kg);
    const s = shieldRaw({ ...o, beta, ly, payload_kg: payload });
    if (!s.valid) return s;
    return { ...s, betaUsed: beta, betaMission: plan.betaMax, clamped, target: plan.target };
  } catch (e) {
    return refuse('calculation failed: ' + (e && e.message ? e.message : String(e)));
  }
}
