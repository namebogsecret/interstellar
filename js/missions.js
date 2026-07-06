// Student missions layer (key J) — a short list of checkable objectives,
// evaluated from live ship/sim state and persisted to localStorage once
// completed. Mirrors the render/map.js + render/targetlist.js house pattern
// (single class owns its own DOM overlay + data), except this module also
// owns the PURE predicate functions per mission so they are independently
// unit-testable without any DOM — see the "pure predicates" section below.
//
// ctx shape used by every predicate: { ship, sim, positions, byName }
//   ship      — the live Ship instance (READ-ONLY here: .pos/.v/.refBody/
//               .landed/.landedBody/.crashed only; never mutated)
//   sim       — the sim state object (READ-ONLY: .time only, via ctx.sim.time
//               is NOT read directly by predicates — bodyVelocity(t) needs a
//               time, passed as ctx.sim.time)
//   positions — Map<name, THREE.Vector3> heliocentric body positions
//               (READ-ONLY; shared with main.js's frame loop, never mutated)
//   byName    — data/bodies.js::byName (body lookup by name)
//
// All three predicates guard against NaN/degenerate state (zero-length
// relative vectors, missing bodies) and simply return false rather than
// throwing — a broken frame must never crash the mission layer.
//
// DELIBERATELY NO top-level import of './i18n.js' (or anything else that
// touches `document`/`localStorage` at module-eval time): unlike map.js /
// targetlist.js (render-only, never Node-tested), this file's whole point is
// that `checkMarsCircularOrbit` / `checkMoonLanding` / `stepJupiterFlyby` /
// `checkMission` must be importable and callable under the plain Node test
// harness (tests/three-loader.mjs, no DOM shim). A static `import { t } from
// './i18n.js'` would execute i18n.js's top-level `localStorage.getItem(...)`
// and crash immediately in Node — so MissionTracker (the only DOM/localStorage
// consumer in this file) receives `t` injected via its constructor instead
// (main.js already has it imported) rather than importing i18n.js itself.
import * as THREE from 'three';
import { orbitFromState, bodyVelocity } from './physics/orbits.js';

const STORAGE_KEY = 'iss_missions';

// Mission 1 threshold — "circular" orbit around Mars.
const MARS_MAX_E = 0.05;
// Mission 2 thresholds — see stepJupiterFlyby doc comment for the full
// criterion. N·radius periapsis gate + minimum heliocentric speed change.
const JUPITER_RPERI_RADII = 20;
const JUPITER_MIN_DELTAV = 1000; // m/s (1 km/s)

// ---- pure predicates (exported individually so tests can call them direct) -

// Mission 1: bound, near-circular relative orbit around Mars.
// Dedicated scratch (never shared with the Jupiter predicate below) — each
// call fully consumes and discards it before returning, so no cross-call
// aliasing risk (ГРАБЛИ.md item 4 discipline).
const _marsVel = new THREE.Vector3();
const _marsR = new THREE.Vector3();
const _marsV = new THREE.Vector3();
export function checkMarsCircularOrbit(ctx) {
  const { ship, sim, byName, positions } = ctx;
  if (!ship.refBody || ship.refBody.name !== 'Mars') return false;
  const mars = byName('Mars');
  const marsPos = positions.get('Mars');
  if (!mars || !marsPos || !(mars.GM > 0)) return false;

  bodyVelocity(mars, sim.time, byName, _marsVel);
  _marsR.subVectors(ship.pos, marsPos);
  _marsV.subVectors(ship.v, _marsVel);
  if (!(_marsR.lengthSq() > 1)) return false;   // degenerate (ship ~= Mars centre)

  const { e } = orbitFromState(mars.GM, _marsR, _marsV);
  // e < MARS_MAX_E already implies bound (e < 1); spelled out for clarity
  // against the ТЗ wording ("bound AND e < 0.05").
  return Number.isFinite(e) && e >= 0 && e < 1 && e < MARS_MAX_E;
}

// Mission 3: soft landing on the Moon. Purely a ship-state readout — no
// vector math, no scratch needed.
export function checkMoonLanding(ctx) {
  const { ship } = ctx;
  return ship.landed === true && ship.landedBody === 'Moon' && !ship.crashed;
}

// Mission 2: gravity assist at Jupiter.
//
// EXACT CHECKABLE CRITERION (documented per ТЗ requirement):
//   1. SOI ENTRY — the frame Jupiter FIRST becomes the ship's dominant
//      gravity source (ship.refBody.name === 'Jupiter') while the ship's
//      relative orbit about Jupiter (r = ship.pos - jupiterPos, v = ship.v -
//      jupiterVel, mu = Jupiter.GM) is HYPERBOLIC (e >= 1) with a periapsis
//      below JUPITER_RPERI_RADII (20) × Jupiter.radius — i.e. a genuinely
//      close hyperbolic pass, not a grazing/near-parabolic SOI graze. At that
//      frame we record the ship's HELIOCENTRIC speed (|ship.v|, since ship.v
//      IS heliocentric coordinate velocity — see physics/ship.js) into the
//      per-mission runtime record ("armed").
//   2. SOI EXIT — the first frame Jupiter STOPS being dominant after being
//      armed, we compare the CURRENT heliocentric speed against the recorded
//      entry speed. |Δspeed| >= JUPITER_MIN_DELTAV (1000 m/s = 1 km/s) means
//      a genuine gravity assist occurred (a pure elastic flyby with no other
//      perturbation barely changes heliocentric speed; a close, fast pass
///     that steals/donates momentum from Jupiter's own orbital motion does).
//   3. The record is DELIBERATELY NOT persisted to localStorage — it is
//      transient per-session runtime state (reset to {armed:false,
//      entrySpeed:null} on every page reload, and again after each arm/exit
//      cycle) as instructed by the ТЗ ("small per-mission runtime record, NOT
//      in localStorage until completed"). Only the boolean COMPLETION is
//      persisted (by the MissionTracker below), so a reload never re-fires
//      the overlay event for an already-completed mission, but it WILL
//      require a fresh qualifying flyby to complete the mission if it was
//      not yet completed before the reload.
//
// Implemented as a pure reducer — stepJupiterFlyby(ctx, state) never mutates
// its `state` argument; it returns a NEW { state, completed } pair, so a test
// can feed a sequence of ctx snapshots and assert on both outputs at each
// step without any hidden mutation.
const _jupVel = new THREE.Vector3();
const _jupR = new THREE.Vector3();
const _jupV = new THREE.Vector3();
export function createJupiterFlybyState() { return { armed: false, entrySpeed: null }; }
export function stepJupiterFlyby(ctx, state) {
  const { ship, sim, byName, positions } = ctx;
  const jupiter = byName('Jupiter');
  const jupPos = positions.get('Jupiter');
  const isDominant = !!(ship.refBody && ship.refBody.name === 'Jupiter');
  if (!jupiter || !jupPos || !(jupiter.GM > 0)) return { state, completed: false };

  if (isDominant && !state.armed) {
    bodyVelocity(jupiter, sim.time, byName, _jupVel);
    _jupR.subVectors(ship.pos, jupPos);
    _jupV.subVectors(ship.v, _jupVel);
    if (!(_jupR.lengthSq() > 1)) return { state, completed: false };   // degenerate

    const { e, rPeri } = orbitFromState(jupiter.GM, _jupR, _jupV);
    const closeHyperbolic = Number.isFinite(e) && e >= 1 &&
      Number.isFinite(rPeri) && rPeri < JUPITER_RPERI_RADII * jupiter.radius;
    if (closeHyperbolic) {
      return { state: { armed: true, entrySpeed: ship.v.length() }, completed: false };
    }
    return { state, completed: false };
  }

  if (!isDominant && state.armed) {
    const deltaV = Math.abs(ship.v.length() - state.entrySpeed);
    return { state: createJupiterFlybyState(), completed: deltaV >= JUPITER_MIN_DELTAV };
  }

  return { state, completed: false };
}

// ---- mission catalogue ------------------------------------------------------
// id must be STABLE (persisted in localStorage) — never rename an existing id
// without a migration; adding a new mission is just appending an entry.
export const MISSIONS = [
  {
    id: 'mars-circular-orbit',
    titleKey: 'mission.marsOrbit.title',
    descKey: 'mission.marsOrbit.desc',
    stateful: false,
  },
  {
    id: 'jupiter-flyby',
    titleKey: 'mission.jupiterFlyby.title',
    descKey: 'mission.jupiterFlyby.desc',
    stateful: true,
  },
  {
    id: 'moon-landing',
    titleKey: 'mission.moonLanding.title',
    descKey: 'mission.moonLanding.desc',
    stateful: false,
  },
];

// Uniform dispatcher some tests may prefer over importing each predicate
// directly. `state` is only consulted/returned for stateful missions (ignored
// otherwise). Never throws — an unknown id simply returns not-completed.
export function checkMission(id, ctx, state) {
  switch (id) {
    case 'mars-circular-orbit': return { completed: checkMarsCircularOrbit(ctx), state };
    case 'moon-landing': return { completed: checkMoonLanding(ctx), state };
    case 'jupiter-flyby': return stepJupiterFlyby(ctx, state || createJupiterFlybyState());
    default: return { completed: false, state };
  }
}

// ---- runtime tracker + panel UI (mirrors SystemMap / TargetList) ----------
// Owns: localStorage-backed completion set, the Jupiter runtime record
// (transient, never persisted), and a minimal DOM panel toggled by J.
// Zero per-frame cost while closed (checks still run — cheap scalar/vector
// math, no allocation — but the DOM is only rebuilt while `open` or on a
// fresh completion).
export class MissionTracker {
  // t: the i18n.js::t(key, vars) function, injected by the caller (main.js
  // already imports it) — see the top-of-file note on why this module never
  // imports i18n.js itself.
  constructor(t) {
    this._t = t;
    this.completed = new Set(loadCompleted());
    this._jupiterState = createJupiterFlybyState();
    this.open = false;

    this.panel = document.createElement('div');
    this.panel.id = 'missionpanel';
    // Same visual family as targetlist.js's panel (shared --fg/--bg/--line
    // custom props from css/style.css); pointer-events left at the default
    // (auto) since this panel has no clickable rows, only text.
    this.panel.style.cssText = `
      position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
      width: 360px; max-height: 66vh; overflow-y: auto; z-index: 9;
      font: 12px/1.5 "SF Mono", "Cascadia Code", Menlo, Consolas, monospace;
      color: var(--fg); background: var(--bg); border: 1px solid var(--line);
      border-radius: 8px; padding: 10px 12px; backdrop-filter: blur(4px);
      text-shadow: 0 0 6px rgba(0, 0, 0, 0.8); display: none;
    `;
    const hud = document.getElementById('hud');
    document.body.insertBefore(this.panel, hud || null);
  }

  isDone(id) { return this.completed.has(id); }

  // Flip open/closed; returns the new open state (mirrors SystemMap.toggle() /
  // TargetList.toggle()'s contract so main.js's onMissions hook can do the
  // same `sim.showMissions = missions.toggle()` one-liner as onMap/onTargetList).
  toggle() {
    this.open = !this.open;
    this.panel.style.display = this.open ? 'block' : 'none';
    if (this.open) this._render();
    return this.open;
  }

  // Evaluate every not-yet-completed mission against the current ctx. Returns
  // the array of MISSIONS entries that transitioned to completed THIS call
  // (usually empty) so main.js can fire exactly one overlay event per mission,
  // exactly once ever (persisted completions are skipped up front, and a
  // completed id is never re-checked again — "does NOT re-fire" contract).
  update(ctx) {
    const justCompleted = [];
    for (const m of MISSIONS) {
      if (this.completed.has(m.id)) continue;
      let done;
      if (m.stateful) {
        const { state, completed } = stepJupiterFlyby(ctx, this._jupiterState);
        this._jupiterState = state;
        done = completed;
      } else if (m.id === 'mars-circular-orbit') {
        done = checkMarsCircularOrbit(ctx);
      } else {
        done = checkMoonLanding(ctx);
      }
      if (done) {
        this.completed.add(m.id);
        justCompleted.push(m);
      }
    }
    if (justCompleted.length) {
      saveCompleted(this.completed);
      if (this.open) this._render();
    }
    return justCompleted;
  }

  _render() {
    const t = this._t;
    this.panel.innerHTML = '';
    const title = document.createElement('div');
    title.style.cssText = 'color:#eaffff; font-weight:600; letter-spacing:0.04em; margin-bottom:6px;';
    title.textContent = t('mission.panel.title');
    this.panel.appendChild(title);

    for (const m of MISSIONS) {
      const done = this.completed.has(m.id);
      const row = document.createElement('div');
      row.style.cssText = 'padding:6px 2px; border-bottom:1px solid var(--line);';
      const head = document.createElement('div');
      head.style.cssText = `display:flex; justify-content:space-between; gap:10px; color:${done ? '#7CFC8A' : 'var(--fg)'};`;
      head.innerHTML = `<b>${t(m.titleKey)}</b><span>${done ? t('mission.status.done') : t('mission.status.pending')}</span>`;
      row.appendChild(head);
      const desc = document.createElement('div');
      desc.style.cssText = 'color:var(--dim); margin-top:2px;';
      desc.textContent = t(m.descKey);
      row.appendChild(desc);
      this.panel.appendChild(row);
    }

    const hint = document.createElement('div');
    hint.style.cssText = 'color:var(--dim); margin-top:8px; font-size:11px;';
    hint.textContent = t('mission.hint');
    this.panel.appendChild(hint);
  }
}

// ---- localStorage persistence ----------------------------------------------
function loadCompleted() {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    const arr = s == null ? [] : JSON.parse(s);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }   // corrupt/disabled storage -> start fresh, never throw
}
function saveCompleted(set) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...set])); } catch { /* storage disabled */ }
}
