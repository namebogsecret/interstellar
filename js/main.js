import * as THREE from 'three';
import { BODIES, byName } from './data/bodies.js';
import { absolutePosition, orbitEllipse, spinAxis, spinAngle, surfaceRotationVelocity, circularizeVelocity, bodyVelocity } from './physics/orbits.js';
import { dominantBody } from './physics/gravity.js';
import { cabotageEngaged, tryAnalyticCoast } from './physics/cabotage.js';
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
              target: null, targetIdx: -1, targetDist: 0, paused: false,
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

// bodyVelocity relocated to physics/orbits.js (pure) — imported above.

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
  const vel = bodyVelocity(b, sim.time, byName).addScaledVector(perp, vCirc);
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

// ---- persisted toggles (localStorage) -------------------------------------
// Mirror the getLang/setLang persistence pattern. All reads are defensive:
// absent/corrupt values are ignored so a wiped store just falls back to defaults.
function saveToggle(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* storage disabled */ } }
function loadToggle(key) { try { const s = localStorage.getItem(key); return s == null ? undefined : JSON.parse(s); } catch { return undefined; } }

// ---- controls hooks -------------------------------------------------------
const controls = new FlightControls(ship, canvas, {
  onModeToggle() {
    ship.mode = MODES[(MODES.indexOf(ship.mode) + 1) % MODES.length];
    saveToggle('iss_mode', ship.mode);
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
      const rv = bodyVelocity(ship.refBody, sim.time, byName, new THREE.Vector3());
      ship.v.copy(rv); momentumFromV(rv, ship.w);
      overlay.event(t('ev.drift', { name: bodyName(ship.refBody.name) }));
    } else { ship.w.set(0, 0, 0); ship.v.set(0, 0, 0); overlay.event(t('ev.stopped')); }
  },
  onReset() { sim.time = 0; spawnAt('Earth'); ship.w.set(0, 0, 0); ship.v.set(0, 0, 0); overlay.event(t('ev.reset')); },
  onOrbits() { sim.showOrbits = !sim.showOrbits; orbitGroup.visible = sim.showOrbits; saveToggle('iss_orbits', sim.showOrbits); overlay.event(t('ev.orbits', { s: t(sim.showOrbits ? 'w.on' : 'w.off') })); },
  onLabels() { sim.showLabels = !sim.showLabels; overlay.root.style.display = sim.showLabels ? 'block' : 'none'; saveToggle('iss_labels', sim.showLabels); overlay.event(t('ev.labels', { s: t(sim.showLabels ? 'w.on' : 'w.off') })); },
  onBloom() { sim.bloom = !sim.bloom; saveToggle('iss_glow', sim.bloom); overlay.event(t('ev.bloom', { s: t(sim.bloom ? 'w.on' : 'w.off') })); },
  onRelFx() { sim.relFx = !sim.relFx; saveToggle('iss_relfx', sim.relFx); overlay.event(t('ev.relfx', { s: t(sim.relFx ? 'w.on' : 'w.off') })); },
  onPause() { sim.paused = !sim.paused; overlay.event(t(sim.paused ? 'ev.pause' : 'ev.resume')); },
  onCircularize() {
    // Snap to a circular orbit around the dominant body. Ignore while landed
    // (simplest safe choice — no lift-off first).
    if (ship.landed) return;
    const b = ship.refBody || dominantBody(ship.pos, BODIES, positions);
    if (!b) return;
    const bp = positions.get(b.name);
    const bVel = bodyVelocity(b, sim.time, byName, new THREE.Vector3());
    const rVec = new THREE.Vector3().subVectors(ship.pos, bp);   // fresh: relative position
    const vVec = new THREE.Vector3().subVectors(ship.v, bVel);   // fresh: relative velocity
    const relV = circularizeVelocity(b.GM, rVec, vVec, new THREE.Vector3());
    ship.v.copy(bVel).add(relV); momentumFromV(ship.v, ship.w);
    overlay.event(t('ev.circularize', { name: bodyName(b.name) }));
  },
});

// Apply any persisted O/L/B/C/M toggles from a previous session, reflecting
// each into the render layer exactly as its toggle hook would (not just the flag).
{
  const o = loadToggle('iss_orbits'); if (typeof o === 'boolean') { sim.showOrbits = o; orbitGroup.visible = o; }
  const l = loadToggle('iss_labels'); if (typeof l === 'boolean') { sim.showLabels = l; overlay.root.style.display = l ? 'block' : 'none'; }
  const g = loadToggle('iss_glow');   if (typeof g === 'boolean') sim.bloom = g;   // applied via bloom.enabled in loop
  const r = loadToggle('iss_relfx');  if (typeof r === 'boolean') sim.relFx = r;   // applied via relativistic.enabled in loop
  // Base RenderPass camera must match relFx from the very first frame: ON uses
  // the wide sourceCamera (aberration headroom), OFF uses the display camera
  // (correct 60° framing) — otherwise a restored OFF value would render the
  // first frame at 90° until the loop below corrects it.
  composer.renderPass.camera = sim.relFx ? composer.sourceCamera : camera;
  const m = loadToggle('iss_mode');   if (m === 'arcade' || m === 'realistic') ship.mode = m;
}

// Ship reached a surface: pin to it, kill relative velocity, announce it.
// Slow contact = landing; fast = crash. Either way you can thrust to fly off.
function touchdown() {
  const b = ship.refBody;
  const bp = positions.get(b.name);
  const bvel = bodyVelocity(b, sim.time, byName, new THREE.Vector3());
  const up = _dir.subVectors(ship.pos, bp).normalize();
  const impact = _tmp.subVectors(ship.v, bvel).length();   // speed rel. to surface

  ship.pos.copy(bp).addScaledVector(up, b.radius + 1);
  // Store the offset in the body-FIXED frame (undo the body's current spin) so
  // the landed ship rides the planet's rotation instead of the ground turning
  // under it. Re-applied each landed frame with +spinAngle.
  ship.landedOffset.copy(ship.pos).sub(bp)
    .applyAxisAngle(spinAxis(b, _axis), -spinAngle(b, sim.time));
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
  const refVel = refB ? bodyVelocity(refB, sim.time, byName, _refVel) : null;

  // When paused, freeze all physics + the sim clock. Rendering, HUD and input
  // (controls.update above) still run below. No dt accumulator to reset — `last`
  // is advanced every frame regardless, so unpausing never sees a dt spike.
  if (!sim.paused) {
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
    // Sit on the surface and ride along with the planet's ROTATION (body-fixed
    // offset rotated back into inertial by the current spin) + orbital motion.
    sim.time += simDt;
    computePositions(sim.time);
    const b = byName(ship.landedBody);
    const bp = positions.get(ship.landedBody);
    const inertialOff = _landOff.copy(ship.landedOffset)
      .applyAxisAngle(spinAxis(b, _axis), spinAngle(b, sim.time));
    ship.pos.copy(bp).add(inertialOff);
    // Ground velocity = body's orbital velocity + surface rotation at this point.
    ship.v.copy(bodyVelocity(b, sim.time, byName, _landVel))
      .add(surfaceRotationVelocity(b, ship.pos, bp, _landSurf));
    momentumFromV(ship.v, ship.w);
    ship.lastAccel.set(0, 0, 0);
    // Lift off the moment the pilot applies thrust — keep v (it already carries
    // orbital + surface motion) so the ship departs with the ground's velocity.
    if (ship.throttle > 0 || tdir) {
      ship.landed = false; ship.crashed = false;
      const up = _dir.subVectors(ship.pos, bp).normalize();
      ship.pos.addScaledVector(up, 50);          // unstick from the surface
      overlay.event(t('ev.liftoff', { name: bodyName(ship.landedBody) }));
    }
  } else if (cabotageEngaged(ship, refB, refAlt, effWarp, BODIES, byName, sim.time)
             && tryAnalyticCoast(ship, refB, BODIES, byName, sim.time, simDt)) {
    // Kepler cabotage: the whole warp frame was advanced analytically along the
    // two-body conic (zero secular drift). All-or-nothing — tryAnalyticCoast
    // committed a SAFE step (above atmosphere, no SOI crossing) or mutated
    // nothing and returned false, falling through to the numeric loop below.
    sim.time += simDt;
    computePositions(sim.time);          // refresh shared Map at the new time (as numeric does)
  } else {
    let nSub, subDt;
    if (effWarp <= 1) { nSub = 1; subDt = simDt; }
    else { nSub = Math.max(1, Math.min(200, Math.ceil(simDt / 600))); subDt = simDt / nSub; }
    for (let i = 0; i < nSub; i++) {
      sim.time += subDt;
      computePositions(sim.time);
      ship.step(subDt, BODIES, positions, tdir || _zero, refVel);   // refVel READ-ONLY (step copies)
      if (ship.refBody && ship.altitude <= 0) { touchdown(); break; }
    }
    computePositions(sim.time);
  }
  }   // end if (!sim.paused)

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
  // The relativistic pass is the ONLY thing that crops the wide-FOV source
  // render back to the display's 60° frame (see relativisticPass SOURCE_FOV).
  // When it's off, the base RenderPass must render through the display camera
  // directly, or the full 90° source gets stretched onto the screen (visible
  // zoom-out). Swap here — the single place sim.relFx actually drives the
  // pass's enabled state — rather than duplicating this in onRelFx, so both
  // the O key toggle and the persisted-toggle startup path stay in sync.
  composer.renderPass.camera = sim.relFx ? composer.sourceCamera : camera;
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

  // HUD navigation context — built with DEDICATED scratch (never _tmp/_rel/_dir,
  // which the landed block + floating-origin loop clobber). refVel stays read-only.
  const navBody = ship.refBody || refB;
  const nav = {
    refBody: navBody || null,
    refPos: navBody ? _navRefPos.copy(positions.get(navBody.name)) : null,
    refVel: navBody
      ? (navBody === refB && refVel ? _navRefVel.copy(refVel) : bodyVelocity(navBody, sim.time, _navRefVel))
      : null,
    targetBody: sim.target || null,
    targetPos: sim.target ? _navTgtPos.copy(positions.get(sim.target.name)) : null,
    targetVel: sim.target ? bodyVelocity(sim.target, sim.time, _navTgtVel) : null,
  };
  updateHUD(ship, sim, nav);

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
// Body-fixed landing scratch (item 3).
const _axis = new THREE.Vector3();
const _landOff = new THREE.Vector3();
const _landVel = new THREE.Vector3();
const _landSurf = new THREE.Vector3();
// HUD nav scratch (item 2) — dedicated, never reused by the hot loop.
const _navRefPos = new THREE.Vector3();
const _navRefVel = new THREE.Vector3();
const _navTgtPos = new THREE.Vector3();
const _navTgtVel = new THREE.Vector3();
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
