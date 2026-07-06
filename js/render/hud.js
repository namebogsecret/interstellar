import * as THREE from 'three';
import { G0 } from '../physics/constants.js';
import { orbitFromState } from '../physics/orbits.js';
import { t, bodyName, fmtDist, fmtSpeed, fmtTime } from '../i18n.js';

const $ = (id) => document.getElementById(id);
// Some nav readouts (periapsis/apoapsis/closing-speed/closest-approach) don't
// have a home in index.html yet -- set defensively so a missing element never
// throws, and the row lights up as soon as the markup lands.
const setText = (id, txt) => { const el = $(id); if (el) el.textContent = txt; };

// Scratch vectors, reused every frame to avoid per-frame allocation in the
// render loop (house pattern -- see orbits.js / ship.js module-level temps).
const _r = new THREE.Vector3();
const _v = new THREE.Vector3();
const _rRel = new THREE.Vector3();
const _vRel = new THREE.Vector3();
const _closePos = new THREE.Vector3();

// Fallback felt-acceleration for the brachistochrone ETA when the ship is
// coasting (lastAccel ~ 0) -- otherwise t = 2*sqrt(d/a) is infinite, which is
// a useless readout. 1 g is a reasonable "if you burned" baseline.
const FALLBACK_ACCEL = G0;

export function updateHUD(ship, sim, nav = {}) {
  const g = ship.gamma, v = ship.speed, beta = ship.beta;
  $('speed').textContent   = fmtSpeed(v) + (v > 1e5 ? `  (${(beta * 100).toFixed(3)} %c)` : '');
  $('gamma').textContent   = g.toFixed(g < 100 ? 4 : 1);
  $('dilation').textContent = t('dyn.dilation', { g: g.toFixed(3) });

  $('mode').textContent = ship.mode === 'arcade' ? t('mode.arcade') : t('mode.realistic');
  $('throttle').textContent = (ship.throttle * 100).toFixed(0) + ' %';
  $('gforce').textContent = (ship.lastAccel.length() / G0).toFixed(2) + ' g';

  if (ship.mode === 'realistic') {
    const frac = ship.fuelMass / ship.fuelMass0 * 100;
    $('fuel').textContent = frac.toFixed(1) + ' %  ' + t('dyn.dvleft', { v: fmtSpeed(ship.deltaVBudget()) });
  } else {
    $('fuel').textContent = t('val.infinite');
  }

  if (ship.refBody) {
    $('refbody').textContent = bodyName(ship.refBody.name);
    $('altitude').textContent = fmtDist(ship.altitude);
    $('atmo').textContent = ship.atmoDensity > 1e-6
      ? t('dyn.atmoIn', { rho: ship.atmoDensity.toFixed(4) })
      : t('dyn.vacuum');
  }

  // --- Orbit prediction: periapsis / apoapsis around the reference body. ---
  if (nav.refBody && nav.refPos && nav.refVel) {
    _r.subVectors(ship.pos, nav.refPos);
    _v.subVectors(ship.v, nav.refVel);
    const { e, rPeri, rApo } = orbitFromState(nav.refBody.GM, _r, _v);
    const radius = nav.refBody.radius;
    setText('periapsis', fmtDist(rPeri - radius) + (rPeri < radius ? ` (${t('nav.impact')})` : ''));
    setText('apoapsis', e >= 1 ? t('nav.escape') : fmtDist(rApo - radius));
  } else {
    setText('periapsis', '—'); setText('apoapsis', '—');
  }

  // --- Target: name, distance, honest ETA, closing speed, closest approach. ---
  $('target').textContent = nav.targetBody ? bodyName(nav.targetBody.name) : '—';

  if (nav.targetPos) {
    const d = ship.pos.distanceTo(nav.targetPos);
    $('tgtdist').textContent = fmtDist(d);

    // Brachistochrone (constant-accel flip-and-burn) ETA: accelerate the
    // first half of the distance, decelerate the second. Non-relativistic
    // approximation -- fine for a HUD estimate, not for the physics engine.
    const a = ship.lastAccel.length() > 1e-6 ? ship.lastAccel.length() : FALLBACK_ACCEL;
    const eta = 2 * Math.sqrt(d / a);
    $('tgteta').textContent = isFinite(eta) ? '≈' + fmtTime(eta) : '—';

    if (nav.targetVel) {
      // Closing speed = component of relative velocity along the line to the
      // target (negative = opening/receding).
      _vRel.subVectors(ship.v, nav.targetVel);
      _rRel.subVectors(nav.targetPos, ship.pos);
      const dist = _rRel.length();
      const closing = dist > 1e-6 ? _vRel.dot(_rRel) / dist : 0;
      setText('closespeed', (closing >= 0 ? '+' : '') + fmtSpeed(closing));

      // Closest approach, treating current relative motion as locally linear.
      _rRel.subVectors(ship.pos, nav.targetPos);
      const vRel2 = _vRel.lengthSq();
      const tStar = vRel2 > 1e-12 ? -_rRel.dot(_vRel) / vRel2 : -1;
      if (tStar > 0) {
        _closePos.copy(_rRel).addScaledVector(_vRel, tStar);
        setText('closedist', fmtDist(_closePos.length()));
        setText('closeeta', fmtTime(tStar));
      } else {
        setText('closedist', t('nav.receding'));
        setText('closeeta', '—');
      }
    } else {
      setText('closespeed', '—'); setText('closedist', '—'); setText('closeeta', '—');
    }
  } else {
    $('tgtdist').textContent = '—'; $('tgteta').textContent = '—';
    setText('closespeed', '—'); setText('closedist', '—'); setText('closeeta', '—');
  }

  $('simtime').textContent  = fmtTime(sim.time);
  $('shiptime').textContent = fmtTime(ship.properTime);
  const eff = Math.round(sim.warp).toLocaleString();
  const wEl = $('warp');
  if (sim.warpLimited) {
    wEl.textContent = `${eff}× ⤵ (${sim.warpTarget.toLocaleString()}×)`;
    wEl.classList.add('limited');
  } else {
    wEl.textContent = `${sim.warpTarget.toLocaleString()}×`;
    wEl.classList.remove('limited');
  }
  $('fps').textContent      = sim.fps.toFixed(0);
}
