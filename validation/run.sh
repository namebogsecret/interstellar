#!/usr/bin/env bash
# One-command relativity validation. Usage (from repo root):
#   bash validation/run.sh            # run all cases, rewrite validation/results/*
#   bash validation/run.sh --check    # compare with committed results (drift detector)
# Exit 1 if any case exceeds its tolerance (or, with --check, if results drifted).
set -u
cd "$(dirname "$0")/.."
LOADER="file://$PWD/tests/three-loader.mjs"
exec node --no-warnings --loader "$LOADER" validation/validate.mjs "$@"
