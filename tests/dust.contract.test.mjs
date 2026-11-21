// "Dust & shield" page — CONTRACT tests written from the TZ ("Ядро js/physics/dust.js"), blind to the implementation.
// Reference values are recomputed independently here from the TZ formulas (stable gamma-1 form).
// Invariants: E_H(0.05)~1.1757 MeV, E_H(0.5)~145.2 MeV; E/(1/2 m v^2)=1+3/4 b^2+O(b^4); no cancellation at tiny beta;
// grain mass 4/3 pi r^3 rho; beta in [0.05,0.5] inclusive; depth linear in ly and nH, strictly increasing in beta;
// shield: thickness=SAFETY*depth, shieldMass=rho*A*thickness; every function NEVER throws.
import assert from 'node:assert/strict';
import { C, LY } from '../js/physics/constants.js';
import * as D from '../js/physics/dust.js';
import { planMission } from '../js/physics/mission.js';

let checks = 0;
const rel = (a, b) => Math.abs(a - b) / (Math.abs(b) || 1);
const near = (a, b, tol, msg) => { checks++; assert.ok(rel(a, b) <= tol, `${msg}: ${a} vs ${b} (rel ${rel(a, b)})`); };
const ok = (c, msg) => { checks++; assert.ok(c, msg); };
const call = (f, ...a) => { checks++; try { return f(...a); } catch (e) { assert.fail(`${f.name} threw: ${e} for ${JSON.stringify(a)}`); } };
const invalid = (r, msg) => ok(r && r.valid === false && typeof r.reason === 'string' && r.reason.length > 0, `expected valid:false+reason (${msg}) got ${JSON.stringify(r)}`);
const valid = (r, msg) => ok(r && r.valid === true, `expected valid:true (${msg}) got ${JSON.stringify(r)}`);

// independent references
const MH = 1.6735575e-27, MU = 1.4, NA = 6.02214076e23, EVJ = 1.602176634e-19, TNT = 4.184e6;
const g1 = (b) => { const s = Math.sqrt(1 - b * b); return (b * b) / (s * (1 + s)); }; // gamma-1, stable
const KE = (m, b) => g1(b) * m * C * C;
const MAT = { graphite: { rho: 2200, Q: 5.9e7, A: 12.011 }, beryllium: { rho: 1850, Q: 3.3e7, A: 9.012 }, aluminium: { rho: 2700, Q: 1.2e7, A: 26.98 } };
function refDepth({ beta, ly, nH = 0.1, material = 'graphite', dustToGas = 0.01 }) {
  const m = MAT[material], col = nH * 1e6 * ly * LY;
  const dust = g1(beta) * C * C * dustToGas * col * MU * MH / m.Q;
  const gas = 0.01 * col * m.A * 1e-3 / NA;
  return (dust + gas) / m.rho;
}

// ---------- constants ----------
near(D.M_H, 1.6735575e-27, 1e-12, 'M_H'); near(D.MU_GAS, 1.4, 1e-12, 'MU_GAS');
ok(D.BETA_MIN === 0.05 && D.BETA_MAX === 0.5, 'beta range');
near(D.GRAIN_DENSITY, 2500, 1e-12, 'GRAIN_DENSITY'); near(D.GRAIN_RADIUS_DEFAULT, 0.1e-6, 1e-12, 'GRAIN_RADIUS_DEFAULT');
near(D.DUST_TO_GAS, 0.01, 1e-12, 'DUST_TO_GAS'); near(D.N_H_DEFAULT, 0.1, 1e-12, 'N_H_DEFAULT');
near(D.TNT_KG_J, 4.184e6, 1e-12, 'TNT'); near(D.EV_J, 1.602176634e-19, 1e-12, 'EV_J');
near(D.SPUTTER_YIELD, 0.01, 1e-12, 'SPUTTER'); ok(D.SAFETY === 2, 'SAFETY');
for (const k of Object.keys(MAT)) for (const f of ['rho', 'Q', 'A']) near(D.MATERIALS[k][f], MAT[k][f], 1e-12, `MATERIALS.${k}.${f}`);

// ---------- gamma / kineticEnergy ----------
near(call(D.gammaOfBeta, 0.5), 1.1547005384, 1e-9, 'gamma(0.5)');
near(call(D.gammaOfBeta, 0), 1, 1e-15, 'gamma(0)');
for (const b of [0.05, 0.1, 0.3, 0.5, 0.9]) near(D.gammaOfBeta(b), 1 / Math.sqrt(1 - b * b), 1e-12, 'gamma ' + b);
near(call(D.kineticEnergy, MH, 0.5) / (EVJ * 1e6), 145.2, 1e-3, 'E_H(0.5) ~145.2 MeV');
near(D.kineticEnergy(MH, 0.5) / (EVJ * 1e6), 145.2323870934601, 1e-9, 'E_H(0.5) exact');
near(D.kineticEnergy(MH, 0.5), 2.3268e-11, 1e-3, 'E_H(0.5) J');
near(D.kineticEnergy(MH, 0.05) / (EVJ * 1e6), 1.1752, 1e-3, 'E_H(0.05) ~1.1752 MeV');
near(D.kineticEnergy(MH, 0.05) / (EVJ * 1e6), 1.175701034248838, 1e-9, 'E_H(0.05) exact');
{
  const b = 0.05, v = b * C, cl = 0.5 * MH * v * v;
  near(D.kineticEnergy(MH, b) / cl, 1 + 0.75 * b * b, 1e-5, 'classical limit 1+3/4 b^2');
  ok(D.kineticEnergy(MH, b) / cl > 1, 'relativistic exceeds classical');
}
for (const b of [1e-8, 1e-6, 1e-4]) {
  const v = b * C, cl = 0.5 * 2.5 * v * v;
  near(D.kineticEnergy(2.5, b) / cl, 1, 1e-9, 'stable small-beta ' + b);
}
near(D.kineticEnergy(3, 0.3), KE(3, 0.3), 1e-12, 'KE scalar m');
near(D.kineticEnergy(2 * MH, 0.2), 2 * D.kineticEnergy(MH, 0.2), 1e-12, 'KE linear in m');
{ let prev = 0; for (let b = 0.01; b < 0.99; b += 0.02) { const e = D.kineticEnergy(1, b); ok(e > prev, 'KE strictly increasing ' + b); prev = e; } }

// ---------- grainMass ----------
near(call(D.grainMass, 0.1e-6), 1.0472e-17, 1e-4, 'grain mass r=0.1um');
near(D.grainMass(0.1e-6), (4 / 3) * Math.PI * 1e-21 * 2500, 1e-12, 'grain mass formula');
near(D.grainMass(2e-6), 8 * D.grainMass(1e-6), 1e-12, 'mass ~ r^3');
near(D.grainMass(1e-6, 5000), 2 * D.grainMass(1e-6, 2500), 1e-12, 'mass ~ rho');

// ---------- impact ----------
{
  const r = call(D.impact, { beta: 0.5 });
  valid(r, 'impact 0.5');
  near(r.beta, 0.5, 1e-15, 'impact.beta'); near(r.gamma, 1.1547005384, 1e-9, 'impact.gamma');
  near(r.hydrogen.J, KE(MH, 0.5), 1e-12, 'H J'); near(r.hydrogen.eV, r.hydrogen.J / EVJ, 1e-12, 'H eV');
  near(r.hydrogen.MeV, 145.2323870934601, 1e-9, 'H MeV');
  near(r.grain.mass, 1.0472e-17, 1e-4, 'impact grain mass');
  near(r.grain.J, KE(r.grain.mass, 0.5), 1e-12, 'grain J');
  near(r.grain.tntKg, r.grain.J / TNT, 1e-12, 'tntKg');
  const r2 = call(D.impact, { beta: 0.05, grainRadius: 1e-6 });
  valid(r2, 'impact 0.05');
  near(r2.hydrogen.MeV, 1.175701034248838, 1e-9, 'H MeV 0.05');
  near(r2.grain.mass, D.grainMass(1e-6), 1e-12, 'custom grain radius');
  near(r2.grain.J, KE(D.grainMass(1e-6), 0.05), 1e-12, 'grain J custom');
}
for (const b of [0.0499, 0.5001, 0, -0.1, 1, 2, NaN, Infinity, '0.2', undefined, null, {}, []]) invalid(call(D.impact, { beta: b }), 'impact beta ' + String(b));
invalid(call(D.impact), 'impact no args'); invalid(call(D.impact, null), 'impact null');
invalid(call(D.impact, { beta: 0.2, grainRadius: 0 }), 'radius 0'); invalid(call(D.impact, { beta: 0.2, grainRadius: -1e-7 }), 'radius <0');
invalid(call(D.impact, { beta: 0.2, grainRadius: NaN }), 'radius NaN');
valid(call(D.impact, { beta: 0.05 }), 'beta exactly 0.05'); valid(call(D.impact, { beta: 0.5 }), 'beta exactly 0.5');

// ---------- erosion ----------
const P = { beta: 0.2, ly: 4.2465, nH_cm3: 0.1, material: 'graphite' };
{
  const r = call(D.erosion, P);
  valid(r, 'erosion proxima');
  const L = 4.2465 * LY, nH = 1e5, col = nH * L;
  near(r.L, L, 1e-12, 'L'); near(r.nH, nH, 1e-12, 'nH m^-3'); near(r.columnH, col, 1e-12, 'columnH');
  near(r.gasMassPerArea, col * MU * MH, 1e-12, 'gasMassPerArea');
  near(r.dustMassPerArea, 0.01 * col * MU * MH, 1e-12, 'dustMassPerArea');
  near(r.energyPerArea.gas, g1(0.2) * C * C * r.gasMassPerArea, 1e-10, 'E gas');
  near(r.energyPerArea.dust, g1(0.2) * C * C * r.dustMassPerArea, 1e-10, 'E dust');
  near(r.energyPerArea.total, r.energyPerArea.gas + r.energyPerArea.dust, 1e-12, 'E total');
  near(r.erodedMassPerArea.dust, r.energyPerArea.dust / 5.9e7, 1e-12, 'eroded dust');
  near(r.erodedMassPerArea.gas, 0.01 * col * 12.011 * 1e-3 / NA, 1e-12, 'eroded gas');
  near(r.erodedMassPerArea.total, r.erodedMassPerArea.dust + r.erodedMassPerArea.gas, 1e-12, 'eroded total');
  near(r.depth, r.erodedMassPerArea.total / 2200, 1e-12, 'depth=mass/rho');
  near(r.depth, refDepth(P), 1e-9, 'depth independent recompute');
  near(r.depth, 1.3439875898e-3, 1e-6, 'Proxima 0.2c graphite ~1.344 mm');
  near(r.grainHitsPerArea, r.dustMassPerArea / D.grainMass(D.GRAIN_RADIUS_DEFAULT), 1e-12, 'grain hits');
}
for (const material of Object.keys(MAT)) for (const beta of [0.05, 0.3, 0.5]) {
  const q = { beta, ly: 10, nH_cm3: 0.5, material };
  near(call(D.erosion, q).depth, refDepth(q), 1e-9, `depth ${material} ${beta}`);
}
{
  const q = { beta: 0.3, ly: 4.2465, nH_cm3: 0.1, material: 'beryllium', dustToGas: 0.02 };
  near(call(D.erosion, q).depth, refDepth(q), 1e-9, 'custom dustToGas');
  const d = call(D.erosion, { beta: 0.3, ly: 4, material: 'graphite' });
  near(d.nH, 1e5, 1e-12, 'default nH = 0.1 cm^-3'); near(d.depth, refDepth({ beta: 0.3, ly: 4 }), 1e-9, 'default nH depth');
  const g = call(D.erosion, { beta: 0.3, ly: 4 });
  valid(g, 'default material'); near(g.depth, d.depth, 1e-12, 'default material = graphite');
  near(call(D.erosion, { ...P, grainRadius: 1e-6 }).grainHitsPerArea, call(D.erosion, P).grainHitsPerArea / 1000, 1e-9, 'hits ~ r^-3');
}
// linearity
for (const beta of [0.05, 0.2, 0.5]) {
  const a = call(D.erosion, { beta, ly: 3, nH_cm3: 0.2 }).depth;
  near(call(D.erosion, { beta, ly: 6, nH_cm3: 0.2 }).depth, 2 * a, 1e-12, 'x2 ly');
  near(call(D.erosion, { beta, ly: 3, nH_cm3: 0.4 }).depth, 2 * a, 1e-12, 'x2 nH');
  near(call(D.erosion, { beta, ly: 30, nH_cm3: 0.2 }).depth, 10 * a, 1e-12, 'x10 ly');
}
{
  const r = call(D.erosion, { beta: 0.3, ly: 4, nH_cm3: 0 });
  valid(r, 'nH=0'); ok(r.depth === 0, 'nH=0 depth 0'); ok(r.columnH === 0, 'nH=0 column 0');
}
{ let prev = -1; for (let i = 0; i <= 45; i++) { const b = 0.05 + i * 0.45 / 45; const d = call(D.erosion, { beta: b, ly: 4, nH_cm3: 0.1 }).depth; ok(d > prev, 'depth strictly rising in beta ' + b); prev = d; } }
for (const ly of [0, -1, NaN, Infinity, '4', null, undefined]) invalid(call(D.erosion, { ...P, ly }), 'erosion ly ' + String(ly));
for (const n of [-0.1, -1, NaN, Infinity, '0.1', null]) invalid(call(D.erosion, { ...P, nH_cm3: n }), 'erosion nH ' + String(n));
for (const m of ['unobtainium', '', 'Graphite', 42, null]) invalid(call(D.erosion, { ...P, material: m }), 'erosion material ' + String(m));
for (const b of [0.0499, 0.5001, NaN, 'x', undefined]) invalid(call(D.erosion, { ...P, beta: b }), 'erosion beta ' + String(b));
valid(call(D.erosion, { ...P, beta: 0.05 }), 'erosion beta 0.05'); valid(call(D.erosion, { ...P, beta: 0.5 }), 'erosion beta 0.5');
invalid(call(D.erosion), 'erosion no args'); invalid(call(D.erosion, null), 'erosion null');

// ---------- shield ----------
{
  const S = { ...P, area_m2: 10, payload_kg: 1000 };
  const r = call(D.shield, S);
  valid(r, 'shield');
  const e = call(D.erosion, P);
  near(r.depth, e.depth, 1e-12, 'shield carries erosion depth'); near(r.columnH, e.columnH, 1e-12, 'shield carries columnH');
  near(r.thickness, 2 * r.depth, 1e-12, 'thickness = SAFETY*depth');
  near(r.shieldMass, 2200 * 10 * r.thickness, 1e-12, 'shieldMass = rho*A*t');
  near(r.massRatio, r.shieldMass / 1000, 1e-12, 'massRatio');
  ok(r.heavierThanCraft === (r.shieldMass > 1000), 'heavierThanCraft flag');
  near(r.extraKE, KE(r.shieldMass, 0.2), 1e-10, 'extraKE');
  const d = call(D.shield, P); // defaults area 10, payload 1000
  valid(d, 'shield defaults'); near(d.shieldMass, r.shieldMass, 1e-12, 'default area/payload'); near(d.massRatio, r.massRatio, 1e-12, 'default massRatio');
  const s4 = call(D.shield, { ...S, safety: 4 });
  near(s4.thickness, 4 * s4.depth, 1e-12, 'custom safety');
  near(call(D.shield, { ...S, area_m2: 20 }).shieldMass, 2 * r.shieldMass, 1e-12, 'mass ~ area');
  near(call(D.shield, { ...S, payload_kg: 500 }).massRatio, 2 * r.massRatio, 1e-12, 'ratio ~ 1/payload');
  const be = call(D.shield, { ...S, material: 'beryllium' });
  near(be.shieldMass, 1850 * 10 * be.thickness, 1e-12, 'beryllium rho');
}
{ // heavier flag both ways
  const light = call(D.shield, { ...P, payload_kg: 1e12 }); ok(light.heavierThanCraft === false, 'light shield not heavier');
  const heavy = call(D.shield, { beta: 0.5, ly: 1000, nH_cm3: 10, material: 'aluminium', area_m2: 100, payload_kg: 1 });
  valid(heavy, 'heavy'); ok(heavy.heavierThanCraft === true && heavy.massRatio > 1, 'heavy shield flagged');
}
for (const a of [0, -1, NaN, Infinity, '10', null]) invalid(call(D.shield, { ...P, area_m2: a }), 'shield area ' + String(a));
for (const p of [0, -5, NaN, Infinity, '1000', null]) invalid(call(D.shield, { ...P, payload_kg: p }), 'shield payload ' + String(p));
invalid(call(D.shield, { ...P, ly: 0 }), 'shield ly 0'); invalid(call(D.shield, { ...P, material: 'x' }), 'shield bad material');
invalid(call(D.shield, { ...P, beta: 0.6 }), 'shield beta'); invalid(call(D.shield), 'shield no args'); invalid(call(D.shield, null), 'shield null');
{ const z = call(D.shield, { ...P, nH_cm3: 0 }); valid(z, 'shield nH=0'); ok(z.thickness === 0 && z.shieldMass === 0 && z.extraKE === 0, 'shield nH=0 zeros'); }

// ---------- sweepBeta ----------
{
  const pts = call(D.sweepBeta, { ly: 4.2465, nH_cm3: 0.1, material: 'graphite', area_m2: 10, payload_kg: 1000 });
  ok(Array.isArray(pts) && pts.length === 46, 'default n=46');
  ok(pts[0].beta === 0.05 && pts[45].beta === 0.5, 'endpoints exact');
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    ok(Number.isFinite(p.thickness) && Number.isFinite(p.shieldMass) && Number.isFinite(p.massRatio), 'finite point ' + i);
    if (i) { ok(p.beta > pts[i - 1].beta, 'beta ascending'); ok(p.thickness > pts[i - 1].thickness, 'thickness monotone'); ok(p.shieldMass > pts[i - 1].shieldMass, 'mass monotone'); }
    const s = D.shield({ beta: p.beta, ly: 4.2465, nH_cm3: 0.1, material: 'graphite', area_m2: 10, payload_kg: 1000 });
    near(p.thickness, s.thickness, 1e-12, 'sweep thickness = shield ' + i); near(p.shieldMass, s.shieldMass, 1e-12, 'sweep mass = shield ' + i);
    near(p.massRatio, s.massRatio, 1e-12, 'sweep ratio = shield ' + i);
  }
  for (const n of [2, 3, 10, 101]) {
    const q = call(D.sweepBeta, { ly: 4, nH_cm3: 0.1 }, n);
    ok(q.length === n, 'length n=' + n); ok(q[0].beta === 0.05 && q[n - 1].beta === 0.5, 'endpoints n=' + n);
  }
}
for (const bad of [undefined, null, { ly: 0 }, { ly: 4, material: 'x' }, 5]) { const r = call(D.sweepBeta, bad); ok(Array.isArray(r) || (r && r.valid === false), 'sweep bad input no throw/shape'); }

// ---------- fromMission ----------
{
  const mk = (betaMax) => ({ valid: true, target: { name: 'X', ly: 4.2465 }, betaMax });
  const lo = call(D.fromMission, mk(0.03)); valid(lo, 'fm lo'); ok(lo.betaUsed === 0.05 && lo.clamped === 'below', 'clamp below');
  const hi = call(D.fromMission, mk(0.9)); valid(hi, 'fm hi'); ok(hi.betaUsed === 0.5 && hi.clamped === 'above', 'clamp above');
  const mid = call(D.fromMission, mk(0.2)); valid(mid, 'fm mid'); ok(mid.betaUsed === 0.2 && mid.clamped === null, 'no clamp');
  const e = call(D.fromMission, mk(0.05)); ok(e.betaUsed === 0.05 && e.clamped === null, 'boundary 0.05 not clamped');
  const e2 = call(D.fromMission, mk(0.5)); ok(e2.betaUsed === 0.5 && e2.clamped === null, 'boundary 0.5 not clamped');
  const ref = D.shield({ beta: 0.2, ly: 4.2465, nH_cm3: 0.1, payload_kg: 1000 });
  near(mid.thickness, ref.thickness, 1e-12, 'fromMission = shield at betaUsed');
  near(call(D.fromMission, mk(0.2), { payload: 500 }).massRatio, 2 * mid.massRatio, 1e-9, 'opts.payload');
  invalid(call(D.fromMission, { ...mk(0.2), valid: false }), 'plan invalid');
  invalid(call(D.fromMission, { valid: false, reason: 'x' }), 'plan invalid 2');
  for (const bad of [undefined, null, {}, 5, 'x', { valid: true }, { valid: true, target: { ly: 4 }, betaMax: NaN }, { valid: true, target: { ly: -1 }, betaMax: 0.2 }])
    invalid(call(D.fromMission, bad), 'fromMission bad ' + JSON.stringify(bad));
}
{ // real run through mission.js
  const plan = planMission({ target: 'Proxima Centauri', engine: 'laser' });
  ok(plan && plan.valid === true, 'planMission proxima laser valid: ' + JSON.stringify(plan && plan.reason));
  const r = call(D.fromMission, plan);
  valid(r, 'fromMission real');
  for (const k of ['thickness', 'shieldMass', 'massRatio', 'depth', 'betaUsed']) ok(Number.isFinite(r[k]) && r[k] >= 0, 'finite ' + k);
  ok(r.betaUsed >= 0.05 && r.betaUsed <= 0.5, 'betaUsed in range');
  ok([null, 'below', 'above'].includes(r.clamped), 'clamped enum');
}

// ---------- never throws on garbage ----------
const junk = [undefined, null, NaN, 0, -1, 1e308, -1e308, Infinity, '', 'x', [], {}, () => 1, Symbol('s'), { beta: {} }, { beta: Symbol('b') }];
for (const f of [D.gammaOfBeta, D.kineticEnergy, D.grainMass, D.impact, D.erosion, D.shield, D.sweepBeta, D.fromMission])
  for (const j of junk) { call(f, j); call(f, j, j); }

console.log(`dust.contract: ${checks} checks passed`);
