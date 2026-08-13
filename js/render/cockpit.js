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
  mesh.userData.layout = layout; // (w, h) -> {px, py, pz?, sx, sy, sz?, rz?}
  return mesh;
}

function applyLayout(mesh, w, h) {
  const p = mesh.userData.layout(w, h);
  mesh.position.set(p.px, p.py, p.pz ?? -D);
  mesh.scale.set(p.sx, p.sy, p.sz ?? 0.03);
  mesh.rotation.z = p.rz ?? 0;
}

function layoutGroup(group, w, h) {
  for (const mesh of group.children) applyLayout(mesh, w, h);
}

// 'full' — 11 boxes: dashboard + trim strip + 3 instrument blocks, header bar
// + trim strip, 4 corner struts. Trim/instrument parts sit at pz = -D+0.01
// (closer to camera than the body they sit on) so they read as a bright
// backlit edge rather than z-fighting with it.
function buildFullFrame(frameMat, trimMat) {
  const g = new THREE.Group();
  const consoleBody = makePart(frameMat, (w, h) => ({
    px: 0, py: -h * 0.90, sx: w * 1.70, sy: h * 0.24,
  }));
  const consoleTrim = makePart(trimMat, (w, h) => ({
    px: 0, py: -h * 0.78, pz: -D + 0.01, sx: w * 1.66, sy: h * 0.012,
  }));
  const instruments = [-0.35, 0, 0.35].map((f) => makePart(trimMat, (w, h) => ({
    px: w * f, py: -h * 0.90, pz: -D + 0.01, sx: w * 0.10, sy: h * 0.05,
  })));
  const headerBody = makePart(frameMat, (w, h) => ({
    px: 0, py: h * 0.94, sx: w * 2.00, sy: h * 0.12,
  }));
  const headerTrim = makePart(trimMat, (w, h) => ({
    px: 0, py: h * 0.885, pz: -D + 0.01, sx: w * 1.96, sy: h * 0.010,
  }));
  // Four corner struts, thin diagonal boxes bracketing each corner of the
  // frustum; mirrored so top-left/bottom-right share one tilt and
  // top-right/bottom-left share the other (a simple diamond brace, not
  // meant to be structurally literal — cosmetic framing only).
  const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => makePart(frameMat, (w, h) => ({
    px: sx * w * 0.94, py: sy * h * 0.80, sx: w * 0.09, sy: h * 0.30, rz: sx * sy * 0.35,
  })));
  g.add(consoleBody, consoleTrim, headerBody, headerTrim, ...instruments, ...corners);
  return g;
}

// 'lite' — 2 boxes: just the dashboard + header slabs, no trim/instruments/
// corner struts. Still unmistakably "a cockpit", at a fifth of the triangles.
function buildLiteFrame(frameMat) {
  const g = new THREE.Group();
  const consoleBody = makePart(frameMat, (w, h) => ({
    px: 0, py: -h * 0.90, sx: w * 1.70, sy: h * 0.24,
  }));
  const headerBody = makePart(frameMat, (w, h) => ({
    px: 0, py: h * 0.94, sx: w * 2.00, sy: h * 0.12,
  }));
  g.add(consoleBody, headerBody);
  return g;
}

// Mesh counts per level, kept in sync with build{Full,Lite}Frame above —
// used only for the honest triangle-count report (ТЗ §5), not for anything
// that affects rendering.
const PART_COUNT = { full: 11, lite: 2, off: 0 };

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
    const frameMat = new THREE.MeshBasicMaterial({ color: 0x0d1016, toneMapped: false });
    const trimMat = new THREE.MeshBasicMaterial({ color: 0x6ec8ff, toneMapped: false });
    const groupFull = buildFullFrame(frameMat, trimMat);
    const groupLite = buildLiteFrame(frameMat);
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
