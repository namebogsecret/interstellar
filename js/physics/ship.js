import * as THREE from 'three';
import { C, C2, G0 } from './constants.js';
import { gravityAccel, dominantBody, gravitationalPotential } from './gravity.js';
import { surfaceRotationVelocity } from './orbits.js';
import { gammaFromW, velocityFromW, relativisticDeltaV } from './relativity.js';

// Two flight models:
//   'arcade'   : infinite fuel, set proper acceleration up to a huge cap.
//   'realistic': finite propellant, fusion-class exhaust velocity, the ship
//                loses mass as it burns (relativistic rocket equation emerges).
export const MODES = ['arcade', 'realistic'];

export class Ship {
  constructor() {
    this.pos = new THREE.Vector3();        // metres, heliocentric (double precision)
    this.w   = new THREE.Vector3();        // specific momentum gamma*v (m/s)
    this.v   = new THREE.Vector3();        // cached coordinate velocity (m/s)
    this.quat = new THREE.Quaternion();    // orientation
    this.mode = 'arcade';

    // Thrust / engine.
    this.throttle = 0;                     // 0..1
    this.maxAccelArcade = 1000 * G0;       // up to ~1000 g in arcade mode
    this.ve = 0.10 * C;                    // exhaust velocity (fusion-ish, 10% c)
    this.thrustForce = 3.0e7;              // N at full throttle (realistic)
    this.dryMass = 2.0e5;                  // kg (200 t)
    this.fuelMass = 8.0e5;                 // kg propellant
    this.fuelMass0 = this.fuelMass;

    // Rotation control (rad/s applied while keys held).
    this.angRate = new THREE.Vector3();    // pitch(x), yaw(y), roll(z) commands

    // Clocks.
    this.properTime = 0;                   // seconds aboard ship
    this.refBody = null;                   // dominant gravity body
    this.altitude = Infinity;              // m above reference surface
    this.lastAccel = new THREE.Vector3();  // last applied specific force (g-meter)
    this.atmoDensity = 0;

    // Surface contact state.
    this.landed = false;
    this.crashed = false;
    this.landedBody = null;
    this.landedOffset = new THREE.Vector3(); // ship.pos - body.pos at touchdown
    this.touchdownSpeed = 0;
  }

  get mass() { return this.dryMass + (this.mode === 'realistic' ? this.fuelMass : 0); }
  get gamma() { return gammaFromW(this.w); }
  get speed() { return this.v.length(); }
  get beta()  { return this.speed / C; }

  // Remaining delta-v budget (realistic mode), m/s.
  deltaVBudget() {
    if (this.mode !== 'realistic' || this.fuelMass <= 0) return 0;
    return relativisticDeltaV((this.dryMass + this.fuelMass) / this.dryMass, this.ve);
  }

  // Body-frame forward / right / up.
  forward(out) { return out.set(0, 0, -1).applyQuaternion(this.quat); }
  right(out)   { return out.set(1, 0, 0).applyQuaternion(this.quat); }
  up(out)      { return out.set(0, 1, 0).applyQuaternion(this.quat); }

  // --- one physics substep -------------------------------------------------
  // dt: coordinate-time seconds. bodies + positions describe the universe now.
  // refBodyVel: heliocentric ORBITAL velocity of the dominant body (Vector3) or
  //   null. Treated READ-ONLY (it is main.js's shared _refVel — mutating it would
  //   corrupt the warp-cap); we only copy it into scratch.
  step(dt, bodies, positions, thrustDir, refBodyVel = null) {
    // 1) Orientation update from angular-rate commands (simple body-rate).
    if (this.angRate.lengthSq() > 0) {
      const dq = new THREE.Quaternion();
      const axis = _v1.copy(this.angRate);
      const ang = axis.length() * dt;
      axis.normalize();
      dq.setFromAxisAngle(axis, ang);
      this.quat.multiply(dq).normalize();
    }

    // 2) Gravity.
    const aGrav = gravityAccel(this.pos, bodies, positions, _aGrav);

    // 3) Thrust (specific force = force/mass, i.e. acceleration).
    const aThrust = _aThrust.set(0, 0, 0);
    if (this.throttle > 0) {
      if (this.mode === 'arcade') {
        aThrust.copy(thrustDir).multiplyScalar(this.maxAccelArcade * this.throttle);
      } else if (this.fuelMass > 0) {
        const F = this.thrustForce * this.throttle;
        aThrust.copy(thrustDir).multiplyScalar(F / this.mass);
        // Mass flow: dm = (F/ve)*dtau. The engine burns in the SHIP frame, so it
        // consumes PROPER time dtau = dt/gamma, not coordinate time dt.
        this.fuelMass = Math.max(0, this.fuelMass - (F / this.ve) * dt / gammaFromW(this.w));
      }
    }

    // 4) Reference body, altitude, atmospheric drag.
    this.refBody = dominantBody(this.pos, bodies, positions);
    const aDrag = _aDrag.set(0, 0, 0);
    this.atmoDensity = 0;
    if (this.refBody) {
      const bp = positions.get(this.refBody.name);
      const r = bp.distanceTo(this.pos);
      this.altitude = r - this.refBody.radius;
      const atmo = this.refBody.atmosphere;
      if (atmo && this.altitude < atmo.height) {
        const h = Math.max(0, this.altitude);
        const rho = atmo.density0 * Math.exp(-h / atmo.scaleHeight);
        this.atmoDensity = rho;
        // Drag acts on velocity RELATIVE to the co-rotating atmosphere:
        //   vAtmo = refBodyVel (body orbital velocity) + omega x r (surface spin).
        // refBodyVel is read-only shared state -> copy it, never mutate. With no
        // reference velocity we fall back to vAtmo = v (i.e. zero drag).
        let vRelMag = 0;
        const vRel = _vRel;
        if (refBodyVel) {
          const omegaR = surfaceRotationVelocity(this.refBody, this.pos, bp, _omegaR);
          _vAtmo.copy(refBodyVel).add(omegaR);
          vRel.subVectors(this.v, _vAtmo);
          vRelMag = vRel.length();
        } else {
          vRel.set(0, 0, 0);
        }
        if (vRelMag > 0 && rho > 1e-9) {
          // a_drag = -0.5 * rho * vRel^2 * Cd * A / m  along -vRel
          const Cd = 0.8, area = 30, m = this.mass;
          const mag = 0.5 * rho * vRelMag * vRelMag * Cd * area / m;
          aDrag.copy(vRel).multiplyScalar(-mag / vRelMag);
        }
      }
    } else {
      this.altitude = Infinity;
    }

    // 5) Integrate specific momentum (relativistic), then position.
    // Thrust + drag are FELT proper-force terms and get the honest 4-force
    // decomposition: the transverse proper acceleration equals gamma*(dw/dt)_perp,
    // so the perpendicular part of dw/dt divides by gamma. GRAVITY is a geometric
    // (geodesic) term — NOT decomposed; decomposing centripetal gravity would
    // break circular orbits. (With thrust || v and no drag, aPerp = 0 so
    // dwFelt = aThrust, and dw/dt = aGrav + aThrust — identical to the old aTot.)
    const aFelt = _aFelt.copy(aThrust).add(aDrag);
    const g = gammaFromW(this.w);
    const speed = this.v.length();
    let dwFelt;
    if (speed > 1) {                                     // |v| > 1 m/s
      const vhat = _vhat.copy(this.v).multiplyScalar(1 / speed);
      const aParMag = aFelt.dot(vhat);
      const aPar = _aPar.copy(vhat).multiplyScalar(aParMag);
      const aPerp = _aPerp.subVectors(aFelt, aPar);      // aFelt - aPar
      dwFelt = _dwFelt.copy(aPar).addScaledVector(aPerp, 1 / g);
    } else {
      dwFelt = _dwFelt.copy(aFelt);
    }
    this.w.addScaledVector(aGrav, dt).addScaledVector(dwFelt, dt);  // gravity undivided
    this.lastAccel.copy(aFelt);                // g-meter = true felt proper accel
    velocityFromW(this.w, this.v);
    this.pos.addScaledVector(this.v, dt);

    // 6) Proper time aboard ship: SR (velocity) + weak-field GR (potential).
    //   dtau = dt * sqrt(1 + 2*Phi/c^2 - v^2/c^2)
    // Valid for r >> r_s = 2GM/c^2 (always true in the solar system); max(0,.)
    // guards the unreachable strong field. Phi -> 0, v -> 0 at infinity => dtau = dt.
    const phi = gravitationalPotential(this.pos, bodies, positions);
    const betaSq = this.v.lengthSq() / C2;
    this.properTime += dt * Math.sqrt(Math.max(0, 1 + 2 * phi / C2 - betaSq));
  }
}

const _v1 = new THREE.Vector3();
const _aGrav = new THREE.Vector3();
const _aThrust = new THREE.Vector3();
const _aDrag = new THREE.Vector3();
// Drag: velocity relative to the co-rotating atmosphere.
const _omegaR = new THREE.Vector3();   // surface rotation velocity (omega x r)
const _vAtmo = new THREE.Vector3();     // refBodyVel + omegaR
const _vRel = new THREE.Vector3();      // ship velocity minus atmosphere velocity
// Integrator: 4-force decomposition of the felt (thrust+drag) proper force.
const _aFelt = new THREE.Vector3();
const _vhat = new THREE.Vector3();
const _aPar = new THREE.Vector3();
const _aPerp = new THREE.Vector3();
const _dwFelt = new THREE.Vector3();
