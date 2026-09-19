#!/usr/bin/env sh
# Executes the exclude guard exactly as published in agent/rules/flow-artifacts.md
# and proves the git behaviors the flow-artifacts rule relies on.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT HUP INT TERM
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

awk '/<!-- flow-exclude-guard -->/{on=1;next} /<!-- \/flow-exclude-guard -->/{on=0} on && !/^```/' \
  "$ROOT/agent/rules/flow-artifacts.md" > "$TMP/guard.sh"
[ -s "$TMP/guard.sh" ] || fail 'guard snippet not found between markers'
sh -n "$TMP/guard.sh"
. "$TMP/guard.sh"
G="git -c user.email=t@t -c user.name=t"

# Outside a repository: no-op, no output, nothing created.
mkdir "$TMP/plain"; cd "$TMP/plain"
out=$(flow_exclude_guard 2>&1) || fail 'guard must exit 0 outside a repository'
[ -z "$out" ] || fail "guard printed outside a repository: $out"
[ -z "$(find "$TMP/plain" -mindepth 1)" ] || fail 'guard created files outside a repository'

# Plain repository: hidden .flow, idempotent entry, works from a subdirectory.
git init -q "$TMP/main"; cd "$TMP/main"; $G commit -q --allow-empty -m init
mkdir -p src; cd src; flow_exclude_guard; cd ..; flow_exclude_guard
[ "$(grep -c '^/\.flow/$' .git/info/exclude)" = 1 ] || fail 'exclude entry must appear exactly once'
mkdir -p .flow/contracts .flow/ldd/e1/units; echo c > .flow/contracts/x.md; echo L > .flow/ldd/e1/LEDGER.md
[ -z "$(git status --porcelain)" ] || fail 'populated .flow must not appear in git status'

# Shared-mode ledger: force-added file tracks normally; leak check names hidden siblings.
git add -f .flow/ldd/e1/LEDGER.md; $G commit -qm ledger
echo L2 >> .flow/ldd/e1/LEDGER.md; echo U > .flow/ldd/e1/units/u1.md
[ "$(git status --porcelain)" = ' M .flow/ldd/e1/LEDGER.md' ] || fail 'tracked ledger edit must show as modified'
[ "$(git ls-files --others --ignored --exclude-standard .flow/ldd/e1)" = '.flow/ldd/e1/units/u1.md' ] || fail 'leak check must list the hidden ledger file'
git add -f .flow/ldd/e1/units/u1.md
[ -z "$(git ls-files --others --ignored --exclude-standard .flow/ldd/e1)" ] || fail 'leak check must be empty after force-add'

# Linked worktree: inherits the exclude, owns its own .flow contents.
git worktree add -q "$TMP/wt" -b feat; cd "$TMP/wt"
mkdir -p .flow/plans; echo p > .flow/plans/PLAN.md
[ -z "$(git status --porcelain)" ] || fail 'worktree must inherit the exclude'
[ ! -e .flow/contracts/x.md ] || fail 'worktree must not see the main checkout contract'
[ -e .flow/ldd/e1/LEDGER.md ] || fail 'tracked ledger must be present in the worktree'

# Fresh clone: not hidden until the guard runs there.
git clone -q "$TMP/main" "$TMP/clone" 2>/dev/null; cd "$TMP/clone"
mkdir -p .flow; echo z > .flow/z
[ "$(git status --porcelain)" = '?? .flow/z' ] || fail 'clone must expose .flow before the guard runs'
flow_exclude_guard
[ -z "$(git status --porcelain)" ] || fail 'clone must hide .flow after the guard runs'

echo 'ok: flow exclude guard'
