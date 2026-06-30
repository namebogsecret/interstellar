import { C, G0 } from '../physics/constants.js';
import { t, bodyName, fmtDist, fmtSpeed, fmtTime } from '../i18n.js';

const $ = (id) => document.getElementById(id);

export function updateHUD(ship, sim) {
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

  if (sim.target) {
    const d = sim.targetDist;
    $('target').textContent = bodyName(sim.target.name);
    $('tgtdist').textContent = fmtDist(d);
    const eta = v > 1 ? d / v : Infinity;
    $('tgteta').textContent = isFinite(eta) ? fmtTime(eta) : '—';
  } else {
    $('target').textContent = '—'; $('tgtdist').textContent = '—'; $('tgteta').textContent = '—';
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
