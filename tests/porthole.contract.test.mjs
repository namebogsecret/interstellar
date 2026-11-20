// "View from the porthole" — CONTRACT tests for js/physics/porthole.js and the position fields of js/data/neighbors.js.
// References are closed-form values worked out by hand (see each case); round trip against relativity.js aberratedCos
// (the INVERSE map, ship -> rest) and the identity D * gamma * (1 - beta cos(theta)) = 1.
import assert from 'node:assert/strict';
import { aberratedCos, gammaFromV } from '../js/physics/relativity.js';
import { C } from '../js/physics/constants.js';
import { NEIGHBORS } from '../js/data/neighbors.js';
import * as P from '../js/physics/porthole.js';

const DEG = Math.PI / 180;
let checks = 0;
const near = (a, b, tol, msg) => { checks++; assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`); };
const ok = (c, msg) => { checks++; assert.ok(c, msg); };

// ---- data: positions ----
ok(NEIGHBORS.length === 50, '50 entries');
for (const s of NEIGHBORS) {
  ok(Number.isFinite(s.ra) && s.ra >= 0 && s.ra < 360, 'ra in [0,360) ' + s.id);
  ok(Number.isFinite(s.dec) && s.dec >= -90 && s.dec <= 90, 'dec in [-90,90] ' + s.id);
  ok(s.vmag === null || (Number.isFinite(s.vmag) && s.vmag > -2 && s.vmag < 25), 'vmag null or plausible ' + s.id);
}
const bySys = new Map();
for (const s of NEIGHBORS) { if (!bySys.has(s.system)) bySys.set(s.system, []); bySys.get(s.system).push(s); }
for (const [sys, list] of bySys) {
  // Proxima is ~2.2 deg from Alpha Cen A/B on the sky; every other system sits within ~1 deg.
  const lim = (sys === 'Alpha Centauri' ? 2.5 : 1) * DEG;
  for (const a of list) for (const b of list) {
    const ang = P.angleBetween(P.unitFromRaDec(a.ra, a.dec), P.unitFromRaDec(b.ra, b.dec));
    ok(ang <= lim, `components of ${sys} close on the sky: ${a.id}/${b.id} ${ang / DEG} deg`);
  }
}
const byId = Object.fromEntries(NEIGHBORS.map((s) => [s.id, s]));
near(byId.proxima.ra, 217.43, 0.05, 'Proxima RA'); near(byId.proxima.dec, -62.68, 0.05, 'Proxima Dec');
near(byId['sirius-a'].vmag, -1.46, 0.02, 'Sirius V'); near(byId.barnard.dec, 4.69, 0.05, 'Barnard Dec');
ok(byId['alpha-cen-a'].vmag < 0.1, 'alpha Cen A V ~ 0');

// ---- kinematics at fixed angles ----
const angs = (th, b) => ({ thp: P.aberratedAngle(th, b), D: P.dopplerOfAngle(th, b) });
{ const r = angs(1.1, 0); near(r.thp, 1.1, 1e-15, 'beta=0: theta\' = theta'); near(r.D, 1, 1e-15, 'beta=0: D=1'); }
{ const r = angs(90 * DEG, 0.5); near(Math.cos(r.thp), 0.5, 1e-14, 'beta=.5 theta=90: cos theta\'=0.5'); near(r.thp / DEG, 60, 1e-12, 'theta\'=60 deg'); near(r.D, Math.sqrt(0.75), 1e-14, 'D=0.8660'); }
for (const b of [0.1, 0.6, 0.99]) near(angs(0, b).D, Math.sqrt((1 + b) / (1 - b)), 1e-12, 'theta=0 D=sqrt((1+b)/(1-b)) b=' + b);
near(angs(0, 0.6).D, 2, 1e-12, 'beta=.6 theta=0: D=2');
near(angs(Math.PI, 0.6).D, 0.5, 1e-12, 'beta=.6 theta=180: D=0.5');
near(angs(Math.PI, 0.6).thp, Math.PI, 1e-12, 'theta=180 stays 180');
near(angs(0, 0.6).thp, 0, 1e-15, 'theta=0 stays 0');
near(angs(90 * DEG, 0.8).thp / DEG, Math.acos(0.8) / DEG, 1e-12, 'beta=.8 theta=90: theta\'=36.87 deg');
near(Math.acos(0.8) / DEG, 36.8699, 1e-4, 'arccos 0.8 numeric');

// ---- properties over a grid ----
for (const b of [0, 0.01, 0.3, 0.5, 0.9, 0.99, 0.999, 0.999999]) {
  const g = gammaFromV(b * C);
  let prev = -1;
  for (let k = 0; k <= 360; k++) {
    const th = (k / 360) * Math.PI, cth = Math.cos(th);
    const thp = P.aberratedAngle(th, b), D = P.dopplerOfAngle(th, b);
    ok(Number.isFinite(thp) && Number.isFinite(D) && D > 0, `finite b=${b} th=${k}`);
    ok(thp <= th + 1e-12, `theta' <= theta b=${b} th=${k}`);              // stars slide forward
    ok(thp >= prev - 1e-12, `theta' monotone in theta b=${b}`); prev = thp;
    near(D * g * (1 - b * cth), 1, 1e-9, `D gamma (1 - b cos) = 1 b=${b} th=${k}`);
    near(Math.cos(thp), P.cosAberrated(cth, b), 1e-9, `half-angle form == cos form b=${b}`);
    // round trip: relativity.js aberratedCos is ship -> rest
    if (b < 0.99999) near(aberratedCos(Math.cos(thp), b), cth, 1e-12, `round trip b=${b} th=${k}`);
  }
}
for (let k = 0; k <= 360; k++) near(P.cosAberrated(Math.cos(k * Math.PI / 360), 0.7), (Math.cos(k * Math.PI / 360) + 0.7) / (1 + 0.7 * Math.cos(k * Math.PI / 360)), 1e-12, 'cos form');
{ const g = P.gammaOfBeta(0.6); near(g, 1.25, 1e-12, 'gamma(0.6)'); }

// ---- range checks ----
for (const bad of [-0.1, 1, 1.5, NaN, Infinity, '0.5']) { checks++; assert.throws(() => P.aberratedAngle(1, bad), RangeError, 'bad beta ' + bad); }
checks++; assert.throws(() => P.resolveTarget('no-such-star'), RangeError);
checks++; assert.throws(() => P.skyView({ beta: 0.5, mode: 'sideways' }), RangeError);

// ---- temperature table ----
ok(P.teffOfSpectral('G2V') > 5000 && P.teffOfSpectral('G2V') < 6500, 'G2V ~ 5600');
ok(P.teffOfSpectral('A1V') > P.teffOfSpectral('G2V'), 'A hotter than G');
ok(P.teffOfSpectral('M5.5Ve') < P.teffOfSpectral('K1V'), 'M cooler than K');
ok(P.teffOfSpectral('T9') < P.teffOfSpectral('L7.5'), 'T cooler than L');
for (const s of NEIGHBORS) ok(Number.isFinite(P.teffOfSpectral(s.spectral)) && P.teffOfSpectral(s.spectral) > 0, 'Teff for ' + s.id);

// ---- full sky ----
for (const mode of ['forward', 'backward']) {
  const v0 = P.skyView({ beta: 0, mode });
  for (const s of v0.stars) { near(s.thetaP, s.theta, 1e-12, 'v0 theta'); near(s.D, 1, 1e-12, 'v0 D'); near(s.Tp, s.T, 1e-9, 'v0 T'); near(Math.hypot(s.x, s.y), s.phi, 1e-12, 'radius = angle from view axis'); }
  const v = P.skyView({ beta: 0.9, mode });
  near(v.gamma, 1 / Math.sqrt(1 - 0.81), 1e-12, 'sky gamma');
  for (const s of v.stars) {
    ok(Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.Tp), 'sky finite ' + s.id);
    near(Math.hypot(s.x, s.y), s.phi, 1e-12, 'azimuthal equidistant radius ' + s.id);
    if (s.mag !== null) near(s.mag, s.vmag - 2.5 * Math.log10(s.D ** 4), 1e-12, 'dm = -2.5 log10 D^4 ' + s.id);
    // position angle preserved: same psi at beta = 0 and beta = 0.9
    const s0 = v0.stars.find((q) => q.id === s.id);
    if (s0.phi > 1e-6 && s.phi > 1e-9) near(Math.cos(Math.atan2(s.y, s.x) - Math.atan2(s0.y, s0.x)), 1, 1e-9, 'position angle preserved ' + s.id);
  }
}
{ // forward: stars crowd toward the centre; the target is at the centre; backward: they spread to the edge side
  const fw = P.skyView({ beta: 0.99, target: 'proxima', mode: 'forward' });
  const t = fw.stars.find((s) => s.id === 'proxima'); near(t.x, 0, 1e-12, 'target x'); near(t.y, 0, 1e-12, 'target y'); near(t.D, Math.sqrt(1.99 / 0.01), 1e-9, 'target D');
  const fw0 = P.skyView({ beta: 0, target: 'proxima', mode: 'forward' });
  ok(fw.stars.every((s, i) => s.phi <= fw0.stars[i].phi + 1e-12), 'forward view compresses toward the axis');
  const bw = P.skyView({ beta: 0.99, target: 'proxima', mode: 'backward' });
  const bw0 = P.skyView({ beta: 0, target: 'proxima', mode: 'backward' });
  ok(bw.stars.every((s, i) => s.phi >= bw0.stars[i].phi - 1e-12), 'backward view pushes stars away from the aft axis');
  ok(bw.stars.every((s) => s.theta <= Math.PI / 2 || s.D < 1), 'D < 1 (redshift) for every star with theta > 90 deg');
  const free = P.skyView({ beta: 0.5, target: { ra: 10, dec: 20 } }); ok(free.stars.length === 50, 'free (RA,Dec) target');
  const nearPole = P.skyView({ beta: 0.5, target: { ra: 0, dec: 90 } }); ok(nearPole.stars.every((s) => Number.isFinite(s.x) && Number.isFinite(s.y)), 'polar axis finite');
}
// slider scale
near(P.betaFromSlider(0), 0, 1e-15, 'slider 0'); ok(P.betaFromSlider(1) < 1 && P.betaFromSlider(1) > 0.9999, 'slider top < 1');
for (const b of [0.5, 0.9, 0.99, 0.999]) near(P.betaFromSlider(P.sliderFromBeta(b)), b, 1e-12, 'slider round trip ' + b);
{ let p = -1; for (let i = 0; i <= 100; i++) { const b = P.betaFromSlider(i / 100); ok(b >= p, 'slider monotone'); p = b; } }
console.log(`porthole.contract: ${checks} checks OK`);
