import * as THREE from 'three';
import { BODIES, byName } from './data/bodies.js';
import { absolutePosition, orbitEllipse } from './physics/orbits.js';
import { dominantBody } from './physics/gravity.js';
import { Ship, MODES } from './physics/ship.js';
import { momentumFromV } from './physics/relativity.js';
import { G0 } from './physics/constants.js';
import { createRenderer, createScene, createCamera, createBloom, handleResize } from './render/scene.js';
import { updateRelativisticPass } from './render/relativisticPass.js';
import { BodyView } from './render/bodies.js';
import { FlightControls } from './render/controls.js';
import { updateHUD } from './render/hud.js';
import { Overlay } from './render/overlay.js';
import { TouchControls } from './render/touch.js';
import { t, bodyName, fmtSpeed, applyStatic, setLang } from './i18n.js';

applyStatic();   // localize all static UI text on load

// Time-speed ladder in ×5 steps (finer control than ×10).
const WARPS = [1, 5, 25, 125, 625, 3125, 15625, 78125, 390625, 1953125, 9765625, 48828125];

// ---- setup ----------------------------------------------------------------
const canvas = document.getElementById('view');
const renderer = createRenderer(canvas);
const camera = createCamera();
const loader = new THREE.TextureLoader();
const { scene, sunLight } = createScene(loader, 'assets/textures/2k_stars_milky_way.jpg');
const { composer, bloom, relativistic } = createBloom(renderer, scene, camera);
handleResize(renderer, camera, composer);

// Body views.
const views = new Map();
for (const b of BODIES) {
  const view = new BodyView(b, loader);
  views.set(b.name, view);
  scene.add(view.group);
}

// Orbit lines (parent-centric ellipses; positioned each frame via floating origin).
const orbitGroup = new THREE.Group();
scene.add(orbitGroup);
const orbitLines = [];
for (const b of BODIES) {
  if (!b.parent || !b.period) continue;
  const pts = orbitEllipse(b, 256);
  if (!pts.length) continue;
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const isMoon = byName(b.parent).parent != null;     // moon of a planet
  const mat = new THREE.LineBasicMaterial({
    color: isMoon ? 0x445566 : 0x4a6b88, transparent: true,
    opacity: isMoon ? 0.25 : 0.4, depthWrite: false,
  });
  const line = new THREE.LineLoop(geo, mat);
  line.frustumCulled = false;
  orbitGroup.add(line);
  orbitLines.push({ line, body: b });
}

// Ship + simulation state.
const ship = new Ship();
const sim = { time: 0, warp: 1, warpTarget: 1, warpCap: Infinity, warpIdx: 0,
              target: null, targetIdx: -1, targetDist: 0,
              fps: 60, bloom: true, relFx: true, showOrbits: true, showLabels: true, warpLimited: false };

const positions = new Map();
function computePositions(t) {
  for (const b of BODIES) {
    let p = positions.get(b.name);
    if (!p) { p = new THREE.Vector3(); positions.set(b.name, p); }
    if (!b.parent) p.set(0, 0, 0);
    else absolutePosition(b, t, byName, p);
  }
}

function bodyVelocity(b, t, out = new THREE.Vector3()) {
  const h = 60;
  const a = absolutePosition(b, t + h, byName, new THREE.Vector3());
  const c = absolutePosition(b, t - h, byName, new THREE.Vector3());
  return out.subVectors(a, c).multiplyScalar(1 / (2 * h));
}

// Spawn in a STABLE CIRCULAR ORBIT around a body (not at rest — otherwise you
// just free-fall into it). Velocity = body's velocity + circular orbit speed.
function spawnAt(name, distMul = 4) {
  computePositions(sim.time);
  const b = byName(name), bp = positions.get(name);
  const off = new THREE.Vector3(1, 0.25, 1).normalize().multiplyScalar(b.radius * distMul);
  ship.pos.copy(bp).add(off);

  const r = off.length();
  const vCirc = Math.sqrt(b.GM / r);                 // circular orbital speed
  let perp = new THREE.Vector3(0, 1, 0).cross(off);  // perpendicular to radius
  if (perp.lengthSq() < 1e-6) perp.set(1, 0, 0);
  perp.normalize();
  const vel = bodyVelocity(b, sim.time).addScaledVector(perp, vCirc);
  ship.v.copy(vel); momentumFromV(vel, ship.w);
  ship.properTime = 0;
  ship.landed = false; ship.crashed = false; ship.throttle = 0;

  const m = new THREE.Matrix4().lookAt(ship.pos, bp, new THREE.Vector3(0, 1, 0));
  ship.quat.setFromRotationMatrix(m);
}

// Orient the ship as if standing on a surface: "up" away from the planet,
// looking along the local horizon.
function orientLanded(upDir) {
  let fwd = new THREE.Vector3(0, 1, 0).cross(upDir);
  if (fwd.lengthSq() < 1e-6) fwd = new THREE.Vector3(1, 0, 0);
  fwd.normalize();
  const m = new THREE.Matrix4().lookAt(ship.pos, _tmp.copy(ship.pos).add(fwd), upDir);
  ship.quat.setFromRotationMatrix(m);
}
spawnAt('Earth');
sim.target = byName('Moon'); sim.targetIdx = BODIES.indexOf(sim.target);

const overlay = new Overlay(views);
overlay.event(t('ev.online'));

// ---- controls hooks -------------------------------------------------------
const controls = new FlightControls(ship, canvas, {
  onModeToggle() {
    ship.mode = MODES[(MODES.indexOf(ship.mode) + 1) % MODES.length];
    overlay.event(t('ev.mode', { m: t(ship.mode === 'arcade' ? 'mode.arcade' : 'mode.realistic') }));
  },
  onTarget(dir) {
    sim.targetIdx = (sim.targetIdx + dir + BODIES.length) % BODIES.length;
    sim.target = BODIES[sim.targetIdx];
    overlay.event(t('ev.target', { name: bodyName(sim.target.name) }));
  },
  onFastTravel() {
    if (sim.target) { spawnAt(sim.target.name, 4); overlay.event(t('ev.jumped', { name: bodyName(sim.target.name) })); }
  },
  onWarp(dir) {
    sim.warpIdx = Math.max(0, Math.min(WARPS.length - 1, sim.warpIdx + dir));
    sim.warpTarget = WARPS[sim.warpIdx];
    overlay.event(t('ev.warp', { x: sim.warpTarget.toLocaleString() }));
  },
  onKill() {
    // "Stop" relative to the body you're near (cancel drift) — the intuitive
    // brake. Far from everything, stop relative to the Sun.
    ship.angRate.set(0, 0, 0);
    if (ship.refBody) {
      const rv = bodyVelocity(ship.refBody, sim.time, new THREE.Vector3());
      ship.v.copy(rv); momentumFromV(rv, ship.w);
      overlay.event(t('ev.drift', { name: bodyName(ship.refBody.name) }));
    } else { ship.w.set(0, 0, 0); ship.v.set(0, 0, 0); overlay.event(t('ev.stopped')); }
  },
  onReset() { sim.time = 0; spawnAt('Earth'); ship.w.set(0, 0, 0); ship.v.set(0, 0, 0); overlay.event(t('ev.reset')); },
  onOrbits() { sim.showOrbits = !sim.showOrbits; orbitGroup.visible = sim.showOrbits; overlay.event(t('ev.orbits', { s: t(sim.showOrbits ? 'w.on' : 'w.off') })); },
  onLabels() { sim.showLabels = !sim.showLabels; overlay.root.style.display = sim.showLabels ? 'block' : 'none'; overlay.event(t('ev.labels', { s: t(sim.showLabels ? 'w.on' : 'w.off') })); },
  onBloom() { sim.bloom = !sim.bloom; overlay.event(t('ev.bloom', { s: t(sim.bloom ? 'w.on' : 'w.off') })); },
  onRelFx() { sim.relFx = !sim.relFx; overlay.event(t('ev.relfx', { s: t(sim.relFx ? 'w.on' : 'w.off') })); },
});

// Ship reached a surface: pin to it, kill relative velocity, announce it.
// Slow contact = landing; fast = crash. Either way you can thrust to fly off.
function touchdown() {
  const b = ship.refBody;
  const bp = positions.get(b.name);
  const bvel = bodyVelocity(b, sim.time, new THREE.Vector3());
  const up = _dir.subVectors(ship.pos, bp).normalize();
  const impact = _tmp.subVectors(ship.v, bvel).length();   // speed rel. to surface

  ship.pos.copy(bp).addScaledVector(up, b.radius + 1);
  ship.landedOffset.copy(ship.pos).sub(bp);
  ship.v.copy(bvel); momentumFromV(bvel, ship.w);
  ship.landed = true; ship.landedBody = b.name; ship.throttle = 0;
  ship.touchdownSpeed = impact;
  ship.crashed = impact > 50;
  orientLanded(up);

  if (ship.crashed) overlay.event(t('ev.crash', { name: bodyName(b.name), spd: fmtSpeed(impact) }));
  else overlay.event(t('ev.touchdown', { name: bodyName(b.name), spd: fmtSpeed(impact) }));
}

// ---- status line + transient events ---------------------------------------
let wasInAtmo = false, lastNear = null;
function updateStatusAndEvents() {
  let act, cls = 'ok';
  if (ship.landed) {
    act = t(ship.crashed ? 'st.crashed' : 'st.landed', { name: bodyName(ship.landedBody) });
    cls = ship.crashed ? 'warn' : 'ok';
    overlay.setStatus(`<b class="${cls}">${act}</b>`);
    wasInAtmo = false; return;
  }
  if (ship.throttle > 0) { act = t('st.burning', { g: (ship.lastAccel.length() / G0).toFixed(1) }); cls = 'warn'; }
  else if (ship.atmoDensity > 1e-4) { act = t('st.atmo'); cls = 'warn'; }
  else act = t('st.coasting');
  const ref = ship.refBody ? `<b>${t('st.ref', { name: bodyName(ship.refBody.name) })}</b>` : '';
  let extra = '';
  if (sim.warpLimited) extra = ` · <span class="warn">${t('st.warpHeld')}</span>`;
  overlay.setStatus(`<b class="${cls}">${act}</b> · ${ref}${extra}`);

  // Atmosphere enter/exit events.
  const inAtmo = ship.atmoDensity > 1e-4;
  if (inAtmo && !wasInAtmo) overlay.event(t('ev.enterAtmo', { name: bodyName(ship.refBody?.name) }));
  if (!inAtmo && wasInAtmo) overlay.event(t('ev.leftAtmo', { name: bodyName(lastNear) }));
  wasInAtmo = inAtmo; if (ship.refBody) lastNear = ship.refBody.name;
}

// ---- main loop ------------------------------------------------------------
let last = performance.now();
let fpsAccum = 0, fpsFrames = 0, lowFpsTime = 0;

function frame(now) {
  let realDt = (now - last) / 1000; last = now;
  realDt = Math.min(realDt, 0.05);

  const thrustDir = controls.update(realDt);

  computePositions(sim.time);

  // FRESH dominant body + altitude from the current position (not last step's),
  // so the warp cap reacts the same frame and never overshoots by a step.
  const refB = dominantBody(ship.pos, BODIES, positions);
  const refAlt = refB ? positions.get(refB.name).distanceTo(ship.pos) - refB.radius : Infinity;
  const refVel = refB ? bodyVelocity(refB, sim.time, _refVel) : null;

  // --- proximity time-warp cap -------------------------------------------
  // The closer / faster you approach a body, the lower the safe time speed.
  // You keep full control UP TO that ceiling, and it climbs back as you leave.
  const target = sim.warpTarget;
  let cap = Infinity;
  if (refB) {
    const r = Math.max(refAlt, 0) + refB.radius;                  // orbital radius
    const tDyn = Math.sqrt((r * r * r) / refB.GM);                // dynamical time (~P/2π)
    cap = Math.max(1, (0.03 * tDyn) / (1 / 60));                  // ~fraction of tDyn / frame
    const relSpeed = refVel ? _tmp.subVectors(ship.v, refVel).length() : ship.speed;
    if (refAlt > 0 && relSpeed > 1) {
      const tImpact = refAlt / relSpeed;                          // time to reach surface
      cap = Math.min(cap, Math.max(1, (0.1 * tImpact) / (1 / 60)));
    }
  }
  let effWarp;
  if (ship.landed) effWarp = target;                 // pinned to a surface: warp freely
  else if (ship.throttle > 0) effWarp = 1;           // real-time during an engine burn
  else effWarp = Math.max(1, Math.min(target, cap));
  sim.warp = effWarp;
  sim.warpCap = cap;
  sim.warpLimited = effWarp < target - 1e-6;
  const simDt = realDt * effWarp;

  let tdir = thrustDir;
  if (!tdir && ship.throttle > 0) tdir = ship.forward(_fwd);

  if (ship.landed) {
    // Sit on the surface and ride along with the planet's motion.
    sim.time += simDt;
    computePositions(sim.time);
    const bp = positions.get(ship.landedBody);
    ship.pos.copy(bp).add(ship.landedOffset);
    if (refVel) { ship.v.copy(refVel); momentumFromV(refVel, ship.w); }
    ship.lastAccel.set(0, 0, 0);
    // Lift off the moment the pilot applies thrust.
    if (ship.throttle > 0 || tdir) {
      ship.landed = false; ship.crashed = false;
      const up = _dir.subVectors(ship.pos, bp).normalize();
      ship.pos.addScaledVector(up, 50);          // unstick from the surface
      if (refVel) { ship.v.copy(refVel); momentumFromV(refVel, ship.w); }
      overlay.event(t('ev.liftoff', { name: bodyName(ship.landedBody) }));
    }
  } else {
    let nSub, subDt;
    if (effWarp <= 1) { nSub = 1; subDt = simDt; }
    else { nSub = Math.max(1, Math.min(200, Math.ceil(simDt / 600))); subDt = simDt / nSub; }
    for (let i = 0; i < nSub; i++) {
      sim.time += subDt;
      computePositions(sim.time);
      ship.step(subDt, BODIES, positions, tdir || _zero);
      if (ship.refBody && ship.altitude <= 0) { touchdown(); break; }
    }
    computePositions(sim.time);
  }

  if (sim.target) sim.targetDist = positions.get(sim.target.name).distanceTo(ship.pos);

  // floating-origin render transforms.
  camera.quaternion.copy(ship.quat);
  camera.position.set(0, 0, 0);
  camera.updateMatrixWorld();
  for (const b of BODIES) {
    const rel = _rel.subVectors(positions.get(b.name), ship.pos);
    views.get(b.name).update(rel, sim.time, camera);
  }
  // Orbit-line groups: each ellipse sits at its parent's relative position.
  if (sim.showOrbits) {
    for (const { line, body } of orbitLines) {
      line.position.copy(_rel.subVectors(positions.get(body.parent), ship.pos));
    }
  }
  sunLight.position.copy(_rel.subVectors(positions.get('Sun'), ship.pos));

  // Relativistic aberration / Doppler from the ship's velocity in view space.
  relativistic.enabled = sim.relFx;
  if (sim.relFx) {
    const qInv = _qInv.copy(camera.quaternion).invert();
    updateRelativisticPass(relativistic, ship.v, qInv, camera, 1.0);
  }
  // Render: always through the composer (a final copy pass writes to screen),
  // toggling the heavy bloom pass on/off rather than bypassing post-processing,
  // so the relativistic effect survives even when bloom is auto-disabled.
  bloom.enabled = sim.bloom;
  composer.render();

  // Overlays.
  const tgtRel = sim.target ? _rel2.subVectors(positions.get(sim.target.name), ship.pos) : null;
  if (sim.showLabels) overlay.update(camera, views, ship, sim.target, tgtRel);
  updateStatusAndEvents();
  updateHUD(ship, sim);

  // FPS + adaptive bloom (drop it if the machine struggles).
  fpsAccum += realDt; fpsFrames++;
  if (fpsAccum > 0.5) {
    sim.fps = fpsFrames / fpsAccum; fpsAccum = 0; fpsFrames = 0;
    if (sim.bloom && sim.fps < 24) { lowFpsTime += 0.5; if (lowFpsTime > 3) { sim.bloom = false; overlay.event(t('ev.bloomAuto')); } }
    else lowFpsTime = 0;
  }

  requestAnimationFrame(frame);
}

const _zero = new THREE.Vector3();
const _rel = new THREE.Vector3();
const _rel2 = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _refVel = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _qInv = new THREE.Quaternion();
requestAnimationFrame(frame);

// ---- start screen / help --------------------------------------------------
const startScreen = document.getElementById('startscreen');
function launch() {
  startScreen.style.display = 'none';
  canvas.requestPointerLock?.();
}
document.getElementById('startbtn').addEventListener('click', launch);
startScreen.addEventListener('click', (e) => { if (e.target === startScreen) launch(); });
// H re-opens the briefing (and releases the mouse so it's readable).
window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'h') {
    document.exitPointerLock?.();
    startScreen.style.display = 'flex';
  }
});

// Language toggle (both the always-visible switch and the one on the card).
document.querySelectorAll('[data-lang]').forEach((el) => {
  el.addEventListener('click', (e) => { e.stopPropagation(); setLang(el.dataset.lang); });
});

// Touch / mobile controls on coarse-pointer devices (reuse the same hooks).
if (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window || navigator.maxTouchPoints > 0) {
  document.body.classList.add('touch');
  const openHelp = () => { document.exitPointerLock?.(); startScreen.style.display = 'flex'; };
  new TouchControls(controls, ship, canvas, openHelp);
}

window.SIM = { ship, sim, BODIES, positions, spawnAt, controls };
