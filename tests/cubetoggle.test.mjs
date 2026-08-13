// Contract (ТЗ, adversarial-verification finding on wave-A cube toggle
// wiring) for two PURE functions that js/main.js's frame loop is expected to
// delegate to: js/render/renderPolicy.js::cubeToggleState and
// ::cubeResourceAction. Neither exists yet at the time this file was
// written — that is the point: this whole file is expected to fail RED on
// the import line until code-implementer adds them. Do not weaken this file
// to "pass" by stubbing the export with different semantics; the shapes
// below ARE the contract.
//
// Confirmed defects this guards against (found by adversarial-verifier,
// reproduced by grep/read of js/main.js, not yet fixed):
//
//   (a) `sim.cubeForced` is set to `true` on the ENABLE edge of the `u` key
//       and is NEVER set back to `false` anywhere (grep: one write of
//       `true`, zero writes of `false`). `cubeAutoStep`'s very first guard
//       returns 'hold' whenever `userForced` is true. Net effect: touch `u`
//       once, ever (the flag persists via `iss_cube_forced` across
//       sessions) → the auto-demotion safety net that A8 built is
//       permanently disabled, including for future re-enables. The fix:
//       the DISABLE edge of the toggle must reset `cubeForced` to `false`
//       — "the user has spoken" is a statement about the ON state only.
//
//   (b) the ~50MB cube render-target/camera release check is
//       `!sim.cubeAberr && sim.cubeReady` — it ignores `relFx`. Turning off
//       relativistic optics (key `c`) while the cube toggle (key `u`) stays
//       on leaves the render PATH at 'plain' (cube pass dead, per
//       resolveRenderPath) while `cubeRT`/`cubeCamera` stay allocated
//       forever — the fix must gate release on `!(cubeAberr && relFx)`,
//       mirroring resolveRenderPath's own gate.
//
//   (c) `ensureCubeResources` is re-invoked every single frame on repeated
//       allocation failure, with no retry cap and no failure path. The fix
//       is `cubeBlocked` acting as a one-shot latch: once set, resource
//       allocation is never attempted again ('ensure' must never fire while
//       cubeBlocked is true).
import assert from 'node:assert/strict';
import { cubeToggleState, cubeResourceAction } from '../js/render/renderPolicy.js';

// ═════════════════════════════════════════════════════════════════════════
// cubeToggleState(s)  —  s = { cubeAberr, cubeForced, cubeBlocked }
//   -> new { cubeAberr, cubeForced, cubeBlocked }, does NOT mutate s.
//
// Represents the effect of one `u` keypress: it flips s.cubeAberr and
// derives the rest of the state from the EDGE direction of that flip.
//   OFF -> ON : cubeAberr=true,  cubeForced=true,  cubeBlocked=false
//   ON  -> OFF: cubeAberr=false, cubeForced=false, cubeBlocked unchanged
// ═════════════════════════════════════════════════════════════════════════

function toggle(cubeAberr, cubeForced, cubeBlocked) {
  return cubeToggleState({ cubeAberr, cubeForced, cubeBlocked });
}

function assertState(actual, expected, ctx) {
  assert.equal(actual.cubeAberr, expected.cubeAberr, `${ctx}: cubeAberr expected ${expected.cubeAberr}, got ${actual.cubeAberr}`);
  assert.equal(actual.cubeForced, expected.cubeForced, `${ctx}: cubeForced expected ${expected.cubeForced}, got ${actual.cubeForced}`);
  assert.equal(actual.cubeBlocked, expected.cubeBlocked, `${ctx}: cubeBlocked expected ${expected.cubeBlocked}, got ${actual.cubeBlocked}`);
}

// ---------------------------------------------------------------------
// T1 — full cycle on->off->on->off, starting from a BLOCKED off state
// (mimics "previous auto-demotion latched cubeBlocked"), verifying ALL
// THREE fields at every step against an explicit table.
// ---------------------------------------------------------------------
{
  let s = { cubeAberr: false, cubeForced: false, cubeBlocked: true };

  s = cubeToggleState(s);
  assertState(s, { cubeAberr: true, cubeForced: true, cubeBlocked: false }, 'T1 step1 (off->on)');

  s = cubeToggleState(s);
  assertState(s, { cubeAberr: false, cubeForced: false, cubeBlocked: false }, 'T1 step2 (on->off)');

  s = cubeToggleState(s);
  assertState(s, { cubeAberr: true, cubeForced: true, cubeBlocked: false }, 'T1 step3 (off->on again)');

  s = cubeToggleState(s);
  assertState(s, { cubeAberr: false, cubeForced: false, cubeBlocked: false }, 'T1 step4 (on->off again)');
}

// ---------------------------------------------------------------------
// T2 — RED ASSERT for defect (a): starting from an ON state with
// cubeForced=true (as it always is once the cube has ever been enabled,
// per current buggy code), toggling OFF must reset cubeForced to false.
// Against the current implementation (no export at all) this fails on
// import; once cubeToggleState exists but keeps forcing forced=true
// forever, this specific assert is the one that catches it.
// ---------------------------------------------------------------------
{
  const before = { cubeAberr: true, cubeForced: true, cubeBlocked: false };
  const after = cubeToggleState(before);
  assert.equal(after.cubeAberr, false, 'T2: toggling from ON must turn cubeAberr off');
  assert.equal(after.cubeForced, false,
    'T2 (defect a): cubeForced must reset to false on the OFF edge — otherwise cubeAutoStep\'s ' +
    'userForced guard permanently disables auto-demotion after a single touch of the toggle');
}

// ---------------------------------------------------------------------
// T3 — enabling the toggle unblocks a previously-blocked cube path.
// ---------------------------------------------------------------------
{
  const before = { cubeAberr: false, cubeForced: false, cubeBlocked: true };
  const after = cubeToggleState(before);
  assert.equal(after.cubeBlocked, false, 'T3: ON edge must clear cubeBlocked (fresh explicit user choice)');
}

// ---------------------------------------------------------------------
// T4 — purity: cubeToggleState must not mutate its input.
// ---------------------------------------------------------------------
{
  const s = { cubeAberr: false, cubeForced: true, cubeBlocked: true };
  const before = JSON.stringify(s);
  cubeToggleState(s);
  assert.equal(JSON.stringify(s), before, 'T4: cubeToggleState must not mutate the input state object');
}

// ---------------------------------------------------------------------
// T5 — idempotence of the ON edge: toggling from the same OFF starting
// state twice (independently, not chained) must produce the same
// cubeForced=true both times — the ON transition is a pure function of
// "was off", not of some hidden counter.
// ---------------------------------------------------------------------
{
  const s0 = { cubeAberr: false, cubeForced: false, cubeBlocked: false };
  const r1 = cubeToggleState(s0);
  const r2 = cubeToggleState(s0);
  assert.equal(r1.cubeForced, true, 'T5: first ON toggle must set cubeForced=true');
  assert.equal(r2.cubeForced, true, 'T5: repeated ON toggle from the same off state must also yield cubeForced=true');
  assert.deepEqual(r1, r2, 'T5: toggling ON from the same starting state must be idempotent (identical output)');
}

// ═════════════════════════════════════════════════════════════════════════
// cubeResourceAction(s)  —  s = { cubeAberr, relFx, cubeReady, cubeBlocked }
//   -> 'ensure' | 'release' | 'none'
//
//   'ensure'  <=> cubeAberr && relFx && !cubeReady && !cubeBlocked
//   'release' <=> cubeReady && !(cubeAberr && relFx)
//   else 'none'
// (The two are mutually exclusive by construction: ensure requires
// !cubeReady, release requires cubeReady.)
// ═════════════════════════════════════════════════════════════════════════

function expectedAction(cubeAberr, relFx, cubeReady, cubeBlocked) {
  if (cubeAberr && relFx && !cubeReady && !cubeBlocked) return 'ensure';
  if (cubeReady && !(cubeAberr && relFx)) return 'release';
  return 'none';
}

// ---------------------------------------------------------------------
// Exhaustive truth table over all 16 combinations of the 4 booleans.
// ---------------------------------------------------------------------
{
  const BOOLS = [false, true];
  let checked = 0;
  for (const cubeAberr of BOOLS) {
    for (const relFx of BOOLS) {
      for (const cubeReady of BOOLS) {
        for (const cubeBlocked of BOOLS) {
          const s = { cubeAberr, relFx, cubeReady, cubeBlocked };
          const want = expectedAction(cubeAberr, relFx, cubeReady, cubeBlocked);
          const got = cubeResourceAction(s);
          checked++;
          assert.equal(got, want,
            `cubeResourceAction truth-table cubeAberr=${cubeAberr} relFx=${relFx} cubeReady=${cubeReady} ` +
            `cubeBlocked=${cubeBlocked}: expected '${want}', got '${got}'`);
        }
      }
    }
  }
  assert.equal(checked, 16, `truth table must cover exactly 16 combinations, covered ${checked}`);
}

// ---------------------------------------------------------------------
// Named scenario — RED ASSERT for defect (b): relFx turned off while the
// cube toggle is still on must trigger a resource release (the cube pass
// is dead per resolveRenderPath even though cubeAberr is still true).
// ---------------------------------------------------------------------
{
  const s = { cubeAberr: true, relFx: false, cubeReady: true, cubeBlocked: false };
  assert.equal(cubeResourceAction(s), 'release',
    'defect (b): relFx off while cube toggle stays on must release cube resources, not leak them');
}

// ---------------------------------------------------------------------
// Named scenario — RED ASSERT for defect (c): cubeBlocked must act as a
// one-shot latch — 'ensure' must never fire while it is true, no matter
// how the other three flags are set.
// ---------------------------------------------------------------------
{
  const BOOLS = [false, true];
  for (const cubeAberr of BOOLS) {
    for (const relFx of BOOLS) {
      for (const cubeReady of BOOLS) {
        const s = { cubeAberr, relFx, cubeReady, cubeBlocked: true };
        assert.notEqual(cubeResourceAction(s), 'ensure',
          `defect (c): cubeBlocked=true must never yield 'ensure' (cubeAberr=${cubeAberr} relFx=${relFx} cubeReady=${cubeReady})`);
      }
    }
  }
}

console.log('cubetoggle.test.mjs OK');
