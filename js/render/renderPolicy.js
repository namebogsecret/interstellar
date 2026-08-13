// Pure render-path policy: resolving which pass renders the frame, and the
// auto-demotion state machine for the cubemap aberration path.
//
// NO THREE import, NO DOM/WebGL access — this module must be importable in
// plain node tests (`node --loader tests/three-loader.mjs`) with zero side
// effects. Keep it that way; scene.js/main.js own the wiring to THREE.

// ── Render path resolution ──────────────────────────────────────────────────
//
// Truth table (relFx × cube, where cube := cubeWanted && cubeReady — the two
// inputs that only ever matter together):
//
//   relFx | cube  | cubeEnabled | path  | relEnabled | useSourceCamera
//   ------+-------+-------------+-------+------------+----------------
//   false | false |    false    | plain |   false    |   false
//   false | true  |    false    | plain |   false    |   false
//   true  | false |    false    | wide  |   true     |   true
//   true  | true  |    true     | cube  |   false    |   false
//
// Reading the table: relFx=false always yields 'plain' regardless of cube
// (the master toggle gates everything below it). relFx=true with cube=false
// yields 'wide' (the extended-FOV 2D aberration path, which needs the cropped
// source camera). relFx=true with cube=true yields 'cube' (the cubemap path,
// which samples by direction and needs no source-camera crop at all).
//
// `useSourceCamera` is LITERALLY the same value as `relEnabled` — this is the
// machine proof of the crop invariant (ГРАБЛИ.md #2: the wide 90° source
// camera must be switched in if and only if the single pass that crops it
// back down to the display's 60° is the one actually running this frame). If
// the wide 90° source were ever fed to the composer while relEnabled=false
// (plain or cube path), nothing would crop it back to 60° and the picture
// would zoom out — exactly the regression ГРАБЛИ #2 describes. Assigning
// `useSourceCamera: relEnabled` instead of re-deriving it from scratch is
// what keeps that impossible by construction.
export function resolveRenderPath({ relFx, cubeWanted, cubeReady }) {
  const cubeEnabled = !!(relFx && cubeWanted && cubeReady);
  const relEnabled  = !!(relFx && !cubeEnabled);
  return { path: cubeEnabled ? 'cube' : relEnabled ? 'wide' : 'plain',
           relEnabled, cubeEnabled, useSourceCamera: relEnabled };
}

// ── Cube toggle wiring ───────────────────────────────────────────────────────
//
// s = { cubeAberr, cubeForced, cubeBlocked } -> a FRESH state object (s is not
// mutated) reflecting the effect of one `u` keypress. The rest of the fields
// are derived from the EDGE direction of the flip, not carried over blindly:
//
//   OFF -> ON : cubeAberr=true,  cubeForced=true,  cubeBlocked=false
//     An explicit user choice overrides any earlier auto-demotion verdict
//     (cubeBlocked) and re-arms the "user has spoken" latch that keeps
//     cubeAutoStep's demoter from immediately fighting the user.
//   ON  -> OFF: cubeAberr=false, cubeForced=false, cubeBlocked unchanged
//     "The user has spoken" is a statement about the ON state only -- once
//     the user turns the toggle back off there is nothing left to force, and
//     leaving cubeForced=true here is exactly the bug that permanently
//     disabled auto-demotion after a single touch of the toggle (it never
//     got reset on this edge in the pre-fix code).
export function cubeToggleState(s) {
  const cubeAberr = !s.cubeAberr;
  if (cubeAberr) return { cubeAberr: true, cubeForced: true, cubeBlocked: false };
  return { cubeAberr: false, cubeForced: false, cubeBlocked: s.cubeBlocked };
}

// s = { cubeAberr, relFx, cubeReady, cubeBlocked } -> 'ensure' | 'release' | 'none'
// Decides whether this frame's reconciler should allocate/free the cube
// path's ~50MB GPU footprint (render target + camera).
//   'ensure'  <=> cubeAberr && relFx && !cubeReady && !cubeBlocked
//     Both toggles (cube AND the relativistic-optics master switch) must
//     want the cube path, resources aren't already up, and the one-shot
//     failure latch (cubeBlocked) hasn't tripped -- that latch is what caps
//     the retry count: once allocation has failed and cubeBlocked is set,
//     'ensure' never fires again for this session.
//   'release' <=> cubeReady && !(cubeAberr && relFx)
//     Mirrors resolveRenderPath's own cube gate (cubeWanted && relFx):
//     resources are freed the instant either toggle stops wanting the cube
//     path, not just when cubeAberr itself goes false -- turning relFx off
//     while cubeAberr stays on must not leak the render target.
//   else 'none'. The two branches are mutually exclusive by construction
//   (ensure requires !cubeReady, release requires cubeReady).
export function cubeResourceAction(s) {
  const { cubeAberr, relFx, cubeReady, cubeBlocked } = s;
  if (cubeAberr && relFx && !cubeReady && !cubeBlocked) return 'ensure';
  if (cubeReady && !(cubeAberr && relFx)) return 'release';
  return 'none';
}

// ── Cubemap auto-demotion policy ────────────────────────────────────────────
//
// There is deliberately no auto-PROMOTION policy, and there will not be one:
// the browser gives no honest signal of hardware headroom (no exposed GPU
// tier/thermal state), and rAF is quantized to vsync — a steady 60fps does
// not distinguish a loaded machine from an idle one, it just means the frame
// fit inside one vblank either way. Only while the cube path is ACTUALLY
// rendering does low FPS causally measure its own cost, so demotion is an
// honest signal and promotion would not be.
export const CUBE_GRACE_S = 2.0;
export const CUBE_LOW_FPS = 20;
export const CUBE_LOW_HOLD_S = 3.0;
export const CUBE_FLOOR_FPS = 10;
export const CUBE_FLOOR_HOLD_S = 1.0;

// Runtime default for the cube toggle (compile-time CUBEMAP_ABERRATION flag
// is retired; this is its replacement).
export const CUBE_DEFAULT_ON = false;

// s = { active, sinceActivate, lowTime, blocked, userForced, bloomOn, visible }
// Pure: does not mutate s, returns a fresh lowTime. Rules applied in order;
// there is no 'promote' action — see note above.
export function cubeAutoStep(s, fps, dt) {
  if (!s.active || s.blocked || s.userForced || !s.visible) {
    return { lowTime: 0, action: 'hold', reason: 'inactive' };
  }
  if (s.sinceActivate < CUBE_GRACE_S) {
    // Shader compile + RT allocation cause a legitimate one-off hitch right
    // after activation — don't let it count toward demotion.
    return { lowTime: s.lowTime, action: 'hold', reason: 'grace' };
  }
  if (fps < CUBE_FLOOR_FPS) {
    // Unusable tier ignores bloomOn — at 8fps you cannot wait for the bloom
    // cascade to get demoted first.
    const lowTime = s.lowTime + dt;
    if (lowTime >= CUBE_FLOOR_HOLD_S) {
      return { lowTime, action: 'demote', reason: 'unusable' };
    }
    return { lowTime, action: 'hold', reason: 'unusable' };
  }
  if (fps < CUBE_LOW_FPS && s.bloomOn) {
    // Sacrifice the cheap bloom cascade first (its own guard trips below
    // fps<24) before sacrificing the physics. lowTime is frozen, not reset.
    return { lowTime: s.lowTime, action: 'hold', reason: 'awaiting-bloom' };
  }
  if (fps < CUBE_LOW_FPS) {
    const lowTime = s.lowTime + dt;
    if (lowTime >= CUBE_LOW_HOLD_S) {
      return { lowTime, action: 'demote', reason: 'slow' };
    }
    return { lowTime, action: 'hold', reason: 'slow' };
  }
  return { lowTime: 0, action: 'hold', reason: 'ok' };
}

// ── Cockpit detail policy ───────────────────────────────────────────────────
//
// Cockpit-frame LOD (js/render/cockpit.js: 'full' | 'lite' | 'off'), reusing
// the SAME FPS window and the SAME thresholds as the cube auto-demotion above
// (CUBE_GRACE_S / CUBE_LOW_FPS / CUBE_LOW_HOLD_S / CUBE_FLOOR_FPS /
// CUBE_FLOOR_HOLD_S) — a second, parallel degradation mechanism is explicitly
// out of scope (ТЗ B2 §5). Same no-promotion rationale as cubeAutoStep's
// header (rAF is vsync-quantized; a recovered fps reading doesn't honestly
// distinguish "machine got faster" from "just idle this half-second" — only
// demotion is an honest signal), except cockpitDetail has three ordered
// levels instead of cube's binary on/off, so demotion is staged: 'full' only
// ever steps down to 'lite' at the softer LOW threshold, while the harsher
// FLOOR threshold can drop straight to 'off' from either level (an unusable
// frame rate does not wait for the intermediate mitigation to be tried
// first — mirrors cubeAutoStep's own "unusable tier ignores bloomOn" branch).
//
// s = { level, active, sinceActivate, lowTime, floorTime, userForced, visible }
//   level        — the level being held BEFORE this call (never mutated).
//   active       — the cockpit toggle (I key) is on and its GPU resources are
//                   allocated; false means there is nothing to measure or
//                   degrade (mirrors cubeAutoStep's own `active`).
//   visible      — page/tab visibility (`!document.hidden`), NOT the cockpit
//                   toggle — a backgrounded tab starves rAF and produces a
//                   dishonest low-fps reading (mirrors cubeAutoStep's own
//                   `visible`, which is the same page-visibility signal).
//   userForced   — pins the level to 'full' unconditionally (screenshot /
//                   explicit-override escape hatch) and resets both timers;
//                   the ONE way a level can move back up, and it is an
//                   explicit external request, not a promotion policy.
// -> { level: 'full'|'lite'|'off', lowTime, floorTime, reason }
export function cockpitDetail(s, fps, dt) {
  if (!s.active || !s.visible) {
    return { level: s.level, lowTime: 0, floorTime: 0, reason: 'inactive' };
  }
  if (s.userForced) {
    return { level: 'full', lowTime: 0, floorTime: 0, reason: 'forced' };
  }
  if (s.level === 'off') {
    // Terminal for this activation — no auto-recovery (see header). Only a
    // fresh activation (caller resets sinceActivate/level) or userForced above
    // can bring it back.
    return { level: 'off', lowTime: 0, floorTime: 0, reason: 'off' };
  }
  if (s.sinceActivate < CUBE_GRACE_S) {
    return { level: s.level, lowTime: s.lowTime, floorTime: s.floorTime, reason: 'grace' };
  }
  if (fps < CUBE_FLOOR_FPS) {
    const floorTime = s.floorTime + dt;
    if (floorTime >= CUBE_FLOOR_HOLD_S) {
      return { level: 'off', lowTime: s.lowTime, floorTime, reason: 'unusable' };
    }
    return { level: s.level, lowTime: s.lowTime, floorTime, reason: 'unusable' };
  }
  if (fps < CUBE_LOW_FPS) {
    const lowTime = s.lowTime + dt;
    if (lowTime >= CUBE_LOW_HOLD_S && s.level === 'full') {
      return { level: 'lite', lowTime, floorTime: 0, reason: 'slow' };
    }
    return { level: s.level, lowTime, floorTime: s.floorTime, reason: 'slow' };
  }
  return { level: s.level, lowTime: 0, floorTime: 0, reason: 'ok' };
}
