// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION — repair round 3, R3-2 and R3-3 (js/render/controls.js).
//
// R3-2: OS key auto-repeat (e.repeat === true) of an ACTION key (n, x, k, g,
//   backspace) must NOT bump inputSeq and must NOT fire the hook. Otherwise a
//   held Shift+N / N cancels its own autopilot (the repeat looks like a fresh
//   user input) — or fires the action again.
// R3-3: window 'blur' and document 'visibilitychange' (hidden) must drop all
//   held keys and mouse look: a key whose keyup was lost to alt-tab must not
//   keep counting as pilot input forever.
// Stubs window/document BEFORE importing controls.js (no DOM in node).
// ─────────────────────────────────────────────────────────────────────────────
import assert from 'node:assert/strict';

class ET {
  constructor() { this.l = {}; }
  addEventListener(t, f) { (this.l[t] ??= []).push(f); }
  dispatch(t, e = {}) { (this.l[t] || []).forEach((f) => f(e)); }
}
globalThis.window = new ET();
globalThis.document = new ET();
document.pointerLockElement = null;
document.hidden = false;
const dom = new ET();
dom.requestPointerLock = () => {};

const { FlightControls } = await import('../js/render/controls.js');
const { Ship } = await import('../js/physics/ship.js');

const key = (key, extra = {}) => ({ key, shiftKey: false, repeat: false, preventDefault() {}, ...extra });

function fresh() {
  const calls = {};
  const hooks = new Proxy({}, { get: (_, name) => (typeof name === 'string' && name.startsWith('on')
    ? () => { calls[name] = (calls[name] || 0) + 1; } : undefined) });
  // Fresh listeners on a fresh window each time.
  globalThis.window = new ET();
  globalThis.document = new ET();
  document.pointerLockElement = null;
  document.hidden = false;
  const c = new FlightControls(new Ship(), dom, hooks);
  return { c, calls };
}

// ── R3-2 ────────────────────────────────────────────────────────────────────
for (const k of ['n', 'x', 'k', 'g', 'backspace']) {
  const { c, calls } = fresh();
  const hook = { n: 'onAutopilot', x: 'onKill', k: 'onCircularize', g: 'onFastTravel', backspace: 'onReset' }[k];
  window.dispatch('keydown', key(k, { repeat: false }));
  const seq1 = c.inputSeq;
  assert.equal(calls[hook], 1, `(R3-2) first '${k}' must fire ${hook}`);
  for (let i = 0; i < 3; i++) window.dispatch('keydown', key(k, { repeat: true }));
  assert.equal(calls[hook], 1, `(R3-2) auto-repeat of '${k}' must not call ${hook} again`);
  assert.equal(c.inputSeq, seq1, `(R3-2) auto-repeat of '${k}' must not bump inputSeq`);
  assert.equal(seq1, 1, `(R3-2) first press bumps inputSeq exactly once`);
}
// the spec case, with Shift+N
{
  const { c, calls } = fresh();
  window.dispatch('keydown', key('n', { shiftKey: true }));
  for (let i = 0; i < 3; i++) window.dispatch('keydown', key('N', { shiftKey: true, repeat: true }));
  assert.equal(calls.onAutopilot, 1);
  assert.equal(c.inputSeq, 1);
}
// a real re-press after keyup still works
{
  const { c, calls } = fresh();
  window.dispatch('keydown', key('n'));
  window.dispatch('keyup', key('n'));
  window.dispatch('keydown', key('n'));
  assert.equal(calls.onAutopilot, 2);
  assert.equal(c.inputSeq, 2);
}
// held FLIGHT keys (movement) still count on every update frame (unchanged behaviour)
{
  const { c } = fresh();
  window.dispatch('keydown', key('w'));
  const s0 = c.inputSeq;
  c.update(1 / 60);
  assert.ok(c.inputSeq > s0, 'held W must still count as input');
}

// ── R3-3 ────────────────────────────────────────────────────────────────────
for (const how of ['blur', 'visibilitychange']) {
  const { c } = fresh();
  window.dispatch('keydown', key('w'));
  window.dispatch('keydown', key('d'));
  c.update(1 / 60);
  assert.ok(c.keys.has('w'), 'precondition');
  // mouse look accumulated under pointer lock
  document.pointerLockElement = dom;
  document.dispatch('mousemove', { movementX: 50, movementY: 30 });
  assert.ok(c.pitchYawFromMouse.x !== 0 || c.pitchYawFromMouse.y !== 0, 'precondition mouse');
  if (how === 'blur') window.dispatch('blur', {});
  else { document.hidden = true; document.dispatch('visibilitychange', {}); }
  assert.equal(c.keys.size, 0, `(R3-3 ${how}) keys must be cleared`);
  assert.equal(c.pitchYawFromMouse.x, 0, `(R3-3 ${how}) pitch must be zeroed`);
  assert.equal(c.pitchYawFromMouse.y, 0, `(R3-3 ${how}) yaw must be zeroed`);
  const s = c.inputSeq;
  c.update(1 / 60);
  c.update(1 / 60);
  assert.equal(c.inputSeq, s, `(R3-3 ${how}) update() must not count phantom input`);
}
// visibilitychange while VISIBLE must not wipe held keys
{
  const { c } = fresh();
  window.dispatch('keydown', key('w'));
  document.hidden = false;
  document.dispatch('visibilitychange', {});
  assert.ok(c.keys.has('w'), '(R3-3) visible visibilitychange must keep keys');
}
console.log('controls.repeat-blur: OK');
