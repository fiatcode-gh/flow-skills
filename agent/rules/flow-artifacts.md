---
name: flow-artifacts
description: Always-on home and lifecycle for Flow working state inside the project; the `.flow/` layout, the git exclude guard, shared-ledger tracking, artifact handoff to other checkouts, and cleanup at integration.
alwaysApply: true
---

# Flow artifacts

Flow working state lives inside the project at `.flow/`, hidden from git through the repository's personal exclude file. Flow writes nowhere else in the working tree. The only tracked Flow writes are shared-mode LDD ledgers and audit reports the user asked for under `docs/reports/`.

## Layout

```text
.flow/
  contracts/<slug>.md                 flow-design governing contract (non-LDD)
  plans/<slug>/PLAN.md, plan-tasks/   flow-planning execution-grade plan (non-LDD)
  ldd/<epic>/                         flow-ldd ledger, resume and units (local or shared mode)
  checkpoints/<head>.md               recovery checkpoint before device/manual/external acceptance
  evidence/<head>/<capsule-id>/       flow-evidence-verifier artifacts
  mailbox/<channel>/                  flow-external-session mailbox channels
```

Every artifact names the head it was derived from, so freshness is checked rather than remembered.

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

## Shared-mode LDD ledgers

`.flow/ldd/<epic>/` is the same path in both LDD modes. Local mode is hidden by the guard and never tracked. Shared mode tracks the ledger: add each new ledger file once with `git add -f`; git then shows changes to it normally. At every checkpoint in shared mode this command must print nothing:

```sh
git ls-files --others --ignored --exclude-standard .flow/ldd/<epic>
```

Anything it prints is a ledger file the team cannot see. Force-add it before continuing.

## Other checkouts and workers

A worker in another checkout, worktree or isolated workspace does not see this checkout's `.flow/`. Hand it artifacts by absolute path into the originating checkout. Do not paste plans into prompts to work around this.

## Lifecycle

`flow-integrating` removes the integrated slug's contract, plan, checkpoints and evidence after integration is confirmed and reports what it removed. It never touches a tracked ledger. Content under `.flow/` is Flow working state, not the user-owned working-tree state that `flow-safety` protects; still, delete only what the lifecycle names.
