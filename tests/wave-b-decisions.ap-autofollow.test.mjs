// Q3 — AP_ATTITUDE_AUTOFOLLOW contract (js/main.js, ~line next to AP_SLEW_RATE).
// See РЕШЕНИЕ-ВОЛНА-B.md: while the autopilot is flying a manoeuvre, should it
// keep turning the ship's nose (and, since the camera rides ship.quat every
// frame, the camera with it) toward the thrust vector, or hold the player's
// current view static? The ТЗ wants this answerable with ONE constant flip
// that gates exactly the cosmetic slew block — never the thrust itself.
//
// ⚠️ KNOWN LIMITATION (see ГРАБЛИ.md "js/main.js is not unit-testable"): the
// slew block lives inside js/main.js's per-frame render loop, and js/main.js
// is a browser-only monolith — it touches `document`/`canvas`/WebGL at module
// top level and exports nothing, so it cannot be `import`ed under Node. There
// is NO pre-existing test of `ship.quat.rotateTowards`/AP_SLEW_RATE at all
// (confirmed by grep across tests/*.test.mjs before this file was added) —
// this is a genuine, pre-existing gap, not one this change introduces, and
// closing it for real needs pulling the per-frame update into a pure,
// importable function — an architecture change explicitly out of scope for
// this work item. This test therefore does NOT claim to exercise the runtime
// behaviour with AP_ATTITUDE_AUTOFOLLOW=false; seeing it pass is not evidence
// the ship stops turning. It only pins the source-level contract so a future
// edit can't silently drop the flag from the condition or flip its default.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mainPath = path.join(here, '..', 'js', 'main.js');
const mainSrc = fs.readFileSync(mainPath, 'utf8');

const constMatch = mainSrc.match(/const AP_ATTITUDE_AUTOFOLLOW = (true|false);/);
assert.ok(constMatch, 'AP_ATTITUDE_AUTOFOLLOW must exist as a plain boolean const in js/main.js');
const shippedDefault = constMatch[1] === 'true';
assert.equal(shippedDefault, true,
  'current shipped default is autofollow ON (unchanged behaviour) — flipping this assertion IS the one-constant Q3 decision, not a code change');

// The slew block's guard must gate on the flag FIRST (short-circuits before
// touching tdirAuto/ship.quat at all when false), and must NOT have grown a
// second, independent condition that could disagree with it.
const guardMatch = mainSrc.match(
  /if \(AP_ATTITUDE_AUTOFOLLOW && tdirAuto && AP_SLEW_RATE > 0\) \{/
);
assert.ok(guardMatch,
  'the cosmetic attitude-slew block must be gated by `AP_ATTITUDE_AUTOFOLLOW && tdirAuto && AP_SLEW_RATE > 0`');

// AP_ATTITUDE_AUTOFOLLOW must gate ONLY that one slew block — thrust
// direction / throttle must be computed unconditionally before it (a wrong
// deviation here would make the "cosmetic only" claim false: the manoeuvre
// itself must not depend on this flag).
const slewIdx = mainSrc.indexOf('if (AP_ATTITUDE_AUTOFOLLOW && tdirAuto && AP_SLEW_RATE > 0) {');
const thrustDirIdx = mainSrc.indexOf('let tdir = tdirAuto ?? thrustDir;');
assert.ok(slewIdx > -1 && thrustDirIdx > -1 && thrustDirIdx < slewIdx,
  'thrust direction (tdir) must be resolved BEFORE the autofollow-gated slew block, so thrust never depends on AP_ATTITUDE_AUTOFOLLOW');

console.log('wave-b-decisions.ap-autofollow.test.mjs OK (source-contract only — see file header for the untestable-runtime-behaviour limitation)');
