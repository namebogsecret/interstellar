// Contract tests for js/physics/neighbors.js. References are independent closed forms derived from
// hyperbolic motion (c = 1, ly, yr): a leg of length x from rest has gamma = 1 + a x,
// tau = acosh(gamma)/a, t = sqrt(gamma^2 - 1)/a; flip-and-burn = two legs of d/2, flyby = one leg of d.
import assert from 'node:assert/strict';
import { NEIGHBORS } from '../js/data/neighbors.js';
import {
  GROUPS, tripTo, buildRows, sortRows, filterRows, spectralGroup, spectralKey,
  parseAccelParam, accelFromSlider, sliderFromAccel, ACCEL_MIN_G, ACCEL_MAX_G,
} from '../js/physics/neighbors.js';

const A1G = 9.80665 * 365.25 * 86400 / 299792458; // ly/yr^2 per g
const rel = (a, b) => Math.abs(a - b) / Math.abs(b);
const near = (a, b, tol, msg) => assert.ok(rel(a, b) <= tol, `${msg}: ${a} vs ${b}`);
const refFlip = (g, d) => { const a = g * A1G, y = 1 + a * d / 2; return { tau: 2 * Math.acosh(y) / a, t: 2 * Math.sqrt(y * y - 1) / a, gamma: y, beta: Math.sqrt(1 - 1 / (y * y)) }; };
const refFly = (g, d) => { const a = g * A1G, y = 1 + a * d; return { tau: Math.acosh(y) / a, t: Math.sqrt(y * y - 1) / a, gamma: y, beta: Math.sqrt(1 - 1 / (y * y)) }; };

// ---- control point: Proxima at 1 g flip-and-burn ~3.5 yr ship, ~5.9 yr Earth ----
{
  const r = tripTo(4.2465, 1, 'flip');
  near(r.tau, 3.5, 0.02, 'Proxima 1g ship ~3.5 y');
  near(r.t, 5.9, 0.02, 'Proxima 1g Earth ~5.9 y');
  assert.ok(r.t > r.tau, 'Earth clock runs longer');
  assert.ok(r.t > 4.2465, 'cannot beat light');
}

// ---- formulas vs independent references on several stars and accelerations ----
for (const id of ['proxima', 'barnard', 'sirius-a', 'tau-ceti', 'gj674']) {
  const d = NEIGHBORS.find((s) => s.id === id).ly;
  for (const g of [0.1, 0.3, 1, 3, 10]) {
    const f = tripTo(d, g, 'flip'), rf = refFlip(g, d);
    near(f.tau, rf.tau, 1e-9, `flip tau ${id} ${g}g`); near(f.t, rf.t, 1e-9, `flip t ${id} ${g}g`);
    near(f.peakGamma, rf.gamma, 1e-9, `flip gamma ${id} ${g}g`); near(f.peakBeta, rf.beta, 1e-9, `flip beta ${id} ${g}g`);
    const y = tripTo(d, g, 'flyby'), ry = refFly(g, d);
    near(y.tau, ry.tau, 1e-9, `flyby tau ${id} ${g}g`); near(y.t, ry.t, 1e-9, `flyby t ${id} ${g}g`);
    near(y.peakGamma, ry.gamma, 1e-9, `flyby gamma ${id} ${g}g`);
    assert.ok(y.tau < f.tau && y.t < f.t, 'flyby faster than flip-and-burn');
    assert.ok(f.tau < f.t, 'ship clock < Earth clock');
    assert.ok(f.t > d, 'Earth time > light time');
  }
}

// ---- monotonic: more distance or less acceleration => longer trip ----
{
  const rows = buildRows(NEIGHBORS, 1, 'flip');
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i].tau >= rows[i - 1].tau && rows[i].t >= rows[i - 1].t, 'time grows with distance ' + rows[i].id);
  }
  const lo = tripTo(4.2465, 0.1, 'flip'), hi = tripTo(4.2465, 10, 'flip');
  assert.ok(lo.tau > hi.tau && lo.t > hi.t);
  // a -> small (Newtonian): D = a tau^2 / 4 on flip-and-burn => tau = 2 sqrt(D/a); lowest slider value 0.1 g
  const g = 0.1, d = 0.5, a = g * A1G, r = tripTo(d, g, 'flip');
  near(r.tau, 2 * Math.sqrt(d / a), 0.01, 'Newtonian limit for small aD');
}

// ---- input guards ----
assert.throws(() => tripTo(4, 0, 'flip'), RangeError);
assert.throws(() => tripTo(4, NaN, 'flip'), RangeError);
assert.throws(() => tripTo(-1, 1, 'flip'), RangeError);
assert.throws(() => tripTo(4, 1, 'warp'), RangeError);

// ---- rows ----
const rows = buildRows(NEIGHBORS, 1, 'flip');
assert.equal(rows.length, 50);
assert.deepEqual(rows.map((r) => r.no), Array.from({ length: 50 }, (_, i) => i + 1));
assert.ok(rows.every((r) => Number.isFinite(r.tau) && Number.isFinite(r.t) && r.group));

// ---- sortRows ----
{
  const ids = (a) => a.map((r) => r.id);
  const byLyDesc = sortRows(rows, 'ly', 'desc');
  assert.equal(byLyDesc[0].id, 'gj674'); assert.equal(byLyDesc[49].id, 'proxima');
  assert.deepEqual(ids(sortRows(rows, 'ly', 'asc')), ids(rows), 'asc by ly = catalogue order');
  assert.deepEqual(ids(sortRows(rows, 'tau', 'asc')), ids(rows), 'asc by tau = by distance');
  assert.deepEqual(ids(sortRows(rows, 't', 'desc')), ids(rows.slice().sort((x, y) => y.ly - x.ly || x.no - y.no)), 'desc by t = distance desc, ties by catalogue no');
  const byName = sortRows(rows, 'name', 'asc').map((r) => r.name);
  const expect = byName.slice().sort((a, b) => a.localeCompare(b, 'en'));
  assert.deepEqual(byName, expect, 'name ascending');
  const bySp = sortRows(rows, 'spectral', 'asc');
  for (let i = 1; i < bySp.length; i++) assert.ok(bySp[i].key >= bySp[i - 1].key, 'spectral order');
  assert.equal(bySp[0].group, 'A'); assert.equal(bySp[bySp.length - 1].group, 'D');
  // stability: equal keys fall back to catalogue number
  const tie = bySp.filter((r) => r.key === bySp[10].key);
  for (let i = 1; i < tie.length; i++) assert.ok(tie[i].no > tie[i - 1].no);
  // input not mutated
  const copy = rows.map((r) => r.id);
  sortRows(rows, 'name', 'desc'); assert.deepEqual(rows.map((r) => r.id), copy);
  // NaN last in both directions
  const withNaN = [{ no: 1, ly: 1, tau: NaN }, { no: 2, ly: 2, tau: 5 }, { no: 3, ly: 3, tau: 1 }];
  assert.deepEqual(sortRows(withNaN, 'tau', 'asc').map((r) => r.no), [3, 2, 1]);
  assert.deepEqual(sortRows(withNaN, 'tau', 'desc').map((r) => r.no), [2, 3, 1]);
  assert.throws(() => sortRows(rows, 'mass'), RangeError);
  assert.throws(() => sortRows(rows, 'ly', 'up'), RangeError);
  // Russian name sort puts entries by ru where present
  const ru = sortRows(rows, 'name', 'asc', 'ru');
  assert.equal(ru.length, 50);
}

// ---- filterRows ----
{
  assert.equal(filterRows(rows, {}).length, 50, 'no filter = all');
  assert.equal(filterRows(rows, { groups: GROUPS }).length, 50, 'all groups = all');
  assert.equal(filterRows(rows, { groups: [] }).length, 0, 'no groups = empty');
  const d = filterRows(rows, { groups: ['D'] });
  assert.deepEqual(d.map((r) => r.id).sort(), ['procyon-b', 'sirius-b', 'van-maanen']);
  const lt = filterRows(rows, { groups: ['L', 'T'] });
  assert.equal(lt.length, 4); assert.ok(lt.every((r) => r.group === 'L' || r.group === 'T'));
  const near5 = filterRows(rows, { maxLy: 5 });
  assert.deepEqual(near5.map((r) => r.id), ['proxima', 'alpha-cen-a', 'alpha-cen-b']);
  assert.equal(filterRows(rows, { maxLy: 4.2465 }).length, 1, 'inclusive bound');
  assert.equal(filterRows(rows, { maxLy: 1 }).length, 0, 'nothing that near');
  assert.equal(filterRows(rows, { maxLy: null }).length, 50);
  assert.deepEqual(filterRows(rows, { query: 'PROX' }).map((r) => r.id), ['proxima']);
  assert.deepEqual(filterRows(rows, { query: 'сириус' }).map((r) => r.id), ['sirius-a', 'sirius-b'], 'Russian query');
  assert.deepEqual(filterRows(rows, { query: 'luyten' }).map((r) => r.id), ['bl-ceti', 'uv-ceti', 'luyten-star'], 'matches name and system');
  assert.equal(filterRows(rows, { query: 'zzzz' }).length, 0);
  assert.equal(filterRows(rows, { query: '   ' }).length, 50, 'blank query ignored');
  assert.equal(filterRows(rows, { groups: ['M'], maxLy: 8, query: 'wolf' }).map((r) => r.id).join(), 'wolf359', 'combined');
  assert.equal(rows.length, 50, 'input not mutated');
}

// ---- spectral helpers ----
assert.equal(spectralGroup('M5.5Ve'), 'M'); assert.equal(spectralGroup('sdM1'), 'M'); assert.equal(spectralGroup('DA2'), 'D');
assert.equal(spectralGroup('X1'), null); assert.equal(spectralGroup(''), null); assert.equal(spectralGroup(undefined), null);
assert.ok(spectralKey('M5.5Ve') > spectralKey('M0V') && spectralKey('M0V') > spectralKey('K5V'));
assert.ok(spectralKey('DQZ') > spectralKey('T6'));

// ---- ?a= parsing and slider ----
assert.equal(parseAccelParam(''), 1); assert.equal(parseAccelParam('?a=3'), 3); assert.equal(parseAccelParam('?a=0.5'), 0.5);
assert.equal(parseAccelParam('?a=2,5'), 2.5); assert.equal(parseAccelParam('?a=abc'), 1); assert.equal(parseAccelParam('?a=-2'), 1);
assert.equal(parseAccelParam('?a=0'), 1); assert.equal(parseAccelParam('?a='), 1);
assert.equal(parseAccelParam('?a=1000'), ACCEL_MAX_G); assert.equal(parseAccelParam('?a=0.0001'), ACCEL_MIN_G);
assert.equal(parseAccelParam('?a=Infinity'), 1); assert.equal(parseAccelParam('?x=1'), 1);
near(accelFromSlider(0), ACCEL_MIN_G, 1e-12, 'slider 0'); near(accelFromSlider(1000), ACCEL_MAX_G, 1e-12, 'slider 1000');
for (const g of [0.1, 0.5, 1, 3, 10]) near(accelFromSlider(sliderFromAccel(g)), g, 1e-9, 'slider roundtrip ' + g);
console.log('neighbors.contract.test: OK');

// ---- page wiring (static checks) ----
{
  const fs = await import('node:fs'), path = await import('node:path'), url = await import('node:url');
  const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
  const rd = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const html = rd('neighbors.html');
  assert.ok(/js\/physics\/neighbors\.js/.test(html) && /js\/data\/neighbors\.js/.test(html), 'page imports logic and data');
  assert.ok(/aria-sort/.test(html) && /aria-live="polite"/.test(html), 'a11y hooks');
  assert.ok(/where-we-reach\.html/.test(html) && /accel\.html/.test(html), 'links to sibling pages');
  assert.ok(rd('sitemap.xml').includes('neighbors.html'), 'sitemap');
  assert.ok(rd('llms.txt').includes('neighbors.html'), 'llms.txt');
  assert.ok(rd('where-we-reach.html').includes('neighbors.html'), 'wwr links to neighbors');
  assert.ok(rd('accel.html').includes('neighbors.html'), 'accel links to neighbors');
}
