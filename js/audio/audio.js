// Thin imperative Web Audio layer. Applies the pure parameters computed by
// js/audio/soundPolicy.js to real AudioContext nodes — this file makes NO
// decisions about what should be audible (see soundPolicy.js's header for
// the "structure-borne, no Doppler, warp-mutes" framing); it only wires
// numbers onto oscillators/filters/gains and manages the browser's autoplay
// gate.
//
// Procedural synthesis ONLY — no audio files, no fetch, no base64 samples.
// The engine hum is a persistent sawtooth+lowpass-filtered-noise pair whose
// gain/frequency/cutoff are driven every frame from engineVoice(); impacts
// and UI clicks are short one-shot bursts (tone + optional noise burst
// generated in-memory via AudioBuffer, not loaded from anywhere) built from
// impactVoice()/uiClickVoice().
//
// Lifecycle: the AudioContext is created LAZILY (never at module load, never
// at page load) and only once sound is actually turned on — see
// setEnabled(). Browsers additionally gate a fresh context to 'suspended'
// until a real user gesture occurs; resumeIfNeeded() is called from the
// existing gesture entry points (js/render/controls.js's click/keydown,
// js/render/touch.js's pointerdown/_action) to lift that gate the moment one
// happens. Every method degrades silently on failure (try/catch around
// construction, defensive `this.ctx` checks everywhere) — a browser that
// blocks or lacks Web Audio must never throw into the frame loop or spam the
// console (pageerror in the smoke test is a hard gate failure).
import { engineVoice, impactVoice, uiClickVoice } from './soundPolicy.js';

// Exponential ramps can't target exactly 0 (log of 0 is undefined) — this is
// the standard "close enough to silence" floor Web Audio code uses instead.
const SILENCE_FLOOR = 0.0001;
// setTargetAtTime time-constant for the continuous engine hum: fast enough
// that throttle changes feel responsive, slow enough to avoid zipper noise.
const ENGINE_SMOOTH_S = 0.15;

export class SoundEngine {
  constructor() {
    this.enabled = false;   // mirrors sim.sound; master gate for every method below
    this.ctx = null;        // created lazily — see _ensureContext()
    this._engineOsc = null;
    this._engineFilter = null;
    this._engineGain = null;
  }

  // Master on/off — called from the Z-key toggle hook (js/main.js). Turning
  // on lazily creates the context (if this is the first time) and attempts
  // to resume it; turning off ramps the continuous engine hum to silence and
  // suspends the context so a muted session costs nothing on the audio
  // thread either, not just the main thread.
  setEnabled(on) {
    this.enabled = !!on;
    if (!this.enabled) { this._quiesce(); return; }
    this._ensureContext();
    this.resumeIfNeeded();
  }

  // Safe to call from any user-gesture handler regardless of whether sound
  // is currently on — a no-op unless there's a real suspended context to
  // wake. This is what actually satisfies the browser's autoplay gate; the
  // context can exist in 'suspended' state for an arbitrary time between
  // setEnabled(true) (which may itself have run outside a gesture, e.g.
  // restoring a persisted iss_sound=true at page load) and the player's
  // first real interaction.
  resumeIfNeeded() {
    if (!this.ctx || this.ctx.state !== 'suspended') return;
    this.ctx.resume().catch(() => { /* still no gesture yet, or blocked — fine, try again next gesture */ });
  }

  _ensureContext() {
    if (this.ctx || !this.enabled) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;   // no Web Audio support — degrade silently, everything else stays a no-op
      this.ctx = new Ctx();
      this._buildEngineGraph();
    } catch { this.ctx = null; }
  }

  // Persistent nodes for the continuous engine hum: sawtooth oscillator (the
  // tonal drive-vibration component) through a lowpass filter (rolls off the
  // harsh harmonics — throttle also opens the cutoff, so it brightens with
  // power) into a gain node that engineVoice() drives to 0 at idle/off/warp.
  // Built ONCE and left running for the session; silence is "gain at 0", not
  // "node doesn't exist" — cheaper than tearing the graph down every toggle
  // and avoids audible start/stop clicks on the oscillator itself.
  _buildEngineGraph() {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 45;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 300;
    filter.Q.value = 0.7;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(filter).connect(gain).connect(ctx.destination);
    osc.start();
    this._engineOsc = osc;
    this._engineFilter = filter;
    this._engineGain = gain;
  }

  // Ramp the continuous hum to silence and give the audio thread back to the
  // browser. Idempotent and safe with no context at all (nothing was ever
  // created — the common "sound has always been off" path).
  _quiesce() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (this._engineGain) this._engineGain.gain.setTargetAtTime(0, now, 0.05);
    if (this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
  }

  // Per-frame engine-hum update. Callers MUST guard this behind sim.sound
  // themselves (see js/main.js's frame loop) — this method still no-ops
  // safely if called anyway, but the point of the outer guard is that a
  // disabled session never even reaches this call, let alone allocates.
  updateEngine(throttle, mode, warp) {
    if (!this.enabled || !this.ctx || !this._engineGain) return;
    const v = engineVoice({ throttle, mode, warp, enabled: this.enabled, speed: 0 });
    const now = this.ctx.currentTime;
    this._engineGain.gain.setTargetAtTime(v.gain, now, ENGINE_SMOOTH_S);
    this._engineOsc.frequency.setTargetAtTime(v.freq, now, ENGINE_SMOOTH_S);
    this._engineFilter.frequency.setTargetAtTime(v.filterCutoff, now, ENGINE_SMOOTH_S);
  }

  // One-shot hull-impact sound (soft touchdown vs crash — see
  // impactVoice()'s header). Self-guarded: safe to call unconditionally from
  // touchdown() in js/main.js without an extra sim.sound check at the call
  // site, since it is not a per-frame call.
  impact(speed, crashed) {
    if (!this.enabled || !this.ctx) return;
    this._burst(impactVoice({ speed, crashed }));
  }

  // One-shot cockpit-instrument click for a toggle/mode/target switch.
  click() {
    if (!this.enabled || !this.ctx) return;
    this._burst(uiClickVoice());
  }

  // Shared one-shot envelope: a short attack + exponential decay gain
  // wrapping an optional tone layer (triangle oscillator) and an optional
  // noise layer (in-memory AudioBuffer of random samples — procedural, not
  // an asset), mixed by `noiseMix`.
  _burst({ gain, freq, noiseMix = 0, duration }) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(SILENCE_FLOOR, now);
    out.gain.linearRampToValueAtTime(Math.max(gain, SILENCE_FLOOR), now + 0.005);
    out.gain.exponentialRampToValueAtTime(SILENCE_FLOOR, now + duration);
    out.connect(ctx.destination);
    const stopAt = now + duration + 0.02;

    if (noiseMix > 0) {
      const src = this._noiseBurst(duration);
      const noiseGain = ctx.createGain();
      noiseGain.gain.value = noiseMix;
      src.connect(noiseGain).connect(out);
      src.start(now);
      src.stop(stopAt);
    }
    if (noiseMix < 1) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const toneGain = ctx.createGain();
      toneGain.gain.value = 1 - noiseMix;
      osc.connect(toneGain).connect(out);
      osc.start(now);
      osc.stop(stopAt);
    }
  }

  // Procedural white-noise burst: a runtime AudioBuffer filled with random
  // samples, NOT a loaded/decoded file — satisfies the "zero binary assets"
  // constraint while still giving impacts/clicks a percussive, non-pure-tone
  // character.
  _noiseBurst(duration) {
    const ctx = this.ctx;
    const n = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }
}
