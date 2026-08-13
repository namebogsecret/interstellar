// Contract (ТЗ, wave A) for the J2000.0 TT epoch constant in js/data/bodies.js.
// The module MUST export `J2000_EPOCH_UNIX` (it currently does not — this
// import is EXPECTED to throw a SyntaxError at load time, failing this whole
// file red, which is the point: it proves the missing-export bug). Value must
// equal true J2000.0 = 2000-01-01 12:00:00 TT, NOT 12:00:00 UTC (TT leads UTC
// by 64.184s at that epoch: 32 leap-seconds + 32.184s fixed TAI→TT offset).
import { J2000_EPOCH_UNIX, j2000MeanAnomaly } from '../js/data/bodies.js';
import { approxAbs, angDist } from './helpers.mjs';
import assert from 'node:assert/strict';

const DEG = Math.PI / 180;
const DAY = 86400;
const wrap = (x) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

// ── A7: exported constant must equal true TT epoch, not the UTC-clock value ─
{
  const expected = Date.UTC(2000, 0, 1, 12, 0, 0) / 1000 - 64.184;
  approxAbs(J2000_EPOCH_UNIX, expected, 1e-6,
    'J2000_EPOCH_UNIX must equal 2000-01-01 12:00:00 TT in Unix seconds');
}

// ── the bug this guards against: epoch silently equal to the round UTC value
{
  const buggyUtcNoon = 946728000;   // Date.UTC(2000,0,1,12,0,0)/1000 — no TT offset
  assert.ok(Math.abs(J2000_EPOCH_UNIX - buggyUtcNoon) > 1,
    `J2000_EPOCH_UNIX must NOT equal the bare UTC-noon value ${buggyUtcNoon} ` +
    `(that was the bug: code labeled "TT" but computed 12:00 UTC)`);
}

// ── regression (should hold once the export exists): j2000MeanAnomaly ──────
// Fixed synthetic body params, NOT live BODIES entries (those are date-
// dependent and out of scope for this file, per existing tests/epoch.test.mjs).
const earth = { L0: 100.46435, varpi: 102.947, period: 365.256 * DAY };

// Δt = 0 (unixSeconds = the module's own epoch) ⇒ M0 = wrap((L0−ϖ)·DEG),
// independent of what the epoch's numeric value actually is.
{
  const m = j2000MeanAnomaly(earth.L0, earth.varpi, earth.period, J2000_EPOCH_UNIX);
  approxAbs(m, wrap((earth.L0 - earth.varpi) * DEG), 1e-9,
    'j2000MeanAnomaly: Δt=0 at the exported epoch ⇒ wrap((L0−ϖ)·DEG)');
}

// Propagating by exactly one period returns to the Δt=0 value (mod 2π).
{
  const base = j2000MeanAnomaly(earth.L0, earth.varpi, earth.period, J2000_EPOCH_UNIX);
  const oneP = j2000MeanAnomaly(earth.L0, earth.varpi, earth.period, J2000_EPOCH_UNIX + earth.period);
  assert.ok(angDist(base, oneP) < 1e-6,
    `j2000MeanAnomaly: +1 period must return to Δt=0 value: angDist=${angDist(base, oneP)}`);
}

console.log('epoch.tt.test.mjs OK');
