// Regression R1 (CONTRACT.md «Поправка R1»): tImpact must account for horizontal speed
// (centrifugal term). Written from the contract, not from the implementation.
import * as THREE from 'three';
import assert from 'node:assert/strict';
import { landingRadar } from '../js/physics/landing.js';
import { approxRel } from './helpers.mjs';

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const rel = (a, e, r, m) => { approxRel(a, e, r, m); checks++; };

const EARTH = { GM: 3.986004418e14, radius: 6.371e6 };
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const H = 1000;

// Inertial two-body velocity-Verlet integration until r = R; linear interpolation of the crossing.
function numericTImpact(vVert, vh, dt = 0.01) {
  const { GM, radius: R } = EARTH;
  let x = R + H, y = 0, vx = vVert, vy = vh, t = 0;
  const acc = (px, py) => { const r = Math.hypot(px, py); const k = -GM / (r * r * r); return [k * px, k * py]; };
  let [ax, ay] = acc(x, y);
  for (let i = 0; i < 5e6; i++) {
    const rPrev = Math.hypot(x, y);
    const hx = vx + 0.5 * dt * ax, hy = vy + 0.5 * dt * ay;
    x += dt * hx; y += dt * hy;
    [ax, ay] = acc(x, y);
    vx = hx + 0.5 * dt * ax; vy = hy + 0.5 * dt * ay;
    const r = Math.hypot(x, y);
    if (r <= R) return t + dt * (rPrev - R) / (rPrev - r);
    t += dt;
  }
  throw new Error('numeric integration did not impact');
}

const radar = (vVert, vh) => landingRadar(V(EARTH.radius + H, 0, 0), V(vVert, vh, 0), EARTH, true);

// R1: tImpact vs numerical two-body truth, <= 10%
for (const vh of [0, 5000, 7000, 7800]) {
  const o = radar(-1, vh);
  ok(o.active === true, `active vh=${vh}`);
  ok(Number.isFinite(o.tImpact) && o.tImpact > 0, `tImpact finite>0 vh=${vh}`);
  rel(o.tImpact, numericTImpact(-1, vh), 0.10, `R1 tImpact vs two-body integration vh=${vh}`);
}

// vh = 0: exactly the old closed form
{
  const r = EARTH.radius + H, g = EARTH.GM / (r * r), v = -1;
  rel(radar(-1, 0).tImpact, (v + Math.sqrt(v * v + 2 * g * H)) / g, 1e-12, 'vh=0 equals old formula');
}

// gEff <= 0 (near/over orbital speed): linear estimate h/|vVert|
for (const vh of [8000, 9000, 12000]) {
  const o = radar(-1, vh);
  ok(Number.isFinite(o.tImpact) && o.tImpact > 0, `gEff<=0 finite vh=${vh}`);
  rel(o.tImpact, H / 1, 1e-9, `gEff<=0 tImpact = h/|vVert| vh=${vh}`);
}

// always finite and > 0 when active
for (const vh of [0, 1, 100, 3000, 7000, 7905, 7910, 8000, 20000]) {
  for (const vv of [-0.11, -1, -50]) {
    const o = radar(vv, vh);
    if (!o.active) continue;
    ok(Number.isFinite(o.tImpact) && o.tImpact > 0, `finite>0 vh=${vh} vv=${vv}`);
  }
}

console.log(`landing.timpact.test.mjs OK (${checks} checks)`);
