// Drake-equation module: CONTRACT tests against independent references (closed forms, identities), not the code under test.
import assert from 'node:assert/strict';
import {
  KEYS, GALAXY, RADIO_BUBBLE_LY, mulberry32, sampleN, pointN, quantile, histogramLog10, summarize,
  ballInSlabVolume, diskVolumeLy3, expectedWithin, pSilence, nearestDistanceLy, validateParams,
} from '../js/physics/drake.js';
import { PRESETS, presetParams } from '../js/data/drake.js';

let checks = 0;
const ok = (c, msg) => { checks++; assert.ok(c, msg); };
const rel = (a, b) => Math.abs(a - b) / (Math.abs(b) || 1);
const near = (a, b, tol, msg) => { checks++; assert.ok(rel(a, b) <= tol, `${msg}: ${a} vs ${b} (rel ${rel(a, b)})`); };
const nearAbs = (a, b, tol, msg) => { checks++; assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`); };
const throwsRange = (fn, msg) => { checks++; assert.throws(fn, (e) => e instanceof RangeError, msg); };

const pt = (v) => ({ min: v, max: v, dist: 'log' });
const base = () => ({ R: pt(2), fp: pt(0.5), ne: pt(3), fl: pt(0.1), fi: pt(0.2), fc: pt(0.25), L: pt(1000) });
const wide = () => ({
  R: { min: 1, max: 100, dist: 'log' }, fp: { min: 0.01, max: 1, dist: 'log' }, ne: { min: 0.1, max: 10, dist: 'log' },
  fl: { min: 1e-6, max: 1, dist: 'log' }, fi: { min: 1e-3, max: 1, dist: 'log' }, fc: { min: 1e-2, max: 1, dist: 'log' },
  L: { min: 1e2, max: 1e8, dist: 'log' },
});

// ---- PRNG: known mulberry32 stream for seed 1, and range ----
{
  const r = mulberry32(1); const a = [r(), r(), r()];
  ok(a.every((x) => x >= 0 && x < 1), 'prng in [0,1)');
  const r2 = mulberry32(1); ok(r2() === a[0] && r2() === a[1] && r2() === a[2], 'prng repeatable');
  ok(mulberry32(2)() !== a[0], 'different seeds differ');
  // uniform mean ~ 0.5, variance ~ 1/12 (n = 1e5)
  const g = mulberry32(99); let s = 0, s2 = 0; const n = 100000;
  for (let i = 0; i < n; i++) { const x = g(); s += x; s2 += x * x; }
  nearAbs(s / n, 0.5, 0.005, 'prng mean'); nearAbs(s2 / n - (s / n) ** 2, 1 / 12, 0.003, 'prng variance');
}

// ---- determinism ----
{
  const a = sampleN(wide(), 500, 42), b = sampleN(wide(), 500, 42), c = sampleN(wide(), 500, 43);
  ok(a.length === 500 && a.every((v, i) => v === b[i]), 'same seed => identical samples');
  ok(a.some((v, i) => v !== c[i]), 'different seed => different samples');
  const s1 = summarize(wide(), 2000, 5), s2 = summarize(wide(), 2000, 5);
  ok(JSON.stringify(s1) === JSON.stringify(s2), 'summarize deterministic');
}

// ---- degenerate parameters: exact product ----
{
  const p = base();
  const exact = 2 * 0.5 * 3 * 0.1 * 0.2 * 0.25 * 1000;
  near(pointN(p), exact, 1e-14, 'pointN');
  const s = sampleN(p, 50, 7);
  ok(s.every((v) => Math.abs(v - exact) / exact < 1e-12), 'degenerate sample == exact product');
  const sm = summarize(p, 100, 7);
  near(sm.median, exact, 1e-12, 'median of point'); near(sm.p025, exact, 1e-12, 'p025 of point'); near(sm.p975, exact, 1e-12, 'p975 of point');
  // a point parameter still consumes its PRNG draw: a point and a razor-thin range give the same stream for the others
  const mk = (fl) => { const q = base(); q.fl = fl; q.R = { min: 1, max: 100, dist: 'log' }; q.L = { min: 10, max: 1e6, dist: 'log' }; return q; };
  const sa = sampleN(mk(pt(0.1)), 200, 3), sb = sampleN(mk({ min: 0.1, max: 0.1 * (1 + 1e-12), dist: 'log' }), 200, 3);
  for (let i = 0; i < 200; i++) near(sa[i], sb[i], 1e-9, 'streams stay aligned when a parameter becomes a point');
}

// ---- samples respect each range; uniform vs log distribution ----
{
  // single varying parameter L: N = base * L, so L = N / base
  const f = 2 * 0.5 * 3 * 0.1 * 0.2 * 0.25;
  const pl = base(); pl.L = { min: 10, max: 1e4, dist: 'log' };
  const sl = sampleN(pl, 20000, 11);
  ok(sl.every((v) => v / f >= 10 * (1 - 1e-12) && v / f <= 1e4 * (1 + 1e-12)), 'log samples within range');
  const mlog = sl.reduce((a, v) => a + Math.log10(v / f), 0) / sl.length; // mean of log10 L = 2.5
  nearAbs(mlog, 2.5, 0.03, 'log-uniform mean of log10');
  const pu = base(); pu.L = { min: 10, max: 1e4, dist: 'uniform' };
  const su = sampleN(pu, 20000, 11);
  const mean = su.reduce((a, v) => a + v / f, 0) / su.length; // uniform mean = 5005
  near(mean, 5005, 0.02, 'uniform mean of L');
  const medLogU = [...su].map((v) => v / f).sort((a, b) => a - b)[10000];
  near(medLogU, 5005, 0.03, 'uniform median of L'); // a log-uniform would have median 316
}

// ---- median of a log-uniform product = analytic (sum of symmetric uniforms in log space) ----
{
  const p = wide();
  let mu = 0, v = 0;
  for (const k of KEYS) { const a = Math.log10(p[k].min), b = Math.log10(p[k].max); mu += (a + b) / 2; v += (b - a) ** 2 / 12; }
  const n = 40000, sd = Math.sqrt(v);
  const s = summarize(p, n, 2024);
  // sampling sd of the median ~ 1.2533 sd/sqrt(n); allow 5 sigma
  nearAbs(s.log10.median, mu, 5 * 1.2533 * sd / Math.sqrt(n), 'median log10 N = sum of range midpoints in log space');
  // 16/84 quantiles of a near-normal sum: mu -+ ~sd (Irwin-Hall with 7 terms is close to normal; allow 0.15 sd)
  nearAbs(s.log10.p84 - s.log10.p16, 2 * sd, 0.3 * sd, 'p16-p84 width ~ 2 sd');
  nearAbs((s.log10.p84 + s.log10.p16) / 2, mu, 0.1 * sd, 'p16-p84 symmetric about median (log space)');
  // P(N<1): for mu == 0 this is 1/2 by symmetry
  const sym = { ...p, R: { min: 1e-2, max: 1e2, dist: 'log' } };
  // build a case with mean log10 exactly 0 by scaling fl range
  let mu2 = 0; for (const k of KEYS) mu2 += (Math.log10(sym[k].min) + Math.log10(sym[k].max)) / 2;
  const shift = Math.pow(10, -mu2); // multiply R range by this
  sym.R = { min: sym.R.min * shift, max: sym.R.max * shift, dist: 'log' };
  const z = summarize(sym, 40000, 8);
  nearAbs(z.pLessThanOne, 0.5, 0.012, 'P(N<1) = 1/2 when the log-mean is 0');
}

// ---- quantiles ----
{
  const s = summarize(wide(), 5000, 1);
  const ord = [s.p025, s.p16, s.median, s.p84, s.p975];
  ok(ord.every((x, i) => i === 0 || x >= ord[i - 1]), 'quantiles monotone');
  ok(s.p025 < s.p975, 'quantiles strictly separate for a wide range');
  nearAbs(quantile([1, 2, 3, 4], 0.5), 2.5, 1e-15, 'quantile interpolates');
  nearAbs(quantile([1, 2, 3, 4], 0), 1, 0, 'q=0'); nearAbs(quantile([1, 2, 3, 4], 1), 4, 0, 'q=1');
  nearAbs(quantile([5], 0.3), 5, 0, 'single element');
  nearAbs(quantile([0, 10], 0.25), 2.5, 1e-15, 'linear');
  throwsRange(() => quantile([1], -0.1), 'q<0'); throwsRange(() => quantile([1], 1.1), 'q>1'); throwsRange(() => quantile([], 0.5), 'empty');
  throwsRange(() => quantile([1], NaN), 'q NaN');
}

// ---- P(N<1) extremes ----
{
  const hi = base(); hi.L = pt(1e12);
  nearAbs(summarize(hi, 200, 1).pLessThanOne, 0, 0, 'P(N<1)=0 for huge N');
  const lo = base(); lo.L = pt(1e-3);
  nearAbs(summarize(lo, 200, 1).pLessThanOne, 1, 0, 'P(N<1)=1 for tiny N');
  // boundary is strict: N == 1 exactly is not "less than one"
  const one = { R: pt(1), fp: pt(1), ne: pt(1), fl: pt(1), fi: pt(1), fc: pt(1), L: pt(1) };
  nearAbs(summarize(one, 10, 1).pLessThanOne, 0, 0, 'N==1 is not < 1');
}

// ---- histogram ----
{
  const s = summarize(wide(), 7777, 3, { bins: 25 });
  ok(s.hist.counts.length === 25 && s.hist.edges.length === 26, 'bins/edges lengths');
  ok(s.hist.counts.reduce((a, b) => a + b, 0) === 7777, 'histogram sums to n');
  ok(s.hist.edges[0] <= s.log10.p025 && s.hist.edges[25] >= s.log10.p975, 'hist range covers the 95% band');
  const h = histogramLog10([1, 10, 100, 1e6, 1e-9], { lo: 0, hi: 3, bins: 3 }); // outliers clamp to end bins
  ok(h.counts[0] === 2 && h.counts[1] === 1 && h.counts[2] === 2, 'clamping into end bins: ' + h.counts);
  const h2 = histogramLog10([0, 10], { lo: 0, hi: 1, bins: 2 });
  ok(h2.counts[0] === 1 && h2.counts[1] === 1, 'value 0 goes to the first bin, 10 (log10 = hi, upper edge) to the last');
  throwsRange(() => histogramLog10([1], { lo: 1, hi: 1, bins: 3 }), 'lo>=hi'); throwsRange(() => histogramLog10([], { lo: 0, hi: 1 }), 'empty');
  throwsRange(() => histogramLog10([1], { lo: 0, hi: 1, bins: 0 }), 'bins 0'); throwsRange(() => histogramLog10([-1], { lo: 0, hi: 1 }), 'negative value');
}

// ---- invalid input ----
{
  const bad = (mut, msg) => { const p = base(); mut(p); throwsRange(() => sampleN(p, 10, 1), msg); };
  bad((p) => { p.R = { min: 5, max: 1 }; }, 'min>max');
  bad((p) => { p.R = { min: 0, max: 1 }; }, 'min=0');
  bad((p) => { p.ne = { min: -1, max: 1 }; }, 'negative');
  bad((p) => { p.L = { min: 1, max: 0 }; }, 'max=0');
  bad((p) => { p.fl = { min: 0.1, max: 1.5 }; }, 'fraction > 1');
  bad((p) => { p.fc = { min: NaN, max: 1 }; }, 'NaN');
  bad((p) => { p.fi = { min: 0.1, max: Infinity }; }, 'Infinity');
  bad((p) => { p.R = { min: 1, max: 2, dist: 'normal' }; }, 'bad dist');
  bad((p) => { delete p.L; }, 'missing key');
  bad((p) => { p.R = { min: '1', max: 2 }; }, 'string number');
  for (const n of [0, -5, 1.5, NaN, Infinity, '10']) throwsRange(() => sampleN(base(), n, 1), 'n=' + n);
  throwsRange(() => sampleN(base(), 10, NaN), 'seed NaN');
  assert.throws(() => sampleN(null, 10, 1), TypeError); checks++;
  throwsRange(() => nearestDistanceLy(-1), 'N<0'); throwsRange(() => nearestDistanceLy(10, 0), 'q=0'); throwsRange(() => nearestDistanceLy(10, 1), 'q=1');
  throwsRange(() => ballInSlabVolume(-1), 'r<0'); throwsRange(() => expectedWithin(-1, 5), 'N<0 within');
  ok((() => { validateParams(base()); return true; })(), 'valid params pass');
}

// ---- Fermi-distance model ----
{
  const h = GALAXY.thicknessLy, R = GALAXY.radiusLy, V = diskVolumeLy3();
  near(V, Math.PI * R * R * h, 1e-15, 'disk volume');
  // ball in slab: small r = full sphere; continuous at r = h/2; r >> h: pi r^2 h (minus the h^3/12 term)
  near(ballInSlabVolume(10), (4 / 3) * Math.PI * 1000, 1e-14, 'small ball');
  near(ballInSlabVolume(h / 2 * (1 - 1e-12)), ballInSlabVolume(h / 2 * (1 + 1e-12)), 1e-9, 'continuous at r=h/2');
  near(ballInSlabVolume(1e4), Math.PI * 1e8 * h, 1e-3, 'large r -> cylinder (h^3/12 correction ~8e-4)');
  // numerical integral of pi (r^2 - z^2) over the slab, independent reference
  { let acc = 0; const m = 200000, r = 3000; for (let i = 0; i < m; i++) { const z = -h / 2 + (i + 0.5) * h / m; acc += Math.PI * (r * r - z * z) * (h / m); }
    near(ballInSlabVolume(r), acc, 1e-8, 'ball in slab vs numerical integral'); }
  // nearest distance: quantile consistency P(none within d) = 1 - q, for several N and q, both regimes
  for (const N of [1e3, 1e5, 1e7, 1e9]) for (const q of [0.1, 0.5, 0.9]) {
    const d = nearestDistanceLy(N, q);
    ok(Number.isFinite(d) && d > 0, `finite d for N=${N}`);
    near(pSilence(N, d), 1 - q, 1e-9, `P(none within d)=1-q  N=${N} q=${q}`);
  }
  // 3D Poisson classic: median distance = (3 ln2 / (4 pi n))^(1/3), n = N / V, when d < h/2
  { const N = 1e11, n = N / V, d = nearestDistanceLy(N, 0.5); ok(d < h / 2, 'regime 3D'); near(d, Math.cbrt(3 * Math.LN2 / (4 * Math.PI * n)), 1e-12, '3D median distance'); }
  // 2D regime: d >> h, median ~ sqrt(ln2 N^-1 * R^2) = R sqrt(ln2/N)
  { const N = 100, d = nearestDistanceLy(N, 0.5); ok(d > 3 * h, 'regime 2D'); near(d, R * Math.sqrt(Math.LN2 / N), 0.01, '2D median distance ~ R sqrt(ln2/N)'); }
  // more civilisations => nearer; monotone
  let prev = Infinity; for (const N of [1e3, 1e4, 1e6, 1e8, 1e10]) { const d = nearestDistanceLy(N); ok(d < prev, 'distance decreases with N'); prev = d; }
  ok(nearestDistanceLy(0) === Infinity && nearestDistanceLy(0.5) === Infinity, 'N<1 => no neighbour expected');
  // silence prob
  nearAbs(pSilence(0, 100), 1, 0, 'N=0 silent'); ok(pSilence(1e12, 100) < 1e-6, 'huge N is not silent');
  near(expectedWithin(1e6, 1e9), 1e6, 1e-12, 'whole galaxy contains all N');
  nearAbs(summarize(base(), 10, 1).pSilenceInBubble, pSilence(pointN(base()), RADIO_BUBBLE_LY), 1e-12, 'summary silence == pSilence for a point N');
}

// ---- presets run through the core ----
{
  const med = {};
  for (const p of PRESETS) { const s = summarize(presetParams(p), 4000, 1); ok(s.median > 0 && Number.isFinite(s.median), 'preset median ' + p.id); med[p.id] = s.median; }
  ok(med.pessimist <= med.optimist, 'pessimist median <= optimist median');
}

console.log('drake.contract.test: OK (' + checks + ' checks)');
