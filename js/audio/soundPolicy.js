// Procedural sound-parameter policy — PURE FUNCTIONS ONLY. No Web Audio, no
// DOM, no THREE — importable from plain node (same discipline as
// js/render/renderPolicy.js, which this module is deliberately modelled on:
// pure decision here, thin imperative layer in js/audio/audio.js applies the
// numbers to actual AudioContext nodes). This file only decides WHAT the
// sound should be; it never decides HOW to make it play.
//
// ── The framing this module commits to: "you hear the inside of the hull" ──
//
// Space is a vacuum. There is no medium to carry a sound wave from an engine
// nozzle, an explosion, or another ship's hull to your ears — that part is
// not an aesthetic choice, it is Newton and Maxwell. Every sound this project
// makes is therefore reframed as STRUCTURE-BORNE: vibration conducted through
// the ship's own airframe into the pressurized cabin you're sitting in, the
// way a submarine crew hears their own engines through the hull and nothing
// of the ocean outside it.
//
//   - engine hum  = vibration of the drive, transmitted through the airframe.
//   - UI clicks   = physical switches/instruments in the cockpit.
//   - impact      = the hull itself ringing on contact with a surface.
//
// This framing is a DESIGN COMMITMENT, not an "arcade mode" shortcut, and it
// has three concrete, enforced consequences:
//
//   1. EXTERNAL events are never sonified. An explosion outside, another
//      ship's engine, atmospheric friction on the OUTER hull while flying
//      through air at speed — none of that reaches a vacuum-insulated cabin
//      any more than the ocean reaches a submarine crew through the hull.
//      There is deliberately no hook anywhere in this codebase wiring any of
//      those events to sound; do not add one on the theory that it "would
//      sound cool" — that would contradict the framing, not extend it.
//
//   2. NO DOPPLER from the ship's own velocity, ever. The engine (the sound
//      source) is rigidly co-moving with the pilot (the observer) — their
//      relative velocity is exactly zero, independent of how fast the ship
//      is moving through the solar system. Doppler shift requires nonzero
//      relative velocity between source and observer; there isn't any here,
//      at any speed, so pitch must never track ship speed. engineVoice()
//      below accepts and DISCARDS a `speed` field for exactly this reason —
//      see the comment on that parameter.
//
//   3. Anything that makes "what does the engine sound like RIGHT NOW" either
//      dishonest or unheard mutes the hum outright, not just warp:
//        - warp > 1 (compressed model time) — a compressed-time engine note
//          has no honest meaning: should it play at the ship's proper-time
//          rate, or the warped model-time rate? Either answer is a lie, so
//          the honest choice is silence. (js/main.js already pins warp=1 the
//          instant throttle>0 during a burn, so this mostly guards "landed,
//          engine off, time fast-forwarding" — belt and braces.)
//        - paused (sim.paused) — model time is not merely compressed, it has
//          stopped advancing AT ALL. The one thing worse than a dishonest
//          pitch is an eternal unchanging drone that never resolves because
//          nothing is happening in the simulation any more — repair-round-1
//          finding R-1: the engine hum kept sounding, frozen at whatever
//          throttle/warp the frame had when P was pressed, because the only
//          call site gated on `sim.sound` but never on `sim.paused`.
//        - hidden (the browser tab is not visible) — nobody is in the
//          cockpit to hear it. This one is enforced TWICE on purpose: here,
//          so a frame that does run while backgrounded computes silence, AND
//          imperatively in js/audio/audio.js via a visibilitychange
//          listener, because the Web Audio graph runs on its own audio
//          thread independent of rAF — with the tab hidden, browsers throttle
//          or fully stop rAF, so "wait for the next frame to silence it" can
//          mean "keep humming for a long time" (also R-1). See that module's
//          comment on _forceEngineSilence() for why the imperative half is
//          not optional.
//      engineShouldSound() below is the ONE decision point all of enabled/
//      paused/hidden/throttle/warp feed into — engineVoice()'s gain=0 branch
//      and audio.js's immediate mute both ask it the identical question,
//      rather than each maintaining their own half of the same condition
//      (ГРАБЛИ #2: two independently-maintained copies of one gate is
//      exactly how that FOV regression happened).
//
// All three exported functions sanitize their inputs defensively: a
// degenerate value (NaN, ±Infinity, a negative speed) must never produce a
// non-finite or out-of-range output. Nothing downstream re-checks this —
// same rule as circularizeVelocity in js/physics/orbits.js (ГРАБЛИ
// 2026-08-14): a function whose result is about to be fed straight into an
// AudioParam guarantees its own output is finite and bounded.

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function safeNonNegative(x) {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x;
}

// ── Engine hum ───────────────────────────────────────────────────────────
export const ENGINE_MIN_FREQ = 45;     // Hz, idle sub-bass rumble at throttle→0
export const ENGINE_MAX_FREQ = 140;    // Hz, still sub-bass at full thrust — a
                                        // structure-borne rumble, not a siren
export const ENGINE_MAX_GAIN = 0.35;   // headroom — never blasts the ear
export const ENGINE_FILTER_MIN = 300;  // Hz, lowpass cutoff for the noise layer
export const ENGINE_FILTER_MAX = 2200;
// Realistic mode's thrust ceiling is honestly clamped to the ship's real
// engine (~3–15g, see controls.throttle.test.mjs) rather than arcade's 1000g
// fiction — the felt strain on the airframe at "full throttle" is genuinely
// milder, so the hull-borne hum is a touch quieter for the same [0,1] slider
// position. This does not change monotonicity in throttle within a mode.
export const ENGINE_REALISTIC_GAIN_MULT = 0.85;

// s = { enabled, paused, hidden, throttle, warp } -> boolean
// The single decision point for "should the engine hum be audible AT ALL
// right now" — see consequence #3 in the module header for why each of
// these five gates it. NaN/undefined `warp` fails safe to muted too
// (`NaN <= 1` and `undefined <= 1` are both false) — an unknown warp state
// must never be treated as "definitely real-time". `paused`/`hidden` being
// undefined (an older call site that hasn't been told about them) is
// likewise treated as false/not-hidden — additive, never a silent new mute.
export function engineShouldSound({ enabled, paused, hidden, throttle, warp }) {
  return !!enabled && !paused && !hidden && clamp01(throttle) > 0 && warp <= 1;
}

// s = { throttle, mode, warp, enabled, paused, hidden, speed } -> { gain, freq, filterCutoff }
export function engineVoice({ throttle, mode, warp, enabled, paused, hidden, speed }) {
  // `speed` is accepted and DELIBERATELY IGNORED — see consequence #2 in the
  // module header. The engine is rigidly co-moving with the listener, so
  // there is no Doppler shift at any speed; this parameter exists so a
  // future "make the pitch rise with speed, it'll sound cooler" patch has to
  // consciously delete this line and the fixation test in
  // tests/soundpolicy.test.mjs, instead of quietly reading a field this
  // function has never used. (`speed` itself is not referenced below.)
  void speed;

  const thr = clamp01(throttle);
  if (!engineShouldSound({ enabled, paused, hidden, throttle, warp })) {
    return { gain: 0, freq: ENGINE_MIN_FREQ, filterCutoff: ENGINE_FILTER_MIN };
  }

  const modeMult = mode === 'realistic' ? ENGINE_REALISTIC_GAIN_MULT : 1;
  const gain = ENGINE_MAX_GAIN * modeMult * thr;
  const freq = ENGINE_MIN_FREQ + (ENGINE_MAX_FREQ - ENGINE_MIN_FREQ) * thr;
  const filterCutoff = ENGINE_FILTER_MIN + (ENGINE_FILTER_MAX - ENGINE_FILTER_MIN) * thr;
  return { gain, freq, filterCutoff };
}

// ── Impact (touchdown / crash) ──────────────────────────────────────────
// Two audibly distinct hull-borne events sharing one contract: a soft
// touchdown is a short, quiet, low-noise thud; a crash is a loud, longer,
// noise-dominated crack. `crashed` selects between them; `speed` (impact
// speed relative to the co-rotating ground — the same value touchdown()
// already computes in js/main.js) only trims loudness WITHIN whichever
// bucket it lands in, it never blurs the two together.
export const IMPACT_LAND_FREQ = 90;
export const IMPACT_LAND_GAIN_BASE = 0.08;
export const IMPACT_LAND_GAIN_PER_MS = 0.0015;
export const IMPACT_LAND_GAIN_MAX = 0.22;
export const IMPACT_LAND_NOISE_MIX = 0.2;
export const IMPACT_LAND_DURATION = 0.35;   // seconds

export const IMPACT_CRASH_FREQ = 55;
// Repair-round-1 finding R-2: crash loudness used to be LINEAR in impact
// speed (gain = 0.35 + speed·0.002, capped at 0.9) — in a solar-system-scale
// simulator, impact speeds run from just over the 50 m/s crash threshold
// (ship.crashed = impact>50, js/main.js) up into multiple km/s (orbital-speed
// impacts), and that linear ramp hit its 0.9 cap by ~275 m/s. Almost every
// real crash in this game is therefore hundreds to thousands of m/s — i.e.
// almost every crash played at the exact same maxed-out volume, with zero
// dynamic range between "rough landing" and "hit Jupiter at orbital speed".
// Kinetic energy scales with v², and perceived loudness scales with
// log(energy) — so loudness should scale with log(v²) = 2·log10(v), NOT
// linearly with v. Fixed to a logarithmic ramp over the realistic speed
// range instead (see logRamp() below); a genuine DynamicsCompressorNode was
// also added as a safety net in js/audio/audio.js, independent of this
// scale being right — see that module's _buildMasterBus().
export const IMPACT_CRASH_SPEED_FLOOR = 50;    // m/s — the crash threshold itself (the QUIETEST possible crash)
export const IMPACT_CRASH_SPEED_CEIL = 2e4;    // m/s — ~20 km/s, a severe high-speed impact; louder above this doesn't get louder (headroom, not more info)
export const IMPACT_CRASH_GAIN_MIN = 0.30;     // at the floor — clearly louder than any soft landing (max 0.22), not yet alarming
export const IMPACT_CRASH_GAIN_MAX = 0.55;     // at/above the ceiling — loud but headphone-safe pre-compressor: 20·log10(0.55) ≈ −5.2 dBFS for a single voice, well under 0 dBFS, and the master compressor (audio.js) catches the case where an impact burst overlaps the engine hum and/or a UI click
export const IMPACT_CRASH_NOISE_MIX = 0.8;
export const IMPACT_CRASH_DURATION = 0.9;   // seconds

// Logarithmic ramp: 0 at v<=vMin, 1 at v>=vMax, log-interpolated between —
// matches "loudness ~ log(energy) ~ log(v²)" instead of a linear ramp that
// saturates almost immediately over a multi-decade speed range. vMin/vMax
// must both be > 0 (impact speeds are; safeNonNegative()'s 0 floor is lifted
// to vMin before the log, so v=0 lands exactly at t=0, not -Infinity).
function logRamp(v, vMin, vMax, outMin, outMax) {
  const vc = Math.min(Math.max(v, vMin), vMax);
  const t = Math.log(vc / vMin) / Math.log(vMax / vMin);
  return outMin + (outMax - outMin) * t;
}

// s = { speed, crashed } -> { gain, freq, noiseMix, duration }
export function impactVoice({ speed, crashed }) {
  const v = safeNonNegative(speed);
  if (crashed) {
    const gain = logRamp(v, IMPACT_CRASH_SPEED_FLOOR, IMPACT_CRASH_SPEED_CEIL, IMPACT_CRASH_GAIN_MIN, IMPACT_CRASH_GAIN_MAX);
    return { gain, freq: IMPACT_CRASH_FREQ, noiseMix: IMPACT_CRASH_NOISE_MIX, duration: IMPACT_CRASH_DURATION };
  }
  const gain = Math.min(IMPACT_LAND_GAIN_MAX, IMPACT_LAND_GAIN_BASE + v * IMPACT_LAND_GAIN_PER_MS);
  return { gain, freq: IMPACT_LAND_FREQ, noiseMix: IMPACT_LAND_NOISE_MIX, duration: IMPACT_LAND_DURATION };
}

// ── UI click / instrument tone ──────────────────────────────────────────
// One short, quiet, tonal blip for toggle/mode/target switches — a physical
// instrument click in the cabin (consequence #1 in the header: an internal,
// not external, event). Deliberately parameterless: every discrete control
// action gets the identical, unmistakable "the panel registered your input"
// tone rather than a zoo of different clicks to keep straight.
export const UI_CLICK_FREQ = 880;
export const UI_CLICK_GAIN = 0.12;
export const UI_CLICK_DURATION = 0.06;   // seconds

export function uiClickVoice() {
  return { gain: UI_CLICK_GAIN, freq: UI_CLICK_FREQ, noiseMix: 0, duration: UI_CLICK_DURATION };
}

// ── AudioContext creation gate ──────────────────────────────────────────
// Repair-round-1 finding R-3: restoring a persisted iss_sound=true at page
// load used to call straight through to context creation with no user
// gesture present, which is a literal contract violation ("AudioContext
// создаётся ЛЕНИВО и только после реального жеста пользователя" — ТЗ §B3)
// and something Chrome logs a console warning about. js/audio/audio.js now
// separates INTENT (sim.sound / SoundEngine.enabled — may be set at page
// load, no gesture required) from CREATION (the real `new AudioContext()`
// call — gated on this predicate, which requires a gesture to have actually
// happened). One decision point for both of SoundEngine's call sites
// (setEnabled(on, {fromGesture}) and resumeIfNeeded()) — see that module.
//
// s = { enabled, fromGesture, hasContext } -> boolean
export function shouldEnsureContext({ enabled, fromGesture, hasContext }) {
  return !!enabled && !!fromGesture && !hasContext;
}
