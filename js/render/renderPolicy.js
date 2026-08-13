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
