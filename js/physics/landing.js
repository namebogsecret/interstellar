// Landing radar: a pure, DOM-free estimate of "how hard will I hit the ground
// if I stop burning now". Inputs are relative to the CO-ROTATING ground (the
// caller passes ship.v − groundVelocity(...)), i.e. the same quantity that
// touchdown() in main.js measures — so the radar's crash verdict and the real
// crash verdict use one threshold (CRASH_SPEED) in one frame.
//
// Honest model, documented: ballistic coast in a point-mass field, no thrust,
// no atmosphere, no further rotation of the ground during the fall.
//   impactSpeed — energy conservation:  v_imp² = |v|² + 2·GM·(1/R − 1/r)
//   tImpact     — constant-gEff fall from altitude h, gEff = GM/r² − vHoriz²/r:
//                 h + vVert·t − ½·gEff·t² = 0 → t = (vVert + sqrt(vVert² + 2·gEff·h)) / gEff
//                 (gEff ≤ 1e-9, near-orbit: linear t = h / (−vVert))
import * as THREE from 'three';

// Touchdown speed (m/s, rel. co-rotating ground) above which contact is a crash.
// SINGLE source of the threshold — main.js touchdown() imports it.
export const CRASH_SPEED = 50;
// Radar is only active below this fraction of the body radius in altitude.
export const RADAR_MAX_ALT_FRAC = 0.1;

// Dedicated module scratch (never shared with other modules — ГРАБЛИ: aliasing
// of scratch vectors). Inputs rRel / vGround are only READ.
const _up = new THREE.Vector3();
const _horiz = new THREE.Vector3();

const finiteVec = (v) => v != null
  && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

function inactive(out) {
  out.active = false;
  out.altitude = NaN; out.vVert = NaN; out.vHoriz = NaN;
  out.impactSpeed = NaN; out.tImpact = NaN;
  out.willCrash = false;
  return out;
}

export function landingRadar(rRel, vGround, body, impacting, out = {}) {
  if (out == null || typeof out !== 'object') out = {};
  try {
    if (!finiteVec(rRel) || !finiteVec(vGround) || body == null) return inactive(out);
    const GM = body.GM, R = body.radius;
    if (!Number.isFinite(GM) || !Number.isFinite(R) || !(GM > 0) || !(R > 0)) return inactive(out);
    if (impacting !== true) return inactive(out);

    const r = rRel.length();
    if (!(r > 0) || !Number.isFinite(r)) return inactive(out);
    const h = r - R;
    if (!(h >= 0) || !(h < RADAR_MAX_ALT_FRAC * R)) return inactive(out);

    _up.copy(rRel).divideScalar(r);
    const vVert = _up.dot(vGround);
    if (!(vVert < -0.1)) return inactive(out);
    const vHoriz = _horiz.copy(vGround).addScaledVector(_up, -vVert).length();

    const v2 = vGround.lengthSq();
    const impactSpeed = Math.sqrt(Math.max(0, v2 + 2 * GM * (1 / R - 1 / r)));
    const g = GM / (r * r);
    // Effective radial acceleration: gravity minus the centrifugal term vHoriz²/r.
    const gEff = g - (vHoriz * vHoriz) / r;
    const tImpact = gEff > 1e-9
      ? (vVert + Math.sqrt(vVert * vVert + 2 * gEff * h)) / gEff
      : h / (-vVert);

    if (![vVert, vHoriz, impactSpeed, tImpact, g].every(Number.isFinite)) return inactive(out);

    out.active = true;
    out.altitude = h;
    out.vVert = vVert;
    out.vHoriz = vHoriz;
    out.impactSpeed = impactSpeed;
    out.tImpact = tImpact;
    out.willCrash = impactSpeed > CRASH_SPEED;
    return out;
  } catch (_) {
    // Contract: never throws (e.g. a getter on a malformed input).
    return inactive(out);
  }
}
