#!/usr/bin/env bash
# Deterministic physics test gate. Runs every tests/*.test.mjs under the three
# loader; exits non-zero if any assertion throws. Usage: bash tests/run.sh
set -u
cd "$(dirname "$0")/.."
LOADER="file://$PWD/tests/three-loader.mjs"
fail=0
shopt -s nullglob
tests=(tests/*.test.mjs)
if [ ${#tests[@]} -eq 0 ]; then echo "no tests found"; exit 1; fi
for t in "${tests[@]}"; do
  echo "── $t"
  if node --no-warnings --loader "$LOADER" "$t"; then :; else fail=1; fi
done
if [ "$fail" -ne 0 ]; then echo "PHYSICS GATE: FAIL"; exit 1; fi
echo "PHYSICS GATE: PASS"
