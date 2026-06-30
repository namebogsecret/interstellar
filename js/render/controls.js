import * as THREE from 'three';

// First-person flight controls. Mouse (pointer-lock) yaws/pitches the ship;
// keys translate thrust along ship axes, roll, set throttle, time-warp, etc.
export class FlightControls {
  constructor(ship, domElement, hooks = {}) {
    this.ship = ship;
    this.dom = domElement;
    this.hooks = hooks;            // { onModeToggle, onTarget, onFastTravel, onWarp, onReset }
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
      else if (k === 'backspace') this.hooks.onReset?.();
      else if (/^[0-9]$/.test(k)) this.ship.throttle = k === '0' ? 0 : Number(k) / 9;
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

    // Throttle trim via Shift / Ctrl.
    if (this.keys.has('shift')) s.throttle = Math.min(1, s.throttle + dt * 0.6);
    if (this.keys.has('control')) s.throttle = Math.max(0, s.throttle - dt * 0.6);

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
      // If no explicit throttle is set, holding a thrust key implies full.
      if (s.throttle === 0) s.throttle = 1;
      return dir;
    }
    return null;   // coasting (throttle has no direction)
  }
}

const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _u = new THREE.Vector3();
