#!/usr/bin/env sh
# Exercises the flow_approve / flow_check functions the Claude Code and
# OpenCode ports define in their instructions, extracted from each file.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

for doc in claude-code/hooks/flow-context.md opencode/AGENTS.md; do
  tmp=$(mktemp -d)
  sed -n '/^flow_approve() {/,/^}/p;/^flow_check() {/,/^}/p' "$ROOT/$doc" >"$tmp/functions.sh"
  (
    cd "$tmp"
    . ./functions.sh
    log=.flow/runtime/approvals.log

    # A missing artifact is never approved, so no empty-hash line is written.
    if flow_approve s accept missing.md 2>/dev/null; then fail "$doc: approved a missing file"; fi
    [ ! -s "$log" ] || fail "$doc: wrote an approval line for a missing file"

    printf 'v1\n' >c.md
    flow_approve aXb contract c.md
    [ "$(flow_check aXb contract c.md)" = ok ] || fail "$doc: current approval not ok"

    # Scope and kind match exactly, not as patterns.
    out=$(flow_check a.b contract c.md || true)
    [ "$out" = missing ] || fail "$doc: scope a.b matched an approval for aXb ($out)"
    out=$(flow_check aXb 'contr.*' c.md || true)
    [ "$out" = missing ] || fail "$doc: kind pattern matched ($out)"

    printf 'v2\n' >c.md
    out=$(flow_check aXb contract c.md || true)
    [ "$out" = stale ] || fail "$doc: edited artifact not stale ($out)"

    rm c.md
    out=$(flow_check aXb contract c.md || true)
    [ "$out" = missing ] || fail "$doc: deleted artifact not missing ($out)"
  )
  rm -rf "$tmp"
done
printf '%s\n' 'ok: approval record functions'
