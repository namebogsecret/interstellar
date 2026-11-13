// Verification-report drift guard. The public physics-verification report must
// not lie about the size of the test suite or reference files that don't exist.
//   C1 N = count of tests/*.test.mjs (same glob as tests/run.sh)
//   C2 every "<n>-file / <n> files / <n> test files / <n> файлов / <n> тест-файлов"
//      claim in README.md, PHYSICS-VERIFICATION.md, physics-verification.html == N
//      (the two report docs must contain >=1 such claim)
//   C3 every tests/<name>.(test.mjs|mjs|py) path cited in the report docs exists
//   C4 physics-gate.yaml: each INV id is cited in both report docs; each tests/
//      path in its cmd: lines exists
//   C5 sitemap.xml lists physics-verification.html
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const stripTags = (s) => s.replace(/<[^>]*>/g, '');

const N = fs.readdirSync(path.join(ROOT, 'tests')).filter((f) => f.endsWith('.test.mjs')).length;
assert.ok(N > 0, 'C1: no tests/*.test.mjs found');

const REPORTS = ['PHYSICS-VERIFICATION.md', 'physics-verification.html'];
const CLAIM_FILES = ['README.md', ...REPORTS];
const texts = Object.fromEntries(CLAIM_FILES.map((f) => [f, read(f)]));
const plain = (f) => stripTags(texts[f]);

const errors = [];
const ok = (name) => console.log(`  ok   ${name}`);
const bad = (name, msgs) => {
  console.log(`  FAIL ${name}`);
  for (const m of msgs) console.log(`       - ${m}`);
  errors.push(name);
};

// ── C2
{
  const msgs = [];
  for (const f of CLAIM_FILES) {
    const t = plain(f);
    const found = [];
    for (const m of t.matchAll(/\b(\d+)[- ](?:test[- ])?files?\b/gi)) found.push(+m[1]);
    for (const m of t.matchAll(/(\d+)\s*(?:тест-)?файл(?:ов|а)?/g)) found.push(+m[1]);
    if (REPORTS.includes(f) && found.length === 0) {
      msgs.push(`${f}: no test-file-count claim found (expected at least one equal to ${N})`);
    }
    for (const n of found) {
      if (n !== N) msgs.push(`${f}: claims ${n} test files, expected N=${N} (tests/*.test.mjs)`);
    }
  }
  msgs.length ? bad('C2 test-file counts match tests/*.test.mjs', msgs) : ok(`C2 test-file counts == ${N}`);
}

// ── C3
{
  const msgs = [];
  const re = /tests\/[A-Za-z0-9_.-]+?\.(?:test\.mjs|mjs|py)\b/g;
  for (const f of REPORTS) {
    for (const p of new Set(plain(f).match(re) || [])) {
      if (!fs.existsSync(path.join(ROOT, p))) msgs.push(`${f}: cites missing file ${p}`);
    }
  }
  msgs.length ? bad('C3 cited test paths exist', msgs) : ok('C3 cited test paths exist');
}

// ── C4
{
  const msgs = [];
  const yaml = read('physics-gate.yaml');
  const ids = [...yaml.matchAll(/^\s*-?\s*id:\s*(INV-[A-Za-z0-9_-]+)/gm)].map((m) => m[1]);
  if (ids.length === 0) msgs.push('physics-gate.yaml: no `id: INV-...` entries parsed');
  for (const id of ids) {
    for (const f of REPORTS) {
      if (!plain(f).includes(id)) msgs.push(`${f}: does not mention ${id}`);
    }
  }
  for (const line of yaml.split('\n').filter((l) => /^\s*cmd:/.test(l))) {
    for (const p of line.match(/tests\/[A-Za-z0-9_.-]+/g) || []) {
      if (!fs.existsSync(path.join(ROOT, p))) msgs.push(`physics-gate.yaml: cmd cites missing file ${p}`);
    }
  }
  msgs.length ? bad('C4 physics-gate.yaml ids/paths consistent', msgs) : ok(`C4 gate ids (${ids.join(', ')}) cited + cmd paths exist`);
}

// ── C5
{
  const sm = read('sitemap.xml');
  sm.includes('physics-verification.html')
    ? ok('C5 sitemap lists physics-verification.html')
    : bad('C5 sitemap lists physics-verification.html', ['sitemap.xml: physics-verification.html not found']);
}

if (errors.length) {
  console.error(`verification-report FAIL: ${errors.join('; ')}`);
  process.exit(1);
}
console.log('verification-report OK');
