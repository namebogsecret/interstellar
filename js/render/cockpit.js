import * as THREE from 'three';

// Cockpit frame: peripheral geometry (window struts + a bottom console) that
// gives the first-person view a sense of flying an actual ship, without
// covering the centre of the view where the relativistic optics/HUD do the
// real work.
//
// Rendered as a SEPARATE Scene, drawn AFTER the post-process composer
// (js/render/scene.js applyRenderPath / relPass / cubePass) — never through
// it. Two reasons that has to be true, both load-bearing:
//   1. Comoving, not aberrated: relativisticPass.js reprojects the frame BY
//      VIEW DIRECTION (it samples a wider source render by the ray each
//      screen pixel would have in the ship's rest frame). Cockpit parts are
//      fixed in camera-LOCAL space — they have no direction of their own to
//      aberrate, they are simply bolted to the pilot's eye — so passing them
//      through that shader would be physically wrong (a rigid part of the
//      ship doesn't refract with the starlight behind it).
//   2. No floating origin: main.js repositions every BODY relative to
//      ship.pos each frame (the floating-origin scheme — see main.js
//      "floating-origin render transforms"). The cockpit has no world
//      position to reposition at all: it lives entirely in camera-local
//      space, so it is exempt from that machinery by construction rather
//      than by a second parallel implementation of it.
//
// The mechanism: state.scene's root quaternion is copied from the display
// camera's quaternion every frame in drawCockpitOverlay() — and since
// camera.quaternion IS ship.quat (main.js sets it every frame; camera.position
// is always (0,0,0), the floating-origin convention) and every cockpit part's
// position/scale is expressed in camera-local coordinates via layoutCockpit(),
// that one quaternion copy is the entire "comoving with the ship" contract.
// drawCockpitOverlay() clears only the depth buffer (not colour) before its
// renderer.render() call, so the frame draws ON TOP of whatever
// composer.render() already wrote — world + relativistic optics + bloom —
// without re-entering any of the passes that produced it.

// Fixed viewing distance (metres) the frame geometry is authored at. Cockpit
// parts are expressed as fractions of the view frustum's half-height/half-
// width AT THIS DISTANCE (see frustumHalfExtents), so layoutCockpit() can
// re-derive every part's position/scale whenever aspect changes (window
// resize) by touching only Mesh.position/scale — never geometry/material.
const D = 1.8;

// One shared unit cube (12 tris), reused via per-mesh scale for every part of
// the frame — this is what "geometry built by code" means here: no imported
// mesh, no texture, just THREE.BoxGeometry sized and placed procedurally.
// Module-level cache (never disposed), the same convention as bodies.js's
// _glowTex — it is not allocated per cockpit-toggle, so it is not released by
// releaseCockpitResources below; only the per-toggle materials are.
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

function frustumHalfExtents(camera, dist) {
  const h = dist * Math.tan((camera.fov * Math.PI / 180) / 2);
  const w = h * camera.aspect;
  return { h, w };
}

// A box "part" is declared once as a function of the frustum's (w, h) at D —
// not as baked numbers — so resize just re-evaluates it.
function makePart(material, layout) {
  const mesh = new THREE.Mesh(UNIT_BOX, material);
  mesh.userData.layout = layout; // (w, h) -> {px, py, pz?, sx, sy, sz?, rx?, ry?, rz?, quat?}
  return mesh;
}

// `quat`, when present, overrides rx/ry/rz wholesale — it is how the
// perspective struts (see segmentBox below) point a box's local Z axis
// along an arbitrary direction instead of the axis-aligned rz-only tilt the
// flat panels (dashboard, edge trims) use.
function applyLayout(mesh, w, h) {
  const p = mesh.userData.layout(w, h);
  mesh.position.set(p.px, p.py, p.pz ?? -D);
  mesh.scale.set(p.sx, p.sy, p.sz ?? 0.03);
  if (p.quat) mesh.quaternion.copy(p.quat);
  else mesh.rotation.set(p.rx ?? 0, p.ry ?? 0, p.rz ?? 0);
}

function layoutGroup(group, w, h) {
  for (const mesh of group.children) applyLayout(mesh, w, h);
}

// ── Perspective struts (A-pillars, visor caps) ──────────────────────────────
//
// These are the parts that actually sell "you are inside a cabin": unlike
// the flat dashboard/trim panels (axis-aligned rectangles facing the
// camera), a strut is authored as two 3D endpoints — near/outer and
// far/inner — and the unit box is stretched and quaternion-rotated to span
// exactly between them. Because the endpoints sit at DIFFERENT depths (near
// close to camera and wide, far deep and narrow, converging toward
// screen-centre-top), the strut is genuinely foreshortened instead of being
// a flat bar parallel to the screen edge.
//
// Endpoints are expressed in the SAME "fraction of the frustum's half-
// extent at that depth" convention frustumHalfExtents already establishes
// for D: half-extent at depth k*D is exactly k*(half-extent at D), because
// the frustum is a cone from the camera. That is why every endpoint below
// multiplies the frustum's (w, h) — evaluated once at D — by its own depth
// factor k before taking a fraction of it; this keeps a strut correctly
// sized relative to the view frustum at ITS OWN depth, not D's.
function pillarPoints(side, w, h) {
  const kNear = 0.60, kFar = 1.15;
  // Outer, close to camera, low — hugs the bottom side edge.
  const a = new THREE.Vector3(side * w * kNear * 0.90, -h * kNear * 0.50, -D * kNear);
  // Still outer (not centre), high, receding — leans up and slightly
  // inward, the way a real A-pillar cants toward the header without ever
  // reaching the middle of the windshield.
  const b = new THREE.Vector3(side * w * kFar * 0.58, h * kFar * 0.78, -D * kFar);
  return { a, b };
}

// Visor cap: a short strut capping each pillar's far/high end — NOT a
// bridge to top-centre (that read as a big tent apex over the whole view in
// repair round 1's first screenshot pass, see ГРАБЛИ) — just enough of an
// inward-and-up nudge to suggest a canopy corner, kept well clear of the
// screen's dead centre and of the DOM HUD panels in the top-left/top-right.
function visorPoints(side, w, h) {
  const { b: outer } = pillarPoints(side, w, h);
  const inner = new THREE.Vector3(outer.x * 0.72, outer.y * 1.04, outer.z * 0.96);
  return { a: outer, b: inner };
}

// Builds a box spanning ptFn(w,h) -> {a, b} exactly: centred at the
// midpoint, stretched along local Z to the a-b distance, quaternion-rotated
// so local Z points from a to b. `thicknessScale` is a fraction of (w+h) so
// the strut's cross-section scales with the frustum like everything else.
function segmentBox(material, ptFn, thicknessScale) {
  return makePart(material, (w, h) => {
    const { a, b } = ptFn(w, h);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const dir = b.clone().sub(a);
    const len = dir.length();
    dir.normalize();
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    const thickness = (w + h) * thicknessScale;
    return { px: mid.x, py: mid.y, pz: mid.z, sx: thickness, sy: thickness, sz: len, quat };
  });
}

// Same span as segmentBox, but offset sideways (in the strut's own local
// frame, via the same quaternion) and thinned down — the lit edge rail
// running alongside a pillar/visor body, the strut equivalent of the flat
// panels' pz+epsilon trim convention.
function segmentBoxTrim(material, ptFn, thicknessScale, railScale) {
  return makePart(material, (w, h) => {
    const { a, b } = ptFn(w, h);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const dir = b.clone().sub(a);
    const len = dir.length();
    dir.normalize();
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    const thickness = (w + h) * thicknessScale;
    const offset = new THREE.Vector3(thickness * 0.65, thickness * 0.65, 0).applyQuaternion(quat);
    const p = mid.add(offset);
    return {
      px: p.x, py: p.y, pz: p.z,
      sx: thickness * railScale, sy: thickness * railScale, sz: len * 0.96, quat,
    };
  });
}

// ── Dashboard (raked, angled away from the pilot) ───────────────────────────
//
// CONSOLE_TILT rotates the slab about its own local X axis: its top edge
// swings back (more negative Z, away from camera) and its bottom edge
// swings forward (toward camera) — the "sloping instrument panel" look, as
// opposed to the old flat card facing the camera dead-on. K_CONSOLE < 1
// anchors the whole slab a bit closer than D, in the same "fraction of the
// frustum at ITS depth" convention pillarPoints uses.
const CONSOLE_TILT = -0.40;
const K_CONSOLE = 0.85;

function consoleGeom(w, h) {
  const wk = w * K_CONSOLE, hk = h * K_CONSOLE;
  return { wk, hk, py: -hk * 0.74, pz: -D * K_CONSOLE, sx: wk * 1.55, sy: hk * 0.36 };
}

// The raised, lit top rim of the dashboard: computed from the SAME rotated
// box geometry (top edge of a box tilted by CONSOLE_TILT about its centre
// lands at centre + halfHeight*(sin, cos) in the (z, y) plane), then nudged
// a hair further along +Z so it reads as a proud edge rather than z-fighting
// the slab it sits on — the rotated equivalent of the flat panels' pz+0.01.
function consoleEdgeGeom(w, h) {
  const g = consoleGeom(w, h);
  const hy = g.sy / 2;
  return {
    ...g,
    py: g.py + hy * Math.cos(CONSOLE_TILT),
    pz: g.pz + hy * Math.sin(CONSOLE_TILT) + 0.02,
  };
}

// 'full' — 12 boxes: raked dashboard + its lit top rim, 2 inset instrument
// lights, 2 A-pillars + their lit edge rails, 2 visor caps + their lit edge
// rails. Every strut is a true 3D span (segmentBox/segmentBoxTrim), not a
// screen-parallel rectangle — that is what buys the perspective.
function buildFullFrame(frameMat, trimMat) {
  const g = new THREE.Group();
  const consoleBody = makePart(frameMat, (w, h) => {
    const p = consoleGeom(w, h);
    return { px: 0, py: p.py, pz: p.pz, sx: p.sx, sy: p.sy, sz: 0.08, rx: CONSOLE_TILT };
  });
  const consoleEdge = makePart(trimMat, (w, h) => {
    const p = consoleEdgeGeom(w, h);
    return { px: 0, py: p.py, pz: p.pz, sx: p.sx * 0.98, sy: p.hk * 0.03, sz: 0.05, rx: CONSOLE_TILT };
  });
  const instruments = [-1, 1].map((side) => makePart(trimMat, (w, h) => {
    const p = consoleEdgeGeom(w, h);
    return {
      px: side * p.wk * 0.34, py: p.py - p.hk * 0.06, pz: p.pz,
      sx: p.wk * 0.09, sy: p.hk * 0.035, sz: 0.05, rx: CONSOLE_TILT,
    };
  }));
  const pillars = [-1, 1].map((side) => segmentBox(frameMat, (w, h) => pillarPoints(side, w, h), 0.0055));
  const pillarTrims = [-1, 1].map((side) => segmentBoxTrim(trimMat, (w, h) => pillarPoints(side, w, h), 0.0055, 0.34));
  const visorCaps = [-1, 1].map((side) => segmentBox(frameMat, (w, h) => visorPoints(side, w, h), 0.0048));
  const visorTrims = [-1, 1].map((side) => segmentBoxTrim(trimMat, (w, h) => visorPoints(side, w, h), 0.0048, 0.34));
  g.add(consoleBody, consoleEdge, ...instruments, ...pillars, ...pillarTrims, ...visorCaps, ...visorTrims);
  return g;
}

// 'lite' — 4 boxes: the SAME dashboard + its lit rim + the two A-pillars,
// no instruments/trim-rails/visor. Same shape as 'full', just the accents
// stripped out — a third of the triangles, still unmistakably a cockpit.
function buildLiteFrame(frameMat, trimMat) {
  const g = new THREE.Group();
  const consoleBody = makePart(frameMat, (w, h) => {
    const p = consoleGeom(w, h);
    return { px: 0, py: p.py, pz: p.pz, sx: p.sx, sy: p.sy, sz: 0.08, rx: CONSOLE_TILT };
  });
  const consoleEdge = makePart(trimMat, (w, h) => {
    const p = consoleEdgeGeom(w, h);
    return { px: 0, py: p.py, pz: p.pz, sx: p.sx * 0.98, sy: p.hk * 0.03, sz: 0.05, rx: CONSOLE_TILT };
  });
  const pillars = [-1, 1].map((side) => segmentBox(frameMat, (w, h) => pillarPoints(side, w, h), 0.0055));
  g.add(consoleBody, consoleEdge, ...pillars);
  return g;
}

// Mesh counts per level, kept in sync with build{Full,Lite}Frame above —
// used only for the honest triangle-count report (ТЗ §5), not for anything
// that affects rendering.
const PART_COUNT = { full: 12, lite: 4, off: 0 };

export function cockpitTriangleCount(level) {
  const trisPerBox = UNIT_BOX.index ? UNIT_BOX.index.count / 3 : UNIT_BOX.attributes.position.count / 3;
  return trisPerBox * (PART_COUNT[level] ?? 0);
}

export function createCockpitState() {
  return { scene: null, groupFull: null, groupLite: null, frameMat: null, trimMat: null, ready: false };
}

// Lazily allocates the cockpit's (tiny) THREE resources — geometry is the
// shared module-level UNIT_BOX, so only the two flat-colour materials are
// actually created here. Wrapped in try/catch for the same reason
// ensureCubeResources (js/render/scene.js) is: callers must check the return
// value, not assume success, even though a failure here (a handful of KB) is
// far less likely than the cube path's ~50MB render target.
export function ensureCockpitResources(state, camera) {
  if (state.ready) return true;
  try {
    const scene = new THREE.Scene();
    // Unlit on purpose — the cockpit must read identically in full Venusian
    // daylight and in the dark past Neptune; it does not depend on (and this
    // scene carries no) scene lighting.
    // toneMapped = false on both: the renderer's ACES filmic curve (set once,
    // shared by the composer's world pass AND this overlay's plain render()
    // call — see drawCockpitOverlay) lifts dark low tones a lot, which washed
    // the intended dark chassis out to a flat pale grey-blue in practice.
    // Opting these two out renders the authored hex colours exactly as given.
    //
    // frameMat: a dark cool grey, NOT pure black — the void behind it (scene
    // background / clear colour) IS pure black, so a truly black chassis
    // would vanish into it; this sits just above that floor so the silhouette
    // reads against both the void and a bright planet.
    // trimMat: a muted warm brass, deliberately NOT the HUD's accent cyan
    // (0x6ec8ff, see hud.js) — repair round 1 (B2-repair) found that sharing
    // the HUD's exact hue made the frame read as more interface chrome
    // instead of a physical part of the ship; a warm hue reads as the ship's
    // own running-light colour and lets the eye separate "structure" from
    // "instruments" at a glance.
    const frameMat = new THREE.MeshBasicMaterial({ color: 0x1b2028, toneMapped: false });
    const trimMat = new THREE.MeshBasicMaterial({ color: 0x9c7248, toneMapped: false });
    const groupFull = buildFullFrame(frameMat, trimMat);
    const groupLite = buildLiteFrame(frameMat, trimMat);
    scene.add(groupFull, groupLite);
    state.scene = scene;
    state.groupFull = groupFull;
    state.groupLite = groupLite;
    state.frameMat = frameMat;
    state.trimMat = trimMat;
    state.ready = true;
    layoutCockpit(state, camera);
    setCockpitLevel(state, 'full');
    return true;
  } catch {
    return false;
  }
}

// Idempotent inverse of ensureCockpitResources — frees the two materials
// (the only resources actually allocated per-toggle; UNIT_BOX is a permanent
// module-level cache, see its own comment) and drops every reference so a
// toggle-off actually gives the (small) GPU footprint back, mirroring
// releaseCubeResources's contract in js/render/scene.js.
export function releaseCockpitResources(state) {
  if (!state.ready) return;
  state.frameMat?.dispose();
  state.trimMat?.dispose();
  state.scene = null;
  state.groupFull = null;
  state.groupLite = null;
  state.frameMat = null;
  state.trimMat = null;
  state.ready = false;
}

// Re-derives every part's position/scale from the camera's CURRENT fov/aspect
// — call once on ensure and again whenever aspect changes (window resize).
export function layoutCockpit(state, camera) {
  if (!state.ready) return;
  const { w, h } = frustumHalfExtents(camera, D);
  layoutGroup(state.groupFull, w, h);
  layoutGroup(state.groupLite, w, h);
}

// Applies a cockpitDetail() verdict (js/render/renderPolicy.js) by toggling
// which of the two pre-built groups is visible — no geometry rebuild, no
// dispose/recreate churn on every LOD change (only ensure/release, driven by
// the master I-toggle, touch materials).
export function setCockpitLevel(state, level) {
  if (!state.ready) return;
  state.groupFull.visible = level === 'full';
  state.groupLite.visible = level === 'lite';
}

// Draws the cockpit scene on top of whatever composer.render() just wrote,
// without re-entering the composer's passes. See the module header for why
// a plain quaternion copy is the entire "comoving with the ship" mechanism.
export function drawCockpitOverlay(renderer, state, camera) {
  if (!state.ready) return;
  state.scene.quaternion.copy(camera.quaternion);
  const prevAutoClear = renderer.autoClear;
  renderer.autoClear = false;
  renderer.clearDepth();   // draw over the composited frame; never touch colour
  renderer.render(state.scene, camera);
  renderer.autoClear = prevAutoClear;
}
