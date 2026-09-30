---
name: flow-safety
description: Always-on repository-state, workspace-lifecycle and external-effect safety rules.
alwaysApply: true
---

# Flow safety

Before mutating a repository, inspect the current branch/worktree and working-tree state.

- Treat pre-existing changes as user-owned. Never silently discard, reset, stash, overwrite, relocate, or "clean up" them.
- Before any temporary test mutation/probe touches a pre-existing dirty file, snapshot its exact current content outside the target path. Restore from that snapshot, never from `HEAD`/checkout/reset, and verify byte-for-byte restoration before continuing.
- Do not put feature work directly on `main`/`master` unless the user explicitly chose that.
- A sole/sequential semantic owner on a suitable feature checkout should normally use that checkout directly so its session/work can remain resumable. This does not override fresh `flow-plan-executor` rotation for execution-grade plan tasks: planned tasks share the checkout/repository state, not executor-session continuity. Isolation is primarily for **independent concurrent writers** or an explicitly disposable experiment, not a generic safety wrapper.
- Independent concurrent writers should use OMP isolation when available. Dependent or overlapping writers stay sequential unless redesigned to be independent.
- Prefer preserving a useful non-isolated unit owner for follow-up/review corrections; completed isolated task workspaces are disposable and may not be revivable.
- Do not assume another agent/session's workspace is disposable or safe to mutate.
- User-owned external worktrees are never created, removed, force-switched, or repurposed without explicit instruction.
- Pushes, force-pushes, pull-request creation/update, review publication, reviewer requests, merges, releases, remote comments/messages, and other stakeholder-visible writes require explicit user approval for that action/round.
- A plan/execution approval authorizes the local code-writing and local verification needed to execute its agreed scope; it does not authorize external publication or integration.
- Never expose secrets in logs, reports, review comments, memory, or generated artifacts. Redact values; retain only the minimum location/type evidence needed.
