import * as THREE from 'three';
import { G0 } from '../physics/constants.js';

// Digit (1-9) -> throttle mapping, LOGARITHMIC across 1g..1000g so a fresh pilot
// pressing '1' gets a gentle ~1g nudge instead of instantly maxing out thrust
// and tearing up their orbit. The TARGET felt acceleration is mode-INDEPENDENT:
//   targetAccel(n) = MAX_G ^ ((n-1)/8) · G0        → 1g (n=1) … 1000g (n=9)
// The throttle is that target divided by the mode's REAL ceiling (maxThrustAccel),
// honestly clamped to 1. So '1'≈1g in BOTH modes, and realistic clamps to the
// ship's thrust limit (~3–15g) instead of the arcade fiction of 1000g.
//   • arcade:    target/maxAccelArcade = (g(n)·G0)/(1000·G0) = g(n)/1000  (old formula, bit-identical)
//   • realistic: target/(F/m); '1'→~1g, high digits clamp at the thrust ceiling.
const MAX_G = 1000;
export function powerToThrottle(n, ship) {
  const targetAccel = Math.pow(MAX_G, (n - 1) / 8) * G0;
  const maxAccel = ship.maxThrustAccel;
  return maxAccel > 0 ? Math.min(1, targetAccel / maxAccel) : 0;
}
// First unthrottled thrust-key press should be gentle (~1g), not full power.
function defaultThrottle(ship) { return powerToThrottle(1, ship); }

// First-person flight controls. Mouse (pointer-lock) yaws/pitches the ship;
// keys translate thrust along ship axes, roll, set throttle, time-warp, etc.
export class FlightControls {
  constructor(ship, domElement, hooks = {}) {
    this.ship = ship;
    this.dom = domElement;
    this.hooks = hooks;            // { onModeToggle, onTarget, onFastTravel, onWarp, onReset, onPause, onCircularize, onMap, onTargetList, onMissions }
    this.keys = new Set();
    this.mouseSens = 0.0022;
    this.rollRate = 1.2;           // rad/s
    this.pitchYawFromMouse = new THREE.Vector2();

    this._bind();
  }

  _bind() {
    this.dom.addEventListener('click', () => this.dom.requestPointerLock());
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== this.dom) return;
      this.pitchYawFromMouse.x += -e.movementY * this.mouseSens; // pitch
      this.pitchYawFromMouse.y += -e.movementX * this.mouseSens; // yaw
    });

    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      this.keys.add(k);
      // Discrete actions.
      if (k === 'm') this.hooks.onModeToggle?.();
      else if (k === 'tab') { e.preventDefault(); this.hooks.onTarget?.(e.shiftKey ? -1 : 1); }
      else if (k === 'g') this.hooks.onFastTravel?.();
      else if (k === '.') this.hooks.onWarp?.(1);
      else if (k === ',') this.hooks.onWarp?.(-1);
      else if (k === 'x') this.hooks.onKill?.();        // kill rotation
      else if (k === 'o') this.hooks.onOrbits?.();      // toggle orbit lines
      else if (k === 'l') this.hooks.onLabels?.();      // toggle labels
      else if (k === 'b') this.hooks.onBloom?.();       // toggle bloom
      else if (k === 'c') this.hooks.onRelFx?.();       // toggle relativistic optics
      else if (k === 'p') this.hooks.onPause?.();        // pause / warp-0
      else if (k === 'k') this.hooks.onCircularize?.();  // circularize orbit
      else if (k === 'v') this.hooks.onMap?.();          // toggle top-down system map
      else if (k === 't') this.hooks.onTargetList?.();   // toggle proximity-sorted target list
      else if (k === 'j') this.hooks.onMissions?.();     // toggle student missions panel
      else if (k === 'backspace') this.hooks.onReset?.();
      else if (/^[0-9]$/.test(k)) this.ship.throttle = k === '0' ? 0 : powerToThrottle(Number(k), this.ship);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
  }

  // Apply per-frame control state to the ship. Returns the thrust direction
  // (unit, world frame) so the physics step can use it.
  update(dt) {
    const s = this.ship;

    // --- rotation: mouse pitch/yaw (applied as orientation deltas) ----------
    const pitch = this.pitchYawFromMouse.x;
    const yaw = this.pitchYawFromMouse.y;
    this.pitchYawFromMouse.set(0, 0);
    if (pitch || yaw) {
      const qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch);
      const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      // Yaw then pitch in body frame.
      s.quat.multiply(qy).multiply(qx).normalize();
    }

    // Roll via Q/E (continuous).
    s.angRate.set(0, 0, 0);
    if (this.keys.has('q')) s.angRate.z += this.rollRate;
    if (this.keys.has('e')) s.angRate.z -= this.rollRate;

    // Throttle trim via [ / ] (not Ctrl/Shift: Ctrl+W closes the browser tab,
    // and Shift collides with Shift+Tab = cycle target backward).
    if (this.keys.has(']')) s.throttle = Math.min(1, s.throttle + dt * 0.6);
    if (this.keys.has('[')) s.throttle = Math.max(0, s.throttle - dt * 0.6);

    // --- translation thrust direction (body frame) --------------------------
    const dir = new THREE.Vector3();
    const f = s.forward(_f), r = s.right(_r), u = s.up(_u);
    if (this.keys.has('w')) dir.add(f);
    if (this.keys.has('s')) dir.sub(f);
    if (this.keys.has('d')) dir.add(r);
    if (this.keys.has('a')) dir.sub(r);
    if (this.keys.has('r')) dir.add(u);
    if (this.keys.has('f')) dir.sub(u);
    if (this.keys.has(' ')) dir.add(f);   // space = forward boost too

    if (dir.lengthSq() > 0) {
      dir.normalize();
      // If no explicit throttle is set, holding a thrust key implies a gentle
      // default burn (~1g), not full arcade-mode thrust (1000g).
      if (s.throttle === 0) s.throttle = defaultThrottle(s);
      return dir;
    }
    return null;   // coasting (throttle has no direction)
  }
}

const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _u = new THREE.Vector3();
