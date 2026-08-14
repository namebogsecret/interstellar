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
// at page load, and — repair-round-1 finding R-3 — never merely because
// sound's persisted ON flag was restored) and only once a real user gesture
// has actually happened while sound is enabled; see setEnabled()/
// resumeIfNeeded() and js/audio/soundPolicy.js's shouldEnsureContext(),
// which is the one decision point both of those go through. Browsers
// additionally gate a fresh context to 'suspended' until a real user gesture
// occurs; resumeIfNeeded() is called from the existing gesture entry points
// (js/render/controls.js's click/keydown, js/render/touch.js's
// pointerdown/_action) to lift that gate — and, per R-3, to create the
// context in the first place for a returning visitor whose sound was left on
// last session. Every method degrades silently on failure (try/catch around
// construction, defensive `this.ctx` checks everywhere) — a browser that
// blocks or lacks Web Audio must never throw into the frame loop or spam the
// console (pageerror in the smoke test is a hard gate failure).
import { engineVoice, impactVoice, uiClickVoice, shouldEnsureContext } from './soundPolicy.js';

// Exponential ramps can't target exactly 0 (log of 0 is undefined) — this is
// the standard "close enough to silence" floor Web Audio code uses instead.
const SILENCE_FLOOR = 0.0001;
// setTargetAtTime time-constant for the continuous engine hum: fast enough
// that throttle changes feel responsive, slow enough to avoid zipper noise.
const ENGINE_SMOOTH_S = 0.15;
// How fast to ramp the hum to silence when the tab goes hidden (R-1b) or
// sound is turned off — quick enough that a background tab doesn't keep
// humming audibly for long, slow enough to avoid an audible click/thump.
const SILENCE_RAMP_S = 0.05;

export class SoundEngine {
  constructor() {
    this.enabled = false;   // mirrors sim.sound (INTENT) — may be true with no context yet, see R-3
    this.ctx = null;        // created lazily — see _ensureContext()/resumeIfNeeded()
    this._engineOsc = null;
    this._engineFilter = null;
    this._engineGain = null;
    this._master = null;    // DynamicsCompressorNode safety net — see _buildMasterBus()

    // R-1b: the engine hum lives on the audio thread, independent of rAF.
    // Backgrounding the tab must silence it IMMEDIATELY, not "whenever the
    // frame loop next happens to run" — browsers throttle or fully stop rAF
    // for hidden tabs, so waiting for the next updateEngine() call could mean
    // audibly humming in the background for a long time. `typeof document`
    // guard: this module is only ever imported from the browser (js/main.js),
    // but stays defensive rather than assuming a DOM exists.
    this._hidden = typeof document !== 'undefined' && document.hidden;
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        this._hidden = document.hidden;
        if (this._hidden) this._forceEngineSilence();
      });
    }
  }

  // Master on/off — called from the Z-key toggle hook (js/main.js) and from
  // page-load restore of the persisted iss_sound flag. `fromGesture: true`
  // must be passed ONLY when this call is itself running inside a real
  // user-gesture event handler (e.g. the Z keydown) — that is what
  // authorizes creating the AudioContext synchronously here (R-3). Restoring
  // a persisted flag at page load is NOT a gesture, so it must be omitted
  // there: this only records intent (this.enabled = true) and defers actual
  // context creation to the player's first real interaction, via
  // resumeIfNeeded() (wired from every gesture entry point already).
  // Turning off always ramps the continuous engine hum to silence and
  // suspends the context so a muted session costs nothing on the audio
  // thread either, not just the main thread.
  setEnabled(on, { fromGesture = false } = {}) {
    this.enabled = !!on;
    if (!this.enabled) { this._quiesce(); return; }
    if (fromGesture) this.resumeIfNeeded();
  }

  // Safe to call from any user-gesture handler regardless of whether sound
  // is currently on — a no-op unless sound is enabled AND there is
  // something to do (create the context, and/or resume it if suspended).
  // This is what actually satisfies the browser's autoplay gate for BOTH
  // halves of the R-3 fix: creating the context the first time (a returning
  // visitor whose iss_sound=true was restored with no gesture yet — this is
  // the first real gesture that follows) and resuming a context that came up
  // (or was pushed back into) 'suspended'.
  resumeIfNeeded() {
    if (!this.enabled) return;
    if (shouldEnsureContext({ enabled: this.enabled, fromGesture: true, hasContext: !!this.ctx })) {
      this._ensureContext();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => { /* still blocked, or genuinely no gesture yet — fine, try again next gesture */ });
    }
  }

  _ensureContext() {
    if (this.ctx || !this.enabled) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;   // no Web Audio support — degrade silently, everything else stays a no-op
      this.ctx = new Ctx();
      this._buildMasterBus();
      this._buildEngineGraph();
    } catch { this.ctx = null; }
  }

  // Repair-round-1 finding R-2 (part b): a genuine safety net, independent
  // of whether soundPolicy.js's gain numbers are exactly right. EVERYTHING
  // this class plays (engine hum + every one-shot burst) routes through this
  // single compressor before ctx.destination, so even an unanticipated
  // overlap (e.g. a crash burst landing while the engine hum and a UI click
  // are also live) cannot exceed a safe, non-clipping level. Settings lean
  // toward a limiter (low threshold, high ratio, fast attack) rather than a
  // musical compressor: -12dB is well below 0dBFS, so quiet sounds (e.g. the
  // 0.12-gain UI click, ≈ -18dB) pass through untouched, while anything
  // pushing toward full scale gets caught fast (3ms) before it can click or
  // clip, and released slowly enough (150ms) to not audibly "pump".
  _buildMasterBus() {
    const ctx = this.ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;   // dB
    comp.knee.value = 6;          // dB
    comp.ratio.value = 16;        // near-limiter
    comp.attack.value = 0.003;    // s — fast enough to catch a percussive impact onset
    comp.release.value = 0.15;    // s
    comp.connect(ctx.destination);
    this._master = comp;
  }

  // Persistent nodes for the continuous engine hum: sawtooth oscillator (the
  // tonal drive-vibration component) through a lowpass filter (rolls off the
  // harsh harmonics — throttle also opens the cutoff, so it brightens with
  // power) into a gain node that engineVoice() drives to 0 at idle/off/warp/
  // paused/hidden. Built ONCE and left running for the session; silence is
  // "gain at 0", not "node doesn't exist" — cheaper than tearing the graph
  // down every toggle and avoids audible start/stop clicks on the oscillator
  // itself. Feeds the master compressor bus, not ctx.destination directly.
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
    osc.connect(filter).connect(gain).connect(this._master);
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
    this._forceEngineSilence();
    if (this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
  }

  // R-1b: immediate (not "next frame") silence for the continuous hum — used
  // both when sound is turned fully off (_quiesce) and when the tab goes
  // hidden (the visibilitychange listener in the constructor). Deliberately
  // does NOT touch this.ctx's suspended/running state itself here (unlike
  // _quiesce) — going hidden is not the same decision as turning sound off;
  // the context stays alive and ready for when the tab becomes visible again,
  // only the audible hum is silenced.
  _forceEngineSilence() {
    if (!this.ctx || !this._engineGain) return;
    this._engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, SILENCE_RAMP_S);
  }

  // Per-frame engine-hum update. Callers MUST guard this behind sim.sound
  // themselves (see js/main.js's frame loop) — this method still no-ops
  // safely if called anyway, but the point of the outer guard is that a
  // disabled session never even reaches this call, let alone allocates.
  // `paused` is sim.paused, passed in because js/main.js freezes throttle/
  // warp while paused and this method has no other way to know that model
  // time has stopped (R-1a); `hidden` is NOT a parameter — it comes from
  // this._hidden, which the constructor's visibilitychange listener keeps
  // current independently of whether/how often this method gets called
  // (R-1b — the whole point is that it must not depend on a frame arriving).
  updateEngine(throttle, mode, warp, paused) {
    if (!this.enabled || !this.ctx || !this._engineGain) return;
    const v = engineVoice({ throttle, mode, warp, enabled: this.enabled, paused, hidden: this._hidden, speed: 0 });
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
  // an asset), mixed by `noiseMix`. Feeds the master compressor bus (R-2),
  // same as the engine hum — a crash burst landing while the hum and/or a
  // UI click are also live cannot sum past a safe level.
  _burst({ gain, freq, noiseMix = 0, duration }) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(SILENCE_FLOOR, now);
    out.gain.linearRampToValueAtTime(Math.max(gain, SILENCE_FLOOR), now + 0.005);
    out.gain.exponentialRampToValueAtTime(SILENCE_FLOOR, now + duration);
    out.connect(this._master);
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
