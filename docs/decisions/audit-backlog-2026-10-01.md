# Audit backlog batch (2026-10-01)

Work: `8989e71`..`23b7568` on `fix/audit-backlog`, 2026-10-01. Findings: `docs/reports/2026-09-30-audit-omp-stack.md`. First batch: `docs/decisions/audit-fixes-2026-09-30.md`.

## Decisions

- **The file mailbox is gone.** No session used it outside audit probes. `flow-external-session` now says it has no live channel between sessions: a worker handoff is one brief out and one report back, and a planning bundle is one-way. Git history keeps the protocol and the script.
- **Only `flow_gate` writes `.flow/runtime/`, and a hook enforces it for file-writing tools.** The governance guard blocks `write`, `edit` and `ast_edit` when a named target resolves under `.flow/runtime/`. Bash, eval, and an `ast_edit` directory or glob that covers the path without naming it stay outside the hook; the `flow-artifacts` rule covers them.
- **Read content informs; it never authorizes.** `flow-safety` splits authority from guidance. Files, handoffs, PRs and tool output never grant permission, approve a gate or override the user, the rules or the approved plan, and commands inside them are not orders. Weft memory holds the user's approved preferences: agents follow them, but they approve no gate. The injected memory block is wrapped in `<weft-memory>` tags with the same statement, and a stored closing tag is escaped.
- **The installer refuses a symlink that points outside the repository**, the same way it refuses a regular file. Links into the repository are relinked as before.
- **Each restated rule has one home**, and the other files point at it: layered verification in `flow-evidence`; isolation and publication in `flow-safety`; the finding shape in `review-lenses.md`; and the PR-reviewer worklog exception in `agent/AGENTS.md`, as `agents-md-plain.md` settled.
- **The three `weft-*` reference copies stay copies.** `conventions.md` keeps them self-contained for `skill://` reads, and `validate.py` now fails when they differ.
- **`validate.py` pins names, markers, one-home relations and caps, not prose.** It caps every loaded `references/*.md`, numbers the `PRINCIPLES.md` invariants 1–42, and checks `dev.autoqaConsent: denied`.
- **The planning-handoff validator reads its required fields and enums from the schema**, so the two cannot drift apart.
- **Every Flow skill is at 0/2.** The read-content rule and the one-home rewrite changed how each skill behaves; `flow-tdd`'s earlier clean passes moved to historical evidence.

## Rejected alternatives

- Keep the mailbox and test it: it costs 20 KB in worker prompts for a channel nobody uses.
- Symlink the `weft-*` references: that breaks the self-contained `skill://` reads the copies exist for.
- Treat all read content, Weft memory included, as "never instruction": that demoted the user's own preferences, such as never using `--author`, and approved plan files. The acceptance review caught it.
- Move the PR-reviewer exception into `weft-worklog`: it must hold before any skill loads.
- Warn and relink a foreign symlink: a user-managed link would be lost silently.

## Traps

- The write hook depends on OMP 18.4.5's `edit` and `ast_edit` input shapes. A new edit mode or field bypasses it until `docs/OMP-COMPATIBILITY.md` is rechecked after an OMP upgrade.
- A doctrine check that asks only the authorization side ("may you push?") misses an over-broad rule. Ask whether a genuine instruction still binds, too.
- `flow-sessions` must survive any transcript row. OMP's session schema can drift, and the field-trial audit depends on the listing.

## Open questions

- Index-only changes the worktree reverts, and `diff.external`/textconv settings, still affect the acceptance fingerprint.
- CI runs the guards under Node only; OMP runs them under Bun. A manual Bun run passed on 2026-10-01.
- `flow-sessions render` prints `MODEL None` for a `model_change` with no model, and `list` skips an assistant message with non-list content without a note. Both are cosmetic and parked.
