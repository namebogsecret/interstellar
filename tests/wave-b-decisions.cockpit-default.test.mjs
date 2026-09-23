// Q1 — COCKPIT_DEFAULT_ON contract (js/main.js, ~line next to AP_SLEW_RATE).
// See РЕШЕНИЕ-ВОЛНА-B.md: should the cockpit overlay ship ON by default
// (currently OFF)? The ТЗ wants this answerable by flipping ONE constant,
// with the persisted `iss_cockpit` localStorage toggle still outranking it
// (a player who already pressed I keeps their choice across a default flip).
//
// js/main.js cannot be `import`ed under Node: it is a browser-only monolith
// that touches `document`/`canvas`/WebGL at module top level and exports
// nothing (confirmed by grep — zero `export` statements). This is a pre-
// existing structural fact, not something introduced here, and the SAME
// constraint blocks a direct unit test of Q3/AP_ATTITUDE_AUTOFOLLOW in the
// same file (see ГРАБЛИ.md and wave-b-decisions.ap-autofollow.test.mjs).
// Rewriting main.js into an importable/testable shape is a real refactor —
// out of scope here (the ТЗ explicitly forbids touching architecture).
//
// What IS checked, without executing main.js:
//  (A) a structural read of the real source text — the constant's current
//      shipped value, and that the cockpit-init line assigns the constant
//      BEFORE letting a persisted boolean override it — so a future edit
//      that silently drops the persisted-toggle priority, or ships a
//      different default without anyone noticing, breaks this test;
//  (B) the GENERAL resolution rule that exact init line encodes
//      (`sim.x = DEFAULT; const p = loadToggle(k); if (typeof p ===
//      'boolean') sim.x = p;`), exercised as a tiny pure function across
//      many default/persisted combinations. This is parametrised over the
//      default value — it is the algorithm's shape being tested, not a
//      hardcoded copy of the literal `false`.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mainPath = path.join(here, '..', 'js', 'main.js');
const mainSrc = fs.readFileSync(mainPath, 'utf8');

// ---------------------------------------------------------------------
// (A) structural: constant exists as a plain boolean literal, and the
// cockpit-init site resolves it in the documented order.
// ---------------------------------------------------------------------
assert.equal((mainSrc.match(/^export /m) || []).length, 0,
  'sanity check for this test\'s own premise: js/main.js must have no exports (if this ever changes, replace this test with a real import-based one)');

const constMatch = mainSrc.match(/const COCKPIT_DEFAULT_ON = (true|false);/);
assert.ok(constMatch, 'COCKPIT_DEFAULT_ON must exist as a plain boolean const in js/main.js');
const shippedDefault = constMatch[1] === 'true';
assert.equal(shippedDefault, false,
  'current shipped default is cockpit OFF — flipping this assertion IS the one-constant Q1 decision, not a code change');

const initMatch = mainSrc.match(
  /sim\.cockpitOn = COCKPIT_DEFAULT_ON;\s*\n\s*const co = loadToggle\('iss_cockpit'\); if \(typeof co === 'boolean'\) sim\.cockpitOn = co;/
);
assert.ok(initMatch,
  'cockpit init must assign COCKPIT_DEFAULT_ON first, then let a persisted iss_cockpit boolean override it (persist outranks the default)');

// ---------------------------------------------------------------------
// (B) behavioural: the exact resolution algorithm used at that site,
// parametrised over the default — not a hardcoded copy of `false`.
// ---------------------------------------------------------------------
function resolveToggle(defaultValue, persisted) {
  let v = defaultValue;
  if (typeof persisted === 'boolean') v = persisted;
  return v;
}

for (const def of [false, true]) {
  // Scenario 1 asked for by the ТЗ: empty/cleared storage (loadToggle
  // returns undefined) -> the default wins, whatever it is.
  assert.equal(resolveToggle(def, undefined), def,
    `empty storage must resolve to the default (default=${def})`);

  // Scenario 2: the semantics of constant->default switching — a persisted
  // boolean always overrides the default, in BOTH directions, so flipping
  // COCKPIT_DEFAULT_ON never fights a player's own saved choice.
  assert.equal(resolveToggle(def, true), true, `persisted true must win over default=${def}`);
  assert.equal(resolveToggle(def, false), false, `persisted false must win over default=${def}`);

  // Corrupt/foreign storage content (not a boolean) must NOT override —
  // mirrors main.js's `typeof co === 'boolean'` guard exactly.
  for (const junk of [null, 'yes', 0, 1, {}]) {
    assert.equal(resolveToggle(def, junk), def,
      `non-boolean persisted value ${JSON.stringify(junk)} must not override default=${def}`);
  }
}

// The exact scenario named in the ТЗ: the REAL shipped default (read from
// source in part A, not re-typed here) with empty storage must resolve OFF.
assert.equal(resolveToggle(shippedDefault, undefined), false,
  'with the real shipped COCKPIT_DEFAULT_ON and empty storage, cockpit must resolve to OFF');

console.log('wave-b-decisions.cockpit-default.test.mjs OK');
