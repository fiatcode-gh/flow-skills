---
name: flow-artifacts
description: Always-on home and lifecycle for Flow working state inside the project; the `.flow/` layout, the git exclude guard, decision records, frozen ledgers, artifact handoff to other checkouts, and cleanup at integration.
alwaysApply: true
---

# Flow artifacts

Flow working state lives inside the project at `.flow/`, hidden from git through the repository's personal exclude file. Flow writes nowhere else in the working tree, except two tracked kinds: decision records under `docs/decisions/` and audit reports the user asked for under `docs/reports/`.

## Layout

```text
.flow/
  contracts/<slug>.md                 flow-design governing contract
  plans/<slug>/PLAN.md, plan-tasks/   flow-planning execution-grade plan
  ldd/<epic>/                         frozen LDD ledger (read-only)
  checkpoints/<head>.md               recovery checkpoint before device/manual/external acceptance
  evidence/<head>/<capsule-id>/       flow-evidence-verifier artifacts
  mailbox/<channel>/                  flow-external-session mailbox channels
  runtime/gates.json                  flow-governance approval/acceptance bindings
```

Durable artifacts record the head they were derived from where applicable; runtime gate state records exact artifact digests and accepted repository identity, so freshness is checked rather than remembered.

## Exclude guard

Run this before the first write under `.flow/` in a checkout. The entry lives in the git common directory, so linked worktrees share it; a fresh clone does not carry it, so the guard runs per checkout, not once per project. It is idempotent, only appends, and is a no-op outside a git repository. Never edit `.gitignore` for this and never remove the entry.

<!-- flow-exclude-guard -->
```sh
flow_exclude_guard() {
  ex=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)/info/exclude || return 0
  grep -qxF '/.flow/' "$ex" 2>/dev/null && return 0
  mkdir -p "${ex%/*}" && printf '/.flow/\n' >>"$ex"
}
```
<!-- /flow-exclude-guard -->

## Frozen LDD ledgers

`.flow/ldd/<epic>/` ledgers from the retired `flow-ldd` skill are read-only history:

- A unit already in flight finishes through `flow-integrating` with its existing `<epic>/<unit>` gate scope. It writes no decision record.
- The next unit in that epic starts with the `flow-design` resume step.
- Do not distill a finished epic until work resumes in its area. Remove a tracked ledger only when the user asks.
- No rule edits or deletes a frozen ledger.

## Other checkouts and workers

A worker in another checkout, worktree or isolated workspace does not see this checkout's `.flow/`. Hand it artifacts by absolute path into the originating checkout. Do not paste plans into prompts to work around this.

## Lifecycle

`flow-integrating` clears the integrated scope's runtime gate state, then removes what `flow-integrating` section 5 names, after integration is confirmed, and reports what it removed. It never touches a frozen ledger. Content under `.flow/` is Flow working state, not the user-owned working-tree state that `flow-safety` protects; still, delete only what the lifecycle names.
