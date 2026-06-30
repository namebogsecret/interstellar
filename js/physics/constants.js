// Physical & astronomical constants — all SI (metres, seconds, kilograms).
export const C        = 299792458;            // speed of light, m/s
export const C2       = C * C;
export const G        = 6.67430e-11;          // gravitational constant
export const AU       = 1.495978707e11;       // astronomical unit, m
export const DAY      = 86400;                // seconds
export const YEAR     = 365.25 * DAY;
export const DEG      = Math.PI / 180;

// One Earth gravity, handy for thrust limits / human-tolerance display.
export const G0       = 9.80665;              // m/s^2

// Rendering helper: bodies smaller than this many pixels are drawn as a
// star-like point marker so distant planets remain findable.
export const MIN_PIXEL_SIZE = 3;
