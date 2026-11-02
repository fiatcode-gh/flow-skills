# Flow for several harnesses in one repository

Work: the OpenCode port (`feat: add the OpenCode Flow port`) and the rename to `flow-skills` (`docs/decisions/flow-skills-rename.md`), 2026-11-02. Records for each unit: `opencode-port.md`, `flow-skills-rename.md`.

## Decisions

- **One repository, `fiatcode-gh/flow-skills`, with one directory per harness**: OMP, Claude Code, OpenCode and Open WebUI. Each directory holds the doctrine or port and that harness's setup, and installs on its own; removing one harness does not break another.
- **OMP stays the canonical doctrine.** Ports translate its mechanics and keep its rules. A rule that exists only in a port is a bug. No harness reads another harness's files, and no symlink crosses harness directories, so this is not the retired `ai-stack` `shared/` layout.
- **Each harness gets Flow from exactly one place.** OpenCode also scans other tools' global skill folders; its installer reports a same-named copy there.
- **Skills and agents name roles, never models.** Models live in harness setup: OMP profiles, OpenCode profile files, Claude Code agent frontmatter.
- **The same gates everywhere**: contract and plan approval bound to artifact bytes, a check before each writer dispatch, acceptance before integration, and approval of every stakeholder-visible write. OMP enforces them with `flow_gate`; the Claude Code and OpenCode ports use `flow_approve` and `flow_check`.
- **The validator grows with the ports**: frontmatter, no other harness's mechanics or model ids, verbatim-copy drift, byte caps.

## Rejected alternatives

- A repository per harness: the ports are rewrites of the OMP doctrine (11 to 178 changed lines per skill), so a doctrine change touches several ports and the drift check needs one checkout.
- Doctrine in `flow-skills` with OMP setup left in `omp-stack`: one harness would have a separate setup repository, and the split needed cross-repository checks.

## Open questions

- (Resolved 2026-11-02) `flow_approve` once recorded an empty hash for a missing file and `flow_check` matched the scope as a pattern; both now refuse or match exactly, in both ports.
- An OpenCode plugin that enforces the gates, after a field trial.
