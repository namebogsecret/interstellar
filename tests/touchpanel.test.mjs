// touchPanel.js contract (js/render/touchPanel.js), written from the ТЗ
// ("вынести N / Shift+N / I / Z / V / T / J / U / B / C в тач-панель"), NOT
// from the implementation — this file is written before touchPanel.js exists.
//
// PANEL_ACTIONS is the single source of truth a phone player needs: every
// keyboard-only feature this wave targets must have exactly one row, and the
// keyboard branch it names in controls.js must call the SAME hook. That is
// the whole point of the exercise (ГРАБЛИ #2 in this repo — two independent
// copies of one decision drifting apart) applied to a new input channel.
//
// Style: bare node:assert/strict, run under `node --loader tests/three-loader.mjs`
// (see tests/run.sh); comments explain WHY each check exists (house style,
// see tests/structure.test.mjs / tests/cockpitpolicy.test.mjs).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isFlightKey, isFlightTouchAction } from '../js/render/controls.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// Strip /* … */ and // … before matching source as text — identical to
// tests/structure.test.mjs's `code()`, duplicated here rather than imported
// because structure.test.mjs is a *.test.mjs script (run.sh globs and runs
// it directly), not a shared module. Crude on purpose: may blank a `//`
// inside a string literal, which only makes checks MORE permissive, never a
// false alarm.
function code(rel) {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n');
}

// ── 0. The module must exist and export the documented shape ────────────────
// This is the ONLY place a missing-module failure is allowed to look like a
// bare stack trace's cousin — everywhere else below assumes PANEL_ACTIONS and
// panelAction are real. A clear message here saves whoever runs this test
// mid-wave (module not landed yet) from mis-reading a cascade of unrelated
// TypeErrors as 20 separate bugs.
let touchPanelMod;
try {
  touchPanelMod = await import('../js/render/touchPanel.js');
} catch (err) {
  assert.fail(
    'js/render/touchPanel.js could not be imported ' +
    `(${err.code || err.name || 'Error'}: ${err.message}).\n` +
    'Contract (dev-lead wave "touch-panel"): js/render/touchPanel.js is a pure ' +
    'module exporting PANEL_ACTIONS (array) and panelAction(name). If the ' +
    'implementer\'s work item has not landed yet, this failure is EXPECTED — ' +
    're-run this file after js/render/touchPanel.js exists.'
  );
}
const { PANEL_ACTIONS, panelAction } = touchPanelMod;
assert.ok(Array.isArray(PANEL_ACTIONS), 'touchPanel.js must export PANEL_ACTIONS as an array');
assert.equal(typeof panelAction, 'function', 'touchPanel.js must export panelAction(name) as a function');

// ── The ten keys this wave promised to make tap-reachable ───────────────────
const REQUIRED_KEYS = ['n', 'shift+n', 'i', 'z', 'v', 't', 'j', 'u', 'b', 'c'];

// The full ТЗ contract, name -> {key, hook, arg, kind, stateKey}. A golden
// table, not just a shape check: a typo'd hook name (e.g. onCockpit ->
// onCockpitToggle) would satisfy every purely-structural check below but
// silently wire the wrong feature to the button — this is what actually
// prevents that class of bug.
const EXPECTED = [
  { name: 'autopilot', key: 'n',       hook: 'onAutopilot',  arg: 'circularize', kind: 'action', stateKey: null },
  { name: 'hohmann',   key: 'shift+n', hook: 'onAutopilot',  arg: 'hohmann',     kind: 'action', stateKey: null },
  { name: 'map',       key: 'v',       hook: 'onMap',        arg: undefined,     kind: 'toggle', stateKey: 'showMap' },
  // правка контракта: sim.showTargetList существует (main.js:188) — targets
  // DOES have a live sim flag (set by TargetList's onOpenChange), so the
  // panel button can (and must) highlight like every other toggle here.
  { name: 'targets',   key: 't',       hook: 'onTargetList', arg: undefined,     kind: 'toggle', stateKey: 'showTargetList' },
  { name: 'missions',  key: 'j',       hook: 'onMissions',   arg: undefined,     kind: 'toggle', stateKey: 'showMissions' },
  { name: 'cockpit',   key: 'i',       hook: 'onCockpit',    arg: undefined,     kind: 'toggle', stateKey: 'cockpitOn' },
  { name: 'sound',     key: 'z',       hook: 'onSound',      arg: undefined,     kind: 'toggle', stateKey: 'sound' },
  { name: 'bloom',     key: 'b',       hook: 'onBloom',      arg: undefined,     kind: 'toggle', stateKey: 'bloom' },
  { name: 'relfx',     key: 'c',       hook: 'onRelFx',      arg: undefined,     kind: 'toggle', stateKey: 'relFx' },
  { name: 'cube',      key: 'u',       hook: 'onCubeAberr',  arg: undefined,     kind: 'toggle', stateKey: 'cubeAberr' },
];
const STATEKEY_WHITELIST = new Set(['showMap', 'showMissions', 'cockpitOn', 'sound', 'bloom', 'relFx', 'cubeAberr', 'showTargetList']);

// ── 1. Coverage: every promised key has EXACTLY one row ─────────────────────
// "Feature reachable from a phone" == "there is exactly one PANEL_ACTIONS row
// for its key". Zero rows means the feature is still keyboard-only; two rows
// means two buttons race to answer the same key (and the structural check
// below would only be able to validate one of them against the single
// keydown branch anyway).
{
  for (const key of REQUIRED_KEYS) {
    const matches = PANEL_ACTIONS.filter((a) => a.key === key);
    assert.equal(matches.length, 1,
      `expected exactly one PANEL_ACTIONS entry for key '${key}', found ${matches.length}`);
  }
  assert.equal(PANEL_ACTIONS.length, REQUIRED_KEYS.length,
    `PANEL_ACTIONS must have exactly ${REQUIRED_KEYS.length} entries (one per promised key), ` +
    `found ${PANEL_ACTIONS.length}: ${PANEL_ACTIONS.map((a) => a.name).join(', ')}`);
}

// ── 2. Uniqueness of name and key; panelAction() lookup ─────────────────────
{
  const names = PANEL_ACTIONS.map((a) => a.name);
  assert.equal(new Set(names).size, names.length,
    `PANEL_ACTIONS names must be unique, got: ${names.join(', ')}`);
  const keys = PANEL_ACTIONS.map((a) => a.key);
  assert.equal(new Set(keys).size, keys.length,
    `PANEL_ACTIONS keys must be unique, got: ${keys.join(', ')}`);

  for (const entry of PANEL_ACTIONS) {
    const found = panelAction(entry.name);
    assert.ok(found, `panelAction('${entry.name}') must find the registered entry`);
    assert.equal(found.name, entry.name, `panelAction('${entry.name}') returned a mismatched entry`);
    assert.equal(found.hook, entry.hook, `panelAction('${entry.name}') returned a mismatched hook`);
  }
  for (const garbage of ['nonexistent-action', '', 'AUTOPILOT', 'cockpit ', null, undefined, 42]) {
    assert.equal(panelAction(garbage), undefined,
      `panelAction(${JSON.stringify(garbage)}) must return undefined for unknown input, not throw or find a fuzzy match`);
  }
}

// ── 3. Golden contract table: name -> key/hook/arg/kind/stateKey ────────────
{
  for (const exp of EXPECTED) {
    const entry = PANEL_ACTIONS.find((a) => a.name === exp.name);
    assert.ok(entry, `PANEL_ACTIONS must contain an entry named '${exp.name}'`);
    assert.equal(entry.key, exp.key, `'${exp.name}'.key must be '${exp.key}', got '${entry.key}'`);
    assert.equal(entry.hook, exp.hook, `'${exp.name}'.hook must be '${exp.hook}', got '${entry.hook}'`);
    assert.equal(entry.arg, exp.arg, `'${exp.name}'.arg must be ${JSON.stringify(exp.arg)}, got ${JSON.stringify(entry.arg)}`);
    assert.equal(entry.kind, exp.kind, `'${exp.name}'.kind must be '${exp.kind}', got '${entry.kind}'`);
    assert.equal(entry.stateKey, exp.stateKey, `'${exp.name}'.stateKey must be ${JSON.stringify(exp.stateKey)}, got ${JSON.stringify(entry.stateKey)}`);
    assert.equal(typeof entry.label, 'string', `'${exp.name}'.label must be a string`);
    assert.ok(entry.label.length > 0, `'${exp.name}'.label must not be empty`);
    assert.equal(typeof entry.title, 'string', `'${exp.name}'.title must be a string`);
    assert.ok(entry.title.length > 0, `'${exp.name}'.title must not be empty`);
  }
}

// ── 3b. Generic shape invariants (own additions, not name-specific) ─────────
// Catches a mutant that gets the golden table right for the 10 known names
// but breaks the RULE (e.g. a future 11th action with a toggle-with-arg or a
// stateKey typo) — independent of the exact-value table above.
{
  for (const entry of PANEL_ACTIONS) {
    assert.ok(entry.kind === 'action' || entry.kind === 'toggle',
      `'${entry.name}'.kind must be 'action' or 'toggle', got '${entry.kind}'`);
    if (entry.kind === 'toggle') {
      assert.equal(entry.arg, undefined, `toggle entry '${entry.name}' must not carry an arg, got ${JSON.stringify(entry.arg)}`);
    } else {
      assert.ok(entry.arg === 'circularize' || entry.arg === 'hohmann',
        `action entry '${entry.name}'.arg must be 'circularize' or 'hohmann', got ${JSON.stringify(entry.arg)}`);
    }
    assert.ok(entry.stateKey === null || STATEKEY_WHITELIST.has(entry.stateKey),
      `'${entry.name}'.stateKey must be null or one of [${[...STATEKEY_WHITELIST].join(', ')}], got ${JSON.stringify(entry.stateKey)}`);
  }
}

// ── 4. Keyboard consistency (structural): the branch named by each entry's
// `hook` must actually exist in controls.js's keydown handler, and the SAME
// physical branch, for the same key. This is what makes "n" and "shift+n"
// share one line and "hohmann"/"circularize" argument, so a future refactor
// that splits them into two ifs cannot quietly drop shift-detection from one.
// ────────────────────────────────────────────────────────────────────────────
{
  const controlsLines = code('js/render/controls.js').split('\n');
  const findKeyBranch = (baseKey) => {
    const esc = baseKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`k === '${esc}'`);
    return controlsLines.filter((l) => re.test(l));
  };

  for (const entry of PANEL_ACTIONS) {
    const baseKey = entry.key.startsWith('shift+') ? entry.key.slice('shift+'.length) : entry.key;
    const branches = findKeyBranch(baseKey);
    assert.equal(branches.length, 1,
      `controls.js must have exactly one keydown branch testing k === '${baseKey}' ` +
      `(for PANEL_ACTIONS entry '${entry.name}'), found ${branches.length}`);
    const line = branches[0];
    assert.ok(line.includes(`hooks.${entry.hook}`) || line.includes(`this.hooks.${entry.hook}`),
      `controls.js branch for '${baseKey}' must call hooks.${entry.hook} ` +
      `(PANEL_ACTIONS entry '${entry.name}' names that hook), got: ${line.trim()}`);
  }

  // 'n' and 'shift+n' must be the SAME branch (not two separate ifs), and
  // that branch must dispatch on e.shiftKey with both string literals.
  const nEntry = PANEL_ACTIONS.find((a) => a.name === 'autopilot');
  const shiftNEntry = PANEL_ACTIONS.find((a) => a.name === 'hohmann');
  const nBranches = findKeyBranch('n');
  assert.equal(nBranches.length, 1, "controls.js must have exactly one k === 'n' branch");
  const nLine = nBranches[0];
  assert.ok(/e\.shiftKey/.test(nLine),
    `the 'n' branch must consult e.shiftKey to distinguish circularize vs hohmann, got: ${nLine.trim()}`);
  assert.ok(nLine.includes(nEntry.arg), `the 'n' branch must reference '${nEntry.arg}' (autopilot arg), got: ${nLine.trim()}`);
  assert.ok(nLine.includes(shiftNEntry.arg), `the 'n' branch must reference '${shiftNEntry.arg}' (hohmann arg), got: ${nLine.trim()}`);
}

// ── 5. Pilot-intent classification agrees with the keyboard table ───────────
// isFlightTouchAction/isFlightKey are the ONE table (controls.js) deciding
// "did the pilot just take the stick". A tap-button and its keyboard
// equivalent MUST agree, or opening a passive panel from a phone would
// silently cancel a running autopilot manoeuvre (or, the other way around, a
// genuine flight action from touch wouldn't cancel it at all).
{
  for (const entry of PANEL_ACTIONS) {
    const baseKey = entry.key.startsWith('shift+') ? entry.key.slice('shift+'.length) : entry.key;
    assert.equal(isFlightTouchAction(entry.name), isFlightKey(baseKey),
      `isFlightTouchAction('${entry.name}') must equal isFlightKey('${baseKey}') — ` +
      `touch and keyboard must agree on whether this is pilot-intent`);
  }
  // autopilot/hohmann are flight actions (n is in FLIGHT_ACTION_KEYS); every
  // toggle/panel name must NOT be flight-intent — opening a panel from a
  // phone is not "taking the stick".
  assert.equal(isFlightTouchAction('autopilot'), true, "'autopilot' must be flight-intent (mirrors key 'n')");
  assert.equal(isFlightTouchAction('hohmann'), true, "'hohmann' must be flight-intent (mirrors key 'n')");
  for (const passive of ['map', 'targets', 'missions', 'cockpit', 'sound', 'bloom', 'relfx', 'cube']) {
    assert.equal(isFlightTouchAction(passive), false, `'${passive}' must NOT be flight-intent — opening a panel is not taking control`);
  }
  // Regression pin on the two pre-existing touch actions (predates this
  // wave) — this wave must not have disturbed them.
  assert.equal(isFlightTouchAction('kill'), true, "regression: 'kill' must stay flight-intent (mirrors key 'x')");
  assert.equal(isFlightKey('x'), true, "regression: keyboard 'x' must stay flight-intent");
  assert.equal(isFlightTouchAction('jump'), true, "regression: 'jump' must stay flight-intent (mirrors key 'g')");
  assert.equal(isFlightKey('g'), true, "regression: keyboard 'g' must stay flight-intent");
}

// ── 6. touchPanel.js purity: no DOM/THREE/localStorage ──────────────────────
// House pattern (renderPolicy.js, soundPolicy.js, autopilot.js): a policy
// module the node gate can run has zero host dependencies. This is what lets
// it be unit-tested at all without a browser, and reused identically for both
// the panel-builder (touch.js) and, eventually, any other input surface.
{
  const bad = [];
  const src = code('js/render/touchPanel.js');
  src.split('\n').forEach((line, i) => {
    if (/document\.|window\.|localStorage|import\s+.*from\s*['"]three['"]/.test(line)) {
      bad.push(`js/render/touchPanel.js:${i + 1}: ${line.trim()}`);
    }
  });
  assert.equal(bad.length, 0, `touchPanel.js must stay pure (no DOM/THREE/localStorage):\n${bad.join('\n')}`);
}

// ── 7. touchPanel.js does not import touch.js or controls.js ────────────────
// One-way dependency: touch.js (the UI builder) imports the data table from
// touchPanel.js, never the reverse — otherwise the "pure data" module could
// not be node-gate-tested in isolation, and a cycle would exist for no reason
// (touchPanel.js needs nothing from either file to describe ten actions).
{
  const src = code('js/render/touchPanel.js');
  assert.ok(!/from\s*['"]\.\/touch\.js['"]/.test(src), "touchPanel.js must not import './touch.js'");
  assert.ok(!/from\s*['"]\.\/controls\.js['"]/.test(src), "touchPanel.js must not import './controls.js'");
}

// ── 8. touch.js dispatches PANEL_ACTIONS by TABLE, not by a second set of
// hand-written case literals for the new names. A new button must be addable
// by adding a PANEL_ACTIONS row; a `case 'cockpit':` in touch.js would mean
// the panel's action list and its dispatcher can drift apart independently —
// exactly ГРАБЛИ #2's shape (two copies of one decision) applied to touch.js.
// ────────────────────────────────────────────────────────────────────────────
{
  const src = code('js/render/touch.js');
  const bad = [];
  for (const entry of PANEL_ACTIONS) {
    const re = new RegExp(`case\\s*['"]${entry.name}['"]\\s*:`);
    if (re.test(src)) bad.push(entry.name);
  }
  assert.equal(bad.length, 0,
    `touch.js must dispatch PANEL_ACTIONS by table lookup, not case literals — found case branches for: ${bad.join(', ')}`);
}

console.log('touchpanel.test.mjs OK');
