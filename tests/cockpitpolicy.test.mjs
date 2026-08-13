// cockpitDetail(s, fps, dt) contract (js/render/renderPolicy.js). Written from
// the ТЗ (B2 §5), not the impl:
//   s = { level, active, sinceActivate, lowTime, floorTime, userForced, visible }
//   -> { level: 'full'|'lite'|'off', lowTime, floorTime, reason }
//
// Constants (exported by the same module, imported here so the test never
// drifts from the real thresholds — cockpitDetail deliberately REUSES the
// cube path's thresholds, not a parallel set): CUBE_GRACE_S, CUBE_LOW_FPS,
// CUBE_LOW_HOLD_S, CUBE_FLOOR_FPS, CUBE_FLOOR_HOLD_S.
//
// Policy shape: three ordered levels ('full' > 'lite' > 'off'), no
// auto-promote (mirrors cubeAutoStep — see that function's header for why a
// recovered fps reading is not an honest "machine got faster" signal). The
// only way level ever moves UP is userForced=true (an explicit external
// override, not a promotion policy).
import assert from 'node:assert/strict';
import {
  cockpitDetail,
  CUBE_GRACE_S,
  CUBE_LOW_FPS,
  CUBE_LOW_HOLD_S,
  CUBE_FLOOR_FPS,
  CUBE_FLOOR_HOLD_S,
} from '../js/render/renderPolicy.js';

function makeLcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const RANK = { full: 2, lite: 1, off: 0 };

// ---------------------------------------------------------------------
// P1 — never silently take it away: whenever !active or !visible holds,
// level must be unchanged from the input and both timers must come back 0,
// no matter the current level, fps, or however much time had accumulated.
// ---------------------------------------------------------------------
{
  const LEVELS = ['full', 'lite', 'off'];
  const fpsOpts = [0, 5, 15, 60];
  const timeOpts = [0, 1.5, 10];
  for (const active of [true, false]) {
    for (const visible of [true, false]) {
      if (active && visible) continue; // the all-clear combo is normal operation, covered below
      for (const level of LEVELS) {
        for (const fps of fpsOpts) {
          for (const lowTime of timeOpts) {
            for (const floorTime of timeOpts) {
              const s = { level, active, sinceActivate: 100, lowTime, floorTime, userForced: false, visible };
              const r = cockpitDetail(s, fps, 0.5);
              const ctx = `active=${active} visible=${visible} level=${level} fps=${fps}`;
              assert.equal(r.level, level, `P1 guarded state must not change level: ${ctx}`);
              assert.equal(r.lowTime, 0, `P1 guarded state must report lowTime=0: ${ctx}`);
              assert.equal(r.floorTime, 0, `P1 guarded state must report floorTime=0: ${ctx}`);
            }
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------
// P2 — userForced wins unconditionally: even at floor-tier fps with
// accumulated time and level already 'off', userForced snaps straight back
// to 'full' with both timers reset. The one legitimate way level moves up.
// ---------------------------------------------------------------------
{
  const s = { level: 'off', active: true, sinceActivate: 100, lowTime: 3, floorTime: 3, userForced: true, visible: true };
  const r = cockpitDetail(s, 2, 0.5);
  assert.equal(r.level, 'full', 'P2 userForced must force level to full');
  assert.equal(r.lowTime, 0, 'P2 userForced must reset lowTime');
  assert.equal(r.floorTime, 0, 'P2 userForced must reset floorTime');
}

// ---------------------------------------------------------------------
// P3 — 'off' is terminal for the activation: once level is 'off', no fps
// (however high) and no elapsed time brings it back without userForced.
// ---------------------------------------------------------------------
{
  let s = { level: 'off', active: true, sinceActivate: 100, lowTime: 0, floorTime: 0, userForced: false, visible: true };
  for (let i = 0; i < 500; i++) {
    const r = cockpitDetail(s, 60, 0.5); // even a perfectly healthy fps
    assert.equal(r.level, 'off', `P3 step ${i}: off must stay off without userForced`);
    assert.equal(r.lowTime, 0, `P3 step ${i}: lowTime pinned at 0 while off`);
    assert.equal(r.floorTime, 0, `P3 step ${i}: floorTime pinned at 0 while off`);
    s = { ...s, lowTime: r.lowTime, floorTime: r.floorTime, sinceActivate: s.sinceActivate + 0.5 };
  }
}

// ---------------------------------------------------------------------
// P4 — grace period: a one-off hitch right after activation (material
// alloc) must not count. sinceActivate < CUBE_GRACE_S, fps=2 -> hold at
// 'full', both timers pinned at 0.
// ---------------------------------------------------------------------
{
  let s = { level: 'full', active: true, sinceActivate: 0, lowTime: 0, floorTime: 0, userForced: false, visible: true };
  const dt = 0.5;
  const stepsWithinGrace = Math.floor(CUBE_GRACE_S / dt);
  assert.ok(stepsWithinGrace >= 1, 'test setup: need at least one step strictly inside the grace window');
  for (let i = 0; i < stepsWithinGrace; i++) {
    assert.ok(s.sinceActivate < CUBE_GRACE_S, `test setup: sinceActivate=${s.sinceActivate} must stay < CUBE_GRACE_S`);
    const r = cockpitDetail(s, 2, dt);
    assert.equal(r.level, 'full', `P4 window ${i}: must hold 'full' during grace period even at fps=2`);
    assert.equal(r.lowTime, 0, `P4 window ${i}: lowTime must not accumulate during grace`);
    assert.equal(r.floorTime, 0, `P4 window ${i}: floorTime must not accumulate during grace`);
    s = { ...s, lowTime: r.lowTime, floorTime: r.floorTime, sinceActivate: s.sinceActivate + dt };
  }
}

// ---------------------------------------------------------------------
// P5 — zero false positives: 10000 windows at a stable 60fps -> level stays
// 'full' throughout, both timers stay 0 (no "дёрганье").
// ---------------------------------------------------------------------
{
  let s = { level: 'full', active: true, sinceActivate: 0, lowTime: 0, floorTime: 0, userForced: false, visible: true };
  const dt = 0.5;
  for (let i = 0; i < 10000; i++) {
    const r = cockpitDetail(s, 60, dt);
    assert.equal(r.level, 'full', `P5 window ${i}: unexpected demotion at stable 60fps`);
    assert.equal(r.lowTime, 0, `P5 window ${i}: lowTime must stay 0 at stable 60fps`);
    assert.equal(r.floorTime, 0, `P5 window ${i}: floorTime must stay 0 at stable 60fps`);
    s = { ...s, lowTime: r.lowTime, floorTime: r.floorTime, sinceActivate: s.sinceActivate + dt };
  }
}

// ---------------------------------------------------------------------
// P6 — degrade order, part 1: from 'full', fps between FLOOR and LOW
// demotes to 'lite' (not straight to 'off') exactly when lowTime reaches
// CUBE_LOW_HOLD_S.
// ---------------------------------------------------------------------
{
  const dt = 0.5;
  let s = { level: 'full', active: true, sinceActivate: CUBE_GRACE_S + 1, lowTime: 0, floorTime: 0, userForced: false, visible: true };
  const fpsMid = (CUBE_FLOOR_FPS + CUBE_LOW_FPS) / 2;
  assert.ok(fpsMid > CUBE_FLOOR_FPS && fpsMid < CUBE_LOW_FPS, 'test setup: fpsMid must sit strictly between the two thresholds');
  const expectedWindow = Math.round(CUBE_LOW_HOLD_S / dt);
  assert.ok(Number.isInteger(CUBE_LOW_HOLD_S / dt), 'test setup: dt must evenly divide CUBE_LOW_HOLD_S');
  let demoteWindow = -1, demotedTo = null;
  for (let i = 1; i <= expectedWindow + 5; i++) {
    const r = cockpitDetail(s, fpsMid, dt);
    s = { ...s, level: r.level, lowTime: r.lowTime, floorTime: r.floorTime, sinceActivate: s.sinceActivate + dt };
    if (r.level !== 'full') { demoteWindow = i; demotedTo = r.level; break; }
    assert.ok(i < expectedWindow, `P6 must not demote before window ${expectedWindow} (i=${i})`);
  }
  assert.equal(demotedTo, 'lite', 'P6 demotion from full at moderate low fps must land on lite, not off');
  assert.equal(demoteWindow, expectedWindow, `P6 demote must land exactly at window ${expectedWindow}`);
}

// ---------------------------------------------------------------------
// P7 — degrade order, part 2: severe fps (< CUBE_FLOOR_FPS) demotes
// straight from 'full' to 'off', skipping 'lite', by CUBE_FLOOR_HOLD_S.
// ---------------------------------------------------------------------
{
  const dt = 0.2;
  let s = { level: 'full', active: true, sinceActivate: CUBE_GRACE_S + 1, lowTime: 0, floorTime: 0, userForced: false, visible: true };
  let landed = null, elapsed = 0;
  const maxSteps = Math.ceil(CUBE_FLOOR_HOLD_S / dt) + 5;
  for (let i = 0; i < maxSteps; i++) {
    const r = cockpitDetail(s, 2, dt);
    s = { ...s, level: r.level, lowTime: r.lowTime, floorTime: r.floorTime, sinceActivate: s.sinceActivate + dt };
    elapsed += dt;
    if (r.level !== 'full') { landed = r.level; break; }
  }
  assert.equal(landed, 'off', 'P7 severe fps must drop straight from full to off, never lite');
  assert.ok(elapsed <= CUBE_FLOOR_HOLD_S + dt + 1e-9, `P7 demote must land by CUBE_FLOOR_HOLD_S, happened at elapsed=${elapsed}`);
}

// ---------------------------------------------------------------------
// P8 — lite can still fall to off: once already at 'lite', severe fps
// demotes to 'off' by CUBE_FLOOR_HOLD_S (does not require passing through
// 'full' first).
// ---------------------------------------------------------------------
{
  const dt = 0.2;
  let s = { level: 'lite', active: true, sinceActivate: CUBE_GRACE_S + 1, lowTime: 0, floorTime: 0, userForced: false, visible: true };
  let landed = null;
  const maxSteps = Math.ceil(CUBE_FLOOR_HOLD_S / dt) + 5;
  for (let i = 0; i < maxSteps; i++) {
    const r = cockpitDetail(s, 2, dt);
    s = { ...s, level: r.level, lowTime: r.lowTime, floorTime: r.floorTime, sinceActivate: s.sinceActivate + dt };
    if (r.level !== 'lite') { landed = r.level; break; }
  }
  assert.equal(landed, 'off', 'P8 lite must be able to fall to off directly under severe fps');
}

// ---------------------------------------------------------------------
// P9 — moderate fps at 'lite' does not demote further (LOW-tier demotion
// only fires when level === 'full'; only FLOOR-tier can push lite -> off).
// ---------------------------------------------------------------------
{
  const dt = 0.5;
  let s = { level: 'lite', active: true, sinceActivate: CUBE_GRACE_S + 1, lowTime: 0, floorTime: 0, userForced: false, visible: true };
  const fpsMid = (CUBE_FLOOR_FPS + CUBE_LOW_FPS) / 2;
  for (let i = 0; i < 200; i++) {
    const r = cockpitDetail(s, fpsMid, dt);
    assert.equal(r.level, 'lite', `P9 window ${i}: moderate fps must not demote lite further`);
    s = { ...s, level: r.level, lowTime: r.lowTime, floorTime: r.floorTime, sinceActivate: s.sinceActivate + dt };
  }
}

// ---------------------------------------------------------------------
// P10 — reset: floorTime/lowTime accumulated on a bad run snap to exactly 0
// the moment a single window comes in above threshold.
// ---------------------------------------------------------------------
{
  const dt = 0.3;
  let s = { level: 'full', active: true, sinceActivate: CUBE_GRACE_S + 1, lowTime: 0, floorTime: 0, userForced: false, visible: true };
  const fpsMid = (CUBE_FLOOR_FPS + CUBE_LOW_FPS) / 2;
  for (let i = 0; i < 3; i++) {
    const r = cockpitDetail(s, fpsMid, dt);
    s = { ...s, level: r.level, lowTime: r.lowTime, floorTime: r.floorTime, sinceActivate: s.sinceActivate + dt };
  }
  assert.ok(s.lowTime > 0, 'P10 setup: must have accumulated lowTime > 0 before the recovery window');
  const r = cockpitDetail(s, 60, dt);
  assert.equal(r.lowTime, 0, `P10 lowTime must reset to exactly 0 after a healthy fps=60 window, got ${r.lowTime}`);
  assert.equal(r.floorTime, 0, 'P10 floorTime must reset to exactly 0 after a healthy fps=60 window');
}

// ---------------------------------------------------------------------
// P11 — purity: cockpitDetail must not mutate the state object it was given.
// ---------------------------------------------------------------------
{
  const s = { level: 'full', active: true, sinceActivate: 5, lowTime: 1.2, floorTime: 0.4, userForced: false, visible: true };
  const before = JSON.stringify(s);
  cockpitDetail(s, 15, 0.5);
  assert.equal(JSON.stringify(s), before, 'P11 cockpitDetail must not mutate the input state object');
}

// ---------------------------------------------------------------------
// P12 — anti-oscillation (property test): a deterministic pseudo-random
// 10000-window trace with fps jumping around in [1, 75] and level fed
// forward honestly (no external reset — this is stricter than the real
// caller, which resets on re-activation). Level must never move UP the
// full>lite>off ranking without userForced — i.e. the rank sequence is
// non-increasing throughout the whole trace.
// ---------------------------------------------------------------------
{
  const rand = makeLcg(20260814);
  let s = { level: 'full', active: true, sinceActivate: 0, lowTime: 0, floorTime: 0, userForced: false, visible: true };
  const dt = 0.1;
  let prevRank = RANK[s.level];
  for (let i = 0; i < 10000; i++) {
    const fps = 1 + rand() * 74; // [1, 75)
    const r = cockpitDetail(s, fps, dt);
    const rank = RANK[r.level];
    assert.ok(rank <= prevRank, `P12 window ${i}: level rank must never increase without userForced (was ${prevRank}, got ${rank})`);
    prevRank = rank;
    s = { ...s, level: r.level, lowTime: r.lowTime, floorTime: r.floorTime, sinceActivate: s.sinceActivate + dt };
  }
}

console.log('cockpitpolicy.test.mjs OK');
