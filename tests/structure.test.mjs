// STRUCTURAL FITNESS FUNCTIONS (ТЗ §9). Not a behaviour test: these read the
// SOURCE as text and assert properties no runtime assertion can see — layering,
// single-source-of-truth, "the decision lives where the contract says it does".
// They are the machine memory of ГРАБЛИ #1/#2/#3, which are all failures of
// STRUCTURE (a second copy, a second condition, a half-finished migration), not
// of arithmetic.
//
// Comments are STRIPPED before matching. A fitness function that fires on prose
// about itself (this file's own docs, or a header explaining the rule) is a
// fitness function people learn to ignore — and the thing being guarded here is
// code, never prose.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// Strip /* … */ and // … so only executable text is matched. Crude on purpose:
// it may also blank a `//` inside a string literal, which would only ever make
// this check MORE permissive, never produce a false alarm.
function code(rel) {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n');
}

function jsFiles(dir) {
  const abs = path.join(ROOT, dir);
  return fs.readdirSync(abs)
    .filter((f) => f.endsWith('.js'))
    .map((f) => path.posix.join(dir, f));
}
const ALL_JS = [...jsFiles('js'), ...jsFiles('js/physics'), ...jsFiles('js/render'), ...jsFiles('js/data')];

function hits(rel, re) {
  const out = [];
  code(rel).split('\n').forEach((line, i) => {
    const m = line.match(re);
    if (m) out.push(`${rel}:${i + 1}: ${line.trim()}`);
  });
  return out;
}
function hitsAll(files, re) { return files.flatMap((f) => hits(f, re)); }

// ── 1. The autopilot core is PURE ────────────────────────────────────────────
// No DOM, no WebGL, no host clock, no randomness. This is what keeps it under
// the node gate at all, and what makes ТЗ §7's determinism test meaningful:
// two identical runs in one process must produce byte-identical states.
{
  const bad = hits('js/physics/autopilot.js',
    /document\.|window\.|localStorage|requestAnimationFrame|Date\.now|Math\.random/);
  assert.equal(bad.length, 0, `autopilot.js must stay pure (no DOM/clock/randomness):\n${bad.join('\n')}`);
}

// ── 2. The core never writes simulation state ────────────────────────────────
// It returns a command; main.js applies it. A physics module that writes
// straight into ship state is ГРАБЛИ 2026-08-14 (NaN into ship.v).
{
  const bad = hits('js/physics/autopilot.js', /ship\.[a-zA-Z]+\s*=[^=]/);
  assert.equal(bad.length, 0, `autopilot.js must not assign ship state:\n${bad.join('\n')}`);
}

// ── 3. No acos as a direction metric ─────────────────────────────────────────
// acos(dot) has a ~1.5e-8 rad numerical floor (ГРАБЛИ, last entry) — measure
// direction agreement with atan2(|a×b|, a·b) instead.
{
  const bad = hits('js/physics/autopilot.js', /Math\.acos/);
  assert.equal(bad.length, 0, `autopilot.js must not use Math.acos:\n${bad.join('\n')}`);
}

// ── 4. Autopilot DECISIONS did not leak out of the core ──────────────────────
// main.js and the render layer only feed observations in and apply the command
// out. Touching the phase/reason enums outside the core means a second place
// started deciding "time to burn" / "refuse" / "cancelled".
{
  const outside = ALL_JS.filter((f) => f !== 'js/physics/autopilot.js');
  const bad = hitsAll(outside, /PHASES\.|REASONS\./);
  assert.equal(bad.length, 0, `autopilot phase/reason enums used outside the core:\n${bad.join('\n')}`);
}

// ── 5. Pilot-override reporting has exactly three writers, all in input code ──
// N reporters → ONE counter → ONE condition → ONE reader. A new input channel
// that misses the counter leaves the pilot silently fighting the autopilot
// (ГРАБЛИ #3: a partial migration behind a guard drops elements quietly).
{
  const calls = hitsAll(ALL_JS, /_noteInput\(\)/);
  assert.equal(calls.length, 4,
    `expected exactly 4 _noteInput() lines (1 definition + 3 reporters), got ${calls.length}:\n${calls.join('\n')}`);
  const wrongFile = calls.filter((c) => !c.startsWith('js/render/controls.js') && !c.startsWith('js/render/touch.js'));
  assert.equal(wrongFile.length, 0, `_noteInput() may only live in controls.js/touch.js:\n${wrongFile.join('\n')}`);
  assert.equal(hits('js/render/controls.js', /_noteInput\(\)/).length, 3, 'controls.js: 1 definition + 2 reporters');
  assert.equal(hits('js/render/touch.js', /_noteInput\(\)/).length, 1, 'touch.js: the tap-button reporter');

  // The counter itself is read/written only by the input layer, the core, and
  // the one call site that hands it over.
  const allowed = new Set(['js/render/controls.js', 'js/physics/autopilot.js', 'js/main.js']);
  const leaks = hitsAll(ALL_JS.filter((f) => !allowed.has(f)), /inputSeq/);
  assert.equal(leaks.length, 0, `inputSeq referenced outside controls/autopilot/main:\n${leaks.join('\n')}`);
}

// ── 6. The orbits.js migration went all the way ──────────────────────────────
// Half a migration is a ReferenceError at runtime that the node gate never runs
// into (ГРАБЛИ 2026-07-06: a signature change left two call sites behind and the
// gate stayed green while the browser died every frame).
{
  const stale = hitsAll(ALL_JS, /\brSafe\b/);
  assert.equal(stale.length, 0, `rSafe was renamed to safeRadius — leftovers:\n${stale.join('\n')}`);

  for (const fn of ['safeRadius', 'dominanceRatio', 'timeToPeriapsis', 'timeToApoapsis']) {
    const defs = hitsAll(ALL_JS, new RegExp(`function\\s+${fn}\\b`));
    assert.equal(defs.length, 1, `${fn} must be defined exactly once, found:\n${defs.join('\n')}`);
    assert.ok(defs[0].startsWith('js/physics/orbits.js'), `${fn} must live in orbits.js, found ${defs[0]}`);
  }
  // …and cabotage.js must really be importing them, not keeping private copies.
  const cab = code('js/physics/cabotage.js');
  const imported = (cab.match(/import\s*\{([\s\S]*?)\}\s*from\s*'\.\/orbits\.js'/) || [, ''])[1]
    .split(',').map((s) => s.trim()).filter(Boolean);
  for (const fn of ['safeRadius', 'dominanceRatio', 'timeToPeriapsis']) {
    assert.ok(imported.includes(fn),
      `cabotage.js must import ${fn} from orbits.js (imports: ${imported.join(', ') || 'none'})`);
    assert.ok(cab.includes(`${fn}(`), `cabotage.js must still call ${fn}`);
  }
}

// ── 7. The crop invariant (ADR-2 / ГРАБЛИ #2) is untouched ───────────────────
// renderPass.camera and the pass enables are assigned in exactly one place.
{
  const bad = hitsAll(ALL_JS.filter((f) => f !== 'js/render/scene.js'),
    /renderPass\.camera\s*=[^=]|relPass\.enabled\s*=[^=]|cubePass\.enabled\s*=[^=]/);
  assert.equal(bad.length, 0, `render-path wiring assigned outside scene.js:\n${bad.join('\n')}`);
}

// ── 8. Every i18n key the autopilot can name exists in BOTH dictionaries ──────
// The classic failure is "added to en, forgot ru": silently shows English to a
// Russian player, and no behaviour test can see it. Checked as TEXT because the
// dictionaries are one module-level object and t() falls back to en by design.
{
  const src = read('js/i18n.js');
  const keys = [
    'hud.autopilot',
    ...['idle', 'wait', 'burn', 'trim', 'done', 'cancelled', 'refused', 'failed'].map((p) => `ap.phase.${p}`),
    ...['landed', 'no-body', 'relativistic', 'atmosphere', 'perturbed', 'unbound',
        'target-unreachable', 'no-fuel', 'ref-changed', 'no-convergence', 'timeout'].map((r) => `ap.reason.${r}`),
    'ap.goal.circular', 'ap.goal.hohmann',
    'ev.apEngaged', 'ev.apDone', 'ev.apCancelled', 'ev.apRefused', 'ev.apFailed',
  ];
  for (const k of keys) {
    const n = src.split(`'${k}'`).length - 1;
    assert.equal(n, 2, `i18n key '${k}' must appear exactly twice (en + ru), found ${n}`);
  }
  // The feature has to be discoverable, or it does not exist (ADR-3).
  assert.equal(src.split('>N<').length - 1 + src.split('<b>N</b>').length - 1 >= 2, true,
    'the N key must be documented in help.html / start.controls of BOTH languages');
}

// NOTE — ТЗ §9 check 8 ("e >= 1 is nowhere a bound/unbound classifier") is NOT
// implemented here on purpose: its last remaining occurrence is js/missions.js,
// which belongs to work item B4 in another worktree. The fitness function
// guarding B4's invariant belongs with B4; adding it here would either go red on
// this branch or need a silent exclusion for the very file it is supposed to
// guard. Flagged to dev-lead for B4.

console.log('structure.test.mjs OK');
