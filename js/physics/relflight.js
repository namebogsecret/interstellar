// "Relativistic flight" hub: live summary of gamma by route + twin clocks to Proxima. Pure, no DOM.
// Nothing is re-derived here: route numbers come from neighbors.js (buildRows -> flightForDistance),
// the clock curve from twins.js (accelTrip/sampleTrip). Units: years, light-years, g.
import { NEIGHBORS } from '../data/neighbors.js';
import { buildRows, tripTo } from './neighbors.js';
import { accelTrip, sampleTrip } from './twins.js';

export const SUMMARY_COUNT = 10;
export const ACCEL_G = 1;

// One row per star SYSTEM (components of a system share the distance), nearest first, flip-and-burn.
// Row: { no, name, ru, system, ly, t (Earth years), tau (ship years), peakGamma, peakBeta }.
export function summaryRows({ count = SUMMARY_COUNT, accelG = ACCEL_G } = {}) {
  if (!Number.isInteger(count) || count < 1) throw new RangeError('count must be an integer >= 1');
  const seen = new Set();
  const stars = [];
  for (const s of NEIGHBORS) {
    if (seen.has(s.system)) continue;
    seen.add(s.system);
    stars.push(s);
    if (stars.length === count) break;
  }
  return buildRows(stars, accelG, 'flip').map((r, i) => ({
    no: i + 1, id: r.id, name: r.name, ru: r.ru, system: r.system, ly: r.ly,
    t: r.t, tau: r.tau, peakGamma: r.peakGamma, peakBeta: r.peakBeta,
  }));
}

// Round trip with the turnaround at distance ly: flip-and-burn out and back = twins.js accel trip whose
// four equal phases last (one-way Earth time)/2 each, so earthYears = 2 * t(one way).
export function twinsTo(ly, accelG = ACCEL_G, n = 200) {
  const oneWay = tripTo(ly, accelG, 'flip');
  if (!oneWay) throw new RangeError('trip is not representable');
  const trip = accelTrip({ accelG, earthYears: 2 * oneWay.t });
  return { ly, accelG, oneWay, trip, samples: sampleTrip(trip, n) };
}
