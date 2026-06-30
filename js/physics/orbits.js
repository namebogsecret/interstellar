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
