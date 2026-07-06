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

// ─────────────────────────────────────────────────────────────────────────────
// UNIVERSAL-VARIABLE KEPLER PROPAGATOR (Vallado "KEPLER" / Curtis Alg. 3.4).
// Advances a two-body RELATIVE state along its conic. Valid for ALL conics —
// ellipse (α>0), parabola (α≈0), hyperbola (α<0) and near-parabolic (e≈1) —
// because the Stumpff functions C(ψ), S(ψ) never form a/e/(1−e), which blow up
// at the parabola. Used by the analytic warp-coast (cabotage.js).
// ─────────────────────────────────────────────────────────────────────────────

// Stumpff functions. Near ψ=0 the closed forms are 0/0, so a Maclaurin series
// takes over (C→1/2, S→1/6 at ψ=0) — this IS why universal variables are valid
// through the parabolic case with no e-specific branch.
export function stumpffC(psi) {
  if (psi > 1e-6) {
    const s = Math.sqrt(psi);
    return (1 - Math.cos(s)) / psi;
  } else if (psi < -1e-6) {
    const s = Math.sqrt(-psi);
    return (Math.cosh(s) - 1) / (-psi);
  }
  // 1/2! − ψ/4! + ψ²/6! − ψ³/8! + ψ⁴/10!
  const p2 = psi * psi;
  return 1 / 2 - psi / 24 + p2 / 720 - p2 * psi / 40320 + p2 * p2 / 3628800;
}

export function stumpffS(psi) {
  if (psi > 1e-6) {
    const s = Math.sqrt(psi);
    return (s - Math.sin(s)) / (s * s * s);
  } else if (psi < -1e-6) {
    const s = Math.sqrt(-psi);
    return (Math.sinh(s) - s) / (s * s * s);
  }
  // 1/3! − ψ/5! + ψ²/7! − ψ³/9! + ψ⁴/11!
  const p2 = psi * psi;
  return 1 / 6 - psi / 120 + p2 / 5040 - p2 * psi / 362880 + p2 * p2 / 39916800;
}

// Module scratch for the propagator result (allocation-free hot path). Never
// touched by any other function — the outputs are built here, then copied to the
// caller's rOut/vOut LAST so aliasing (rOut===r0Vec) is safe.
const _pR = new THREE.Vector3();
const _pV = new THREE.Vector3();

// Advance the relative state (r0Vec,v0Vec) about a body of parameter mu forward
// by dt along its conic. Writes new position→rOut, velocity→vOut. Returns TRUE
// on convergence; FALSE (rOut/vOut UNMODIFIED, never NaN, never partial) if the
// input is degenerate or Newton fails to converge in 50 iters → caller falls
// back to numeric. ALIASING-SAFE: rOut may === r0Vec, vOut may === v0Vec.
export function propagateUniversal(mu, r0Vec, v0Vec, dt, rOut, vOut) {
  if (!(mu > 0) || !Number.isFinite(mu) || !Number.isFinite(dt)) return false;
  const r0 = r0Vec.length();
  if (!(r0 > 0) || !Number.isFinite(r0)) return false;
  const v0sq = v0Vec.lengthSq();
  if (!Number.isFinite(v0sq)) return false;

  const sqrtmu = Math.sqrt(mu);
  const rdotv = r0Vec.dot(v0Vec);
  const alpha = 2 / r0 - v0sq / mu;             // 1/a: >0 ellipse, ≈0 parabola, <0 hyperbola
  const smudt = sqrtmu * dt;

  // Initial guess for the universal anomaly χ (per-conic, Vallado).
  let chi;
  if (alpha > 1e-9) {
    chi = smudt * alpha;                        // ellipse: exact linear (mean) part
  } else if (alpha < -1e-9) {
    const a = 1 / alpha;                        // negative
    const sgn = dt >= 0 ? 1 : -1;
    const num = -2 * mu * alpha * dt;
    const den = rdotv + sgn * Math.sqrt(-mu * a) * (1 - r0 * alpha);
    chi = sgn * Math.sqrt(-a) * Math.log(num / den);
    if (!Number.isFinite(chi)) chi = smudt / r0; // fallback if the log arg degenerates
  } else {
    chi = smudt / r0;                           // (near-)parabolic: matches Barker scale
  }

  // Newton–Raphson on the universal Kepler equation.
  let converged = false;
  for (let it = 0; it < 50; it++) {
    const chi2 = chi * chi;
    const psi = alpha * chi2;
    const C = stumpffC(psi);
    const S = stumpffS(psi);
    if (!Number.isFinite(C) || !Number.isFinite(S)) return false;
    const chi3 = chi2 * chi;
    const term = rdotv / sqrtmu;
    const F = term * chi2 * C + (1 - alpha * r0) * chi3 * S + r0 * chi - smudt;
    const dF = term * chi * (1 - psi * S) + (1 - alpha * r0) * chi2 * C + r0;
    if (!Number.isFinite(F) || !Number.isFinite(dF) || dF === 0) return false;
    const dchi = F / dF;
    chi -= dchi;
    if (Math.abs(F) <= 1e-10 * (Math.abs(smudt) + 1) ||
        Math.abs(dchi) <= 1e-9 * (Math.abs(chi) + 1)) { converged = true; break; }
  }
  if (!converged) return false;

  // f, g and their dots at the converged χ → build result in scratch, copy last.
  const chi2 = chi * chi;
  const psi = alpha * chi2;
  const C = stumpffC(psi);
  const S = stumpffS(psi);
  if (!Number.isFinite(C) || !Number.isFinite(S)) return false;
  const chi3 = chi2 * chi;

  const f = 1 - (chi2 / r0) * C;
  const g = dt - (1 / sqrtmu) * chi3 * S;
  _pR.copy(r0Vec).multiplyScalar(f).addScaledVector(v0Vec, g);
  const rNewMag = _pR.length();
  if (!(rNewMag > 0) || !Number.isFinite(rNewMag)) return false;

  // Enforce the Wronskian f·ġ − ḟ·g = 1 EXACTLY (not just to round-off): this is
  // what makes the specific angular momentum h = r×v = W·h0 bit-conserved. Solve
  // for whichever of ġ/ḟ divides by the better-conditioned denominator — |f| is
  // small only near a quarter-orbit (where |g| is large) and vice-versa, so one
  // of the two is always well away from zero.
  let fdot, gdot;
  if (Math.abs(f) >= 0.1) {
    fdot = (sqrtmu / (rNewMag * r0)) * chi * (psi * S - 1);
    gdot = (1 + g * fdot) / f;
  } else {
    gdot = 1 - (chi2 / rNewMag) * C;
    fdot = (f * gdot - 1) / g;
  }
  _pV.copy(r0Vec).multiplyScalar(fdot).addScaledVector(v0Vec, gdot);

  if (!Number.isFinite(_pR.x + _pR.y + _pR.z + _pV.x + _pV.y + _pV.z)) return false;
  rOut.copy(_pR);
  vOut.copy(_pV);
  return true;
}

// Heliocentric velocity (m/s, world frame) of a body at time t by central finite
// difference (h=60 s) of its absolute position. Pure — RELOCATED here from
// main.js so the physics layer owns it (main.js imports it). Scratch is module-
// private and consumed transiently, never read across calls.
const _bvA = new THREE.Vector3();
const _bvC = new THREE.Vector3();
export function bodyVelocity(b, t, byName, out = new THREE.Vector3()) {
  const h = 60;
  absolutePosition(b, t + h, byName, _bvA);
  absolutePosition(b, t - h, byName, _bvC);
  return out.subVectors(_bvA, _bvC).multiplyScalar(1 / (2 * h));
}
