// engineVoice/impactVoice/uiClickVoice contract (js/audio/soundPolicy.js).
// Written from the ТЗ, not the impl. Covers the physical-honesty decisions
// documented in that module's header: monotonic hum, hard mute at
// off/idle/warp/paused/hidden, NO Doppler (fixation test — see P5),
// soft-landing-vs-crash distinction with a non-saturating log scale, the
// AudioContext-creation gesture gate, and finiteness/boundedness under
// degenerate input.
//
// P10-P14 are repair-round-1 regression tests (dev-lead findings R-1/R-2/R-3,
// 2026-08-14): each pins down exactly the behaviour that was wrong, written
// against the NEW contract so it is red on the pre-repair code and green
// after the fix in this same round.
import assert from 'node:assert/strict';
import {
  engineVoice, engineShouldSound, impactVoice, uiClickVoice, shouldEnsureContext,
  ENGINE_MAX_GAIN, ENGINE_MIN_FREQ, ENGINE_MAX_FREQ,
  IMPACT_LAND_GAIN_MAX, IMPACT_CRASH_GAIN_MAX, IMPACT_CRASH_GAIN_MIN,
  IMPACT_CRASH_SPEED_FLOOR, IMPACT_CRASH_SPEED_CEIL,
} from '../js/audio/soundPolicy.js';

// ---------------------------------------------------------------------
// P1 — engine hum is monotonic (non-decreasing) in throttle, both gain and
// frequency, across the whole [0,1] range, enabled=true, warp=1 (real-time).
// ---------------------------------------------------------------------
{
  const steps = 21;
  let prevGain = -Infinity, prevFreq = -Infinity;
  for (let i = 0; i <= steps; i++) {
    const throttle = i / steps;
    const v = engineVoice({ throttle, mode: 'arcade', warp: 1, enabled: true, speed: 0 });
    assert.ok(v.gain >= prevGain - 1e-12, `P1 gain must be non-decreasing in throttle: throttle=${throttle} gain=${v.gain} < prev=${prevGain}`);
    assert.ok(v.freq >= prevFreq - 1e-12, `P1 freq must be non-decreasing in throttle: throttle=${throttle} freq=${v.freq} < prev=${prevFreq}`);
    prevGain = v.gain; prevFreq = v.freq;
  }
  // Genuinely rises, not just flat-non-decreasing.
  const lo = engineVoice({ throttle: 0.1, mode: 'arcade', warp: 1, enabled: true, speed: 0 });
  const hi = engineVoice({ throttle: 1.0, mode: 'arcade', warp: 1, enabled: true, speed: 0 });
  assert.ok(hi.gain > lo.gain, 'P1 full throttle must be audibly louder than a light throttle');
  assert.ok(hi.freq > lo.freq, 'P1 full throttle must be audibly higher-pitched than a light throttle');
}

// ---------------------------------------------------------------------
// P2 — hard zero-volume gate #1: enabled=false silences the hum at ANY
// throttle, including full throttle.
// ---------------------------------------------------------------------
{
  for (const throttle of [0, 0.01, 0.5, 1]) {
    const v = engineVoice({ throttle, mode: 'arcade', warp: 1, enabled: false, speed: 0 });
    assert.equal(v.gain, 0, `P2 enabled=false must silence throttle=${throttle}, got gain=${v.gain}`);
  }
}

// ---------------------------------------------------------------------
// P3 — hard zero-volume gate #2: throttle=0 silences the hum whether or not
// sound is otherwise enabled (there is nothing to hum with the engine off).
// ---------------------------------------------------------------------
{
  for (const enabled of [true, false]) {
    const v = engineVoice({ throttle: 0, mode: 'arcade', warp: 1, enabled, speed: 0 });
    assert.equal(v.gain, 0, `P3 throttle=0 must be silent regardless of enabled=${enabled}, got gain=${v.gain}`);
  }
}

// ---------------------------------------------------------------------
// P4 — warp mute: sim.warp > 1 (compressed model time) mutes the hum
// completely even at full throttle/enabled=true — "rendering compressed
// time as sound is meaningless" (module header, consequence #3). warp<=1
// (real-time or slower) must NOT be muted by this rule.
// ---------------------------------------------------------------------
{
  for (const warp of [1.001, 5, 625, 1e6]) {
    const v = engineVoice({ throttle: 1, mode: 'arcade', warp, enabled: true, speed: 0 });
    assert.equal(v.gain, 0, `P4 warp=${warp} (>1) must mute the engine hum, got gain=${v.gain}`);
  }
  for (const warp of [0, 0.5, 1]) {
    const v = engineVoice({ throttle: 1, mode: 'arcade', warp, enabled: true, speed: 0 });
    assert.ok(v.gain > 0, `P4 warp=${warp} (<=1) must NOT be muted by the warp rule, got gain=${v.gain}`);
  }
}

// ---------------------------------------------------------------------
// P5 — NO DOPPLER (fixation test): the ship's own speed must never affect
// the hum's pitch or loudness. The source is co-moving with the observer
// (module header, consequence #2) — there is no relative velocity, hence no
// Doppler shift, at ANY speed. This pins the physics decision down so a
// future "make it sound cooler" patch has to consciously break this test.
// ---------------------------------------------------------------------
{
  const speeds = [0, 1, 1e3, 1e6, 2.9e8, 1e12, -1e6, NaN, Infinity];
  const base = engineVoice({ throttle: 0.6, mode: 'arcade', warp: 1, enabled: true, speed: 0 });
  for (const speed of speeds) {
    const v = engineVoice({ throttle: 0.6, mode: 'arcade', warp: 1, enabled: true, speed });
    assert.equal(v.freq, base.freq, `P5 speed=${speed} must not change engine pitch (Doppler is physically absent), got ${v.freq} vs ${base.freq}`);
    assert.equal(v.gain, base.gain, `P5 speed=${speed} must not change engine loudness, got ${v.gain} vs ${base.gain}`);
  }
}

// ---------------------------------------------------------------------
// P6 — soft landing ≠ crash: impactVoice() at the SAME impact speed must
// produce audibly and structurally different output depending on `crashed`
// — louder, noisier, longer for a crash than a soft touchdown.
// ---------------------------------------------------------------------
{
  for (const speed of [0, 5, 20, 49]) {
    const land = impactVoice({ speed, crashed: false });
    const crash = impactVoice({ speed, crashed: true });
    assert.ok(crash.gain > land.gain, `P6 speed=${speed}: crash must be louder than a soft landing (${crash.gain} vs ${land.gain})`);
    assert.ok(crash.noiseMix > land.noiseMix, `P6 speed=${speed}: crash must be noisier than a soft landing (${crash.noiseMix} vs ${land.noiseMix})`);
    assert.ok(crash.duration > land.duration, `P6 speed=${speed}: crash must ring out longer than a soft landing (${crash.duration} vs ${land.duration})`);
    assert.notEqual(crash.freq, land.freq, `P6 speed=${speed}: crash and landing must not share the exact same tone`);
  }
}

// ---------------------------------------------------------------------
// P7 — finiteness + boundedness under degenerate input: NaN/Infinity/
// negative throttle, speed and warp must never produce a non-finite or
// out-of-range gain (or freq/filterCutoff), for engineVoice AND
// impactVoice. No function downstream re-checks this (ГРАБЛИ 2026-08-14 —
// a function feeding an AudioParam guarantees its own output is sane).
// ---------------------------------------------------------------------
{
  const degenerate = [NaN, Infinity, -Infinity, -1, -1e9];
  for (const throttle of degenerate) {
    for (const warp of [...degenerate, 1]) {
      const v = engineVoice({ throttle, mode: 'arcade', warp, enabled: true, speed: 0 });
      assert.ok(Number.isFinite(v.gain), `P7 engineVoice throttle=${throttle} warp=${warp}: gain must be finite, got ${v.gain}`);
      assert.ok(Number.isFinite(v.freq), `P7 engineVoice throttle=${throttle} warp=${warp}: freq must be finite, got ${v.freq}`);
      assert.ok(Number.isFinite(v.filterCutoff), `P7 engineVoice throttle=${throttle} warp=${warp}: filterCutoff must be finite, got ${v.filterCutoff}`);
      assert.ok(v.gain >= 0 && v.gain <= ENGINE_MAX_GAIN, `P7 engineVoice throttle=${throttle} warp=${warp}: gain out of range [0,${ENGINE_MAX_GAIN}], got ${v.gain}`);
      assert.ok(v.freq >= ENGINE_MIN_FREQ && v.freq <= ENGINE_MAX_FREQ, `P7 engineVoice throttle=${throttle} warp=${warp}: freq out of range, got ${v.freq}`);
    }
  }
  for (const speed of degenerate) {
    for (const crashed of [true, false]) {
      const v = impactVoice({ speed, crashed });
      const cap = crashed ? IMPACT_CRASH_GAIN_MAX : IMPACT_LAND_GAIN_MAX;
      assert.ok(Number.isFinite(v.gain), `P7 impactVoice speed=${speed} crashed=${crashed}: gain must be finite, got ${v.gain}`);
      assert.ok(Number.isFinite(v.freq), `P7 impactVoice speed=${speed} crashed=${crashed}: freq must be finite, got ${v.freq}`);
      assert.ok(Number.isFinite(v.duration), `P7 impactVoice speed=${speed} crashed=${crashed}: duration must be finite, got ${v.duration}`);
      assert.ok(v.gain >= 0 && v.gain <= cap, `P7 impactVoice speed=${speed} crashed=${crashed}: gain out of range [0,${cap}], got ${v.gain}`);
      assert.ok(v.noiseMix >= 0 && v.noiseMix <= 1, `P7 impactVoice speed=${speed} crashed=${crashed}: noiseMix out of [0,1], got ${v.noiseMix}`);
    }
  }
}

// ---------------------------------------------------------------------
// P8 — purity: none of the three functions mutate the state object passed
// in (same discipline as tests/cubepolicy.test.mjs's P8).
// ---------------------------------------------------------------------
{
  const s1 = { throttle: 0.5, mode: 'arcade', warp: 1, enabled: true, speed: 1e6 };
  const before1 = JSON.stringify(s1);
  engineVoice(s1);
  assert.equal(JSON.stringify(s1), before1, 'P8 engineVoice must not mutate its input');

  const s2 = { speed: 30, crashed: true };
  const before2 = JSON.stringify(s2);
  impactVoice(s2);
  assert.equal(JSON.stringify(s2), before2, 'P8 impactVoice must not mutate its input');
}

// ---------------------------------------------------------------------
// P9 — uiClickVoice: a sane, finite, bounded, non-silent, short blip. Not
// heavily parameterized (every discrete control action gets the identical
// tone — see the module header), so the only contract worth pinning is
// "always the same finite, audible, brief descriptor".
// ---------------------------------------------------------------------
{
  const v = uiClickVoice();
  assert.ok(Number.isFinite(v.gain) && v.gain > 0 && v.gain < 1, `P9 uiClickVoice gain must be a finite, audible, headroom-safe value, got ${v.gain}`);
  assert.ok(Number.isFinite(v.freq) && v.freq > 0, `P9 uiClickVoice freq must be finite and positive, got ${v.freq}`);
  assert.ok(Number.isFinite(v.duration) && v.duration > 0 && v.duration < 1, `P9 uiClickVoice duration must be a short, finite, positive blip, got ${v.duration}`);
}

// ---------------------------------------------------------------------
// P10 — R-1a: PAUSE mutes the engine hum, even at full throttle/enabled/
// warp<=1. Repro from the bug report: Z (on) -> hold W (throttle>0) -> P
// (pause) -> hum used to keep sounding forever, frozen at the throttle/warp
// the frame happened to have when P was pressed. Un-pausing must restore it
// (paused is not a one-way latch).
// ---------------------------------------------------------------------
{
  const playing = engineVoice({ throttle: 1, mode: 'arcade', warp: 1, enabled: true, paused: false, hidden: false, speed: 0 });
  assert.ok(playing.gain > 0, 'P10 setup: must be audible when NOT paused, to prove pausing is what silences it');

  const paused = engineVoice({ throttle: 1, mode: 'arcade', warp: 1, enabled: true, paused: true, hidden: false, speed: 0 });
  assert.equal(paused.gain, 0, `P10 paused=true must mute the hum even at full throttle, got gain=${paused.gain}`);
  assert.equal(engineShouldSound({ enabled: true, paused: true, hidden: false, throttle: 1, warp: 1 }), false, 'P10 engineShouldSound must agree: paused -> false');

  const resumed = engineVoice({ throttle: 1, mode: 'arcade', warp: 1, enabled: true, paused: false, hidden: false, speed: 0 });
  assert.ok(resumed.gain > 0, 'P10 un-pausing must restore the hum, not leave it latched off');
}

// ---------------------------------------------------------------------
// P11 — R-1b: a HIDDEN tab mutes the engine hum too, independent of pause —
// nobody is in the cockpit to hear it, and (per the module header) the
// audio-thread graph does not stop on its own just because rAF does.
// ---------------------------------------------------------------------
{
  for (const [paused, hidden] of [[false, true], [true, true]]) {
    const v = engineVoice({ throttle: 1, mode: 'arcade', warp: 1, enabled: true, paused, hidden, speed: 0 });
    assert.equal(v.gain, 0, `P11 hidden=true (paused=${paused}) must mute the hum, got gain=${v.gain}`);
  }
  const visible = engineVoice({ throttle: 1, mode: 'arcade', warp: 1, enabled: true, paused: false, hidden: false, speed: 0 });
  assert.ok(visible.gain > 0, 'P11 hidden=false/paused=false must NOT be muted by this rule');

  // engineShouldSound is the single decision point both engineVoice and
  // audio.js's immediate visibilitychange mute must agree with.
  assert.equal(engineShouldSound({ enabled: true, paused: false, hidden: true, throttle: 1, warp: 1 }), false, 'P11 engineShouldSound must agree: hidden -> false');
  assert.equal(engineShouldSound({ enabled: true, paused: false, hidden: false, throttle: 1, warp: 1 }), true, 'P11 engineShouldSound must agree: fully clear -> true');
}

// ---------------------------------------------------------------------
// P12 — R-2: crash loudness is a LOGARITHMIC ramp over the realistic impact
// speed range, not a linear one that saturates almost immediately. Pins
// down: (a) the crash floor (50 m/s) is the quietest crash, at
// IMPACT_CRASH_GAIN_MIN, not already near the cap; (b) a moderate crash
// (~275 m/s — where the OLD linear formula was already maxed out) must be
// meaningfully quieter than a severe one; (c) monotonic non-decreasing
// across the whole range; (d) never exceeds IMPACT_CRASH_GAIN_MAX even for
// speeds far past the ceiling (escape-velocity-scale impacts are possible
// in a solar-system sim); (e) always strictly louder than any soft landing.
// ---------------------------------------------------------------------
{
  const atFloor = impactVoice({ speed: IMPACT_CRASH_SPEED_FLOOR, crashed: true });
  assert.ok(Math.abs(atFloor.gain - IMPACT_CRASH_GAIN_MIN) < 1e-9, `P12 the crash floor (${IMPACT_CRASH_SPEED_FLOOR} m/s) must land at IMPACT_CRASH_GAIN_MIN, got ${atFloor.gain}`);

  const moderate = impactVoice({ speed: 275, crashed: true });   // the old formula's saturation point
  const severe = impactVoice({ speed: 5000, crashed: true });
  const extreme = impactVoice({ speed: 1e6, crashed: true });    // far past the ceiling — e.g. a relativistic-adjacent impact
  assert.ok(moderate.gain < IMPACT_CRASH_GAIN_MAX - 0.05, `P12 a moderate crash (275 m/s, the OLD formula's saturation point) must NOT already be at/near the cap, got ${moderate.gain} (cap ${IMPACT_CRASH_GAIN_MAX})`);
  assert.ok(severe.gain > moderate.gain, `P12 a severe crash (5000 m/s) must be audibly louder than a moderate one (275 m/s): ${severe.gain} vs ${moderate.gain}`);
  assert.ok(severe.gain - moderate.gain > 0.05, `P12 the moderate-vs-severe gap must be a MEANINGFUL amount of dynamic range, got ${severe.gain - moderate.gain}`);
  assert.ok(Number.isFinite(extreme.gain) && extreme.gain <= IMPACT_CRASH_GAIN_MAX, `P12 an extreme impact speed (1e6 m/s) must stay finite and capped at IMPACT_CRASH_GAIN_MAX, got ${extreme.gain}`);
  assert.ok(Math.abs(extreme.gain - IMPACT_CRASH_GAIN_MAX) < 1e-9, `P12 far past the ceiling must clamp exactly to IMPACT_CRASH_GAIN_MAX, got ${extreme.gain}`);

  let prev = -Infinity;
  for (const speed of [0, 10, IMPACT_CRASH_SPEED_FLOOR, 60, 100, 275, 1000, 5000, IMPACT_CRASH_SPEED_CEIL, 1e5]) {
    const v = impactVoice({ speed, crashed: true });
    assert.ok(v.gain >= prev - 1e-12, `P12 crash gain must be non-decreasing in speed: speed=${speed} gain=${v.gain} < prev=${prev}`);
    assert.ok(v.gain <= IMPACT_CRASH_GAIN_MAX + 1e-12 && v.gain >= IMPACT_CRASH_GAIN_MIN - 1e-12, `P12 crash gain must stay within [${IMPACT_CRASH_GAIN_MIN},${IMPACT_CRASH_GAIN_MAX}], got ${v.gain} at speed=${speed}`);
    prev = v.gain;
  }

  // Still always distinct from (louder than) any soft landing — P6's
  // invariant, re-checked against the new formula at the boundary.
  const landAtCap = IMPACT_LAND_GAIN_MAX;
  assert.ok(IMPACT_CRASH_GAIN_MIN > landAtCap, `P12 even the QUIETEST crash must outrank the LOUDEST possible soft landing (${IMPACT_CRASH_GAIN_MIN} vs ${landAtCap})`);
}

// ---------------------------------------------------------------------
// P13 — R-3: the AudioContext-creation gate. Context creation may happen
// ONLY when sound is enabled AND a real user gesture is present AND no
// context exists yet — recording "sound is on" (e.g. restoring a persisted
// iss_sound=true at page load, no gesture) must NOT by itself authorize
// creating a context.
// ---------------------------------------------------------------------
{
  const cases = [
    [{ enabled: false, fromGesture: false, hasContext: false }, false, 'nothing on'],
    [{ enabled: false, fromGesture: true, hasContext: false }, false, 'gesture alone (sound not even on) must not create a context'],
    [{ enabled: true, fromGesture: false, hasContext: false }, false, 'THE R-3 CASE: persisted-on intent restored at page load, no gesture yet -> must NOT create a context'],
    [{ enabled: true, fromGesture: true, hasContext: false }, true, 'enabled + a real gesture + no context yet -> create it'],
    [{ enabled: true, fromGesture: true, hasContext: true }, false, 'already has a context -> idempotent, do not recreate'],
    [{ enabled: false, fromGesture: true, hasContext: true }, false, 'sound turned back off -> never (re)create regardless of context/gesture'],
  ];
  for (const [s, expected, label] of cases) {
    assert.equal(shouldEnsureContext(s), expected, `P13 ${label}: ${JSON.stringify(s)}`);
  }
}

// ---------------------------------------------------------------------
// P14 — purity of the two new predicates (same discipline as P8).
// ---------------------------------------------------------------------
{
  const s1 = { enabled: true, paused: false, hidden: false, throttle: 0.7, warp: 1 };
  const before1 = JSON.stringify(s1);
  engineShouldSound(s1);
  assert.equal(JSON.stringify(s1), before1, 'P14 engineShouldSound must not mutate its input');

  const s2 = { enabled: true, fromGesture: true, hasContext: false };
  const before2 = JSON.stringify(s2);
  shouldEnsureContext(s2);
  assert.equal(JSON.stringify(s2), before2, 'P14 shouldEnsureContext must not mutate its input');
}

console.log('soundpolicy.test.mjs OK');
