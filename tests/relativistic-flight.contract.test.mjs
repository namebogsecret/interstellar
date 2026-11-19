// "Relativistic flight" hub — CONTRACT tests for js/physics/relflight.js. References are independent:
// textbook closed forms in plain Math (hyperbolic motion), the neighbours table and the twins module.
import assert from 'node:assert/strict';
import { NEIGHBORS } from '../js/data/neighbors.js';
import { buildRows, tripTo } from '../js/physics/neighbors.js';
import { flyby } from '../js/physics/accel.js';
import { clocksAt } from '../js/physics/twins.js';
import { summaryRows, twinsTo, SUMMARY_COUNT, ACCEL_G } from '../js/physics/relflight.js';

let checks = 0;
const rel = (a, b) => Math.abs(a - b) / (Math.abs(b) || 1);
const near = (a, b, tol, msg) => { checks++; assert.ok(rel(a, b) <= tol, `${msg}: ${a} vs ${b} (rel ${rel(a, b)})`); };
const ok = (c, msg) => { checks++; assert.ok(c, msg); };
const throwsRange = (fn, msg) => { checks++; assert.throws(fn, (e) => e instanceof RangeError, msg); };

const A = 9.80665 * 365.25 * 86400 / 299792458; // 1 g in ly/yr^2, independent literal chain

// ---- summary rows ----
ok(SUMMARY_COUNT === 10 && ACCEL_G === 1, 'defaults: 10 systems, 1 g');
const rows = summaryRows();
ok(rows.length === 10, '10 rows');
ok(new Set(rows.map((r) => r.system)).size === 10, 'one row per system (no Alpha Cen A/B duplicates)');
ok(rows[0].id === 'proxima' && rows[0].no === 1, 'nearest first = Proxima');
for (let i = 1; i < rows.length; i++) ok(rows[i].ly >= rows[i - 1].ly, 'distance non-decreasing ' + i);
for (const r of rows) {
  // consistent with the neighbours table for the same star
  const b = buildRows(NEIGHBORS, 1, 'flip').find((x) => x.id === r.id);
  near(r.t, b.t, 1e-12, 'Earth time vs buildRows ' + r.id);
  near(r.tau, b.tau, 1e-12, 'ship time vs buildRows ' + r.id);
  near(r.peakGamma, b.peakGamma, 1e-12, 'peak gamma vs buildRows ' + r.id);
  // analytic flip-and-burn at 1 g: gamma_peak = 1 + a D/2, tau = (2/a) acosh(gamma), t = (2/a) sqrt(gamma^2-1)
  const g = 1 + A * r.ly / 2;
  near(r.peakGamma, g, 1e-9, 'peak gamma = 1 + aD/2c^2 ' + r.id);
  near(r.tau, (2 / A) * Math.acosh(g), 1e-9, 'tau analytic ' + r.id);
  near(r.t, (2 / A) * Math.sqrt(g * g - 1), 1e-9, 't analytic ' + r.id);
  ok(r.tau < r.t && r.t > r.ly, 'ship clock < Earth clock; Earth time > light time ' + r.id);
  ok(r.peakBeta > 0 && r.peakBeta < 1, 'beta in (0,1) ' + r.id);
}
for (let i = 1; i < rows.length; i++) {
  ok(rows[i].t >= rows[i - 1].t && rows[i].tau >= rows[i - 1].tau && rows[i].peakGamma >= rows[i - 1].peakGamma,
    'monotone in distance ' + i);
}
// Proxima at 1 g flip-and-burn: textbook ~3.6 yr ship, ~5.9 yr Earth, gamma ~ 3.2
near(rows[0].peakGamma, 1 + A * 4.2465 / 2, 1e-12, 'Proxima peak gamma');
ok(rows[0].tau > 3.4 && rows[0].tau < 3.8, 'Proxima ship time ~3.6 yr');
ok(rows[0].t > 5.8 && rows[0].t < 6.1, 'Proxima Earth time ~5.9 yr');
// flyby peak gamma at 1 g to Proxima = 1 + aD/c^2 (the contract example)
near(tripTo(4.2465, 1, 'flyby').peakGamma, 1 + A * 4.2465, 1e-12, 'flyby gamma = 1 + aD');
near(flyby({ accelG: 1, d: 4.2465 }).peakGamma, 1 + A * 4.2465, 1e-12, 'accel.js flyby gamma');

// other accelerations / counts
const r3 = summaryRows({ count: 3, accelG: 2 });
ok(r3.length === 3, 'count=3');
near(r3[0].peakGamma, 1 + 2 * A * 4.2465 / 2, 1e-9, '2 g Proxima gamma');
ok(r3[0].t < rows[0].t, 'more acceleration, shorter trip');
throwsRange(() => summaryRows({ count: 0 }), 'count 0');
throwsRange(() => summaryRows({ count: 1.5 }), 'count fractional');
throwsRange(() => summaryRows({ accelG: -1 }), 'negative accel');

// ---- twins to Proxima ----
const tw = twinsTo(4.2465);
near(tw.trip.turnaroundLy, 4.2465, 1e-9, 'turnaround at Proxima');
near(tw.trip.earthYears, 2 * rows[0].t, 1e-12, 'round trip Earth time = 2 x one way');
near(tw.trip.shipYears, 2 * rows[0].tau, 1e-9, 'round trip ship time = 2 x one way');
near(tw.trip.gamma, rows[0].peakGamma, 1e-9, 'twins gamma = flip peak gamma');
ok(tw.samples.length === 201, '201 samples');
ok(tw.samples[0].t === 0 && tw.samples[0].tau === 0, 'starts at zero');
near(tw.samples[200].t, tw.trip.earthYears, 1e-12, 'ends at T');
near(tw.samples[200].tau, tw.trip.shipYears, 1e-9, 'ends at ship total');
for (let i = 1; i < tw.samples.length; i++) {
  ok(tw.samples[i].t > tw.samples[i - 1].t && tw.samples[i].tau >= tw.samples[i - 1].tau, 'clocks monotone ' + i);
  ok(tw.samples[i].tau <= tw.samples[i].t + 1e-12, 'ship clock never ahead of Earth ' + i);
}
{ // halfway = at Proxima: ship clock = one-way tau, position = D
  const mid = clocksAt(tw.trip, tw.trip.earthYears / 2);
  near(mid.tau, rows[0].tau, 1e-9, 'tau at turnaround = one-way tau');
  near(mid.x, 4.2465, 1e-9, 'x at turnaround = D');
}
throwsRange(() => twinsTo(-1), 'negative ly');
throwsRange(() => twinsTo(4.2, 0), 'zero accel');

console.log(`relativistic-flight.contract: ${checks} checks OK`);
