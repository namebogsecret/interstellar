// Keplerian orbit propagation. Planets/moons ride analytic "rails" (they are
// not mutually gravitating) — cheap, stable, and visually correct. Only the
// ship feels real N-body gravity (see gravity.js).
import * as THREE from 'three';

// Solve Kepler's equation M = E - e*sin(E) for eccentric anomaly E (Newton).
function eccentricAnomaly(M, e) {
  M = ((M % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  let E = e < 0.8 ? M : Math.PI;
  for (let k = 0; k < 8; k++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-12) break;
  }
  return E;
}

// Position of a body in its PARENT-centred inertial frame at time t (seconds
// since epoch). Returns a fresh THREE.Vector3 (double precision) in metres.
export function orbitalPosition(b, t, out = new THREE.Vector3()) {
  if (!b.parent || !b.period) return out.set(0, 0, 0);
  const n = (2 * Math.PI) / b.period;           // mean motion (signed -> retrograde)
  const M = b.M0 + n * t;
  const E = eccentricAnomaly(M, b.e);

  // Position in the orbital plane (periapsis along +x).
  const xp = b.a * (Math.cos(E) - b.e);
  const yp = b.a * Math.sqrt(1 - b.e * b.e) * Math.sin(E);

  // Rotate: argument of periapsis (omega) -> inclination (i) -> node (Omega).
  const cw = Math.cos(b.omega), sw = Math.sin(b.omega);
  const ci = Math.cos(b.i),     si = Math.sin(b.i);
  const cO = Math.cos(b.Omega), sO = Math.sin(b.Omega);

  // Standard 3-1-3 rotation, mapping ecliptic plane to world XZ (y = "up").
  const x1 = cw * xp - sw * yp;
  const y1 = sw * xp + cw * yp;
  const x2 = x1;
  const y2 = ci * y1;
  const z2 = si * y1;
  const X = cO * x2 - sO * y2;
  const Y = sO * x2 + cO * y2;
  const Z = z2;

  // Map (X, Y) ecliptic-plane to world (x, z); orbital inclination -> world y.
  return out.set(X, Z, Y);
}

// Absolute (heliocentric) position: walk the parent chain.
export function absolutePosition(b, t, byName, out = new THREE.Vector3()) {
  orbitalPosition(b, t, out);
  let p = b.parent ? byName(b.parent) : null;
  const tmp = new THREE.Vector3();
  while (p) {
    orbitalPosition(p, t, tmp);
    out.add(tmp);
    p = p.parent ? byName(p.parent) : null;
  }
  return out;
}

// Sample the full orbit as parent-centred points (for drawing orbit lines).
export function orbitEllipse(b, segments = 256) {
  const pts = [];
  if (!b.parent || !b.period) return pts;
  const cw = Math.cos(b.omega), sw = Math.sin(b.omega);
  const ci = Math.cos(b.i),     si = Math.sin(b.i);
  const cO = Math.cos(b.Omega), sO = Math.sin(b.Omega);
  for (let k = 0; k <= segments; k++) {
    const E = (k / segments) * 2 * Math.PI;
    const xp = b.a * (Math.cos(E) - b.e);
    const yp = b.a * Math.sqrt(1 - b.e * b.e) * Math.sin(E);
    const x1 = cw * xp - sw * yp, y1 = sw * xp + cw * yp;
    const y2 = ci * y1, z2 = si * y1;
    const X = cO * x1 - sO * y2, Y = sO * x1 + cO * y2, Z = z2;
    pts.push(new THREE.Vector3(X, Z, Y));
  }
  return pts;
}

// Rotation angle of a body about its spin axis at time t.
export function spinAngle(b, t) {
  if (!isFinite(b.rotPeriod) || b.rotPeriod === 0) return 0;
  return (2 * Math.PI * t) / b.rotPeriod;
}

// World-frame reference for spin-axis tilt (obliquity direction simplified —
// only the magnitude of surface speed matters downstream, not the true node
// of the equinoxes, so we just tip "up" by the body's axial tilt).
const X_AXIS = new THREE.Vector3(1, 0, 0);

// Unit spin axis of a body in the world frame. Always well-defined (even when
// rotPeriod is 0/non-finite, in which case the downstream angular velocity is
// zero but the axis direction itself is still meaningful for e.g. rendering).
export function spinAxis(b, out = new THREE.Vector3()) {
  return out.set(0, 1, 0).applyAxisAngle(X_AXIS, b.tilt || 0);
}

// Velocity (m/s, world frame) of the point on a rotating body at `shipPos`
// due to that body's spin: v = omega x r, omega = spinAxis(b) * (2*pi/rotPeriod)
// (SIGNED -- a negative rotPeriod is retrograde, matching spinAngle's sign
// convention), r = shipPos - bodyPos. Returns (0,0,0) if rotPeriod is 0 or
// non-finite (no rotation, or undefined for a body without one).
const _spinAxis = new THREE.Vector3();
const _r = new THREE.Vector3();
export function surfaceRotationVelocity(b, shipPos, bodyPos, out = new THREE.Vector3()) {
  if (!isFinite(b.rotPeriod) || b.rotPeriod === 0) return out.set(0, 0, 0);
  const omega = (2 * Math.PI) / b.rotPeriod;      // signed: negative -> retrograde
  spinAxis(b, _spinAxis).multiplyScalar(omega);   // omega vector
  _r.subVectors(shipPos, bodyPos);
  return out.crossVectors(_spinAxis, _r);
}

// Relative velocity (m/s) for a circular orbit at the current radius,
// preserving the orbital plane and prograde sense of the given state vector.
// mu = standard gravitational parameter (b.GM) of the body being orbited.
const _h = new THREE.Vector3();
const _dir = new THREE.Vector3();
export function circularizeVelocity(mu, rVec, vVec, out = new THREE.Vector3()) {
  const r = rVec.length();
  const speed = Math.sqrt(mu / r);
  _h.crossVectors(rVec, vVec);
  if (_h.lengthSq() > 1e-12) {
    _dir.crossVectors(_h, rVec).normalize();
  } else {
    // Radial (degenerate) state: no defined orbital plane -- pick any unit
    // vector perpendicular to rVec.
    _dir.set(-rVec.y, rVec.x, 0);
    if (_dir.lengthSq() < 1e-12) _dir.set(0, -rVec.z, rVec.y);
    _dir.normalize();
  }
  return out.copy(_dir).multiplyScalar(speed);
}

// Classic two-body orbital elements from a state vector (rVec, vVec) about a
// body with gravitational parameter mu. Returns { a, e, rPeri, rApo }.
// NOTE: rVec/vVec are typically formed by subtracting two heliocentric
// double-precision positions (~1e11 m each); the subtraction leaves ~1e3 m of
// floating-point residual error. Fine for a HUD readout, NOT for physics.
export function orbitFromState(mu, rVec, vVec) {
  const r = rVec.length();
  const v2 = vVec.lengthSq();
  const eps = v2 / 2 - mu / r;                    // specific orbital energy
  const a = -mu / (2 * eps);
  const rv = rVec.dot(vVec);
  const ex = ((v2 - mu / r) * rVec.x - rv * vVec.x) / mu;
  const ey = ((v2 - mu / r) * rVec.y - rv * vVec.y) / mu;
  const ez = ((v2 - mu / r) * rVec.z - rv * vVec.z) / mu;
  const e = Math.sqrt(ex * ex + ey * ey + ez * ez);
  if (e >= 1) {
    // Hyperbolic/parabolic -- unbound. rPeri is still meaningful; rApo is not.
    return { a, e, rPeri: a * (1 - e), rApo: Infinity };
  }
  return { a, e, rPeri: a * (1 - e), rApo: a * (1 + e) };
}
