// Shared assertion helpers for the physics test suite. NOT a *.test.mjs file,
// so tests/run.sh ignores it (it only globs tests/*.test.mjs).
import assert from 'node:assert/strict';

export function approxAbs(actual, expected, tol, msg = '') {
  const d = Math.abs(actual - expected);
  assert.ok(d <= tol, `${msg}: |${actual} - ${expected}| = ${d} > ${tol}`);
}

export function approxRel(actual, expected, rel, msg = '') {
  const denom = Math.abs(expected) || 1;
  const r = Math.abs(actual - expected) / denom;
  assert.ok(r <= rel, `${msg}: rel err ${r} > ${rel} (actual=${actual}, expected=${expected})`);
}

// Smallest angular distance on the circle (handles the 0/2π wrap boundary).
export function angDist(a, b) {
  const d = Math.abs(a - b) % (2 * Math.PI);
  return Math.min(d, 2 * Math.PI - d);
}
