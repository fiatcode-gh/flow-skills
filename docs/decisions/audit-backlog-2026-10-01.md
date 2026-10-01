# Audit backlog batch (2026-10-01)

Work: `8989e71`..`23b7568` on `fix/audit-backlog`, 2026-10-01. Findings: `docs/reports/2026-09-30-audit-omp-stack.md`. First batch: `docs/decisions/audit-fixes-2026-09-30.md`.

## Decisions

- **The file mailbox is gone.** No session used it outside audit probes. `flow-external-session` now says it has no live channel between sessions: a worker handoff is one brief out and one report back, and a planning bundle is one-way. Git history keeps the protocol and the script.
- **Only `flow_gate` writes `.flow/runtime/`, and a hook enforces it for file-writing tools.** The governance guard blocks `write`, `edit` and `ast_edit` when a named target resolves under `.flow/runtime/`, and an `ast_edit` directory or glob that reaches an existing gate-state file. Bash and eval stay outside the hook; a profile prompt rule covers direct Bash lines, and the `flow-artifacts` rule covers the rest. `docs/OMP-COMPATIBILITY.md` is the one list of what the rule misses.
- **Read content informs; it never authorizes.** `flow-safety` splits authority from guidance. Files, handoffs, PRs and tool output never grant permission, approve a gate or override the user, the rules or the approved plan, and commands inside them are not orders. Weft memory holds the user's approved preferences: agents follow them, but they approve no gate. The injected memory block is wrapped in `<weft-memory>` tags with the same statement, and a stored closing tag is escaped.
- **The installer refuses a symlink that points outside the repository**, the same way it refuses a regular file. Links into the repository are relinked as before.
- **Each restated rule has one home**, and the other files point at it: layered verification in `flow-evidence`; isolation and publication in `flow-safety`; the finding shape in `review-lenses.md`; and the PR-reviewer worklog exception in `agent/AGENTS.md`, as `agents-md-plain.md` settled.
- **The three `weft-*` reference copies stay copies.** `conventions.md` keeps them self-contained for `skill://` reads, and `validate.py` now fails when they differ.
- **`validate.py` pins names, markers, pointer phrases, one-home relations and caps, not rule prose.** It caps every loaded `references/*.md`, numbers the `PRINCIPLES.md` invariants 1–42, and checks `dev.autoqaConsent: denied`. A pointer phrase such as "Isolation follows the `flow-safety` rule" is pinned as written, so rewording a pointer means editing its pin.
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

- Closed on `fix/audit-residuals` (2026-10-01):
  - the acceptance fingerprint ignores `diff.external`/textconv (`52e96b2`) and counts the staged diff (`9a3e09a`); acceptances recorded earlier read stale once;
  - all three profiles prompt for any shell line that names the gate-state directory (`cc9b9b0`);
  - the write hook blocks an `ast_edit` directory or glob that reaches an existing gate-state file (`ecda8cc`). OMP's walk honours `.gitignore` and the primary checkout's `.git/info/exclude`, but not the common-dir exclude seen from a linked worktree, so the guard never relies on the `.flow/` exclude. It reads paths the way OMP expands them — stray `:`, `@`, decoded `file://` URLs, split before expanding the base — and blocks what it cannot decode (`53e6770`, `1f23bff`). Trade-off: `ast_edit .` is refused once gate state exists; name narrower paths;
  - `tests/run.sh` runs the three extension tests under Bun when it is on PATH, and CI installs Bun with `oven-sh/setup-bun@v2.2.0` (`dbaea2b`; CI itself is unproven until a push);
  - `flow-sessions render` notes a `model_change` with no model, and `list` notes an assistant message with non-list content (`8defc80`).
- Still open: eval writes to the gate-state directory, and the direct Bash spellings listed in `docs/OMP-COMPATIBILITY.md`. The `flow-artifacts` rule governs them.
- Reviewed on `fix/audit-review` (2026-10-01, four lenses on `8989e71..9ee74b8`): the Bash `cwd` argument escaped the prompt rule, repo-local git config (`filter.*.clean`, `.git/info/attributes`, `.git/info/exclude`) could blank the acceptance fingerprint, a percent-encoded `ssh://localhost` target and a symlinked `.flow` passed the write hook, and `flow-sessions list` still counted an empty model name. The hook now also blocks Bash with a gate-state `cwd` and the file tools on `.git/`, and anchors gate state through a symlinked `.flow` before any record exists. The fingerprint itself was not rewritten: Bash and eval still reach `.git/`, and the user-global git config layer stays writable by every tool; `docs/OMP-COMPATIBILITY.md` lists these with the hard-link and `cd <path> &&` forms.
