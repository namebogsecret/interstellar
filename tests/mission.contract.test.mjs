// "Mission planner" page — CONTRACT tests written from the TZ ("Контракт ядра: js/physics/mission.js"), blind to the implementation.
// planMission is cross-checked against the shared cores it MUST reuse: flight.js (photon), lasersail.js (laser),
// engines.js (rockets + solar sail), data/engines.js, data/neighbors.js, constants.js.
// Invariants cited from the TZ: 0<=betaMax<1; 0<tShip<=tEarth; energy>=0; brakeLoss in [0,1) (null if !brake);
// Newtonian limit (photon) tShip/tEarth->1, tEarth~2*sqrt(D/a); ultra-relativistic tShip<<tEarth, tEarth>=D/c;
// budget influences ONLY withinBudget/budgetRatio/'overBudget'; planMission NEVER throws.
import assert from 'node:assert/strict';
import { C, G0, LY, AU } from '../js/physics/constants.js';
import { NEIGHBORS } from '../js/data/neighbors.js';
import { ENGINES } from '../js/data/engines.js';
import { flightForDistance } from '../js/physics/flight.js';
import { launch } from '../js/physics/lasersail.js';
import { propulsiveTrip, sailTrip, stageMasses } from '../js/physics/engines.js';
import { planMission, ENGINE_IDS, DEFAULTS, canBrake, summarize } from '../js/physics/mission.js';

let checks = 0;
const rel = (a, b) => Math.abs(a - b) / (Math.abs(b) || 1);
const near = (a, b, tol, msg) => { checks++; assert.ok(rel(a, b) <= tol, `${msg}: ${a} vs ${b} (rel ${rel(a, b)})`); };
const ok = (c, msg) => { checks++; assert.ok(c, msg); };
const eq = (a, b, msg) => { checks++; assert.deepEqual(a, b, msg); };
const plan = (o) => { checks++; let r; try { r = planMission(o); } catch (e) { assert.fail('planMission threw: ' + e + ' for ' + JSON.stringify(o)); } return r; };
const valid = (o) => { const r = plan(o); ok(r && r.valid === true, 'expected valid for ' + JSON.stringify(o) + ' got ' + JSON.stringify(r)); return r; };
const invalid = (o, msg) => { const r = plan(o); ok(r && r.valid === false && typeof r.reason === 'string' && r.reason.length > 0, 'expected valid:false+reason (' + msg + ') got ' + JSON.stringify(r)); };

const NEAR = NEIGHBORS.reduce((a, b) => (b.ly < a.ly ? b : a));
const FAR = NEIGHBORS.reduce((a, b) => (b.ly > a.ly ? b : a));
const ROCKETS = ENGINES.filter((e) => e.kind === 'rocket');
const SAILENG = ENGINES.find((e) => e.kind === 'sail');
const eng = (id) => ENGINES.find((e) => e.id === id);
const Dof = (s) => s.ly * LY;
const gam = (v) => 1 / Math.sqrt(1 - (v / C) ** 2);

// ---------- exports / constants ----------
eq(ENGINE_IDS, ['chemical', 'ion', 'ntr', 'fusion', 'sail', 'laser', 'photon'], 'ENGINE_IDS');
eq(DEFAULTS, { payload: 1000, budget: 1e21, accelG: 1, laserPower: 100e9, laserArea: 16 }, 'DEFAULTS');
for (const id of ENGINE_IDS) eq(canBrake(id), !(id === 'sail' || id === 'laser'), 'canBrake ' + id);
eq(ROCKETS.map((e) => e.id), ['chemical', 'ion', 'ntr', 'fusion'], 'data/engines.js has the 4 rockets');
ok(NEIGHBORS.length > 10 && FAR.ly > NEAR.ly, 'NEIGHBORS sane');

// ---------- bad input: valid:false + reason, never throws ----------
// TZ-AMBIG: null (not undefined) payload/budget is treated as invalid (null is not a finite number > 0; only absent keys fall back to DEFAULTS)
const base = { target: NEAR.name, engine: 'ion' };
for (const p of [0, -1, NaN, Infinity, -Infinity, '1000', null, {}, [], true]) invalid({ ...base, payload: p }, 'payload ' + String(p));
for (const b of [0, -1, NaN, Infinity, '1e21', null]) invalid({ ...base, budget: b }, 'budget ' + String(b));
invalid({ ...base, engine: 'warp' }, 'unknown engine');
invalid({ ...base, engine: '' }, 'empty engine');
invalid({ ...base, engine: undefined }, 'missing engine');
invalid({ ...base, engine: 'Ion' }, 'engine id is case-sensitive'); // TZ-AMBIG: ids compared exactly (ENGINE_IDS are lowercase)
invalid({ ...base, target: 'Nowhere Star' }, 'unknown star');
invalid({ ...base, target: 'proxima centauri' }, 'star name compared exactly (case)');
invalid({ ...base, target: 'Proxima' }, 'star name compared exactly (prefix)');
invalid({ ...base, target: undefined }, 'missing target');
invalid({ ...base, target: null }, 'null target');
invalid({ ...base, target: 42 }, 'numeric target');
for (const ly of [0, -3, NaN, Infinity]) invalid({ ...base, target: { name: 'X', ly } }, 'object target ly=' + ly);
for (const g of [0, -1, NaN, Infinity, '1']) invalid({ target: NEAR.name, engine: 'photon', accelG: g }, 'photon accelG ' + String(g));
for (const k of ['laserPower', 'laserArea']) {
  for (const v of [0, -1, NaN, Infinity, '5']) invalid({ target: NEAR.name, engine: 'laser', [k]: v }, `laser ${k} ${String(v)}`);
}
// engine-specific params are ignored by other engines (spec: accelG only for photon, laser* only for laser)
for (const id of ['chemical', 'ion', 'ntr', 'fusion', 'sail']) {
  valid({ target: NEAR.name, engine: id, accelG: NaN, laserPower: 0, laserArea: -1 });
}
valid({ target: NEAR.name, engine: 'photon', laserPower: 0, laserArea: NaN });
valid({ target: NEAR.name, engine: 'laser', accelG: NaN });
// never throws on garbage shape
for (const bad of [undefined, null, {}, 5, 'x', [], { target: {}, engine: {} }, { target: NEAR.name, engine: ['ion'] }]) {
  checks++; let r; try { r = planMission(bad); } catch (e) { assert.fail('threw on ' + JSON.stringify(bad) + ': ' + e); }
  // TZ-AMBIG: planMission() with no argument at all is expected to return valid:false, not throw
  ok(r && r.valid === false && typeof r.reason === 'string', 'garbage -> valid:false ' + JSON.stringify(bad));
}
// overflow in a key result -> valid:false (not a NaN/Infinity-carrying success)
{
  const r = plan({ target: NEAR.name, engine: 'photon', accelG: 1e300 });
  ok(r.valid === false || (Number.isFinite(r.tEarth) && Number.isFinite(r.energy) && Number.isFinite(r.fuelMass)), 'huge accelG: refusal or all-finite');
  const r2 = plan({ target: FAR.name, engine: 'photon', accelG: 1e-300 });
  ok(r2.valid === false || (Number.isFinite(r2.tEarth) && Number.isFinite(r2.tShip)), 'tiny accelG: refusal or all-finite');
  const r3 = plan({ target: NEAR.name, engine: 'photon', payload: 1e300, accelG: 10 });
  ok(r3.valid === false || (Number.isFinite(r3.energy) && Number.isFinite(r3.power)), 'huge payload: refusal or all-finite');
}
// TZ-AMBIG: extreme accelG (x>~19 so tanh(x) rounds to 1): the invariant betaMax<1 must still hold if the plan is valid
{
  const r = plan({ target: FAR.name, engine: 'photon', accelG: 1e9 });
  ok(r.valid === false || (r.betaMax < 1 && r.betaMax > 0 && r.tShip > 0 && r.tShip <= r.tEarth), 'accelG=1e9: valid only with betaMax<1');
}

// ---------- target: string vs object ----------
for (const id of ENGINE_IDS) {
  for (const s of [NEAR, FAR, NEIGHBORS[3]]) {
    const a = valid({ target: s.name, engine: id });
    const b = valid({ target: { name: s.name, ly: s.ly }, engine: id });
    eq(a, b, `string vs object target identical (${id}, ${s.name})`);
    eq(a.target.name, s.name, 'target.name'); eq(a.target.ly, s.ly, 'target.ly'); eq(a.D, s.ly * LY, 'D = ly*LY');
    eq(a.engineId, id, 'engineId echo');
  }
}
// TZ-AMBIG: an object target with a name not in NEIGHBORS but a valid ly is accepted as given (spec: "объект {name, ly}")
{
  const r = valid({ target: { name: 'Custom', ly: 5 }, engine: 'photon' });
  eq(r.target.name, 'Custom'); eq(r.D, 5 * LY, 'custom object D');
}

// ---------- defaults ----------
{
  const a = valid({ target: NEAR.name, engine: 'photon' });
  const b = valid({ target: NEAR.name, engine: 'photon', payload: DEFAULTS.payload, budget: DEFAULTS.budget, accelG: DEFAULTS.accelG, brake: true });
  eq(a, b, 'omitted params = DEFAULTS (photon)');
  eq(a.budget, DEFAULTS.budget, 'budget echo default'); eq(a.brake, true, 'brake defaults to true');
  const c = valid({ target: NEAR.name, engine: 'laser' });
  const d = valid({ target: NEAR.name, engine: 'laser', laserPower: DEFAULTS.laserPower, laserArea: DEFAULTS.laserArea, payload: DEFAULTS.payload });
  eq(c, d, 'omitted params = DEFAULTS (laser)');
  const e = valid({ target: NEAR.name, engine: 'ion', brake: undefined });
  eq(e.brake, true, 'brake:undefined -> default true');
}

// ---------- purity ----------
{
  const inp = Object.freeze({ target: Object.freeze({ name: NEAR.name, ly: NEAR.ly }), engine: 'fusion', payload: 500, brake: false });
  const a = valid(inp), b = valid(inp);
  eq(a, b, 'deterministic');
  const out = valid({ target: NEAR.name, engine: 'ion' });
  eq(JSON.parse(JSON.stringify(out)).tEarth, out.tEarth, 'JSON-safe numbers (finite)');
}

// ---------- universal invariants: 7 engines x {nearest, farthest} x brake ----------
function universal(r, tag) {
  ok(r.valid === true, tag + ' valid');
  ok(r.betaMax >= 0 && r.betaMax < 1, tag + ' 0<=betaMax<1: ' + r.betaMax);
  ok(r.gammaMax >= 1 && Number.isFinite(r.gammaMax), tag + ' gammaMax>=1');
  near(r.gammaMax, gam(r.betaMax * C), 1e-9, tag + ' gammaMax = 1/sqrt(1-beta^2)');
  near(r.vMax, r.betaMax * C, 1e-12, tag + ' vMax = betaMax*c');
  ok(r.tShip > 0 && r.tShip <= r.tEarth, tag + ` 0<tShip<=tEarth: ${r.tShip} ${r.tEarth}`);
  ok(Number.isFinite(r.tEarth) && Number.isFinite(r.tShip), tag + ' finite times');
  ok(r.tEarth * C >= r.D * (1 - 1e-12), tag + ' tEarth >= D/c');
  ok(r.energy >= 0 && Number.isFinite(r.energy), tag + ' energy>=0');
  ok(r.fuelMass >= 0 && Number.isFinite(r.fuelMass), tag + ' fuelMass>=0');
  ok(r.power >= 0 && Number.isFinite(r.power), tag + ' power>=0');
  ok(r.dv >= r.vMax * (1 - 1e-12), tag + ' dv>=vMax');
  ok(r.massRatio >= 1, tag + ' massRatio>=1');
  if (r.brake) {
    ok(r.brakeLoss !== null && r.brakeLoss >= 0 && r.brakeLoss < 1, tag + ' brakeLoss in [0,1)');
    eq(r.arrivalSpeed, 0, tag + ' arrivalSpeed 0 when braking');
    ok(!r.flags.includes('flyby'), tag + ' no flyby flag when braking');
  } else {
    eq(r.brakeLoss, null, tag + ' brakeLoss null when !brake');
    near(r.arrivalSpeed, r.vMax, 1e-9, tag + ' flyby arrivalSpeed = vMax');
    ok(r.flags.includes('flyby'), tag + ' flyby flag');
  }
  eq(r.flags.includes('relativistic'), r.betaMax > 0.1, tag + " 'relativistic' iff betaMax>0.1");
  eq(r.withinBudget, r.energy <= r.budget, tag + ' withinBudget');
  eq(r.flags.includes('overBudget'), !r.withinBudget, tag + " 'overBudget' iff !withinBudget");
  near(r.budgetRatio, r.energy / r.budget, 1e-12, tag + ' budgetRatio');
  ok(r.flags.every((f) => typeof f === 'string'), tag + ' flags are strings');
  eq(new Set(r.flags).size, r.flags.length, tag + ' no duplicate flags');
}
for (const id of ENGINE_IDS) for (const s of [NEAR, FAR]) for (const brake of [true, false]) {
  const r = valid({ target: s.name, engine: id, brake });
  universal(r, `[${id}/${s.name}/brake=${brake}]`);
  eq(r.brake, brake && canBrake(id), 'effective brake ' + id);
}
// also with non-default photon accel and big payloads
for (const g of [1e-6, 1e-3, 0.5, 1, 3, 10, 100]) for (const s of [NEAR, FAR]) for (const brake of [true, false]) {
  universal(valid({ target: s.name, engine: 'photon', accelG: g, brake }), `[photon g=${g} ${s.name} ${brake}]`);
}

// ---------- sail / laser cannot brake ----------
for (const id of ['sail', 'laser']) for (const s of [NEAR, FAR]) {
  const r = valid({ target: s.name, engine: id, brake: true });
  eq(r.brake, false, id + ' brake downgraded'); ok(r.flags.includes('cannotBrake'), id + " 'cannotBrake'"); ok(r.flags.includes('flyby'), id + " 'flyby'");
  eq(r.fuelMass, 0, id + ' fuelMass 0'); eq(r.brakeLoss, null, id + ' brakeLoss null'); eq(r.massRatio, 1, id + ' massRatio 1');
  const r2 = valid({ target: s.name, engine: id, brake: false });
  ok(!r2.flags.includes('cannotBrake'), id + ": no 'cannotBrake' when brake not requested"); ok(r2.flags.includes('flyby'), id + ' flyby');
  eq({ ...r2, flags: [] }, { ...r, flags: [] }, id + ' brake:true == brake:false except flags');
  eq(r2.flags.slice().sort(), r.flags.filter((f) => f !== 'cannotBrake').sort(), id + ' flags differ only by cannotBrake');
}
// rockets / photon never raise cannotBrake
for (const id of ['chemical', 'ion', 'ntr', 'fusion', 'photon']) for (const brake of [true, false]) {
  ok(!valid({ target: NEAR.name, engine: id, brake }).flags.includes('cannotBrake'), id + ' no cannotBrake');
}

// ---------- rockets: consistency with engines.js ----------
for (const e of ROCKETS) for (const s of [NEAR, FAR]) for (const payload of [1, 1000, 123456]) for (const brake of [true, false]) {
  const tag = `[${e.id}/${s.name}/m=${payload}/brake=${brake}]`;
  const D = Dof(s), ref = propulsiveTrip(e, payload, D, { brake });
  const r = valid({ target: s.name, engine: e.id, payload, brake });
  near(r.tEarth, ref.time, 1e-12, tag + ' tEarth = propulsiveTrip.time');
  near(r.vMax, ref.vCruise, 1e-12, tag + ' vMax = vCruise');
  near(r.dv, ref.dvUsed, 1e-12, tag + ' dv = dvUsed');
  for (const f of ref.flags) ok(r.flags.includes(f), tag + ' core flag ' + f);
  // tShip = tEarth - tCoast (1 - 1/gamma(vCruise)), tCoast = tEarth - tBurn
  const tCoast = ref.time - ref.tBurn;
  near(r.tShip, ref.time - tCoast * (1 - 1 / gam(ref.vCruise)), 1e-9, tag + ' tShip formula');
  // mass bookkeeping
  const ve = e.isp * G0, { m0 } = stageMasses(e, payload);
  const mEnd = m0 * Math.exp(-ref.dvUsed / ve);
  near(r.fuelMass, m0 - mEnd, 1e-9, tag + ' fuelMass = m0 - mEnd');
  ok(r.fuelMass <= e.propMass * (1 + 1e-9), tag + ' fuelMass <= propMass');
  near(r.massRatio, m0 / mEnd, 1e-9, tag + ' massRatio');
  near(r.energy, 0.5 * r.fuelMass * ve * ve, 1e-9, tag + ' energy = 1/2 fuel ve^2');
  near(r.power, 0.5 * e.F * ve, 1e-9, tag + ' power = 1/2 F ve');
  if (brake) {
    const mAfter = m0 * Math.exp(-ref.vCruise / ve);
    near(r.brakeLoss, (mAfter - mEnd) / m0, 1e-9, tag + ' brakeLoss');
    ok(r.brakeLoss > 0, tag + ' brakeLoss>0');
    near(r.dv, 2 * r.vMax, 1e-9, tag + ' brake dv = 2 vMax (not distance-limited)');
  } else {
    near(r.dv, r.vMax, 1e-9, tag + ' flyby dv = vMax');
  }
  ok(Math.abs(r.arrivalSpeed - (brake ? 0 : r.vMax)) <= 1e-9 * r.vMax, tag + ' arrivalSpeed');
}
// no-brake fuel <= brake fuel (same total dv, or less)
for (const e of ROCKETS) for (const s of [NEAR, FAR]) {
  const a = valid({ target: s.name, engine: e.id, brake: true }), b = valid({ target: s.name, engine: e.id, brake: false });
  ok(b.fuelMass <= a.fuelMass * (1 + 1e-9), `${e.id}/${s.name} flyby fuel <= braking fuel`);
  ok(b.energy <= a.energy * (1 + 1e-9), `${e.id}/${s.name} flyby energy <= braking energy`);
  ok(b.tEarth <= a.tEarth * (1 + 1e-9), `${e.id}/${s.name} flyby is not slower than braking`);
  ok(b.vMax >= a.vMax * (1 - 1e-9), `${e.id}/${s.name} flyby peak speed >= braking peak speed`);
}
// fusion without braking is relativistic by 0.1c (known from the core), with braking it is not
ok(valid({ target: NEAR.name, engine: 'fusion', brake: false }).flags.includes('relativistic'), 'fusion flyby relativistic flag');
// fuel scales: bigger payload -> never less fuel burnt in absolute terms for the same engine (stage grows)
for (const e of ROCKETS) {
  const a = valid({ target: NEAR.name, engine: e.id, payload: 10 }), b = valid({ target: NEAR.name, engine: e.id, payload: 100000 });
  ok(b.vMax <= a.vMax * (1 + 1e-9), e.id + ' heavier payload is not faster');
}

// ---------- solar sail ----------
for (const s of [NEAR, FAR]) for (const payload of [1, 1000, 50000]) {
  const tag = `[sail/${s.name}/m=${payload}]`;
  const ref = sailTrip(SAILENG, payload, AU, Dof(s));
  const r = valid({ target: s.name, engine: 'sail', payload, brake: false });
  near(r.tEarth, ref.time, 1e-12, tag + ' tEarth'); near(r.vMax, ref.vCruise, 1e-12, tag + ' vMax'); near(r.dv, ref.dvUsed, 1e-12, tag + ' dv');
  near(r.tShip, ref.time / gam(ref.vCruise), 1e-9, tag + ' tShip = tEarth/gamma');
  eq(r.fuelMass, 0, 'fuel 0'); eq(r.power, 0, 'power 0'); eq(r.energy, 0, 'energy 0'); eq(r.massRatio, 1, 'massRatio 1');
  eq(r.withinBudget, true, 'free energy is within budget'); eq(r.budgetRatio, 0, 'budgetRatio 0');
  near(r.arrivalSpeed, r.vMax, 1e-12, 'flyby speed');
}
ok(valid({ target: NEAR.name, engine: 'sail', payload: 10 }).vMax > valid({ target: NEAR.name, engine: 'sail', payload: 1e5 }).vMax, 'lighter payload -> faster sail');

// ---------- laser sail ----------
for (const [P, A, m] of [[100e9, 16, 1000], [1e9, 1, 1], [1e12, 100, 10], [1e14, 100, 1]]) for (const s of [NEAR, FAR]) {
  const tag = `[laser P=${P} A=${A} m=${m} ${s.name}]`;
  const ref = launch({ payload: m, power: P, area: A }, { distance: Dof(s) });
  const r = valid({ target: s.name, engine: 'laser', payload: m, laserPower: P, laserArea: A });
  near(r.tEarth, ref.tFlight, 1e-12, tag + ' tEarth = tFlight'); near(r.tShip, ref.tau, 1e-12, tag + ' tShip = tau');
  near(r.betaMax, ref.betaMax, 1e-12, tag + ' betaMax'); near(r.gammaMax, ref.gammaMax, 1e-12, tag + ' gammaMax');
  near(r.vMax, ref.betaMax * C, 1e-12, tag + ' vMax'); near(r.dv, r.vMax, 1e-12, tag + ' dv = vMax');
  near(r.energy, P * ref.tBeam, 1e-12, tag + ' energy = power*tBeam');
  near(r.power, P, 1e-12, tag + ' power = beam power');
  for (const f of ref.flags) ok(r.flags.includes(f), tag + ' core flag ' + f);
  universal(r, tag);
  ok(r.energy > 0, tag + ' energy>0');
}
{
  const r = valid({ target: NEAR.name, engine: 'laser', payload: 1, laserPower: 1e14, laserArea: 100 });
  ok(r.betaMax > 0.1 && r.flags.includes('relativistic'), 'laser relativistic case flagged (core says beta~0.2)');
  ok(r.tShip < r.tEarth * (1 - 1e-4), 'relativistic laser: noticeable time dilation');
}
// scaling sanity: more power -> faster; heavier payload -> slower
ok(valid({ target: NEAR.name, engine: 'laser', laserPower: 1e12 }).tEarth < valid({ target: NEAR.name, engine: 'laser', laserPower: 1e11 }).tEarth, 'more laser power is faster');
ok(valid({ target: NEAR.name, engine: 'laser', payload: 4000 }).tEarth > valid({ target: NEAR.name, engine: 'laser', payload: 1000 }).tEarth, 'heavier payload is slower');
// laser: the energy for a given sail does not depend on destination while the beam is shorter than D (Lbeam < D)
{
  const a = valid({ target: NEAR.name, engine: 'laser' }), b = valid({ target: FAR.name, engine: 'laser' });
  near(a.energy, b.energy, 1e-9, 'laser energy independent of distance when beam range < D');
  ok(b.tEarth > a.tEarth, 'farther is longer (laser)');
}

// ---------- photon rocket ----------
for (const g of [1e-3, 0.1, 1, 3, 10]) for (const s of [NEAR, FAR, NEIGHBORS[10]]) for (const payload of [1, 1000, 7e5]) {
  const a = g * G0, D = Dof(s);
  // brake
  {
    const tag = `[photon g=${g} ${s.name} m=${payload} brake]`;
    const ref = flightForDistance(a, D), r = valid({ target: s.name, engine: 'photon', accelG: g, payload, brake: true });
    near(r.tShip, ref.tau, 1e-12, tag + ' tau'); near(r.tEarth, ref.T, 1e-12, tag + ' T'); near(r.betaMax, ref.betaMax, 1e-12, tag + ' betaMax');
    near(r.gammaMax, ref.gammaMax, 1e-12, tag + ' gammaMax');
    const x = ref.x;
    near(r.massRatio, Math.exp(2 * x), 1e-9, tag + ' massRatio = e^{2x}');
    near(r.brakeLoss, Math.exp(-x) * (1 - Math.exp(-x)), 1e-9, tag + ' brakeLoss = e^-x (1-e^-x)');
    near(r.fuelMass, payload * (Math.exp(2 * x) - 1), 1e-9, tag + ' fuelMass');
    near(r.energy, r.fuelMass * C * C, 1e-12, tag + ' energy = fuel c^2');
    near(r.power, payload * r.massRatio * a * C, 1e-9, tag + ' power = m0 a c');
    near(r.dv, 2 * r.vMax, 1e-12, tag + ' dv = 2 vMax');
    eq(r.arrivalSpeed, 0, tag + ' arrives at rest');
    ok(r.brakeLoss <= 0.25 + 1e-12, tag + ' brakeLoss <= 1/4 (max of y(1-y))');
  }
  // flyby: half of a 2D flight
  {
    const tag = `[photon g=${g} ${s.name} m=${payload} flyby]`;
    const ref = flightForDistance(a, 2 * D), r = valid({ target: s.name, engine: 'photon', accelG: g, payload, brake: false });
    near(r.tShip, ref.tau / 2, 1e-12, tag + ' tau/2'); near(r.tEarth, ref.T / 2, 1e-12, tag + ' T/2'); near(r.betaMax, ref.betaMax, 1e-12, tag + ' betaMax');
    const x = ref.x;
    near(r.massRatio, Math.exp(x), 1e-9, tag + ' massRatio = e^{x}');
    near(r.fuelMass, payload * (Math.exp(x) - 1), 1e-9, tag + ' fuelMass');
    near(r.energy, r.fuelMass * C * C, 1e-12, tag + ' energy');
    near(r.power, payload * r.massRatio * a * C, 1e-9, tag + ' power');
    near(r.dv, r.vMax, 1e-12, tag + ' dv = vMax');
    near(r.arrivalSpeed, r.vMax, 1e-12, tag + ' arrival = vMax');
    eq(r.brakeLoss, null, tag + ' brakeLoss null');
  }
}
// payload linearity & independence of kinematics from payload
{
  const a = valid({ target: FAR.name, engine: 'photon', payload: 100 }), b = valid({ target: FAR.name, engine: 'photon', payload: 700 });
  near(b.fuelMass / a.fuelMass, 7, 1e-12, 'photon fuelMass ~ payload'); near(b.energy / a.energy, 7, 1e-12, 'energy ~ payload');
  near(b.power / a.power, 7, 1e-12, 'power ~ payload');
  eq(a.tEarth, b.tEarth, 'tEarth independent of payload'); eq(a.tShip, b.tShip, 'tShip independent of payload'); eq(a.massRatio, b.massRatio, 'massRatio independent of payload');
}
// Newtonian limit: tiny acceleration, nearest star
{
  const g = 1e-6, a = g * G0, D = Dof(NEAR);
  for (const brake of [true, false]) {
    const r = valid({ target: NEAR.name, engine: 'photon', accelG: g, brake });
    ok(r.betaMax < 0.1 && !r.flags.includes('relativistic'), 'newtonian limit not relativistic');
    ok(Math.abs(r.tShip / r.tEarth - 1) < 2e-3, 'newtonian limit tShip/tEarth -> 1: ' + r.tShip / r.tEarth);
    // brake: accelerate D/2, decelerate D/2 => 2 sqrt(D/a); flyby: constant a over D => sqrt(2D/a)
    const t0 = brake ? 2 * Math.sqrt(D / a) : Math.sqrt(2 * D / a);
    near(r.tEarth, t0, 5e-3, `newtonian tEarth ${brake ? '2sqrt(D/a)' : 'sqrt(2D/a)'}`);
    near(r.massRatio, brake ? 1 + 2 * r.betaMax * 1 : 1 + r.betaMax, 5e-2, 'newtonian massRatio ~ 1+dv/c'); // TZ-AMBIG: e^{dv/c} ~ 1 + dv/c for tiny dv
  }
}
// ultra-relativistic: g=10, farthest star
{
  const r = valid({ target: FAR.name, engine: 'photon', accelG: 10, brake: true });
  ok(r.betaMax < 1 && r.betaMax > 0.999, 'ultra: beta ~ 1 but strictly < 1: ' + r.betaMax);
  ok(r.tShip < 0.1 * r.tEarth, 'ultra: tShip << tEarth ' + r.tShip / r.tEarth);
  ok(r.tEarth >= r.D / C && r.tEarth < 1.2 * r.D / C + 4 * C / (10 * G0), 'ultra: tEarth just above D/c');
  ok(r.flags.includes('relativistic'), 'ultra: relativistic flag');
  // an interstellar trip at 1g to the farthest star: still tShip well below tEarth
  const r1 = valid({ target: FAR.name, engine: 'photon', accelG: 1, brake: true });
  ok(r1.tShip < 0.5 * r1.tEarth && r1.tShip > 0, '1g far: dilation');
}
// monotonicity: farther -> longer; larger acceleration -> not slower (Earth) and shorter ship time
{
  const sorted = NEIGHBORS.slice().sort((p, q) => p.ly - q.ly);
  let prev = 0, prevShip = 0;
  for (const s of sorted) {
    const r = valid({ target: s.name, engine: 'photon' });
    ok(r.tEarth >= prev && r.tShip >= prevShip, 'photon times non-decreasing with distance @ ' + s.name); prev = r.tEarth; prevShip = r.tShip;
  }
  let pe = Infinity, ps = Infinity;
  for (const g of [0.1, 0.3, 1, 3, 10, 30]) {
    const r = valid({ target: FAR.name, engine: 'photon', accelG: g });
    ok(r.tEarth <= pe && r.tShip <= ps, 'photon times non-increasing with accel @ g=' + g); pe = r.tEarth; ps = r.tShip;
  }
}

// ---------- budget affects ONLY withinBudget / budgetRatio / 'overBudget' (+ the echoed budget) ----------
const strip = (r) => { const { budget, withinBudget, budgetRatio, flags, ...rest } = r; return { rest, flags: flags.filter((f) => f !== 'overBudget') }; };
for (const id of ENGINE_IDS) for (const brake of [true, false]) {
  const r0 = valid({ target: NEAR.name, engine: id, brake });
  for (const b of [1e-3, 1, 1e10, 1e18, 1e21, 1e30, 1e300]) {
    const r = valid({ target: NEAR.name, engine: id, brake, budget: b });
    eq(strip(r), strip(r0), `budget ${b} changes only budget fields (${id}, brake=${brake})`);
    eq(r.budget, b, 'budget echo'); eq(r.withinBudget, r.energy <= b, 'withinBudget'); near(r.budgetRatio, r.energy / b, 1e-12, 'budgetRatio');
    eq(r.flags.includes('overBudget'), r.energy > b, "'overBudget' flag");
  }
  // boundary energy == budget -> within
  const at = valid({ target: NEAR.name, engine: id, brake, budget: r0.energy > 0 ? r0.energy : 1 });
  eq(at.withinBudget, true, `energy == budget is within (${id})`);
  ok(!at.flags.includes('overBudget'), 'no overBudget at boundary');
  if (r0.energy > 0) {
    near(at.budgetRatio, 1, 1e-12, 'budgetRatio=1 at boundary');
    const below = valid({ target: NEAR.name, engine: id, brake, budget: r0.energy * (1 - 1e-9) });
    eq(below.withinBudget, false, `budget just below energy is over (${id})`); ok(below.flags.includes('overBudget'), 'overBudget just below');
    ok(below.budgetRatio > 1, 'ratio > 1 just below');
    const above = valid({ target: NEAR.name, engine: id, brake, budget: r0.energy * (1 + 1e-9) });
    eq(above.withinBudget, true, 'just above is within');
  }
}
// default budget 1e21 J: fusion/photon to a far star blow it, a sail does not
ok(valid({ target: FAR.name, engine: 'photon' }).withinBudget === false, 'photon to the farthest star exceeds default budget');
ok(valid({ target: NEAR.name, engine: 'sail' }).withinBudget === true, 'sail within default budget');

// ---------- property sweep (seeded PRNG): invariants over random valid inputs ----------
{
  let s = 123456789;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const logu = (lo, hi) => Math.exp(Math.log(lo) + rnd() * (Math.log(hi) - Math.log(lo)));
  for (let i = 0; i < 300; i++) {
    const star = NEIGHBORS[Math.floor(rnd() * NEIGHBORS.length)], id = ENGINE_IDS[Math.floor(rnd() * ENGINE_IDS.length)];
    const o = { target: star.name, engine: id, payload: logu(0.1, 1e7), brake: rnd() < 0.5, budget: logu(1e5, 1e30) };
    if (id === 'photon') o.accelG = logu(1e-4, 50);
    if (id === 'laser') { o.laserPower = logu(1e8, 1e14); o.laserArea = logu(0.5, 1e3); }
    const r = plan(o);
    if (!r.valid) { ok(typeof r.reason === 'string', 'refusal has reason'); continue; } // refusals are allowed only for overflow-like cases
    universal(r, '[prop ' + JSON.stringify(o) + ']');
    const r2 = plan({ ...o, budget: o.budget * 3 });
    eq(strip(r2), strip(r), 'budget-only change (random)');
  }
}

// ---------- summarize ----------
for (const lang of ['ru', 'en']) {
  for (const id of ENGINE_IDS) {
    const out = summarize(valid({ target: NEAR.name, engine: id }), lang);
    ok(Array.isArray(out) && out.length > 0, `summarize ${id}/${lang} returns a non-empty array`);
  }
}

console.log(`mission.contract: ${checks} checks passed`);
