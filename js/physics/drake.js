// Drake equation as a Monte-Carlo over parameter RANGES, plus a Fermi-paradox distance model.
// Pure maths, no DOM. N = R* · fp · ne · fl · fi · fc · L.
//   R*  stars formed per year in the Galaxy (1/yr)        fp  fraction of stars with planets
//   ne  habitable-zone planets per planet-bearing star     fl  fraction of those where life arises
//   fi  fraction of life-bearing ones that get intelligence
//   fc  fraction of those that emit detectable signals     L   years a civilisation stays detectable
// Each parameter is a range {min, max, dist}: dist 'log' = log-uniform, 'uniform' = linear-uniform.
// Sampling is reproducible: mulberry32 PRNG, one draw per parameter per sample in KEYS order
// (a degenerate min === max parameter still consumes its draw, so the other parameters' streams don't shift).

export const KEYS = ['R', 'fp', 'ne', 'fl', 'fi', 'fc', 'L'];
export const FRACTION_KEYS = ['fp', 'fl', 'fi', 'fc']; // must be <= 1 (probabilities)

// Galaxy model for the Fermi-paradox part: a uniform cylinder (round numbers, not a fit).
export const GALAXY = { radiusLy: 50000, thicknessLy: 1000 };
// Order-of-magnitude radius of the region our own radio leakage has reached (broadcasting for ~a century).
export const RADIO_BUBBLE_LY = 100;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

export function validateParams(params) {
  if (params === null || typeof params !== 'object') throw new TypeError('params must be an object');
  for (const k of KEYS) {
    const p = params[k];
    if (p === null || typeof p !== 'object') throw new RangeError(`param ${k} is missing`);
    if (!isNum(p.min) || !isNum(p.max)) throw new RangeError(`param ${k}: min and max must be finite numbers`);
    if (p.min <= 0 || p.max <= 0) throw new RangeError(`param ${k}: min and max must be > 0`);
    if (p.min > p.max) throw new RangeError(`param ${k}: min must be <= max`);
    const d = p.dist === undefined ? 'log' : p.dist;
    if (d !== 'log' && d !== 'uniform') throw new RangeError(`param ${k}: dist must be 'log' or 'uniform'`);
    if (FRACTION_KEYS.includes(k) && p.max > 1) throw new RangeError(`param ${k} is a fraction: max must be <= 1`);
  }
}

function checkN(n) {
  if (!Number.isInteger(n) || n < 1) throw new RangeError('n must be an integer >= 1');
}
function checkSeed(seed) {
  if (!isNum(seed)) throw new RangeError('seed must be a finite number');
}

function draw(p, u) {
  if (p.min === p.max) return p.min;
  return (p.dist === 'uniform')
    ? p.min + u * (p.max - p.min)
    : Math.exp(Math.log(p.min) + u * (Math.log(p.max) - Math.log(p.min)));
}

// n draws of N. Float64Array, same order as the PRNG stream.
export function sampleN(params, n, seed = 1) {
  validateParams(params);
  checkN(n);
  checkSeed(seed);
  const rng = mulberry32(seed);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let prod = 1;
    for (const k of KEYS) prod *= draw(params[k], rng());
    out[i] = prod;
  }
  return out;
}

// Exact product when every parameter is a point (min === max); the same factor order as sampleN.
export function pointN(params) {
  validateParams(params);
  let prod = 1;
  for (const k of KEYS) prod *= params[k].min;
  return prod;
}

// q in [0,1], linear interpolation between order statistics. `sorted` must be ascending.
export function quantile(sorted, q) {
  if (!sorted || sorted.length < 1) throw new RangeError('quantile of an empty sample');
  if (!isNum(q) || q < 0 || q > 1) throw new RangeError('q must be in [0, 1]');
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// Counts per bin of log10(value) on [lo, hi]; out-of-range values go to the end bins, so counts sum to values.length.
export function histogramLog10(values, { lo, hi, bins = 40 } = {}) {
  if (!values || values.length < 1) throw new RangeError('histogram of an empty sample');
  if (!Number.isInteger(bins) || bins < 1) throw new RangeError('bins must be an integer >= 1');
  if (!isNum(lo) || !isNum(hi) || !(hi > lo)) throw new RangeError('need finite lo < hi');
  const counts = new Array(bins).fill(0);
  const w = (hi - lo) / bins;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isNaN(v) || v < 0) throw new RangeError('values must be >= 0');
    const x = v > 0 ? Math.log10(v) : -Infinity;
    let b = Math.floor((x - lo) / w);
    if (b < 0) b = 0; else if (b >= bins) b = bins - 1;
    counts[b]++;
  }
  const edges = Array.from({ length: bins + 1 }, (_, i) => lo + i * w);
  return { lo, hi, bins, edges, counts };
}

// ---- Fermi paradox: how far is the nearest neighbour? ----
// Model: N civilisations scattered at random (Poisson) over a cylinder of radius R and thickness h
// (GALAXY). The probability that none lies within r of us is exp(-N·V(r)/Vgal), where V(r) is the volume of a
// ball of radius r clipped to the slab |z| <= h/2. Valid for N >> 1; edge effects (we are not at the
// centre) and the clustering of real stars are ignored.
export function diskVolumeLy3(g = GALAXY) { return Math.PI * g.radiusLy * g.radiusLy * g.thicknessLy; }

export function ballInSlabVolume(r, h = GALAXY.thicknessLy) {
  if (!isNum(r) || r < 0) throw new RangeError('r must be a finite number >= 0');
  return r <= h / 2 ? (4 / 3) * Math.PI * r ** 3 : Math.PI * (r * r * h - h ** 3 / 12);
}

// Inverse of ballInSlabVolume.
function radiusForVolume(v, h) {
  const vTurn = Math.PI * h ** 3 / 6; // value at r = h/2
  return v <= vTurn ? Math.cbrt(3 * v / (4 * Math.PI)) : Math.sqrt(v / (Math.PI * h) + h * h / 12);
}

// Expected number of civilisations inside radius r of us, given N in the Galaxy.
export function expectedWithin(N, rLy, g = GALAXY) {
  if (!isNum(N) || N < 0) throw new RangeError('N must be a finite number >= 0');
  return N * Math.min(1, ballInSlabVolume(rLy, g.thicknessLy) / diskVolumeLy3(g));
}

// P(nobody within r) — the "silence" probability for a search radius r.
export function pSilence(N, rLy, g = GALAXY) { return Math.exp(-expectedWithin(N, rLy, g)); }

// Distance d such that P(nearest > d) = 1 - q (q = 0.5: median distance to the nearest civilisation).
// Infinity when it exceeds the Galaxy (N too small to expect any neighbour at that confidence).
export function nearestDistanceLy(N, q = 0.5, g = GALAXY) {
  if (!isNum(N) || N < 0) throw new RangeError('N must be a finite number >= 0');
  if (!isNum(q) || q <= 0 || q >= 1) throw new RangeError('q must be in (0, 1)');
  if (N === 0) return Infinity;
  const v = -Math.log(1 - q) * diskVolumeLy3(g) / N;
  if (v >= ballInSlabVolume(g.radiusLy, g.thicknessLy)) return Infinity;
  return radiusForVolume(v, g.thicknessLy);
}

// Full Monte-Carlo summary for the page.
export function summarize(params, n = 20000, seed = 1, { bins = 40 } = {}) {
  const samples = sampleN(params, n, seed);
  const sorted = Float64Array.from(samples).sort();
  const q = (p) => quantile(sorted, p);
  let below = 0, silence = 0;
  for (let i = 0; i < n; i++) {
    if (samples[i] < 1) below++;
    silence += pSilence(samples[i], RADIO_BUBBLE_LY);
  }
  const lg = (v) => Math.log10(v);
  let lo = Math.floor(lg(sorted[0])), hi = Math.ceil(lg(sorted[n - 1]));
  if (!(hi > lo)) { lo -= 1; hi += 1; }
  const median = q(0.5), p16 = q(0.16), p84 = q(0.84), p025 = q(0.025), p975 = q(0.975);
  return {
    n, seed, median, p16, p84, p025, p975,
    pLessThanOne: below / n,
    pSilenceInBubble: silence / n, // mean over samples of P(no neighbour within RADIO_BUBBLE_LY)
    log10: { median: lg(median), p16: lg(p16), p84: lg(p84), p025: lg(p025), p975: lg(p975) },
    nearestLy: { atMedian: nearestDistanceLy(median), atP16: nearestDistanceLy(p16), atP84: nearestDistanceLy(p84) },
    hist: histogramLog10(samples, { lo, hi, bins }),
  };
}
