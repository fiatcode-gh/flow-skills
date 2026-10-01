#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

uv run --with pyyaml python tests/validate.py
uv run python tests/planning-handoff.test.py
uv run python tests/flow-sessions.test.py
node --no-warnings --experimental-strip-types tests/ai-memory.test.mjs
node --no-warnings --experimental-strip-types tests/flow-evidence-guard.test.mjs
node --no-warnings --experimental-strip-types tests/flow-governance-guard.test.mjs
# OMP loads the extensions under Bun, so run them there too when it is available.
if command -v bun >/dev/null 2>&1; then
  bun tests/ai-memory.test.mjs
  bun tests/flow-evidence-guard.test.mjs
  bun tests/flow-governance-guard.test.mjs
else
  printf '%s\n' 'skip: bun not on PATH; extension tests ran under Node only'
fi
node --no-warnings tests/bash-patterns.test.mjs
sh -n scripts/omp-stack
./tests/install.test.sh
./tests/flow-exclude.test.sh
printf '%s\n' 'ok: shell syntax'
