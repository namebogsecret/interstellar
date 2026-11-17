// Ship communications: light-time delay and longitudinal relativistic Doppler.
// Pure maths, no DOM. SI units (metres, seconds, Hz). Model: flat special relativity,
// purely radial (longitudinal) motion, vacuum; no gravity, no plasma, no antenna geometry.
// Beta = v/c; "eps" = 1 - beta is accepted wherever beta is, because for beta -> 1 the
// subtraction 1 - beta loses all its digits while eps itself can be carried exactly.
import { C, AU, LY, YEAR, DAY } from './constants.js';
import { STARS } from '../data/stars.js';

// Reference carriers (deep-space allocations; centre of the band).
export const CARRIERS = [
  { id: 'S', label: 'S-band', hz: 2.3e9 },
  { id: 'X', label: 'X-band', hz: 8.4e9 },
  { id: 'Ka', label: 'Ka-band', hz: 32e9 },
];

// Distance presets, metres. Solar-system values are Earth-centred ranges.
// Moon: mean geocentric distance 384 400 km. Mars and Jupiter: closest / farthest Earth-planet
// distance, NASA Planetary Fact Sheets (Mars 54.6 / 401.3 million km; Jupiter 588.5 / 968.5 million km).
// Stars: js/data/stars.js (parallax distances, light-years).
export const TARGETS = [
  { id: 'moon', en: 'Moon', ru: 'Луна', m: 3.844e8 },
  { id: 'sun', en: 'Sun (1 AU)', ru: 'Солнце (1 а.е.)', m: AU },
  { id: 'mars-min', en: 'Mars, closest', ru: 'Марс, ближайший', m: 54.6e9 },
  { id: 'mars-max', en: 'Mars, farthest', ru: 'Марс, дальний', m: 401.3e9 },
  { id: 'jupiter-min', en: 'Jupiter, closest', ru: 'Юпитер, ближайший', m: 588.5e9 },
  { id: 'jupiter-max', en: 'Jupiter, farthest', ru: 'Юпитер, дальний', m: 968.5e9 },
  ...STARS.map((s) => ({ id: 'star-' + s.name, en: s.name, ru: s.ru, m: s.ly * LY, star: true })),
];

function checkDist(d, name = 'distance') {
  if (typeof d !== 'number' || !Number.isFinite(d) || d <= 0) {
    throw new RangeError(name + ' must be a finite number > 0 (metres)');
  }
}

// Resolve {beta} or {eps = 1 - beta} to a consistent pair, eps in (0, 1], beta in [0, 1).
export function resolveBeta({ beta, eps } = {}) {
  if (eps !== undefined) {
    if (typeof eps !== 'number' || !Number.isFinite(eps) || eps <= 0 || eps > 1) {
      throw new RangeError('eps = 1 - beta must be in (0, 1]');
    }
    return { beta: 1 - eps, eps };
  }
  if (typeof beta !== 'number' || !Number.isFinite(beta) || beta < 0 || beta >= 1) {
    throw new RangeError('beta must be in [0, 1)');
  }
  return { beta, eps: 1 - beta };
}

// Lorentz factor 1/sqrt((1-b)(1+b)) = 1/sqrt(eps (2-eps)): exact near beta -> 1.
export function gammaOf(opts) {
  const { eps } = resolveBeta(opts);
  return 1 / Math.sqrt(eps * (2 - eps));
}

// Static ship (at rest relative to Earth) at distance d.
export function oneWayDelay(d) { checkDist(d); return d / C; }
export function roundTripDelay(d) { checkDist(d); return 2 * d / C; }

// A signal sent from Earth NOW toward a ship that is at distance d0 NOW and moves radially at beta.
// Receding: d0 / (c (1 - beta)); approaching: d0 / (c (1 + beta)).
export function chaseDelay({ d0, receding = true, ...b }) {
  checkDist(d0, 'd0');
  const { beta, eps } = resolveBeta(b);
  return receding ? d0 / (C * eps) : d0 / (C * (1 + beta));
}

// Ping: send now, ship reflects instantly, echo returns to Earth.
// Receding: 2 d0 / (c (1 - beta)); approaching: 2 d0 / (c (1 + beta)) (ship still outbound of Earth at reflection).
export function pingDelay(opts) { return 2 * chaseDelay(opts); }

// Longitudinal relativistic Doppler factor f_obs / f_emit = exp(-+rapidity)
// = sqrt((1-b)/(1+b)) receding, its inverse approaching. Written through eps: sqrt(eps/(2-eps)).
export function dopplerFactor({ receding = true, ...b }) {
  const { eps } = resolveBeta(b);
  const red = Math.sqrt(eps / (2 - eps));
  return receding ? red : 1 / red;
}

// Split of the received rate into its two physical pieces (product = dopplerFactor):
//   dilation  = 1/gamma  (ship clock ticks slower, dtau/dt)
//   kinematic = 1/(1+b) receding, 1/(1-b) approaching (changing light-path length)
export function dopplerParts({ receding = true, ...b }) {
  const { beta, eps } = resolveBeta(b);
  const dilation = 1 / gammaOf({ eps });
  const kinematic = receding ? 1 / (1 + beta) : 1 / eps;
  return { dilation, kinematic, total: dilation * kinematic };
}

export function receivedFrequency(f0, opts) {
  if (typeof f0 !== 'number' || !Number.isFinite(f0) || f0 <= 0) throw new RangeError('f0 must be a finite number > 0 (Hz)');
  return f0 * dopplerFactor(opts);
}
export function wavelength(f) {
  if (typeof f !== 'number' || !Number.isFinite(f) || f <= 0) throw new RangeError('f must be a finite number > 0 (Hz)');
  return C / f;
}

// Everything the page shows, for one state.
export function commsState({ d, receding = true, f0, ...b }) {
  checkDist(d);
  const { beta, eps } = resolveBeta(b);
  const doppler = dopplerFactor({ eps, receding });
  const fRx = receivedFrequency(f0, { eps, receding });
  return {
    beta, eps, receding, gamma: gammaOf({ eps }),
    oneWay: oneWayDelay(d), roundTrip: roundTripDelay(d),
    chase: chaseDelay({ d0: d, eps, receding }), ping: pingDelay({ d0: d, eps, receding }),
    doppler, shift: doppler < 1 ? 'red' : doppler > 1 ? 'blue' : 'none',
    parts: dopplerParts({ eps, receding }),
    fTx: f0, fRx, lambdaTx: wavelength(f0), lambdaRx: wavelength(fRx),
  };
}

// Decimals the page shows for a value of magnitude a (4 significant digits at most).
export function sigDecimals(a) { return a >= 1000 ? 0 : a >= 100 ? 1 : a >= 10 ? 2 : a >= 1 ? 3 : 4; }

// Human-readable duration: picks the largest unit in which the value is >= 1. A value that
// would be DISPLAYED as the next unit's size (59.999 s -> "60.00 s") is promoted ("1.00 min").
export function humanDuration(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) throw new RangeError('seconds must be finite and >= 0');
  const steps = [['yr', YEAR], ['d', DAY], ['h', 3600], ['min', 60], ['s', 1]];
  let i = steps.findIndex(([, size]) => seconds >= size);
  if (i < 0) return { value: seconds, unit: 's' };
  while (i > 0) {
    const v = seconds / steps[i][1], ratio = steps[i - 1][1] / steps[i][1];
    if (+v.toFixed(sigDecimals(v)) >= ratio) i--; else break;
  }
  return { value: seconds / steps[i][1], unit: steps[i][0] };
}

// Log slider helpers: s in [0, 1000]. The distance scale runs from the Moon to 100 light-years.
export const DIST_MIN = 3.844e8;
export function distFromSlider(s, lo = DIST_MIN, hi = 100 * LY) {
  if (!Number.isFinite(s)) throw new RangeError('slider must be finite');
  const f = Math.min(1, Math.max(0, s / 1000));
  return lo * Math.pow(hi / lo, f);
}
export function sliderFromDist(d, lo = DIST_MIN, hi = 100 * LY) {
  checkDist(d);
  return Math.min(1000, Math.max(0, 1000 * Math.log(d / lo) / Math.log(hi / lo)));
}
// eps = 1 - beta on a log scale from 1 (beta = 0) down to 1e-5 (beta = 0.99999).
export const EPS_MIN = 1e-5;
export function epsFromSlider(s) {
  if (!Number.isFinite(s)) throw new RangeError('slider must be finite');
  return Math.pow(EPS_MIN, Math.min(1, Math.max(0, s / 1000)));
}
export function sliderFromEps(eps) {
  if (!(eps > 0 && eps <= 1)) throw new RangeError('eps must be in (0, 1]');
  return Math.min(1000, Math.max(0, 1000 * Math.log(eps) / Math.log(EPS_MIN)));
}
