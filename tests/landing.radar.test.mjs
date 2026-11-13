// Landing radar — tests written from CONTRACT.md (not from the implementation).
// Module: js/physics/landing.js (landingRadar, CRASH_SPEED, RADAR_MAX_ALT_FRAC).
import * as THREE from 'three';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { landingRadar, CRASH_SPEED, RADAR_MAX_ALT_FRAC } from '../js/physics/landing.js';
import { approxRel, approxAbs } from './helpers.mjs';

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.equal(a, b, m); checks++; };
const rel = (a, e, r, m) => { approxRel(a, e, r, m); checks++; };
const abs = (a, e, t, m) => { approxAbs(a, e, t, m); checks++; };

const MOON = { GM: 4.9048695e12, radius: 1737400 };
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const NUMERIC = ['altitude', 'vVert', 'vHoriz', 'impactSpeed', 'tImpact'];
const impactE = (v2, b, r) => Math.sqrt(v2 + 2 * b.GM * (1 / b.radius - 1 / r));

// ── constants ─────────────────────────────────────────────────────────────
eq(CRASH_SPEED, 50, 'CRASH_SPEED === 50');
eq(RADAR_MAX_ALT_FRAC, 0.1, 'RADAR_MAX_ALT_FRAC === 0.1');

// ── free fall (Moon): energy conservation exact, tImpact ≈ sqrt(2h/g) ───────
// Active requires vVert < -0.1, so "from rest" is modelled with vVert = -0.11
// (kinematically indistinguishable) and compared against the exact formulas.
for (const h of [100, 1000, 10000, 100000]) {
  const r = MOON.radius + h;
  const v0 = 0.11;
  const o = landingRadar(V(r, 0, 0), V(-v0, 0, 0), MOON, true);
  eq(o.active, true, `free fall h=${h} active`);
  rel(o.altitude, h, 1e-12, `altitude h=${h}`);
  rel(o.impactSpeed, impactE(v0 * v0, MOON, r), 1e-9, `impactSpeed energy h=${h}`);
  // from-rest closed form (v0 contributes only v0^2 under the sqrt)
  rel(o.impactSpeed, Math.sqrt(2 * MOON.GM * (1 / MOON.radius - 1 / r)), 1e-3, `impactSpeed ≈ rest formula h=${h}`);
  const g = MOON.GM / (r * r);
  const tFall = (-v0 + Math.sqrt(v0 * v0 + 2 * g * h)) / g;
  rel(o.tImpact, tFall, 1e-9, `tImpact exact h=${h}`);
}
{ // small h: tImpact ≈ sqrt(2h/g) within 1%
  const h = 500, r = MOON.radius + h, g = MOON.GM / (r * r);
  const o = landingRadar(V(r, 0, 0), V(-0.11, 0, 0), MOON, true);
  rel(o.tImpact, Math.sqrt(2 * h / g), 0.01, 'tImpact ≈ sqrt(2h/g)');
  ok(o.tImpact > 0, 'tImpact positive');
}
{ // true rest: vVert = 0 is not "descending" -> inactive
  const o = landingRadar(V(MOON.radius + 1000, 0, 0), V(0, 0, 0), MOON, true);
  eq(o.active, false, 'rest (vVert=0) inactive');
}

// ── sign / magnitude with oblique vector ──────────────────────────────────
{
  const r = MOON.radius + 2000;
  // r̂ = +y. vGround = (30, -12, 40): vVert=-12, vHoriz=50
  const rr = V(0, r, 0), vg = V(30, -12, 40);
  const o = landingRadar(rr, vg, MOON, true);
  eq(o.active, true, 'oblique active');
  abs(o.vVert, -12, 1e-9, 'vVert negative = downward');
  abs(o.vHoriz, 50, 1e-9, 'vHoriz magnitude');
  ok(o.vHoriz >= 0, 'vHoriz non-negative');
  rel(o.impactSpeed, impactE(30 * 30 + 12 * 12 + 40 * 40, MOON, r), 1e-9, 'oblique impactSpeed');
  // arbitrary direction of r̂ (non-axis-aligned)
  const n = V(1, 2, 2).normalize();
  const rr2 = n.clone().multiplyScalar(MOON.radius + 800);
  const perp = V(2, -1, 0).normalize().multiplyScalar(7);
  const vg2 = n.clone().multiplyScalar(-9).add(perp);
  const o2 = landingRadar(rr2, vg2, MOON, true);
  abs(o2.vVert, -9, 1e-9, 'vVert general direction');
  abs(o2.vHoriz, 7, 1e-9, 'vHoriz general direction');
}

// ── inactive cases ────────────────────────────────────────────────────────
function assertInactive(o, msg) {
  eq(o.active, false, msg + ': active=false');
  for (const k of NUMERIC) ok(Number.isNaN(o[k]), `${msg}: ${k} is NaN (got ${o[k]})`);
  eq(o.willCrash, false, msg + ': willCrash=false');
}
{
  const r = MOON.radius + 1000;
  assertInactive(landingRadar(V(r, 0, 0), V(-20, 0, 0), MOON, false), 'impacting=false');
  assertInactive(landingRadar(V(r, 0, 0), V(5, 0, 0), MOON, true), 'ascending');
  assertInactive(landingRadar(V(r, 0, 0), V(-0.05, 0, 0), MOON, true), 'vVert barely down (> -0.1)');
  const rHigh = MOON.radius * (1 + RADAR_MAX_ALT_FRAC);
  assertInactive(landingRadar(V(rHigh, 0, 0), V(-20, 0, 0), MOON, true), 'altitude == 0.1R');
  assertInactive(landingRadar(V(MOON.radius * 1.5, 0, 0), V(-20, 0, 0), MOON, true), 'altitude >> 0.1R');
  assertInactive(landingRadar(V(MOON.radius - 10, 0, 0), V(-20, 0, 0), MOON, true), 'altitude < 0');
  // just below the altitude ceiling stays active
  const o = landingRadar(V(MOON.radius * (1 + RADAR_MAX_ALT_FRAC * 0.999), 0, 0), V(-20, 0, 0), MOON, true);
  eq(o.active, true, 'just below 0.1R active');
  // altitude exactly 0 is allowed
  const o0 = landingRadar(V(MOON.radius, 0, 0), V(-20, 0, 0), MOON, true);
  eq(o0.active, true, 'altitude==0 active');
  abs(o0.tImpact, 0, 1e-9, 'tImpact at altitude 0 is 0');
  rel(o0.impactSpeed, 20, 1e-9, 'impactSpeed at surface = |v|');
}

// ── willCrash threshold ───────────────────────────────────────────────────
{
  // at the surface impactSpeed = |vGround| exactly
  const at = (v) => landingRadar(V(MOON.radius, 0, 0), V(-v, 0, 0), MOON, true);
  eq(at(49.9).willCrash, false, '49.9 safe');
  eq(at(49.999).willCrash, false, '49.999 safe');
  eq(at(50).willCrash, false, 'exactly 50 safe (strict >)');
  eq(at(50.001).willCrash, true, '50.001 crash');
  eq(at(51).willCrash, true, '51 crash');
  eq(at(500).willCrash, true, '500 crash');
  // willCrash derives from impactSpeed, not vVert: slow descent from height crashes
  const o = landingRadar(V(MOON.radius + 50000, 0, 0), V(-1, 0, 0), MOON, true);
  eq(o.willCrash, o.impactSpeed > CRASH_SPEED, 'willCrash consistent with impactSpeed');
  eq(o.willCrash, true, 'slow descent from 50 km still crashes (energy)');
}

// ── guards: never throw, bad input → inactive ─────────────────────────────
{
  const good = () => [V(MOON.radius + 1000, 0, 0), V(-20, 0, 0), { ...MOON }, true];
  const run = (rr, vg, b, imp, msg) => {
    let o;
    assert.doesNotThrow(() => { o = landingRadar(rr, vg, b, imp); }, msg + ' must not throw');
    checks++;
    assertInactive(o, msg);
  };
  run(V(0, 0, 0), V(-20, 0, 0), MOON, true, 'r=0');
  for (const bad of [NaN, Infinity, -Infinity]) {
    for (const idx of ['x', 'y', 'z']) {
      let [rr, vg, b, i] = good();
      rr[idx] = bad;
      run(rr, vg, b, i, `rRel.${idx}=${bad}`);
      [rr, vg, b, i] = good();
      vg[idx] = bad;
      run(rr, vg, b, i, `vGround.${idx}=${bad}`);
    }
    run(...(() => { const [rr, vg, , i] = good(); return [rr, vg, { GM: bad, radius: MOON.radius }, i]; })(), `GM=${bad}`);
    run(...(() => { const [rr, vg, , i] = good(); return [rr, vg, { GM: MOON.GM, radius: bad }, i]; })(), `radius=${bad}`);
  }
  for (const rad of [0, -1737400]) {
    const [rr, vg, , i] = good();
    run(rr, vg, { GM: MOON.GM, radius: rad }, i, `radius=${rad}`);
  }
  for (const gm of [0, -1]) {
    const [rr, vg, , i] = good();
    run(rr, vg, { GM: gm, radius: MOON.radius }, i, `GM=${gm}`);
  }
}

// ── no mutation of inputs ─────────────────────────────────────────────────
{
  const rr = V(1.2e6, 1.0e6, 3.0e5).setLength(MOON.radius + 700);
  const vg = V(-3, -9, 4);
  const rr0 = rr.clone(), vg0 = vg.clone();
  landingRadar(rr, vg, MOON, true);
  ok(rr.x === rr0.x && rr.y === rr0.y && rr.z === rr0.z, 'rRel not mutated');
  ok(vg.x === vg0.x && vg.y === vg0.y && vg.z === vg0.z, 'vGround not mutated');
  // also on the inactive path
  landingRadar(rr, vg, MOON, false);
  ok(rr.equals(rr0) && vg.equals(vg0), 'inputs not mutated on inactive path');
  // aliasing: same vector passed for both args must not corrupt it
  const same = V(0, MOON.radius + 100, 0);
  const s0 = same.clone();
  assert.doesNotThrow(() => landingRadar(same, same, MOON, true)); checks++;
  ok(same.equals(s0), 'aliased inputs not mutated');
}

// ── out reuse ─────────────────────────────────────────────────────────────
{
  const out = {};
  const o1 = landingRadar(V(MOON.radius + 1000, 0, 0), V(-20, 0, 0), MOON, true, out);
  ok(o1 === out, 'returns the same out object');
  const imp1 = out.impactSpeed;
  const o2 = landingRadar(V(MOON.radius + 3000, 0, 0), V(-20, 0, 0), MOON, true, out);
  ok(o2 === out, 'out reused on second call');
  ok(out.impactSpeed !== imp1 && out.impactSpeed > imp1, 'out refreshed with new values');
  // active -> inactive resets stale numbers
  landingRadar(V(MOON.radius + 3000, 0, 0), V(-20, 0, 0), MOON, false, out);
  eq(out.active, false, 'out reflects inactive');
  ok(Number.isNaN(out.impactSpeed) && Number.isNaN(out.tImpact), 'out stale numbers cleared to NaN');
  eq(out.willCrash, false, 'out willCrash cleared');
  const d = landingRadar(V(MOON.radius + 1000, 0, 0), V(-20, 0, 0), MOON, true);
  ok(d !== out, 'default out is a fresh object per call');
}

// ── structural: wiring ────────────────────────────────────────────────────
{
  const rd = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
  const main = rd('../js/main.js');
  ok(/import\s*\{[^}]*\bCRASH_SPEED\b[^}]*\}\s*from\s*['"]\.\/physics\/landing\.js['"]/.test(main),
    'main.js imports CRASH_SPEED from physics/landing.js');
  ok(!/impact\s*>\s*50\b/.test(main), 'main.js has no literal `impact > 50`');
  ok(/impact\s*>\s*CRASH_SPEED/.test(main), 'main.js uses `impact > CRASH_SPEED`');
  ok(/id="landing"/.test(rd('../index.html')), 'index.html has id="landing"');
  const i18n = rd('../js/i18n.js');
  ok(/['"]?nav\.landing['"]?\s*:/.test(i18n), 'i18n has nav.landing');
  ok(/['"]?nav\.landingCrash['"]?\s*:/.test(i18n), 'i18n has nav.landingCrash');
  ok(/['"]?hud\.landing['"]?\s*:/.test(i18n), 'i18n has hud.landing');
  const count = (k) => (i18n.match(new RegExp(`['"]?${k.replace('.', '\\.')}['"]?\\s*:`, 'g')) || []).length;
  ok(count('nav.landing') >= 2 && count('nav.landingCrash') >= 2, 'nav keys present in EN and RU');
}

console.log(`landing.radar.test.mjs OK (${checks} checks)`);
