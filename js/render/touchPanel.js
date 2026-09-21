// Declarative table of the touch-panel actions (the "☰" drawer in touch.js).
// PURE DATA + one lookup — no DOM, no window/document/localStorage, no THREE.
// House pattern: js/render/renderPolicy.js / js/audio/soundPolicy.js (chief
// policy lives as data/pure-functions, the imperative layer just applies it).
//
// This table is the SINGLE source of truth for "which keyboard-only feature
// gets a panel button, what it's called, which controls.hooks entry it calls,
// and whether it's a state toggle vs a one-shot action". js/render/touch.js
// builds the panel by looping over PANEL_ACTIONS — it must never hardcode a
// `case 'cockpit':`-style literal for any of these names; that would be a
// second copy of this table drifting apart from it (ГРАБЛИ #2/#3 shape).
//
// Each entry's `name` also has to agree with js/render/controls.js's own
// classification table (FLIGHT_TOUCH_ACTIONS / isFlightTouchAction) on
// whether it counts as "taking the controls": tests/structure.test.mjs-style
// invariant is `isFlightTouchAction(a.name) === isFlightKey(baseKey(a.key))`
// for every row here. Only 'autopilot' and 'hohmann' are flight actions (key
// 'n', which is already flight in controls.js); every panel toggle below is
// deliberately NOT a flight input — same as its keyboard equivalent.
export const PANEL_ACTIONS = [
  { name: 'autopilot', key: 'n',       hook: 'onAutopilot', arg: 'circularize',
    kind: 'action', stateKey: null,          label: 'AP ○', title: 'Autopilot: circularize orbit' },
  { name: 'hohmann',   key: 'shift+n', hook: 'onAutopilot', arg: 'hohmann',
    kind: 'action', stateKey: null,          label: 'AP ⇗', title: 'Autopilot: Hohmann transfer to target' },
  { name: 'cockpit',   key: 'i',       hook: 'onCockpit',
    kind: 'toggle', stateKey: 'cockpitOn',   label: 'CPT',  title: 'Toggle cockpit overlay' },
  { name: 'sound',     key: 'z',       hook: 'onSound',
    kind: 'toggle', stateKey: 'sound',       label: 'SND',  title: 'Toggle procedural sound' },
  { name: 'map',       key: 'v',       hook: 'onMap',
    kind: 'toggle', stateKey: 'showMap',     label: 'MAP',  title: 'Toggle system map' },
  { name: 'targets',   key: 't',       hook: 'onTargetList',
    kind: 'toggle', stateKey: null,          label: 'TGT',  title: 'Toggle target list' },
  { name: 'missions',  key: 'j',       hook: 'onMissions',
    kind: 'toggle', stateKey: 'showMissions', label: 'MSN', title: 'Toggle missions panel' },
  { name: 'cube',      key: 'u',       hook: 'onCubeAberr',
    kind: 'toggle', stateKey: 'cubeAberr',   label: 'CUBE', title: 'Toggle cubemap aberration path' },
  { name: 'bloom',     key: 'b',       hook: 'onBloom',
    kind: 'toggle', stateKey: 'bloom',       label: 'BLM',  title: 'Toggle bloom' },
  { name: 'relfx',     key: 'c',       hook: 'onRelFx',
    kind: 'toggle', stateKey: 'relFx',       label: 'REL',  title: 'Toggle relativistic optics' },
];

const BY_NAME = new Map(PANEL_ACTIONS.map((a) => [a.name, a]));

/** Look up a panel action by its `name`; undefined if there isn't one. */
export function panelAction(name) { return BY_NAME.get(name); }
