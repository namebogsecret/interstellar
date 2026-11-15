// "Where we reach in a lifetime" — flip-and-burn at constant proper acceleration.
// Module: js/physics/flight.js, js/data/stars.js, page where-we-reach.html.
// Every check is against analytics/numerics derived INDEPENDENTLY of the module's
// closed forms (exp-form cosh, Simpson integration of the rapidity profile).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { C, G0, YEAR } from '../js/physics/constants.js';
import { LY, flightForTau, flightForDistance, reachable, X_MAX, oneMinusBeta } from '../js/physics/flight.js';
import { STARS } from '../js/data/stars.js';
import { gOf, vOf, fmt, fmtBeta, massLog10, yearWord } from '../js/verify/wwr-view.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let checks = 0;
const rel = (a, b) => Math.abs(a - b) / Math.abs(b);
const near = (a, b, tol, msg) => { checks++; assert.ok(rel(a, b) <= tol, `${msg}: ${a} vs ${b} (rel ${rel(a, b)})`); };
const ok = (c, msg) => { checks++; assert.ok(c, msg); };

// independent exp-form helpers (NOT the module's sinh/asinh forms)
const coshE = (x) => (Math.exp(x) + Math.exp(-x)) / 2;
const sinhE = (x) => (Math.exp(x) - Math.exp(-x)) / 2;

// Independent numeric path: Simpson over the proper-time rapidity profile
// phi(s)=a s/c (accelerate, s<tau/2), phi=a(tau-s)/c (brake). dD/ds = c sinh(phi), dT/ds = cosh(phi).
function simpson(f, lo, hi, n) {
  const h = (hi - lo) / n; let s = f(lo) + f(hi);
  for (let i = 1; i < n; i++) s += f(lo + i * h) * (i % 2 ? 4 : 2);
  return s * h / 3;
}
function numeric(a, tau) {
  const half = tau / 2;
  const D = 2 * simpson((s) => C * sinhE(a * s / C), 0, half, 20000);
  const T = 2 * simpson((s) => coshE(a * s / C), 0, half, 20000);
  return { D, T };
}

// (0) LY constant
near(LY, 299792458 * 365.25 * 86400, 1e-15, 'LY = C*YEAR');

// (a) reference values: 1 g, Proxima 4.2465 ly
{
  const D = 4.2465 * LY;
  const r = flightForDistance(G0, D);
  ok(r.valid, 'valid');
  ok(r.tau / YEAR > 3.5 && r.tau / YEAR < 3.6, `tau ${r.tau / YEAR} y in 3.5-3.6`);
  ok(r.T / YEAR > 5.8 && r.T / YEAR < 5.9, `T ${r.T / YEAR} y in 5.8-5.9`);
  // independent: invert D = (2c^2/a)(cosh x - 1) with exp-form by bisection
  let lo = 0, hi = 20;
  for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; (2 * C * C / G0 * (coshE(m) - 1) < D ? (lo = m) : (hi = m)); }
  near(r.x, lo, 1e-9, 'x vs bisection');
  near(r.tau, 2 * C * lo / G0, 1e-9, 'tau vs bisection');
  near(r.T, 2 * C / G0 * sinhE(lo), 1e-9, 'T vs bisection');
  near(r.gammaMax, coshE(lo), 1e-9, 'gamma max');
  // hand number: 1g/40-year-class sanity: tau=40y at 1g -> D ~ 1.2e4... use forward
  const f = flightForTau(G0, 3.5 * YEAR);
  near(f.D, 2 * C * C / G0 * (coshE(f.x) - 1), 1e-9, 'forward D exp-form');
}

// (b) small x: Newtonian limit D -> a tau^2/4 (2 legs of a (tau/2)^2/2; the brief said /8, which is one leg), T -> tau
{
  const a = 0.1, tau = 1e4; // x = 1.7e-6
  const f = flightForTau(a, tau);
  near(f.D, a * tau * tau / 4, 1e-9, 'Newton D');
  near(f.T, tau, 1e-9, 'Newton T');
  near(f.gammaMax, 1, 1e-9, 'gamma->1');
  const g = flightForTau(G0, 3600 * 24);
  near(g.D, G0 * 86400 ** 2 / 4, 1e-6, 'Newton D, 1 day at 1 g');
}

// (c) large x: T ~ (c/a) e^x, gamma = cosh x, beta -> 1
{
  const a = 10 * G0, tau = 60 * YEAR;
  const f = flightForTau(a, tau);
  ok(f.x > 100, 'x large');
  near(f.T, (C / a) * Math.exp(f.x), 1e-9, 'T ~ (c/a) e^x');
  near(f.gammaMax, Math.exp(f.x) / 2, 1e-9, 'gamma ~ e^x/2');
  ok(f.betaMax <= 1 && f.betaMax > 1 - 1e-12, 'beta -> 1, <= 1');
  ok(Number.isFinite(f.D) && f.D > 0, 'D finite');
  near(f.D, (C * C / a) * Math.exp(f.x), 1e-9, 'D ~ (c^2/a) e^x');
}

// (d) round trip over a in 0.1-10 g, D in 1-100 ly
for (const ag of [0.1, 0.3, 1, 2.5, 10]) {
  for (const dly of [1, 4.2465, 12, 50, 100]) {
    const a = ag * G0, D = dly * LY;
    const inv = flightForDistance(a, D);
    ok(inv.valid, `inverse valid ${ag}g ${dly}ly`);
    const fwd = flightForTau(a, inv.tau);
    ok(fwd.valid, 'forward valid');
    near(fwd.D, D, 1e-9, `round-trip D ${ag}g ${dly}ly`);
    near(fwd.T, inv.T, 1e-9, `round-trip T ${ag}g ${dly}ly`);
    near(fwd.gammaMax, inv.gammaMax, 1e-9, 'round-trip gamma');
  }
}

// (e) monotonicity
{
  let prev = 0;
  for (let t = 1; t <= 80; t += 3) { const f = flightForTau(G0, t * YEAR); ok(f.D > prev, `D grows with tau (${t})`); prev = f.D; }
  prev = 0;
  for (let ag = 0.1; ag <= 10; ag *= 1.3) { const f = flightForTau(ag * G0, 40 * YEAR); ok(f.D > prev, `D grows with a (${ag})`); prev = f.D; }
  // longer distance at fixed a -> more tau and more T; higher a -> less tau for the same D
  let pt = 0, pT = 0;
  for (let d = 1; d <= 100; d += 9) { const r = flightForDistance(G0, d * LY); ok(r.tau > pt && r.T > pT, 'tau,T grow with D'); pt = r.tau; pT = r.T; }
  let ptau = Infinity;
  for (let ag = 0.1; ag <= 10; ag *= 1.5) { const r = flightForDistance(ag * G0, 10 * LY); ok(r.tau < ptau, 'tau falls with a'); ptau = r.tau; }
  // T always >= tau, and T*c >= D (no superluminal)
  for (const [ag, t] of [[0.1, 1], [1, 40], [10, 80], [3, 5]]) {
    const f = flightForTau(ag * G0, t * YEAR);
    ok(f.T >= f.tau, 'T >= tau'); ok(C * f.T >= f.D, 'D <= cT (equality only to double precision)');
  }
}

// (f) identities + independent numeric integration
for (const [ag, t] of [[0.1, 5], [1, 3.6], [1, 40], [3, 10], [10, 2]]) {
  const a = ag * G0, tau = t * YEAR;
  const f = flightForTau(a, tau);
  ok(f.valid, 'valid');
  const g = f.gammaMax, bg = f.betaMax * f.gammaMax;
  // cosh^2 - sinh^2 = 1  (<=> gamma^2 - (beta gamma)^2 = 1); relative to gamma^2 for conditioning
  ok(Math.abs(g * g - bg * bg - 1) <= 1e-12 * g * g + 1e-12, `gamma^2-(beta gamma)^2=1 (${ag}g,${t}y)`);
  // Lorentz-factor from Delta-T / tau relation: T = (2c/a) sinh x vs numeric
  const n = numeric(a, tau);
  near(n.D, f.D, 1e-3, `numeric D (${ag}g,${t}y)`);
  near(n.T, f.T, 1e-3, `numeric T (${ag}g,${t}y)`);
  // tau-integral of dtau/dt: dtau = dt/gamma  -> integrate over coordinate time with v profile
  // closed form check: gamma at midpoint equals sqrt(1+(aT/(2c))^2) up to the coast-free identity
  near(f.gammaMax, Math.sqrt(1 + (a * f.T / (2 * C)) ** 2) * 1, 1e-9, 'gamma = sqrt(1+(aT/2c)^2)');
}

// (g) garbage input
{
  for (const bad of [NaN, -1, 0, Infinity, -Infinity, 1e300, '1', null, undefined]) {
    for (const [a, t] of [[bad, YEAR], [G0, bad]]) {
      const f = flightForTau(a, t);
      ok(f.valid === false && typeof f.reason === 'string' && f.reason.length > 0, `flightForTau refuses ${String(bad)}`);
      if (bad === 1e300) continue; // 1e300 m / 1e300 m/s^2 is finite and below the overflow guard
      const r = flightForDistance(a, t);
      ok(r.valid === false && typeof r.reason === 'string', `flightForDistance refuses ${String(bad)}`);
    }
  }
  // huge but finite: x beyond the overflow guard
  const f = flightForTau(1e6 * G0, 1e6 * YEAR);
  ok(f.valid === false, 'overflow x refused');
  ok(X_MAX < 710 && X_MAX > 100, 'X_MAX below cosh overflow');
  const r = flightForDistance(1e-3, 1e60);
  ok(r.valid === false || Number.isFinite(r.T), 'huge D never yields NaN');
  // valid results never contain non-finite numbers
  const v = flightForTau(10 * G0, 80 * YEAR);
  ok(v.valid && [v.D, v.T, v.x, v.gammaMax, v.betaMax].every(Number.isFinite), 'valid result finite');
}

// (h) reachable()
{
  const list = reachable(STARS, G0, 5 * YEAR);
  ok(list.length === STARS.length, 'same length');
  for (const s of list) {
    ok(typeof s.reachable === 'boolean', 'flag');
    ok(Number.isFinite(s.tau) && Number.isFinite(s.T) && s.T >= s.tau, 'times');
    ok(s.reachable === (s.tau <= 5 * YEAR), `flag consistent for ${s.name}`);
  }
  ok(list[0].reachable === true, 'Proxima within 5 y at 1 g (tau~3.6)');
  ok(list.some((s) => !s.reachable), 'some not reachable in 5 y at 1 g');
  const all = reachable(STARS, 10 * G0, 80 * YEAR);
  ok(all.every((s) => s.reachable), 'everything within 80 y at 10 g');
  const none = reachable(STARS, 0.1 * G0, 1 * YEAR);
  ok(none.every((s) => !s.reachable), 'nothing in 1 y at 0.1 g');
  ok(reachable(STARS, NaN, YEAR).every((s) => s.reachable === false), 'bad input -> not reachable');
}

// (i) star data
{
  ok(STARS.length >= 10, 'enough stars');
  const names = STARS.map((s) => s.name);
  ok(new Set(names).size === names.length, 'unique names');
  for (const s of STARS) {
    ok(s.ly > 4.2 && s.ly < 15, `distance range ${s.name}`);
    ok(typeof s.name === 'string' && s.name.length > 0, 'name');
    ok(typeof s.ru === 'string' && s.ru.length > 0, 'ru name');
  }
  for (let i = 1; i < STARS.length; i++) ok(STARS[i].ly >= STARS[i - 1].ly, 'sorted by distance');
  ok(STARS[0].name === 'Proxima Centauri' && Math.abs(STARS[0].ly - 4.2465) < 0.01, 'Proxima first');
}

// (i2) stars added after review: present, within range, still sorted
for (const n of ['EZ Aquarii', '61 Cygni', 'Procyon A/B', 'Struve 2398', 'Groombridge 34', 'DX Cancri', 'Epsilon Indi']) ok(STARS.some((s) => s.name === n), `star ${n}`);
near(STARS.find((s) => s.name === '61 Cygni').ly, 11.40, 0.01, '61 Cyg');

// (k) 1 - beta in log form
{
  const val = (o) => o.mant * Math.pow(10, o.exp10);
  near(val(oneMinusBeta(1)), 1 - Math.tanh(1), 1e-12, '1-beta x=1');
  near(val(oneMinusBeta(0.1)), 1 - Math.tanh(0.1), 1e-12, '1-beta x=0.1');
  const o = oneMinusBeta(20.65); // 2/(e^41.3+1) ~ 2.3e-18 (tanh is exactly 1 here)
  ok(Math.tanh(20.65) === 1, 'premise: tanh saturates');
  near(o.mant * Math.pow(10, o.exp10 + 18), 2 / (Math.exp(41.3) + 1) * 1e18, 1e-12, 'x=20.65');
  ok(o.exp10 === -18 && o.mant > 2.2 && o.mant < 2.4, 'x=20.65 -> ~2.3e-18');
  const big = oneMinusBeta(412.9); // e^{2x} overflows; log10 = log10(2) - 2x/ln10
  ok(Number.isFinite(big.mant) && big.mant >= 1 && big.mant < 10 && Number.isInteger(big.exp10), 'x=412.9 finite');
  near(Math.log10(big.mant) + big.exp10, Math.log10(2) - 2 * 412.9 / Math.LN10, 1e-12, 'x=412.9 log10');
  ok(Number.isNaN(oneMinusBeta(-1).mant) && Number.isNaN(oneMinusBeta(NaN).mant), 'bad input -> NaN');
}

// (l) page helpers (js/verify/wwr-view.js)
{
  near(gOf(0), 0.1, 1e-12, 'gOf(0)'); near(gOf(1000), 10, 1e-12, 'gOf(1000)'); near(gOf(500), 1, 1e-12, 'gOf(500)=1g');
  ok(vOf(0.1) === 0 && vOf(10) === 1000 && vOf(1) === 500, 'vOf bounds');
  for (const v of [0, 137, 500, 999, 1000]) ok(vOf(gOf(v)) === v, `slider roundtrip ${v}`);
  ok(fmt(NaN) === '—' && fmt(0) === '0' && fmt(1.234) === '1.23' && fmt(12.34) === '12.3' && fmt(123.4) === '123', 'fmt small');
  ok(fmt(12345) === '12 345' && fmt(2.5e7) === '2.50·10^7', 'fmt large');
  // peak speed
  ok(fmtBeta(1) === Math.tanh(1).toFixed(3) + ' c', 'fmtBeta plain');
  ok(fmtBeta(20.65) === '1 − 2.3·10^-18 (c)', `fmtBeta saturated: ${fmtBeta(20.65)}`);
  ok(!/e\+|0\.0e/.test(fmtBeta(20.65)) && !/NaN|Infinity/.test(fmtBeta(412.9)), 'fmtBeta no garbage');
  ok(/^1 − [1-9]\.\d·10\^-\d+ \(c\)$/.test(fmtBeta(5)), 'fmtBeta x=5 form');
  // mass ratio exponent: e^{2x} -> 2x/ln10 (a mutation f.x instead of 2x is caught)
  near(massLog10(1), 2 / Math.LN10, 1e-14, 'massLog10(1)'); near(massLog10(Math.LN10), 2, 1e-14, 'massLog10(ln10)=2');
  // year declension
  const ru = (n) => yearWord(n, 'ru');
  ok(ru(1) === 'год' && ru(21) === 'год' && ru(2) === 'года' && ru(4) === 'года' && ru(5) === 'лет' && ru(11) === 'лет' && ru(14) === 'лет' && ru(12) === 'лет' && ru(80) === 'лет' && ru(22) === 'года' && ru(0) === 'лет', 'ru integer years');
  ok(ru(2.5) === 'года' && ru(1.5) === 'года' && ru(11.5) === 'года' && ru(150.4) === 'лет' && ru(3e6) === 'лет' && ru(NaN) === 'лет', 'ru fractional/large');
  ok(yearWord(1, 'en') === 'year' && yearWord(2, 'en') === 'years' && yearWord(2.5, 'en') === 'years' && yearWord(0.5, 'en') === 'years', 'en years');
}

// (j) HTML contract
{
  const html = fs.readFileSync(path.join(ROOT, 'where-we-reach.html'), 'utf8');
  ok(/data-lang="en"/.test(html) && /data-lang="ru"/.test(html), 'both languages');
  ok(/js\/physics\/flight\.js/.test(html) || /js\/where-we-reach\.js/.test(html), 'wires flight.js');
  ok(/iss_lang/.test(html), 'lang key');
  ok(/physics-verification\.html/.test(html), 'links verification');
  ok(/href="\/"|href="index\.html"/.test(html), 'links simulator');
  const ext = [...html.matchAll(/<script[^>]*\ssrc=["']([^"']+)["']/g)].map((m) => m[1]);
  for (const s of ext) ok(!/^(https?:)?\/\//.test(s), `no external script: ${s}`);
  ok(!/<link[^>]+href=["']https?:\/\/[^"']+\.css/.test(html), 'no external css');
  // the page's module (if separate) must exist
  ok(/from '\.\/js\/verify\/wwr-view\.js'/.test(html), 'page uses wwr-view helpers');
  ok(/td:not\(\[data-label\]\)::before \{ content: none/.test(html), 'unlabelled cell has no reserved label');
  for (const s of ext) ok(fs.existsSync(path.join(ROOT, s.replace(/^\.?\//, ''))), `script exists ${s}`);
  const sm = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  ok(sm.includes('where-we-reach.html'), 'sitemap');
  ok(fs.readFileSync(path.join(ROOT, 'llms.txt'), 'utf8').includes('where-we-reach.html'), 'llms.txt');
}

console.log(`where-we-reach.test.mjs OK (${checks} checks)`);
