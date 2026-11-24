#!/usr/bin/env sh
# Exercises the flow_digest / flow_approve / flow_check functions the Claude
# Code port defines in its instructions, extracted from that file. The OpenCode
# port records through the flow_gate plugin tool instead;
# tests/opencode-flow-guard.test.mjs R1 proves the two read each other's lines.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

for doc in claude-code/hooks/flow-context.md; do
  tmp=$(mktemp -d)
  sed -n '/^flow_digest() {/,/^}/p;/^flow_approve() {/,/^}/p;/^flow_check() {/,/^}/p' "$ROOT/$doc" >"$tmp/functions.sh"
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

    # A plan is hashed through its last "## In-scope amendments" line; lines under it
    # are outside the digest. Only kind plan uses the rule.
    printf '# Plan\ntask 03: run tests\n## In-scope amendments\n' >p.md
    flow_approve s plan p.md
    printf '%s\n' '- task 03: fix the test command' >>p.md
    out=$(flow_check s plan p.md || true)
    [ "$out" = ok ] || fail "$doc: line under the amendments heading made the plan $out"

    printf '# Plan\ntask 03: run lint\n## In-scope amendments\n- task 03: fix the test command\n' >p.md
    out=$(flow_check s plan p.md || true)
    [ "$out" = stale ] || fail "$doc: edit above the amendments heading not stale ($out)"

    printf '# Contract\n## In-scope amendments\n' >k.md
    flow_approve s contract k.md
    printf '%s\n' '- a line' >>k.md
    out=$(flow_check s contract k.md || true)
    [ "$out" = stale ] || fail "$doc: contract used the amendments rule ($out)"

    printf '# Plan\ntask 01\n' >q.md
    flow_approve q plan q.md
    printf '## In-scope amendments\n- a line\n' >>q.md
    out=$(flow_check q plan q.md || true)
    [ "$out" = stale ] || fail "$doc: heading added after approval not stale ($out)"

    # A record logged before the rule (whole-file hash) stays ok while nothing
    # is written under the heading.
    printf '# Plan\ntask 01\n## In-scope amendments\n' >r.md
    printf 'old plan %s r.md\n' "$(sha256sum r.md | cut -d' ' -f1)" >>"$log"
    out=$(flow_check old plan r.md || true)
    [ "$out" = ok ] || fail "$doc: whole-file record of a bare-heading plan not ok ($out)"

    # The last heading line binds: an earlier one (quoted in a fence) stays inside
    # the digest, and a second heading under the first moves the boundary.
    printf '# Plan\n\n```text\n## In-scope amendments\n```\n\n- L1: polling\n\n## In-scope amendments\n' >f.md
    flow_approve f plan f.md
    sed 's/L1: polling/L1: push/' f.md >f.tmp && mv f.tmp f.md
    out=$(flow_check f plan f.md || true)
    [ "$out" = stale ] || fail "$doc: decision after an earlier heading line not stale ($out)"

    flow_approve f plan f.md
    printf '%s\n' '- task 03: fix the test command' >>f.md
    out=$(flow_check f plan f.md || true)
    [ "$out" = ok ] || fail "$doc: line under the last heading made the plan $out"

    printf '# Plan\ntask 01\n## In-scope amendments\n' >t.md
    flow_approve t plan t.md
    printf '## In-scope amendments\n- L1: push\n' >>t.md
    out=$(flow_check t plan t.md || true)
    [ "$out" = stale ] || fail "$doc: second heading under the first not stale ($out)"

    # A plan ending with the bare heading and no final newline hashes as the whole file.
    printf '# Plan\n## In-scope amendments' >u.md
    [ "$(flow_digest plan u.md)" = "$(sha256sum u.md | cut -d' ' -f1)" ] || fail "$doc: heading without a final newline changed the digest"
  )
  rm -rf "$tmp"
done
printf '%s\n' 'ok: approval record functions'
