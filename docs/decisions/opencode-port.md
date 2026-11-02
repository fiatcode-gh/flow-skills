# OpenCode Flow port

Work: `feat/opencode-port`, 2026-11-02.

## Decisions

- **The port lives in `ports/opencode/` and installs by symlinks under `~/.config/opencode/` only.** Nothing else on the machine is touched: no shell startup file, no link in `~/.local/bin`.
- **The doctrine is translated from the OMP source, not from the Claude Code port.** Verbatim files (`flow-tdd`, `ui-design`, the handoff schema and validator, some references) are pinned by `tests/validate.py`. The only rule-level differences are the mechanics map:
  - the `subagent` tool runs agents, and the `skill` tool loads skills;
  - the built-in `general` agent is the mechanical lane, and `explore` is the read-only search lane;
  - `flow_approve` and `flow_check` replace `flow_gate`;
  - there is no task-list tool, so the stage list lives in the forward pointer;
  - there is no workspace isolation, so writers that touch the same files run one at a time;
  - there is no evidence verifier, so the checkpoint step keeps Main's own observation or the user's own look.
- **The always-on doctrine is one `AGENTS.md`, loaded in full.** There is no hook and no core/full split. Its byte cap is 22528, raised from 20480 because the translation is over 21 KB and the user chose to raise the cap rather than trim rules.
- **Approvals are checked for every kind a dispatch relies on.** Before a dispatch for `Plan: NONE` work, Main runs `flow_check <scope> implementation <contract path>` instead of the plan check. The acceptance receipt is written to `.flow/plans/<slug>/ACCEPTANCE.md` (`mkdir -p` first for `Plan: NONE` work) before `flow_approve <slug> accept`, because a missing path records an empty hash that `flow_check` reads as `ok`. The planner and the implementer each stop on a missing `Flow gate:` block (the implementer also on a missing `Plan:` line).
- **Read-only reviewers cannot spawn writers.** Every read-only agent has `permission.task: deny`, except the three audit agents, which may spawn `explore` only (`task: {"*": deny, explore: allow}`). OMP's reviewers had no task tool; this keeps `edit: deny` from being bypassed through `general` or `flow-implementer`. `tests/validate.py` pins both shapes. The SEC lens has no agent file: Main briefs a `general` subagent, which the Safety read-only list names.
- **The base config carries only the bash ask-list**, the same publication backstop OMP has. Profiles carry only `model` and `agent.<name>.model`, one profile file per provider. Agent files carry no model, so an agent without a mapping inherits the session model.
- **Profile launches must use `--standalone`.** The background service ignores the client's `OPENCODE_CONFIG` (seen on v2.2.5). So `flow-opencode run <profile>` runs a private server. Plain `opencode` uses the service with the base config. Run `opencode reload` after install. `run` rejects profile names that contain `/` or start with `.`.
- **Skill discovery is asynchronous, and the global skill folders of other agent tools are scanned too.** OpenCode lists a skill with the same name once, from `~/.config/opencode/skills`. The installer still reports those other copies, because a hidden copy drifts without notice.
- **`doctor` is the repeatable headless check.** It covers agents, profile models, base asks and skills, reads the installed profiles under the config root (what `run` uses), and needs `python3`. A checker that exits non-zero or prints nothing is a FAIL. `install` checks every symlink destination, `opencode.json` included, before it links anything.
- **The Weft harness section is `## Harness: [[OpenCode]]`.**

## Rejected alternatives

- An OpenCode plugin to enforce the approval gates: field trial first.
- `OPENCODE_CONFIG_DIR` per profile: it names a whole directory, so skills and agents would be duplicated per profile.
- A shell alias or a `~/.local/bin` link written by the installer: startup-file edits are out of bounds, and `~/.local/bin` is outside the config root.
- Copying files instead of symlinking: copies drift.
- Carrying the Claude Code port's shortened skills: the port's content must match OMP.

## Open questions

- Whether Code Mode worktrees (`worktree_create`, `session_move`) can isolate a subagent writer.
- The exact glob matching rules of `permission.bash` for compound commands.
- Whether `todowrite` returns in a later OpenCode version.
- Which models suit the free profile.
- How the gates hold up in real OpenCode sessions: the port was accepted on headless checks, and a full interactive Flow session is still to come.
