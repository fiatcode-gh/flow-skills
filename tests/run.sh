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
node --no-warnings tests/bash-patterns.test.mjs
sh -n scripts/omp-stack
./tests/install.test.sh
./tests/flow-exclude.test.sh
printf '%s\n' 'ok: shell syntax'
