// "Ship communications" module — CONTRACT tests: light-time delay and longitudinal Doppler.
// Written from the contract with independent reference formulas (computed here in plain
// beta/gamma form, units SI), plus identities between outputs.
import assert from 'node:assert/strict';
import { C, YEAR, LY, AU, DAY } from '../js/physics/constants.js';
import { STARS } from '../js/data/stars.js';
import {
  CARRIERS, TARGETS, resolveBeta, gammaOf, oneWayDelay, roundTripDelay, chaseDelay, pingDelay,
  dopplerFactor, dopplerParts, receivedFrequency, wavelength, commsState, humanDuration,
  distFromSlider, sliderFromDist, epsFromSlider, sliderFromEps, EPS_MIN,
} from '../js/physics/comms.js';

let checks = 0;
const rel = (a, b) => Math.abs(a - b) / (Math.abs(b) || 1);
const near = (a, b, tol, msg) => { checks++; assert.ok(rel(a, b) <= tol, `${msg}: ${a} vs ${b} (rel ${rel(a, b)})`); };
const ok = (c, msg) => { checks++; assert.ok(c, msg); };
const throwsRange = (fn, msg) => { checks++; assert.throws(fn, (e) => e instanceof RangeError, msg); };

// Independent references (textbook form)
const refGamma = (b) => 1 / Math.sqrt(1 - b * b);
const refRed = (b) => Math.sqrt((1 - b) / (1 + b));
const refBlue = (b) => Math.sqrt((1 + b) / (1 - b));

// ---------- static light-time ----------
near(oneWayDelay(LY), YEAR, 1e-12, '1 ly -> exactly 1 Julian year');
near(roundTripDelay(LY), 2 * YEAR, 1e-12, 'round trip 1 ly = 2 years');
near(oneWayDelay(AU), 499.00478, 1e-7, '1 AU ~ 499.005 s');
near(oneWayDelay(3.844e8), 1.2823, 2e-4, 'Moon ~ 1.28 s');
near(oneWayDelay(C), 1, 1e-15, 'd = c * 1 s');
{
  const prox = STARS.find((s) => s.name === 'Proxima Centauri');
  near(prox.ly, 4.2465, 1e-12, 'Proxima in data is 4.2465 ly');
  near(oneWayDelay(prox.ly * LY) / YEAR, 4.2465, 1e-12, 'Proxima delay 4.2465 years');
  near(roundTripDelay(prox.ly * LY) / YEAR, 8.493, 1e-12, 'Proxima ping 8.493 years');
}
for (const d of [1, 1e3, AU, 7.7 * LY]) near(roundTripDelay(d), 2 * oneWayDelay(d), 1e-15, 'round = 2 * one way');
{ let prev = 0; for (const d of [1, 10, 1e6, AU, LY, 50 * LY]) { const t = oneWayDelay(d); ok(t > prev, 'delay monotone in d'); prev = t; } }
for (const d of [0, -1, NaN, Infinity, -Infinity, '5', undefined]) {
  throwsRange(() => oneWayDelay(d), `oneWay d=${d}`);
  throwsRange(() => roundTripDelay(d), `round d=${d}`);
}

// ---------- Doppler: closed-form values ----------
near(dopplerFactor({ beta: 0.6 }), 0.5, 1e-14, 'receding beta=0.6 -> 0.5');
near(dopplerFactor({ beta: 0.6, receding: false }), 2, 1e-14, 'approaching beta=0.6 -> 2');
near(dopplerFactor({ beta: 0.8 }), 1 / 3, 1e-14, 'receding beta=0.8 -> 1/3');
near(dopplerFactor({ beta: 0.8, receding: false }), 3, 1e-14, 'approaching beta=0.8 -> 3');
near(dopplerFactor({ beta: 0 }), 1, 1e-15, 'beta=0 -> 1 (receding)');
near(dopplerFactor({ beta: 0, receding: false }), 1, 1e-15, 'beta=0 -> 1 (approaching)');
for (const b of [1e-9, 1e-4, 0.1, 0.3, 0.5, 0.9, 0.99, 0.999]) {
  const r = dopplerFactor({ beta: b }), a = dopplerFactor({ beta: b, receding: false });
  near(r, refRed(b), 1e-11, `red vs sqrt((1-b)/(1+b)) b=${b}`);
  near(a, refBlue(b), 1e-11, `blue vs sqrt((1+b)/(1-b)) b=${b}`);
  near(r * a, 1, 1e-13, `red * blue = 1 at b=${b}`);
  ok(r < 1 && a > 1, `red<1<blue at b=${b}`);
  // D = 1/(gamma (1+b)) receding; D = 1/(gamma (1-b)) approaching
  near(r, 1 / (refGamma(b) * (1 + b)), 1e-11, `D = 1/(gamma(1+b)) b=${b}`);
  near(a, 1 / (refGamma(b) * (1 - b)), 1e-9, `D = 1/(gamma(1-b)) b=${b}`);
  // exp(-rapidity)
  near(r, Math.exp(-Math.atanh(b)), 1e-11, `D = exp(-rapidity) b=${b}`);
  near(a, Math.exp(Math.atanh(b)), 1e-11, `D = exp(+rapidity) b=${b}`);
}
{ // monotone in beta
  let pr = 2, pa = 0;
  for (const b of [0, 0.1, 0.3, 0.6, 0.9, 0.99, 0.9999]) {
    const r = dopplerFactor({ beta: b }), a = dopplerFactor({ beta: b, receding: false });
    ok(r < pr || b === 0, 'receding factor decreases'); ok(a > pa || b === 0, 'approaching factor increases'); pr = r; pa = a;
  }
}

// ---------- gamma ----------
near(gammaOf({ beta: 0 }), 1, 1e-15, 'gamma(0)');
near(gammaOf({ beta: 0.6 }), 1.25, 1e-14, 'gamma(0.6)');
near(gammaOf({ beta: 0.99 }), 7.0888120500833, 1e-9, 'gamma(0.99)');
near(gammaOf({ eps: 0.01 }), gammaOf({ beta: 0.99 }), 1e-12, 'eps and beta agree');
// near light speed: exact answer for eps = 1e-12 is 1/sqrt(eps(2-eps)) ~ 707106.78
near(gammaOf({ eps: 1e-12 }), 1 / Math.sqrt(2e-12 * (1 - 5e-13)), 1e-12, 'gamma eps=1e-12');
{ // and the naive route from beta = 1 - 1e-12 has lost digits; eps route is the trusted one
  const g = gammaOf({ eps: 1e-12 });
  near(g, 707106.7811865, 1e-9, 'gamma ~ 7.071e5 at 1-beta = 1e-12');
}

// ---------- identities: D * gamma * (1 +- beta) = 1, parts ----------
for (const b of [0.2, 0.6, 0.9, 0.999, 0.999999]) for (const receding of [true, false]) {
  const D = dopplerFactor({ beta: b, receding });
  const p = dopplerParts({ beta: b, receding });
  near(p.total, D, 1e-9, `parts product == doppler (b=${b} rec=${receding})`);
  near(p.dilation, 1 / refGamma(b), 1e-9, 'dilation = 1/gamma');
  near(p.kinematic, receding ? 1 / (1 + b) : 1 / (1 - b), 1e-6, 'kinematic = 1/(1 +- b)');
  near(D * gammaOf({ beta: b }) * (receding ? 1 + b : 1 - b), 1, 1e-6, 'D gamma (1 +- b) = 1');
}

// ---------- chase delay ----------
{
  const d0 = 4.2465 * LY;
  near(chaseDelay({ d0, beta: 0 }), oneWayDelay(d0), 1e-14, 'beta=0 chase == static one way');
  near(chaseDelay({ d0, beta: 0, receding: false }), oneWayDelay(d0), 1e-14, 'beta=0 chase approaching == static');
  near(chaseDelay({ d0, beta: 0.5 }), 2 * oneWayDelay(d0), 1e-14, 'beta=0.5 receding -> 2 d0/c');
  near(chaseDelay({ d0, beta: 0.5, receding: false }), oneWayDelay(d0) / 1.5, 1e-14, 'beta=0.5 approaching -> d0/(1.5c)');
  for (const b of [0.1, 0.6, 0.9, 0.99, 0.9999]) {
    const t = chaseDelay({ d0, beta: b });
    // closure: ship at d0 + b c t equals light path c t
    near(C * t, d0 + b * C * t, 1e-9, `receding chase closure b=${b}`);
    // identity: d0/(c(1-b)) = (d0/c) gamma^2 (1+b)
    near(t, (d0 / C) * refGamma(b) ** 2 * (1 + b), 1e-9, `chase = d0/c gamma^2 (1+b) b=${b}`);
    const ta = chaseDelay({ d0, beta: b, receding: false });
    near(C * ta, d0 - b * C * ta, 1e-9, `approach chase closure b=${b}`);
    near(ta, (d0 / C) * refGamma(b) ** 2 * (1 - b), 1e-9, `approach = d0/c gamma^2 (1-b) b=${b}`);
    // doppler relation: chase_rec / chase_appr = ((1+b)/(1-b)) = 1/D_rec^2
    near(t / ta, 1 / dopplerFactor({ beta: b }) ** 2, 1e-9, `chase ratio = 1/D^2 b=${b}`);
    // ping: closure on the echo leg
    const p = pingDelay({ d0, beta: b });
    near(p, 2 * t, 1e-14, 'ping = 2 chase');
    near(p, t + (d0 + b * C * t) / C, 1e-9, `receding ping = out + back b=${b}`);
  }
  { let prev = 0; for (const b of [0, 0.5, 0.9, 0.99, 0.999999, 0.999999999]) { const t = chaseDelay({ d0, beta: b }); ok(t > prev && Number.isFinite(t), 'receding chase grows, finite'); prev = t; } }
  // eps carries precision where 1 - beta cannot: eps=1e-13 -> d0/(c*1e-13)
  near(chaseDelay({ d0, eps: 1e-13 }), d0 / (C * 1e-13), 1e-14, 'chase via eps=1e-13');
}

// ---------- frequency / wavelength ----------
{
  const f0 = 8.4e9;
  near(receivedFrequency(f0, { beta: 0.6 }), 4.2e9, 1e-14, 'X-band at 0.6 receding -> 4.2 GHz');
  near(receivedFrequency(f0, { beta: 0.6, receding: false }), 16.8e9, 1e-14, 'X-band at 0.6 approaching -> 16.8 GHz');
  near(receivedFrequency(f0, { beta: 0 }), f0, 1e-15, 'no shift at rest');
  near(wavelength(f0), 0.035690, 1e-4, 'X-band wavelength ~ 3.569 cm');
  near(wavelength(f0) * f0, C, 1e-15, 'lambda f = c');
  near(wavelength(receivedFrequency(f0, { beta: 0.6 })), 2 * wavelength(f0), 1e-14, 'red: lambda doubles at D=0.5');
  ok(CARRIERS.map((c) => c.hz).join() === '2300000000,8400000000,32000000000', 'S, X, Ka carriers');
  throwsRange(() => receivedFrequency(0, { beta: 0.1 }), 'f0=0');
  throwsRange(() => receivedFrequency(NaN, { beta: 0.1 }), 'f0=NaN');
  throwsRange(() => wavelength(-1), 'lambda f<0');
}

// ---------- commsState ----------
{
  const s = commsState({ d: 4.2465 * LY, beta: 0.6, receding: true, f0: 8.4e9 });
  near(s.oneWay / YEAR, 4.2465, 1e-12, 'state oneWay');
  near(s.roundTrip / YEAR, 8.493, 1e-12, 'state roundTrip');
  near(s.doppler, 0.5, 1e-14, 'state doppler'); ok(s.shift === 'red', 'red shift label');
  near(s.fRx, 4.2e9, 1e-14, 'state fRx');
  near(s.lambdaRx, 2 * s.lambdaTx, 1e-14, 'state lambda');
  near(s.parts.total, s.doppler, 1e-12, 'state parts');
  near(s.chase, 4.2465 * LY / (C * 0.4), 1e-12, 'state chase');
  const b = commsState({ d: LY, beta: 0.6, receding: false, f0: 2.3e9 });
  ok(b.shift === 'blue', 'blue shift label'); near(b.doppler, 2, 1e-14, 'blue 2.0');
  ok(commsState({ d: LY, beta: 0, f0: 2.3e9 }).shift === 'none', 'no shift at rest');
  for (const v of Object.values(s)) if (typeof v === 'number') ok(Number.isFinite(v), 'state values finite');
}

// ---------- boundary beta: finite or explicit error, never silent NaN ----------
for (const bad of [-0.1, -1e-12, 1, 1.0000001, 2, NaN, Infinity, -Infinity, '0.5', null, undefined]) {
  throwsRange(() => dopplerFactor({ beta: bad }), `doppler beta=${bad}`);
  throwsRange(() => gammaOf({ beta: bad }), `gamma beta=${bad}`);
  throwsRange(() => chaseDelay({ d0: LY, beta: bad }), `chase beta=${bad}`);
  throwsRange(() => commsState({ d: LY, beta: bad, f0: 8.4e9 }), `state beta=${bad}`);
}
for (const bad of [0, -1e-5, 1.5, NaN, Infinity]) throwsRange(() => dopplerFactor({ eps: bad }), `eps=${bad}`);
throwsRange(() => dopplerFactor({}), 'no beta/eps');
throwsRange(() => chaseDelay({ d0: 0, beta: 0.5 }), 'd0=0');
throwsRange(() => chaseDelay({ d0: NaN, beta: 0.5 }), 'd0=NaN');
for (const b of [0, 0.999999999, 1 - 1e-15]) for (const receding of [true, false]) {
  const D = dopplerFactor({ beta: b, receding }), t = chaseDelay({ d0: AU, beta: b, receding });
  ok(Number.isFinite(D) && D > 0, `doppler finite b=${b}`); ok(Number.isFinite(t) && t > 0, `chase finite b=${b}`);
}
near(dopplerFactor({ beta: 0.999999999 }), refRed(0.999999999), 1e-6, 'doppler b=0.999999999 close to textbook (loose: textbook loses digits)');
near(dopplerFactor({ eps: 1e-12 }), Math.sqrt(1e-12 / (2 - 1e-12)), 1e-14, 'doppler eps=1e-12');

// ---------- humanDuration ----------
{
  const cases = [[0.5, 's', 0.5], [1.28, 's', 1.28], [59.9, 's', 59.9], [60, 'min', 1], [499, 'min', 499 / 60], [3600, 'h', 1],
    [86400, 'd', 1], [DAY * 364, 'd', 364], [YEAR, 'yr', 1], [4.2465 * YEAR, 'yr', 4.2465], [0, 's', 0]];
  for (const [sec, unit, val] of cases) { const h = humanDuration(sec); ok(h.unit === unit, `unit for ${sec}: ${h.unit}`); if (val === 0) ok(h.value === 0, 'zero'); else near(h.value, val, 1e-12, `humanDuration value ${sec}`); }
  ok(humanDuration(oneWayDelay(AU)).unit === 'min', '1 AU in minutes');
  for (const bad of [-1, NaN, Infinity, '1']) throwsRange(() => humanDuration(bad), `human ${bad}`);
}

// ---------- targets: from data, real values ----------
{
  ok(TARGETS.length >= 6 + STARS.length, 'targets include planets and all stars');
  const prox = TARGETS.find((t) => t.id === 'star-Proxima Centauri');
  near(prox.m, 4.2465 * LY, 1e-12, 'Proxima target = stars.js'); ok(typeof prox.ru === 'string' && prox.ru.length > 0, 'ru name');
  ok(TARGETS.some((t) => t.id.startsWith('star-Sirius')) && TARGETS.some((t) => t.id.startsWith('star-Alpha')), 'Sirius and Alpha Cen present');
  const ids = TARGETS.map((t) => t.id); ok(new Set(ids).size === ids.length, 'unique ids');
  for (const t of TARGETS) ok(Number.isFinite(t.m) && t.m > 0 && t.en && t.ru, `target ${t.id} sane`);
  const g = (id) => TARGETS.find((t) => t.id === id).m;
  ok(g('mars-min') < g('mars-max') && g('jupiter-min') < g('jupiter-max'), 'min < max');
  near(oneWayDelay(g('mars-min')) / 60, 3.03, 5e-3, 'Mars closest ~3.03 light-minutes');
  near(oneWayDelay(g('mars-max')) / 60, 22.3, 5e-3, 'Mars farthest ~22.3 light-minutes');
}

// ---------- slider helpers ----------
near(distFromSlider(0), AU, 1e-12, 'dist slider 0 = 1 AU');
near(distFromSlider(1000), 100 * LY, 1e-12, 'dist slider 1000 = 100 ly');
near(distFromSlider(500), Math.sqrt(AU * 100 * LY), 1e-12, 'dist slider midpoint geometric');
for (const s of [0, 137, 500, 999, 1000]) near(sliderFromDist(distFromSlider(s)) || 1e-300, s || 1e-300, 1e-9, `dist roundtrip ${s}`);
ok(sliderFromDist(1) === 0 && sliderFromDist(1e30) === 1000, 'dist slider clamps');
ok(epsFromSlider(0) === 1, 'beta slider 0 -> eps 1 (beta 0)');
near(epsFromSlider(1000), EPS_MIN, 1e-12, 'beta slider max -> beta 0.99999');
for (const s of [0, 250, 777, 1000]) near(sliderFromEps(epsFromSlider(s)) || 1e-300, s || 1e-300, 1e-9, `eps roundtrip ${s}`);
{ let prev = 2; for (let s = 0; s <= 1000; s += 50) { const e = epsFromSlider(s); ok(e <= prev, 'eps monotone'); prev = e; } }
ok(resolveBeta({ eps: epsFromSlider(1000) }).beta < 1, 'slider top still beta<1');
throwsRange(() => distFromSlider(NaN), 'slider NaN'); throwsRange(() => epsFromSlider(NaN), 'eps slider NaN');

console.log(`comms.contract: ${checks} checks passed`);
