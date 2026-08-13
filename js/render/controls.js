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

// Keys that update() itself acts on — i.e. the ones that mean "the pilot is
// flying the ship right now". Held state (not just the keydown edge) is what
// makes them worth re-reporting every frame; see _noteInput below.
const FLIGHT_KEYS = ['w', 's', 'a', 'd', 'r', 'f', ' ', 'q', 'e', '[', ']'];

// First-person flight controls. Mouse (pointer-lock) yaws/pitches the ship;
// keys translate thrust along ship axes, roll, set throttle, time-warp, etc.
//
// ⚠️ PILOT-INTENT COUNTER: every channel of pilot input MUST pass through
// this._noteInput(). It is the single signal the autopilot reads to know it has
// been overridden (js/physics/autopilot.js compares obs.inputSeq with the value
// frozen at engage — N reporters, ONE counter, ONE condition, ONE reader). A new
// input channel (gamepad, another touch button…) that skips it would silently
// leave the pilot fighting the autopilot. The structural gate counts the
// reporters (tests/structure.test.mjs).
export class FlightControls {
  constructor(ship, domElement, hooks = {}) {
    this.ship = ship;
    this.dom = domElement;
    this.hooks = hooks;            // { onModeToggle, onTarget, onFastTravel, onWarp, onReset, onPause, onCircularize, onAutopilot, onMap, onTargetList, onMissions, onCockpit }
    this.keys = new Set();
    this.mouseSens = 0.0022;
    this.rollRate = 1.2;           // rad/s
    this.pitchYawFromMouse = new THREE.Vector2();
    // Monotonic counter of PILOT INTENT. Rises on ANY input. Never decreases,
    // never resets. The only writer is _noteInput().
    this.inputSeq = 0;

    this._bind();
  }

  // The ONLY writer of inputSeq (see the class header).
  _noteInput() { this.inputSeq++; }

  _bind() {
    // Both listeners below are real user gestures — the natural place to lift
    // the browser's autoplay suspension on a sound context that may already
    // want to be on (e.g. a persisted iss_sound=true restored at page load,
    // before any gesture happened). onGesture is a cheap, self-guarded no-op
    // whenever there is nothing to resume — see js/audio/audio.js.
    this.dom.addEventListener('click', () => { this.dom.requestPointerLock(); this.hooks.onGesture?.(); });
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== this.dom) return;
      this.pitchYawFromMouse.x += -e.movementY * this.mouseSens; // pitch
      this.pitchYawFromMouse.y += -e.movementX * this.mouseSens; // yaw
    });

    window.addEventListener('keydown', (e) => {
      // Reporter #1: EVERY key, counted BEFORE dispatch. Order matters — the
      // autopilot hook below reads the already-incremented value as its arming
      // baseline, so engaging cannot be cancelled by its own keypress. That is
      // sturdier than exempting the 'n' key (an exemption a future key would
      // silently need too).
      this._noteInput();
      this.hooks.onGesture?.();
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
      else if (k === 'u') this.hooks.onCubeAberr?.();    // toggle cubemap aberration path
      else if (k === 'i') this.hooks.onCockpit?.();      // toggle cockpit frame overlay
      else if (k === 'z') this.hooks.onSound?.();        // toggle procedural sound (off by default)
      else if (k === 'p') this.hooks.onPause?.();        // pause / warp-0
      else if (k === 'k') this.hooks.onCircularize?.();  // circularize orbit
      else if (k === 'n') this.hooks.onAutopilot?.(e.shiftKey ? 'hohmann' : 'circularize'); // autopilot on/off
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
    // Reporter #2: a HELD flight key or any look input is intent every frame,
    // not just on its keydown edge (mouse/drag has no key event at all).
    // Deliberately NOT `this.keys.size > 0`: a discrete action key stays in the
    // set until keyup, so the broad form would make pressing N cancel the very
    // autopilot it just engaged, one frame later. Everything discrete is
    // already covered by reporter #1 on its keydown.
    if (pitch || yaw || FLIGHT_KEYS.some((k) => this.keys.has(k))) this._noteInput();
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
