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
sh -n omp/bin/flow-omp
sh -n opencode/bin/flow-opencode
./tests/install.test.sh
./tests/opencode-install.test.sh
./tests/flow-exclude.test.sh
./tests/approval-record.test.sh
./tests/session-start.test.sh
# The PowerShell launchers and their tests run under pwsh on any OS; CI's Ubuntu has it.
if command -v pwsh >/dev/null 2>&1; then
  pwsh -NoProfile -File tests/ps-syntax.ps1
  pwsh -NoProfile -File tests/flow-omp.test.ps1
  pwsh -NoProfile -File tests/flow-opencode.test.ps1
else
  printf '%s\n' 'skip: pwsh not on PATH; PowerShell tests not run'
fi
printf '%s\n' 'ok: shell syntax'
