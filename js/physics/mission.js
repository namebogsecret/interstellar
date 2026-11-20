// Mission builder: pick a star, an engine, payload, energy budget -> one honest trip plan.
// Pure functions, SI units; no DOM, no state. Formulas are NOT copied: rockets reuse engines.js
// (propulsiveTrip / stageMasses), the solar sail reuses sailTrip, the laser sail reuses lasersail.launch,
// the photon rocket reuses flight.js (constant proper acceleration, ve = c).
// Model limits (stated on the page): rocket legs are Newtonian (the cores are), no gravity, no drag.
import { C, G0, LY, AU } from './constants.js';
import { flightForDistance } from './flight.js';
import { launch } from './lasersail.js';
import { propulsiveTrip, sailTrip, stageMasses, ENGINES } from './engines.js';
import { NEIGHBORS } from '../data/neighbors.js';

export { NEIGHBORS, ENGINES };

export const ENGINE_IDS = ['chemical', 'ion', 'ntr', 'fusion', 'sail', 'laser', 'photon'];
export const DEFAULTS = { payload: 1000, budget: 1e21, accelG: 1, laserPower: 100e9, laserArea: 16 };
export const RELATIVISTIC_BETA = 0.1;

export const canBrake = (engineId) => engineId !== 'sail' && engineId !== 'laser';

const okPos = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
const refuse = (reason) => ({ valid: false, reason });
const gammaOfBeta = (b) => 1 / Math.sqrt(1 - b * b);
const uniq = (a) => [...new Set(a)];

function resolveTarget(t) {
  if (typeof t === 'string') {
    const s = NEIGHBORS.find((n) => n.name === t);
    return s ? { name: s.name, ly: s.ly } : null;
  }
  if (t && typeof t === 'object' && typeof t.name === 'string' && okPos(t.ly)) return { name: t.name, ly: t.ly };
  return null;
}

/**
 * Plan one mission. Never throws: bad input or an overflowing result -> { valid:false, reason }.
 * @param {{target:(string|{name:string,ly:number}), engine:string, payload?:number, budget?:number, brake?:boolean,
 *          accelG?:number, laserPower?:number, laserArea?:number}} p
 */
export function planMission(p = {}) {
  try {
    return plan(p ?? {});
  } catch (e) {
    return refuse('calculation failed: ' + (e && e.message ? e.message : String(e)));
  }
}

function plan(p) {
  const engineId = p.engine;
  if (!ENGINE_IDS.includes(engineId)) return refuse('unknown engine: ' + String(engineId));
  const target = resolveTarget(p.target);
  if (!target) return refuse('target not found');
  const payload = p.payload === undefined ? DEFAULTS.payload : p.payload;
  const budget = p.budget === undefined ? DEFAULTS.budget : p.budget;
  const accelG = p.accelG === undefined ? DEFAULTS.accelG : p.accelG;
  const laserPower = p.laserPower === undefined ? DEFAULTS.laserPower : p.laserPower;
  const laserArea = p.laserArea === undefined ? DEFAULTS.laserArea : p.laserArea;
  if (!okPos(payload)) return refuse('payload must be a finite number > 0 (kg)');
  if (!okPos(budget)) return refuse('budget must be a finite number > 0 (J)');
  if (engineId === 'photon' && !okPos(accelG)) return refuse('acceleration must be a finite number > 0 (g)');
  if (engineId === 'laser' && !okPos(laserPower)) return refuse('laser power must be a finite number > 0 (W)');
  if (engineId === 'laser' && !okPos(laserArea)) return refuse('sail area must be a finite number > 0 (m^2)');

  const wantBrake = p.brake === undefined ? true : p.brake;
  const brake = !!wantBrake && canBrake(engineId);
  const D = target.ly * LY;
  if (!okPos(D)) return refuse('distance is not a finite number > 0');

  const f = { tEarth: 0, tShip: 0, dv: 0, vMax: 0, betaMax: 0, gammaMax: 1, arrivalSpeed: 0, fuelMass: 0,
    power: 0, energy: 0, brakeLoss: null, massRatio: 1 };
  let coreFlags = [];

  if (engineId === 'photon') {
    const a = accelG * G0;
    const r = flightForDistance(a, brake ? D : 2 * D);
    if (!r.valid) return refuse(r.reason);
    const x = r.x;
    f.tEarth = brake ? r.T : r.T / 2;
    f.tShip = brake ? r.tau : r.tau / 2;
    f.betaMax = Math.min(r.betaMax, 1 - Number.EPSILON);   // tanh(x) rounds to exactly 1 for x > ~19: keep beta strictly below 1
    f.gammaMax = r.gammaMax;
    f.vMax = f.betaMax * C;
    f.massRatio = Math.exp(brake ? 2 * x : x);
    f.brakeLoss = brake ? Math.exp(-x) * (1 - Math.exp(-x)) : null;
    f.arrivalSpeed = brake ? 0 : f.vMax;
    f.fuelMass = payload * (f.massRatio - 1);
    f.energy = f.fuelMass * C * C;
    f.power = payload * f.massRatio * a * C;
    f.dv = (brake ? 2 : 1) * f.vMax;
  } else if (engineId === 'laser') {
    let r;
    try { r = launch({ payload, power: laserPower, area: laserArea }, { distance: D }); }
    catch (e) { return refuse('laser sail: ' + e.message); }
    if (!r.flights) return refuse('laser sail does not reach the target');
    f.tEarth = r.tFlight; f.tShip = r.tau;
    f.betaMax = r.betaMax; f.gammaMax = r.gammaMax;
    f.vMax = f.betaMax * C; f.dv = f.vMax; f.arrivalSpeed = f.vMax;
    f.power = laserPower; f.energy = laserPower * r.tBeam;
    coreFlags = r.flags;
  } else if (engineId === 'sail') {
    const e = ENGINES.find((x) => x.id === 'sail');
    const s = sailTrip(e, payload, AU, D);
    f.tEarth = s.time; f.vMax = s.vCruise; f.dv = s.dvUsed; f.arrivalSpeed = s.vCruise;
    f.betaMax = f.vMax / C;
    if (!(f.betaMax < 1)) return refuse('sail speed is not below c');
    f.gammaMax = gammaOfBeta(f.betaMax);
    f.tShip = f.tEarth / f.gammaMax;
    coreFlags = s.flags;
  } else {
    const e = ENGINES.find((x) => x.id === engineId);
    const t = propulsiveTrip(e, payload, D, { brake });
    if (!Number.isFinite(t.time) || !(t.vCruise > 0)) return refuse('engine cannot make this trip (no delta-v budget)');
    const ve = e.isp * G0, { m0 } = stageMasses(e, payload);
    const mEnd = m0 * Math.exp(-t.dvUsed / ve);
    f.tEarth = t.time; f.vMax = t.vCruise; f.dv = t.dvUsed;
    f.betaMax = f.vMax / C;
    if (!(f.betaMax < 1)) return refuse('cruise speed is not below c');
    f.gammaMax = gammaOfBeta(f.betaMax);
    const tCoast = Math.max(0, f.tEarth - t.tBurn);
    f.tShip = f.tEarth - tCoast * (1 - 1 / f.gammaMax);
    f.arrivalSpeed = brake ? 0 : f.vMax;
    f.fuelMass = m0 - mEnd;
    f.power = 0.5 * e.F * ve;
    f.energy = 0.5 * f.fuelMass * ve * ve;
    f.massRatio = m0 / mEnd;
    f.brakeLoss = brake ? (m0 * Math.exp(-f.vMax / ve) - mEnd) / m0 : null;
    coreFlags = t.flags;
  }

  for (const k of ['tEarth', 'tShip', 'dv', 'vMax', 'betaMax', 'gammaMax', 'arrivalSpeed', 'fuelMass', 'power', 'energy', 'massRatio']) {
    if (!Number.isFinite(f[k])) return refuse('result not finite: ' + k);
  }
  if (f.brakeLoss !== null && !Number.isFinite(f.brakeLoss)) return refuse('result not finite: brakeLoss');
  if (f.brakeLoss !== null) f.brakeLoss = Math.min(Math.max(f.brakeLoss, 0), 1 - Number.EPSILON);
  if (f.tShip > f.tEarth) f.tShip = f.tEarth;

  const withinBudget = f.energy <= budget;
  const flags = [];
  if (!brake) flags.push('flyby');
  if (wantBrake && !canBrake(engineId)) flags.push('cannotBrake');
  if (f.betaMax > RELATIVISTIC_BETA) flags.push('relativistic');
  if (!withinBudget) flags.push('overBudget');
  return {
    valid: true, engineId, target, D, brake, ...f, budget, withinBudget, budgetRatio: f.energy / budget,
    flags: uniq([...flags, ...coreFlags]),
  };
}

// Compact value formatter (3 significant digits, scientific outside 1e-2..1e6). Pages use richer view helpers.
const sig = (x) => {
  if (!Number.isFinite(x)) return '—';
  if (x === 0) return '0';
  const a = Math.abs(x);
  if (a >= 1e-2 && a < 1e6) return String(+x.toPrecision(3));
  const e = Math.floor(Math.log10(a));
  return (x / Math.pow(10, e)).toFixed(2) + 'e' + e;
};

const LABELS = {
  en: { target: 'Target', engine: 'Engine', tEarth: 'Time, Earth clock (yr)', tShip: 'Time, ship clock (yr)', dv: 'Total delta-v (m/s)',
    vMax: 'Peak speed (m/s)', beta: 'Peak speed (c)', gamma: 'Lorentz factor', arrival: 'Arrival speed (m/s)', fuel: 'Propellant used (kg)',
    power: 'Power (W)', energy: 'Energy (J)', budget: 'Budget (J)', ratio: 'Energy / budget', loss: 'Start mass burnt on braking',
    massRatio: 'Mass ratio', error: 'Error' },
  ru: { target: 'Цель', engine: 'Двигатель', tEarth: 'Время, часы Земли (лет)', tShip: 'Время, часы корабля (лет)', dv: 'Полное Δv (м/с)',
    vMax: 'Пиковая скорость (м/с)', beta: 'Пиковая скорость (c)', gamma: 'Лоренц-фактор', arrival: 'Скорость прибытия (м/с)', fuel: 'Расход рабочего тела (кг)',
    power: 'Мощность (Вт)', energy: 'Энергия (Дж)', budget: 'Бюджет (Дж)', ratio: 'Энергия / бюджет', loss: 'Доля стартовой массы, сожжённая на торможение',
    massRatio: 'Массовое число', error: 'Ошибка' },
};

/** Summary rows [{key, label, value}] (strings) for a plan; invalid plan -> one error row. */
export function summarize(plan, lang = 'ru') {
  const L = LABELS[lang === 'en' ? 'en' : 'ru'];
  if (!plan || !plan.valid) return [{ key: 'error', label: L.error, value: String(plan && plan.reason || 'invalid') }];
  const yr = 365.25 * 86400;
  const rows = [
    ['target', plan.target.name + ' (' + sig(plan.target.ly) + ' ly)'], ['engine', plan.engineId],
    ['tEarth', sig(plan.tEarth / yr)], ['tShip', sig(plan.tShip / yr)], ['dv', sig(plan.dv)],
    ['vMax', sig(plan.vMax)], ['beta', sig(plan.betaMax)], ['gamma', sig(plan.gammaMax)], ['arrival', sig(plan.arrivalSpeed)],
    ['fuel', sig(plan.fuelMass)], ['power', sig(plan.power)], ['energy', sig(plan.energy)], ['budget', sig(plan.budget)],
    ['ratio', sig(plan.budgetRatio)], ['loss', plan.brakeLoss === null ? '—' : sig(plan.brakeLoss)], ['massRatio', sig(plan.massRatio)],
  ];
  return rows.map(([key, value]) => ({ key, label: L[key], value }));
}
