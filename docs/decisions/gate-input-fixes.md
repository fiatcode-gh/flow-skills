# Gate input fixes

From the 2026-10-08 field-trial audit (`docs/FIELD-TRIALS.md`). Two guard input errors cost a retry in nearly every planned session: `flow_gate present` with `contracts/<slug>.md` (18 sessions) and a `Flow gate:` block placed in the task tool's shared `context` (20 sessions). Work: `2967c29`, `2f2c4c0` on `fix/gate-input`.

## Decisions

- **Paths relative to `.flow/`.** A relative artifact path whose first segment is not `.flow` resolves under `.flow/`; `.flow/...` and absolute paths resolve as before. The first segment is read before normalizing, so `.flow/../x` stays a repository path and is refused. It applies to `present`, `status` and the manifest `Contract:`/`Plan:` lines, because they share one resolver. The first segment is split on `/` only: POSIX `resolve` treats `\` as part of a name.
- **Block in `context`.** OMP prepends the shared `context` to every child's assignment, so a block there is part of each brief. A task's own block wins; otherwise the `context` block is used. The block is taken whole from one place, never merged field by field, so a partial task block cannot borrow a plan from `context`.
- **Read text as the child gets it.** OMP repairs double-encoded `task`, `context` and `tasks[].task` text after the `tool_call` hook (`repairDoubleEncodedJsonString`, pi-tui `src/tools/task-repair-args.ts`, OMP 18.8.4). Without a mirror of that repair, a double-encoded task block was invisible to the guard, which then fell back to a current `context` block while the child received an unapproved one. The guard now applies a local mirror before parsing. It is a copy, not an import, so the Node test run keeps working.

## Rejected

- Only rewording the error message. The existing message already led to a correct retry; the cost was the first rejected dispatch, which a message cannot prevent.
- Changing doctrine to say "in each task's `task` text". "Carry this block in every brief" stays true once `context` counts, so no skill text or mark changes.

## Traps

- The repair mirror is pinned to OMP 18.8.4. If OMP changes its heuristic, the guard and the child can read different text again. `docs/OMP-COMPATIBILITY.md` names the mirror; recheck it on OMP upgrades.
- OMP accepts `context` only with `task.batch` on (the default; no profile overrides it). With batch off, OMP rejects a call that has `context`, so the fallback cannot pass a block the child never sees.

## Open

- Deferred from the same audit: keeping `flow_gate` presentations across a restart, and binding `plan-tasks/` capsules to the plan approval.
