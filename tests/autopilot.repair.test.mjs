// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION CORPUS — repair round 2 (four defects found by adversarial review
// that the green gate did not catch). One block per defect, each written to be
// RED on the unfixed tree.
//
//   R2-1  an interplanetary Hohmann always ends FAILED(timeout): the manoeuvre
//         deadline was capped at an ABSOLUTE 1e6 s (11.6 days), which is shorter
//         than any heliocentric transfer.
//   R2-2  the TRIM phase is structurally inert — it is only ever entered from
//         the cutoff branch and commands zero thrust, so it spins out three
//         empty passes and reports FAILED(no-convergence). Root of the second
//         order: the burn cutoff and the tolerance were two INDEPENDENT numbers,
//         so below v_circ ≈ 40 m/s the cutoff is coarser than the tolerance and
//         DONE is unreachable by construction.
//   R2-3  ev.apEngaged is never emitted on a successful engage (the `announced`
//         flag is only read on terminal phases), and the one path that did emit
//         it announced "autopilot engaged" when it had actually MISSED a burn
//         point and was going round again.
//   R2-4  every keydown cancelled the manoeuvre, including keys that only open
//         a panel (V/T/J/H/P/M/O/L/B/C/U/I/Z). Taking the controls must cancel;
//         opening the map must not.
// ─────────────────────────────────────────────────────────────────────────────
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PHASES, engageAutopilot, autopilotStep,
  runClosedLoop, fixedSchedule, warpAwareSchedule, conicState, circularState,
  makeObs, MU_EARTH, BODIES,
} from './autopilot.harness.mjs';
import { isFlightKey, isFlightTouchAction } from '../js/render/controls.js';
import { E_TOL } from '../js/physics/autopilot.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MU_SUN = BODIES.find((b) => b.name === 'Sun').GM;
const AU = 1.495978707e11;
const R_MARS = BODIES.find((b) => b.name === 'Mars').a;

// Ideal Hohmann coast time between two circular radii (half the transfer ellipse).
const tof = (mu, r1, r2) => Math.PI * Math.sqrt(Math.pow(0.5 * (r1 + r2), 3) / mu);

// ═════════════════════════════════════════════════════════════════════════════
// R2-1 · the manoeuvre deadline must scale with the manoeuvre, not with a
//        constant. A timeout has to mean "this is not converging" — never
//        "this manoeuvre is long".
// ═════════════════════════════════════════════════════════════════════════════
{
  // (1a) INTERPLANETARY SCALE, stated directly: Earth → Mars is a 2.24e7 s
  // coast. A deadline shorter than the physically necessary coast makes the
  // manoeuvre impossible to complete no matter how correct the guidance is.
  const r1 = AU, rT = R_MARS;
  const tofMars = tof(MU_SUN, r1, rT);
  const st = circularState(MU_SUN, r1);
  const obs = makeObs(st.r, st.v, { mu: MU_SUN, safeRadius: 7.3e8, bodyRadius: 6.96e8 });
  const engaged = engageAutopilot({ kind: 'hohmann', bodyName: 'Sun', targetRadius: rT }, obs);
  assert.equal(engaged.phase, PHASES.WAIT,
    `(R2-1a) Earth→Mars must engage, got ${engaged.phase} (${engaged.reason})`);
  assert.ok(engaged.manoeuvreTimeout > tofMars,
    `(R2-1a) deadline ${engaged.manoeuvreTimeout} s is shorter than the transfer it just accepted ` +
    `(${tofMars} s) — the manoeuvre is impossible by construction`);

  // (1b) BEHAVIOURAL, at a heliocentric scale chosen so the whole run stays
  // cheap while the coast (1.79e6 s) still exceeds the old 1e6 s cap. Coarse
  // 600 s coast steps are 0.7 % of the dynamical time here, so the integration
  // stays honest.
  const rA = 1.0e10, rB = 6.0e10;
  const tofAB = tof(MU_SUN, rA, rB);
  assert.ok(tofAB > 1.2e6, `(R2-1b) fixture must exceed the old cap, tof=${tofAB}`);
  const s2 = circularState(MU_SUN, rA);
  const res = runClosedLoop({
    mu: MU_SUN, r0: s2.r, v0: s2.v,
    goal: { kind: 'hohmann', bodyName: 'Sun', targetRadius: rB },
    obsBase: { safeRadius: 7.3e8, bodyRadius: 6.96e8, refBodyName: 'Sun' },
    dtOf: warpAwareSchedule({ burnDt: 0.5, coastMax: 600, dtReal: 1 / 60 }),
    maxSteps: 60000, label: 'helio transfer',
  });
  assert.notEqual(res.state.reason, 'timeout',
    `(R2-1b) heliocentric transfer timed out at simTime=${res.simTime} s ` +
    `(coast alone needs ${tofAB} s) — the deadline is not scaling with the manoeuvre`);
  assert.equal(res.state.phase, PHASES.DONE,
    `(R2-1b) must finish DONE, got ${res.state.phase} (${res.state.reason})`);
  assert.ok(Math.abs(res.elements.a - rB) / rB <= 5e-3,
    `(R2-1b) a=${res.elements.a} vs target ${rB}`);
  assert.ok(res.elements.e <= 5e-3, `(R2-1b) e=${res.elements.e}`);
}

// ═════════════════════════════════════════════════════════════════════════════
// R2-2 · TRIM must either thrust and converge, or not exist. And DONE must be
//        REACHABLE wherever the autopilot agrees to work: a cutoff coarser than
//        the tolerance it is supposed to satisfy is a contradiction in the
//        contract, not a tuning question.
// ═════════════════════════════════════════════════════════════════════════════
{
  // v_circ here is ~36 m/s, where the old absolute cutoff (0.02 m/s) implies a
  // residual eccentricity of ~1.1e-3 — ABOVE the 1e-3 tolerance. No number of
  // trim passes can close that gap; the old code burned three inert passes and
  // reported FAILED(no-convergence).
  const rSlow = 1.0e17;
  const vCirc = Math.sqrt(MU_SUN / rSlow);
  assert.ok(vCirc < 40, `(R2-2) fixture must be in the slow regime, v_circ=${vCirc}`);
  assert.ok(2 * 0.02 / vCirc > E_TOL,
    '(R2-2) fixture must be a case where the OLD absolute cutoff cannot satisfy E_TOL');

  const st = conicState(MU_SUN, 0.05, rSlow);
  const res = runClosedLoop({
    mu: MU_SUN, r0: st.r, v0: st.v, goal: { kind: 'circularize', bodyName: 'Sun' },
    obsBase: { safeRadius: 7.3e8, bodyRadius: 6.96e8, refBodyName: 'Sun' },
    dtOf: fixedSchedule(0.05), maxSteps: 40000, label: 'slow circular',
  });
  assert.equal(res.state.phase, PHASES.DONE,
    `(R2-2) DONE must be reachable at v_circ=${vCirc.toFixed(1)} m/s, ` +
    `got ${res.state.phase} (${res.state.reason}) with e=${res.elements.e}`);
  assert.ok(res.elements.e <= E_TOL, `(R2-2) e=${res.elements.e} exceeds the tolerance it reported DONE on`);

  // If the phase exists in the log at all, it must do something: an inert phase
  // the HUD shows to the player is a defect of the contract by itself.
  const trims = res.log.filter((e) => e.phase === PHASES.TRIM);
  if (trims.length) {
    assert.ok(trims.some((e) => e.throttle > 0),
      `(R2-2) TRIM ran for ${trims.length} steps and never commanded thrust — the phase is inert`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// R2-3 · engagement must be announced when it happens; a missed burn point must
//        NOT be announced as an engagement.
// ═════════════════════════════════════════════════════════════════════════════
{
  const st = conicState(MU_EARTH, 0.3, 8.0e6);
  const res = runClosedLoop({
    mu: MU_EARTH, r0: st.r, v0: st.v, goal: { kind: 'circularize', bodyName: 'Earth' },
    dtOf: fixedSchedule(0.05), maxSteps: 40000, label: 'announce',
  });
  const events = res.log.map((e) => e.event).filter(Boolean);
  assert.ok(events.includes('ev.apEngaged'),
    `(R2-3) a successful engage never announced itself; events seen: ${JSON.stringify(events)}`);
  assert.equal(events.filter((e) => e === 'ev.apEngaged').length, 1,
    `(R2-3) engagement must be announced exactly once, got ${JSON.stringify(events)}`);
  assert.ok(events.includes('ev.apDone'), '(R2-3) completion must still be announced');
  // ordering: you are told it took the job before you are told it finished
  assert.ok(events.indexOf('ev.apEngaged') < events.indexOf('ev.apDone'),
    '(R2-3) engagement must be announced before completion');

  // A refusal announces the refusal and NOT an engagement.
  const bad = engageAutopilot({ kind: 'circularize', bodyName: 'Earth' },
    makeObs(st.r, st.v, { landed: true }));
  const out = autopilotStep(bad, makeObs(st.r, st.v, { landed: true }), 0, st.r.clone());
  assert.equal(out.event, 'ev.apRefused', `(R2-3) refusal must announce itself, got ${out.event}`);

  // The "missed the burn point, going round again" path must have its own key,
  // in both dictionaries — announcing it as an engagement is a lie to the player.
  const i18n = fs.readFileSync(path.join(ROOT, 'js/i18n.js'), 'utf8');
  assert.equal(i18n.split("'ev.apLap'").length - 1, 2,
    "(R2-3) 'ev.apLap' must exist in BOTH dictionaries (en + ru)");
  const ap = fs.readFileSync(path.join(ROOT, 'js/physics/autopilot.js'), 'utf8');
  const lapLine = ap.split('\n').find((l) => /lapped\s*\?/.test(l));
  assert.ok(lapLine && lapLine.includes('ev.apLap'),
    `(R2-3) the missed-apsis path must emit ev.apLap, not an engagement: ${lapLine}`);
}

// ═════════════════════════════════════════════════════════════════════════════
// R2-4 · TAKING THE CONTROLS cancels; OPENING A PANEL does not. One table, one
//        classifier — the counter and the cancel condition stay single.
// ═════════════════════════════════════════════════════════════════════════════
{
  // Flight input: translation, roll, look, discrete flight actions, throttle.
  const cancels = ['w', 's', 'a', 'd', 'r', 'f', ' ', 'q', 'e',   // translate + roll
                   'x', 'k', 'g', 'backspace',                     // discrete flight actions
                   'n',                                            // the autopilot key itself
                   '[', ']', '0', '1', '5', '9'];                  // manual throttle
  for (const k of cancels) {
    assert.equal(isFlightKey(k), true, `(R2-4) '${k}' takes the controls and must cancel`);
  }
  // Passive UI: panels, toggles, pause, and the two keys owned by B2/B3.
  const keeps = ['v', 't', 'j', 'h', 'p', 'm', 'o', 'l', 'b', 'c', 'u', 'i', 'z',
                 'tab', ',', '.'];
  for (const k of keeps) {
    assert.equal(isFlightKey(k), false, `(R2-4) '${k}' only opens/toggles UI and must NOT cancel`);
  }
  // An unmapped key is not a flight input either.
  for (const k of ['f1', 'shift', 'control', 'arrowup', 'y']) {
    assert.equal(isFlightKey(k), false, `(R2-4) unmapped '${k}' must not cancel a manoeuvre`);
  }
  // Touch taps obey the SAME classification.
  assert.equal(isFlightTouchAction('kill'), true, '(R2-4) touch STOP takes the controls');
  assert.equal(isFlightTouchAction('jump'), true, '(R2-4) touch jump takes the controls');
  for (const n of ['target', 'warpup', 'warpdn', 'help']) {
    assert.equal(isFlightTouchAction(n), false, `(R2-4) touch '${n}' must not cancel`);
  }

  // Fitness: the keydown reporter must be GUARDED by that table, not fire on
  // every key — a pure predicate nobody calls would pass every check above.
  const src = fs.readFileSync(path.join(ROOT, 'js/render/controls.js'), 'utf8');
  const code = src.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  const keydown = code.slice(code.indexOf("addEventListener('keydown'"), code.indexOf("addEventListener('keyup'"));
  assert.ok(/_noteInput\(\)/.test(keydown), '(R2-4) the keydown reporter must still exist');
  assert.ok(/isFlightKey\s*\(/.test(keydown),
    '(R2-4) the keydown reporter must consult the flight-input table');
  const touchSrc = fs.readFileSync(path.join(ROOT, 'js/render/touch.js'), 'utf8');
  assert.ok(/isFlightTouchAction\s*\(/.test(touchSrc),
    '(R2-4) the touch reporter must consult the SAME table');

  // Behavioural: a manoeuvre survives a passive keypress and dies on a flight
  // one. inputSeq is the only channel, so this is exercised through it.
  const st = conicState(MU_EARTH, 0.3, 8.0e6);
  const engaged = engageAutopilot({ kind: 'circularize', bodyName: 'Earth' }, makeObs(st.r, st.v));
  const seq0 = engaged.armedInputSeq;
  const dir = st.r.clone();
  const same = autopilotStep(engaged, makeObs(st.r, st.v, { inputSeq: seq0 }), 0.05, dir);
  assert.notEqual(same.phase, PHASES.CANCELLED,
    '(R2-4) an unchanged counter must not cancel (a passive key never bumps it)');
  const bumped = autopilotStep(engaged, makeObs(st.r, st.v, { inputSeq: seq0 + 1 }), 0.05, dir);
  assert.equal(bumped.phase, PHASES.CANCELLED,
    '(R2-4) a bumped counter must still cancel (a flight key bumps it)');
}

console.log('autopilot.repair.test.mjs OK');
