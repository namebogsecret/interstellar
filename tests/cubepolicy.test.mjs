// cubeAutoStep(s, fps, dt) contract (js/render/renderPolicy.js). Written from
// the ТЗ, not the impl:
//   s = { active, sinceActivate, lowTime, blocked, userForced, bloomOn, visible }
//   -> { lowTime: number, action: 'demote'|'hold', reason: string }
//
// Constants (exported by the same module, imported here so the test never
// drifts from the real thresholds): CUBE_GRACE_S, CUBE_LOW_FPS,
// CUBE_LOW_HOLD_S, CUBE_FLOOR_FPS, CUBE_FLOOR_HOLD_S.
//
// Policy: there is no auto-promote — cubeAutoStep only ever hands back
// 'hold' or 'demote'. It downgrades an overloaded cube path; it never
// re-enables one.
import assert from 'node:assert/strict';
import {
  cubeAutoStep,
  CUBE_GRACE_S,
  CUBE_LOW_FPS,
  CUBE_LOW_HOLD_S,
  CUBE_FLOOR_FPS,
  CUBE_FLOOR_HOLD_S,
} from '../js/render/renderPolicy.js';

// Small deterministic LCG (Numerical Recipes constants) — no external deps,
// fixed seed so P9 is reproducible.
function makeLcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// ---------------------------------------------------------------------
// P1 — never silently take it away: whenever any of blocked, userForced,
// !active, !visible holds, action must be 'hold' and lowTime must come
// back 0, no matter how low fps is or how long the trace / how much
// lowTime had already accumulated going in.
// Property test over all 16 combinations of the 4 flags × 4 fps values.
// ---------------------------------------------------------------------
{
  const BOOLS = [true, false];
  const fpsOpts = [0, 5, 15, 60];
  const lowTimeInOpts = [0, 1.5, 10]; // stand-in for "any trace length so far"
  let guardedCount = 0;
  for (const active of BOOLS) {
    for (const blocked of BOOLS) {
      for (const userForced of BOOLS) {
        for (const visible of BOOLS) {
          const guarded = blocked || userForced || !active || !visible;
          if (!guarded) continue; // the single all-clear combo is normal operation, covered by P2-P9
          guardedCount++;
          for (const fps of fpsOpts) {
            for (const lowTimeIn of lowTimeInOpts) {
              const s = { active, sinceActivate: 100, lowTime: lowTimeIn, blocked, userForced, bloomOn: false, visible };
              const r = cubeAutoStep(s, fps, 0.5);
              const ctx = `active=${active} blocked=${blocked} userForced=${userForced} visible=${visible} fps=${fps} lowTimeIn=${lowTimeIn}`;
              assert.equal(r.action, 'hold', `P1 guarded state must hold: ${ctx}`);
              assert.equal(r.lowTime, 0, `P1 guarded state must report lowTime=0: ${ctx}`);
            }
          }
        }
      }
    }
  }
  assert.equal(guardedCount, 15, 'P1 exactly 15 of 16 flag combinations are guarded (the all-clear combo is excluded)');
}

// ---------------------------------------------------------------------
// P2 — grace period: a one-off hitch right after activation (shader
// compile + 50MB render-target alloc) must not count as a hardware
// failure. sinceActivate < CUBE_GRACE_S, fps=5 -> hold, lowTime pinned at 0.
// ---------------------------------------------------------------------
{
  let s = { active: true, sinceActivate: 0, lowTime: 0, blocked: false, userForced: false, bloomOn: false, visible: true };
  const dt = 0.5;
  const stepsWithinGrace = Math.floor(CUBE_GRACE_S / dt);
  assert.ok(stepsWithinGrace >= 1, 'test setup: need at least one step strictly inside the grace window');
  for (let i = 0; i < stepsWithinGrace; i++) {
    assert.ok(s.sinceActivate < CUBE_GRACE_S, `test setup: sinceActivate=${s.sinceActivate} must stay < CUBE_GRACE_S=${CUBE_GRACE_S}`);
    const r = cubeAutoStep(s, 5, dt);
    assert.equal(r.action, 'hold', `P2 window ${i}: must hold during grace period even at fps=5`);
    assert.equal(r.lowTime, 0, `P2 window ${i}: lowTime must not accumulate during grace period, got ${r.lowTime}`);
    s = { ...s, lowTime: r.lowTime, sinceActivate: s.sinceActivate + dt };
  }
}

// ---------------------------------------------------------------------
// P3 — zero false positives: 10000 windows at a stable 60fps -> never a
// single demote, lowTime stays 0 throughout.
// ---------------------------------------------------------------------
{
  let s = { active: true, sinceActivate: 0, lowTime: 0, blocked: false, userForced: false, bloomOn: false, visible: true };
  const dt = 0.5;
  for (let i = 0; i < 10000; i++) {
    const r = cubeAutoStep(s, 60, dt);
    assert.equal(r.action, 'hold', `P3 window ${i}: unexpected demote at stable 60fps`);
    assert.equal(r.lowTime, 0, `P3 window ${i}: lowTime must stay 0 at stable 60fps, got ${r.lowTime}`);
    s = { ...s, lowTime: r.lowTime, sinceActivate: s.sinceActivate + dt };
  }
}

// ---------------------------------------------------------------------
// P4 — playability floor: active cube, grace expired, bloomOn=true,
// fps=5 (below CUBE_FLOOR_FPS) -> demote must land no later than
// CUBE_FLOOR_HOLD_S of accumulated time, REGARDLESS of bloomOn (can't
// wait out the bloom-degrade cascade at single-digit fps).
// ---------------------------------------------------------------------
{
  const dt = 0.2;
  let s = { active: true, sinceActivate: CUBE_GRACE_S + 1, lowTime: 0, blocked: false, userForced: false, bloomOn: true, visible: true };
  let elapsed = 0;
  let demoted = false;
  let reason = '';
  const maxSteps = Math.ceil(CUBE_FLOOR_HOLD_S / dt) + 5; // small margin so a late-but-eventual demote still gets caught with a clear failure
  for (let i = 0; i < maxSteps; i++) {
    const r = cubeAutoStep(s, 5, dt);
    s = { ...s, lowTime: r.lowTime, sinceActivate: s.sinceActivate + dt };
    elapsed += dt;
    if (r.action === 'demote') {
      demoted = true;
      reason = r.reason;
      assert.ok(elapsed <= CUBE_FLOOR_HOLD_S + dt + 1e-9,
        `P4 demote must land by CUBE_FLOOR_HOLD_S=${CUBE_FLOOR_HOLD_S}s of low-fps time, happened at elapsed=${elapsed}`);
      break;
    }
  }
  assert.ok(demoted, 'P4 demote must occur below CUBE_FLOOR_FPS despite bloomOn=true');
  assert.ok(typeof reason === 'string' && reason.length > 0, 'P4 reason must be a non-empty readable string');
}

// ---------------------------------------------------------------------
// P5 — degrade order, part 1: active cube, grace expired, bloomOn=true,
// fps=15 (between CUBE_FLOOR_FPS and CUBE_LOW_FPS) -> across 20 windows,
// never a demote, and lowTime stays FROZEN at whatever it was on entry
// (not reset to 0, not growing): bloom gets sacrificed first (existing
// guard turns bloom off below 24fps), only then is the cube effect at risk.
// ---------------------------------------------------------------------
{
  const dt = 0.1;
  let s = { active: true, sinceActivate: CUBE_GRACE_S + 1, lowTime: 0, blocked: false, userForced: false, bloomOn: false, visible: true };
  // Prime a nonzero lowTime via a few bloomOn=false low-fps windows (see P6
  // for why fps=15+bloomOn=false accumulates), staying far below CUBE_LOW_HOLD_S.
  for (let i = 0; i < 3; i++) {
    const r = cubeAutoStep(s, 15, dt);
    assert.equal(r.action, 'hold', 'P5 setup: priming steps must not demote yet');
    s = { ...s, lowTime: r.lowTime, sinceActivate: s.sinceActivate + dt };
  }
  assert.ok(s.lowTime > 0, 'P5 setup: priming must have produced a nonzero lowTime to freeze');
  const primed = s.lowTime;
  s = { ...s, bloomOn: true };
  for (let i = 0; i < 20; i++) {
    const r = cubeAutoStep(s, 15, dt);
    assert.equal(r.action, 'hold', `P5 window ${i}: no demote allowed at fps=15 while bloomOn=true`);
    assert.equal(r.lowTime, primed, `P5 window ${i}: lowTime must stay frozen at ${primed}, got ${r.lowTime}`);
    s = { ...s, lowTime: r.lowTime, sinceActivate: s.sinceActivate + dt };
  }
}

// ---------------------------------------------------------------------
// P6 — degrade order, part 2: same setup but bloomOn=false, fps=15 ->
// demote lands exactly when accumulated lowTime reaches CUBE_LOW_HOLD_S.
// Window count is computed from the constants, never hardcoded.
// ---------------------------------------------------------------------
{
  const dt = 0.5;
  let s = { active: true, sinceActivate: CUBE_GRACE_S + 1, lowTime: 0, blocked: false, userForced: false, bloomOn: false, visible: true };
  const expectedWindow = Math.round(CUBE_LOW_HOLD_S / dt); // dt chosen to divide CUBE_LOW_HOLD_S evenly
  assert.ok(Number.isInteger(CUBE_LOW_HOLD_S / dt), 'test setup: dt must evenly divide CUBE_LOW_HOLD_S to pin an exact window');
  let demoteWindow = -1;
  for (let i = 1; i <= expectedWindow + 5; i++) {
    const r = cubeAutoStep(s, 15, dt);
    s = { ...s, lowTime: r.lowTime, sinceActivate: s.sinceActivate + dt };
    if (r.action === 'demote') { demoteWindow = i; break; }
    assert.ok(i < expectedWindow, `P6 must not demote before window ${expectedWindow} (i=${i})`);
  }
  assert.equal(demoteWindow, expectedWindow,
    `P6 demote must land exactly at window ${expectedWindow} (lowTime reaching CUBE_LOW_HOLD_S=${CUBE_LOW_HOLD_S}), got ${demoteWindow}`);
}

// ---------------------------------------------------------------------
// P7 — reset: lowTime accumulated on a low-fps run must snap to exactly 0
// (not merely decrease) the moment a single window comes in above threshold.
// ---------------------------------------------------------------------
{
  const dt = 0.3;
  let s = { active: true, sinceActivate: CUBE_GRACE_S + 1, lowTime: 0, blocked: false, userForced: false, bloomOn: false, visible: true };
  for (let i = 0; i < 3; i++) {
    const r = cubeAutoStep(s, 15, dt);
    s = { ...s, lowTime: r.lowTime, sinceActivate: s.sinceActivate + dt };
  }
  assert.ok(s.lowTime > 0, 'P7 setup: must have accumulated lowTime > 0 before the recovery window');
  const r = cubeAutoStep(s, 60, dt);
  assert.equal(r.lowTime, 0, `P7 lowTime must reset to exactly 0 after a healthy fps=60 window, got ${r.lowTime}`);
}

// ---------------------------------------------------------------------
// P8 — purity: cubeAutoStep must not mutate the state object it was given.
// ---------------------------------------------------------------------
{
  const s = { active: true, sinceActivate: 5, lowTime: 1.2, blocked: false, userForced: false, bloomOn: false, visible: true };
  const before = JSON.stringify(s);
  cubeAutoStep(s, 15, 0.5);
  assert.equal(JSON.stringify(s), before, 'P8 cubeAutoStep must not mutate the input state object');
}

// ---------------------------------------------------------------------
// P9 — anti-oscillation (property test): a deterministic pseudo-random
// 10000-window trace with fps jumping around in [3, 75], emulating the
// real caller contract (on 'demote' the caller sets active=false,
// blocked=true and keeps feeding that forward). Demote must fire AT MOST
// ONCE across the whole trace — proof the automaton is terminal, not
// proof of any particular threshold.
// ---------------------------------------------------------------------
{
  const rand = makeLcg(20260813);
  let s = { active: true, sinceActivate: 0, lowTime: 0, blocked: false, userForced: false, bloomOn: false, visible: true };
  const dt = 0.1;
  let demotes = 0;
  for (let i = 0; i < 10000; i++) {
    const fps = 3 + rand() * 72; // [3, 75)
    const r = cubeAutoStep(s, fps, dt);
    if (r.action === 'demote') {
      demotes++;
      s = { ...s, lowTime: r.lowTime, sinceActivate: s.sinceActivate + dt, active: false, blocked: true };
    } else {
      s = { ...s, lowTime: r.lowTime, sinceActivate: s.sinceActivate + dt };
    }
  }
  assert.ok(demotes <= 1, `P9 demote must happen at most once across the trace, happened ${demotes} times`);
}

console.log('cubepolicy.test.mjs OK');
