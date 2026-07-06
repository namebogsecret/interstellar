// Real solar-system data. Distances/radii in metres, masses via GM (m^3/s^2),
// periods in seconds. Orbital elements are heliocentric J2000-ish, simplified
// (we keep a, e, i and spread the phase so bodies aren't artificially aligned).
//
// Sizes and distances are REAL and to scale relative to one another. The only
// "cheat" for findability is the point-marker drawn when a body is sub-pixel.
import { AU, DAY, DEG } from '../physics/constants.js';

const tex = (f) => `assets/textures/${f}`;

// J2000.0 epoch (2000-01-01 12:00 TT), expressed in Unix seconds.
const J2000_EPOCH_UNIX = 946728000;

function wrap(rad) {
  return ((rad % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
}

// Mean anomaly at `unixSeconds`, propagated linearly (mean motion) from the
// body's J2000 mean longitude L0. varpi = longitude of perihelion (Omega +
// omega), both angles in degrees. Pure function — no three/document/window —
// so it is node-testable with a fixed timestamp.
export function j2000MeanAnomaly(L0deg, varpiDeg, periodSec, unixSeconds) {
  return wrap(
    (L0deg - varpiDeg) * DEG + (2 * Math.PI / periodSec) * (unixSeconds - J2000_EPOCH_UNIX)
  );
}

// Helper: build a body record with sensible defaults.
function body(o) {
  return Object.assign({
    parent: null,          // name of parent body (null = orbits the Sun / is the Sun)
    e: 0, i: 0,            // eccentricity, inclination (rad once multiplied by DEG)
    Omega: 0, omega: 0,    // node / periapsis argument (rad)
    M0: 0,                 // mean anomaly at epoch (rad) — phase spread
    tilt: 0,               // axial tilt (rad)
    rotPeriod: Infinity,   // sidereal rotation (s); negative = retrograde
    color: 0xffffff,
    texture: null,
    clouds: null,
    atmosphere: null,      // {height(m), color, density0(kg/m^3), scaleHeight(m)}
    rings: null,           // {inner(m), outer(m), texture}
    emissive: false,
  }, o);
}

// Axial tilts & rotation are real. Planet M0 (mean anomaly) is derived below
// from each planet's real J2000 mean longitude (L0) so that sim.time = 0
// (module load / reset) places every planet at its true real-world position
// today. Moons keep an invented phase-spread — lunar/satellite ephemerides at
// J2000 precision are out of scope for this sim.
export const BODIES = [
  body({
    name: 'Sun', GM: 1.32712440018e20, radius: 6.957e8,
    rotPeriod: 25.05 * DAY, color: 0xfff5e0, texture: tex('2k_sun.jpg'),
    emissive: true,
  }),

  body({
    name: 'Mercury', parent: 'Sun', GM: 2.2032e13, radius: 2.4397e6,
    a: 0.387098 * AU, e: 0.205630, i: 7.005 * DEG, Omega: 48.331 * DEG, omega: 29.124 * DEG,
    period: 87.969 * DAY, rotPeriod: 58.646 * DAY, tilt: 0.034 * DEG,
    L0: 252.25084, // J2000 mean longitude (deg); real M0 set from this below
    color: 0x8c7853, texture: tex('2k_mercury.jpg'),
  }),

  body({
    name: 'Venus', parent: 'Sun', GM: 3.24859e14, radius: 6.0518e6,
    a: 0.723332 * AU, e: 0.006772, i: 3.395 * DEG, Omega: 76.680 * DEG, omega: 54.884 * DEG,
    period: 224.701 * DAY, rotPeriod: -243.025 * DAY, tilt: 177.36 * DEG,
    L0: 181.97973, // J2000 mean longitude (deg); real M0 set from this below
    color: 0xe8c873, texture: tex('2k_venus_atmosphere.jpg'),
    atmosphere: { height: 2.5e5, color: 0xe8d59a, density0: 65, scaleHeight: 15.9e3 },
  }),

  body({
    name: 'Earth', parent: 'Sun', GM: 3.986004418e14, radius: 6.371e6,
    a: 1.000000 * AU, e: 0.016709, i: 0.0 * DEG, Omega: -11.260 * DEG, omega: 114.207 * DEG,
    period: 365.256 * DAY, rotPeriod: 0.99726968 * DAY, tilt: 23.439 * DEG,
    L0: 100.46435, // J2000 mean longitude (deg); real M0 set from this below
    color: 0x2b5fa0, texture: tex('2k_earth_daymap.jpg'), clouds: tex('2k_earth_clouds.jpg'),
    atmosphere: { height: 1.0e5, color: 0x5b8dd6, density0: 1.225, scaleHeight: 8.5e3 },
  }),
  body({
    name: 'Moon', parent: 'Earth', GM: 4.9048695e12, radius: 1.7374e6,
    a: 3.844e8, e: 0.0549, i: 5.145 * DEG, period: 27.321661 * DAY,
    rotPeriod: 27.321661 * DAY, tilt: 6.68 * DEG,
    M0: 0.7, // invented phase spread — real lunar J2000 ephemeris out of scope
    color: 0x999999, texture: tex('2k_moon.jpg'),
  }),

  body({
    name: 'Mars', parent: 'Sun', GM: 4.282837e13, radius: 3.3895e6,
    a: 1.523679 * AU, e: 0.093400, i: 1.850 * DEG, Omega: 49.558 * DEG, omega: 286.502 * DEG,
    period: 686.980 * DAY, rotPeriod: 1.025957 * DAY, tilt: 25.19 * DEG,
    L0: 355.45332, // J2000 mean longitude (deg); real M0 set from this below
    color: 0xc1440e, texture: tex('2k_mars.jpg'),
    atmosphere: { height: 1.1e5, color: 0xd8a878, density0: 0.020, scaleHeight: 11.1e3 },
  }),
  // Moon M0 below: invented phase spread — real satellite J2000 ephemeris out of scope.
  body({
    name: 'Phobos', parent: 'Mars', GM: 7.087e5, radius: 1.11e4,
    a: 9.376e6, e: 0.0151, i: 1.093 * DEG, period: 0.31891 * DAY, M0: 1.0, color: 0x6b6157,
  }),
  body({
    name: 'Deimos', parent: 'Mars', GM: 9.615e4, radius: 6.2e3,
    a: 2.3463e7, e: 0.00033, i: 0.93 * DEG, period: 1.263 * DAY, M0: 2.5, color: 0x7a6f63,
  }),

  body({
    name: 'Jupiter', parent: 'Sun', GM: 1.26686534e17, radius: 6.9911e7,
    a: 5.20260 * AU, e: 0.048498, i: 1.303 * DEG, Omega: 100.464 * DEG, omega: 273.867 * DEG,
    period: 4332.589 * DAY, rotPeriod: 0.41354 * DAY, tilt: 3.13 * DEG,
    L0: 34.40438, // J2000 mean longitude (deg); real M0 set from this below
    color: 0xd8ca9d, texture: tex('2k_jupiter.jpg'),
  }),
  // Moon M0 below: invented phase spread — real satellite J2000 ephemeris out of scope.
  body({ name: 'Io',       parent: 'Jupiter', GM: 5.96e12, radius: 1.8216e6, a: 4.217e8,  period: 1.769 * DAY,  M0: 0.0, color: 0xd9d36a }),
  body({ name: 'Europa',   parent: 'Jupiter', GM: 3.20e12, radius: 1.5608e6, a: 6.711e8,  period: 3.551 * DAY,  M0: 1.6, color: 0xb6a98a }),
  body({ name: 'Ganymede', parent: 'Jupiter', GM: 9.89e12, radius: 2.6341e6, a: 1.0704e9, period: 7.155 * DAY,  M0: 3.0, color: 0x9b8e7d }),
  body({ name: 'Callisto', parent: 'Jupiter', GM: 7.18e12, radius: 2.4103e6, a: 1.8827e9, period: 16.689 * DAY, M0: 4.4, color: 0x6e6356 }),

  body({
    name: 'Saturn', parent: 'Sun', GM: 3.7931187e16, radius: 5.8232e7,
    a: 9.55491 * AU, e: 0.055508, i: 2.489 * DEG, Omega: 113.665 * DEG, omega: 339.392 * DEG,
    period: 10759.22 * DAY, rotPeriod: 0.43958 * DAY, tilt: 26.73 * DEG,
    L0: 49.94432, // J2000 mean longitude (deg); real M0 set from this below
    color: 0xe3d9a8, texture: tex('2k_saturn.jpg'),
    rings: { inner: 7.4e7, outer: 1.4022e8, texture: tex('2k_saturn_ring_alpha.jpg') },
  }),
  // Moon M0 below: invented phase spread — real satellite J2000 ephemeris out of scope.
  body({ name: 'Titan', parent: 'Saturn', GM: 8.978e12, radius: 2.5747e6, a: 1.22187e9, period: 15.945 * DAY, M0: 2.2, color: 0xd9a441,
    atmosphere: { height: 6e5, color: 0xcf9a3a, density0: 5.3, scaleHeight: 40e3 } }),

  body({
    name: 'Uranus', parent: 'Sun', GM: 5.793939e15, radius: 2.5362e7,
    a: 19.21845 * AU, e: 0.046381, i: 0.773 * DEG, Omega: 74.006 * DEG, omega: 96.998 * DEG,
    period: 30688.5 * DAY, rotPeriod: -0.71833 * DAY, tilt: 97.77 * DEG,
    L0: 313.23218, // J2000 mean longitude (deg); real M0 set from this below
    color: 0xa6dbe6, texture: tex('2k_uranus.jpg'),
  }),

  body({
    name: 'Neptune', parent: 'Sun', GM: 6.836529e15, radius: 2.4622e7,
    a: 30.11039 * AU, e: 0.009456, i: 1.770 * DEG, Omega: 131.784 * DEG, omega: 276.336 * DEG,
    period: 60182 * DAY, rotPeriod: 0.6713 * DAY, tilt: 28.32 * DEG,
    L0: 304.88003, // J2000 mean longitude (deg); real M0 set from this below
    color: 0x3f54ba, texture: tex('2k_neptune.jpg'),
  }),
  body({ name: 'Triton', parent: 'Neptune', GM: 1.428e12, radius: 1.3534e6, a: 3.5476e8, period: -5.877 * DAY, M0: 1.0, color: 0xc7b9a8 }),
];

// Set each planet's real M0 (mean anomaly at "now") from its J2000 mean
// longitude (L0). Moons have no L0 and keep their invented phase-spread.
const _nowUnix = Date.now() / 1000;
for (const b of BODIES) {
  if (typeof b.L0 === 'number') {
    const varpiDeg = (b.Omega + b.omega) / DEG; // Omega/omega are radians here; convert back to degrees
    b.M0 = j2000MeanAnomaly(b.L0, varpiDeg, b.period, _nowUnix);
  }
}

export function byName(name) {
  return BODIES.find((b) => b.name === name);
}
