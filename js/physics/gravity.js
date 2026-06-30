// N-body gravitational acceleration on the ship from every massive body.
// Bodies act as point masses (valid outside their radius). Inside a body we
// clamp to the surface value to avoid singularities (and to set up landing).
import * as THREE from 'three';

const d = new THREE.Vector3();

// state.positions: Map<name, THREE.Vector3> of current body positions (m).
// Returns acceleration (m/s^2) in `out`.
export function gravityAccel(shipPos, bodies, positions, out = new THREE.Vector3()) {
  out.set(0, 0, 0);
  for (const b of bodies) {
    if (!b.GM) continue;
    const bp = positions.get(b.name);
    if (!bp) continue;
    d.subVectors(bp, shipPos);
    let r2 = d.lengthSq();
    const rSurf2 = b.radius * b.radius;
    if (r2 < rSurf2) r2 = rSurf2;           // clamp inside the body
    const r = Math.sqrt(r2);
    const a = b.GM / r2;                      // magnitude toward the body
    out.addScaledVector(d, a / r);            // d/r is the unit vector
  }
  return out;
}

// Dominant gravity source (nearest in terms of strongest pull) — used for the
// HUD "reference body", altitude, and atmosphere checks.
export function dominantBody(shipPos, bodies, positions) {
  let best = null, bestPull = -Infinity;
  for (const b of bodies) {
    if (!b.GM) continue;
    const bp = positions.get(b.name);
    if (!bp) continue;
    const r2 = Math.max(bp.distanceToSquared(shipPos), b.radius * b.radius);
    const pull = b.GM / r2;
    if (pull > bestPull) { bestPull = pull; best = b; }
  }
  return best;
}
