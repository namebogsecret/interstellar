// engineVoice/impactVoice/uiClickVoice contract (js/audio/soundPolicy.js).
// Written from the ТЗ, not the impl. Covers the physical-honesty decisions
// documented in that module's header: monotonic hum, hard mute at
// off/idle/warp, NO Doppler (fixation test — see P4), soft-landing-vs-crash
// distinction, and finiteness/boundedness under degenerate input.
import assert from 'node:assert/strict';
import {
  engineVoice, impactVoice, uiClickVoice,
  ENGINE_MAX_GAIN, ENGINE_MIN_FREQ, ENGINE_MAX_FREQ,
  IMPACT_LAND_GAIN_MAX, IMPACT_CRASH_GAIN_MAX,
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

console.log('soundpolicy.test.mjs OK');
