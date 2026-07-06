// J2000 mean-anomaly contract (bodies.js j2000MeanAnomaly). Pure helper only —
// NO assertions on live body.M0 (date-dependent). Fixed timestamps throughout.
import { j2000MeanAnomaly } from '../js/data/bodies.js';
import { approxAbs, angDist } from './helpers.mjs';
import assert from 'node:assert/strict';

const J2000 = 946728000;         // epoch, Unix seconds
const DEG = Math.PI / 180;
const DAY = 86400;
const wrap = (x) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

// Earth / Mars params (L0, varpi=Ω+ω) per the ТЗ.
const earth = { L0: 100.46435, varpi: 102.947, period: 365.256 * DAY };
const mars = { L0: 355.45332, varpi: 336.04, period: 686.980 * DAY };

// 1) Δt = 0 (unixSeconds = epoch) ⇒ M0 = wrap((L0 − varpi)·π/180).
{
  const m = j2000MeanAnomaly(earth.L0, earth.varpi, earth.period, J2000);
  approxAbs(m, wrap((earth.L0 - earth.varpi) * DEG), 1e-9, 'epoch Δt=0 ⇒ wrap((L0−ϖ)·DEG)');
}

// 2) Propagation identity: advancing by exactly one period returns to the Δt=0
//    value (mod 2π).
{
  const base = j2000MeanAnomaly(earth.L0, earth.varpi, earth.period, J2000);
  const oneP = j2000MeanAnomaly(earth.L0, earth.varpi, earth.period, J2000 + earth.period);
  assert.ok(angDist(base, oneP) < 1e-6,
    `+1 period must return to Δt=0 value: angDist=${angDist(base, oneP)}`);
}

// 3) Distinct bodies have distinct M0 at a fixed non-epoch timestamp.
{
  const t = 1_500_000_000;      // fixed non-epoch Unix time
  const mE = j2000MeanAnomaly(earth.L0, earth.varpi, earth.period, t);
  const mM = j2000MeanAnomaly(mars.L0, mars.varpi, mars.period, t);
  assert.ok(angDist(mE, mM) > 1e-3, `Earth and Mars M0 must differ: ${mE} vs ${mM}`);
}

console.log('epoch.test.mjs OK');
