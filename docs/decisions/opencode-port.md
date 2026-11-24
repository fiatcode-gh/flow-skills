# OpenCode Flow port

Work: `feat/opencode-port`, 2026-11-02.

## Decisions

- **The port lives in `opencode/` and installs by symlinks under `~/.config/opencode/` only.** Nothing else on the machine is touched: no shell startup file, no link in `~/.local/bin`.
- **The doctrine is translated from the OMP source, not from the Claude Code port.** Verbatim files (`flow-tdd`, `ui-design`, the handoff schema and validator, some references) are pinned by `tests/validate.py`. The only rule-level differences are the mechanics map:
  - the `subagent` tool runs agents, and the `skill` tool loads skills;
  - the built-in `general` agent is the mechanical lane, and `explore` is the read-only search lane;
  - `flow_gate` is a tool of the `flow-guard` plugin and records approvals behind a permission prompt. Reversed on 2026-11-24: until then `flow_approve` and `flow_check` in `AGENTS.md` replaced `flow_gate`. The 2026-11-23 audit found that every recorded break was a model skipping a rule it had read, and one recorded leak was a secret printed through the shell;
  - there is no task-list tool, so the stage list lives in the forward pointer;
  - there is no workspace isolation, so writers that touch the same files run one at a time;
  - `flow-evidence-verifier` is ported, and the plugin lets its dispatch through only with a current acceptance and a complete capsule. Reversed on 2026-11-24, for the same reason: until then the checkpoint step kept Main's own observation or the user's own look.
- **The always-on doctrine is one `AGENTS.md`, loaded in full.** There is no hook and no core/full split. Its byte cap is 22528, raised from 20480 because the translation is over 21 KB and the user chose to raise the cap rather than trim rules.
- **Approvals are checked for every kind a dispatch relies on.** The plugin checks them at dispatch and at a follow-up to a finished session: the contract for the planner; the contract and the plan for a writer, or the contract and the `implementation` record for `Plan: NONE` work; a current acceptance for the verifier. The `ACCEPTANCE.md` receipt file and the agents' own `Flow gate:` stop are gone: `flow_gate accept` binds the working tree, and the plugin refuses a gated dispatch without the block.
- **Read-only reviewers cannot spawn writers.** Every read-only agent has `permission.task: deny`, except the three audit agents, which may spawn `explore` only (`task: {"*": deny, explore: allow}`). OMP's reviewers had no task tool; this keeps `edit: deny` from being bypassed through `general` or `flow-implementer`. `tests/validate.py` pins both shapes. The SEC lens has no agent file: Main briefs a `general` subagent, which the Safety read-only list names.
- **The base config carries only the bash ask-list**, the same publication backstop OMP has. Profiles carry `model`, `agent.<name>.model` and an optional `agent.<name>.variant`, one profile file per provider. Agent files carry no model, so an agent without a mapping inherits the session model.
- **Profile launches must use `--standalone`.** The background service ignores the client's `OPENCODE_CONFIG` (seen on v2.2.5). So `flow-opencode run <profile>` runs a private server. Plain `opencode` uses the service with the base config. Run `opencode reload` after install. `run` rejects profile names that contain `/` or start with `.`.
- **Skill discovery is asynchronous, and the global skill folders of other agent tools are scanned too.** OpenCode lists a skill with the same name once, from `~/.config/opencode/skills`. The installer still reports those other copies, because a hidden copy drifts without notice.
- **`doctor` is the repeatable headless check.** It covers agents, profile models, base asks and skills, reads the installed profiles under the config root (what `run` uses), and needs `python3`. A checker that exits non-zero or prints nothing is a FAIL. `install` checks every symlink destination, `opencode.json` included, before it links anything.
- **Profiles follow OMP's roles, effort included, through `agent.<name>.variant`.** Probed on v2.2.5: `agent.<name>.variant` reaches the provider (`claude --effort=<variant>` for `claude-agent`, `reasoning_effort` in the request for `commandcode`), while a `#variant` suffix on the top-level `model` or an agent `model` is ignored (or fails to resolve). The top-level `model` therefore cannot carry Main's effort, so a profile also overrides the built-in `build` agent with Main's model and variant. The planner and the acceptance reviewer ran on `claude-agent/fable` until 2026-11-24, when Fable was dropped because it used up the plan allowance too fast; they now use `claude-agent/opus`. The free `opencode` profile has no effort. `tests/validate.py` keeps agents of one OMP role on one model and effort, requires `build`, and checks every model and effort against the OMP profile (OMP's Anthropic ids map to `opus` and `sonnet` in the `claude-agent` catalog and in the Claude Code port); the free `opencode` profile may carry no variant; `flow-opencode doctor` reports each agent's resolved `model#variant`.
- **`commandcode` is the built-in OpenCode provider, so its profile has no `provider` block.** OpenCode 2.2.5 lists `commandcode/<model>` for the catalog with the right base URL and a `low`/`high`/`max` variant ladder, and a headless run answered with only the key stored by `/connect`. The key lives in OpenCode's credential store and no Flow step reads it. `tests/validate.py` still rejects an `apiKey` or any `headers` object anywhere in a profile, and a `provider` block for any id but the profile's own.
- **The Weft harness section is `## Harness: [[OpenCode]]`.**

## Rejected alternatives

- `OPENCODE_CONFIG_DIR` per profile: it names a whole directory, so skills and agents would be duplicated per profile.
- A shell alias or a `~/.local/bin` link written by the installer: startup-file edits are out of bounds, and `~/.local/bin` is outside the config root.
- Copying files instead of symlinking: copies drift.
- Carrying the Claude Code port's shortened skills: the port's content must match OMP.
- A custom `provider.commandcode` block in the profile: the built-in provider already has the catalog, and `provider` is deprecated in the v2 config schema.

## Enforcement plugin (2026-11-24)

Rejected on 2026-11-02 as "An OpenCode plugin to enforce the approval gates: field trial first." Reversed on 2026-11-24: the 2026-11-23 audit found that every recorded break was a model skipping a rule it had read, and one recorded leak was a secret printed through the shell.

- **One V2 plugin, `opencode/plugins/flow-guard/`, id `flow-guard`.** The installers link it to `~/.config/opencode/plugins/flow-guard`. `index.ts` only defines the plugin; `setup.ts`, `tool-path.ts`, `credentials.ts`, `runtime-writes.ts`, `git.ts`, `record.ts`, `flow-gate.ts` and `dispatch.ts` do the work. There is no `package.json`, and no file is named `server`, `tui` or `rpc`, which OpenCode reads as plugin parts. Only `index.ts` imports `@opencode/plugin`; the rest import `node:` built-ins and siblings.
- **Code Mode stays on.** A tool call nested in Code Mode `execute` passes the `execute.before` hook again under its own name, so `opencode/opencode.json` keeps only `$schema` and `permission`.
- **The record is `.flow/runtime/approvals.log`, one line per record: `<scope> <kind> <digest> <path>`.** For `contract`, `plan` and `implementation` the digest is OMP's artifact digest and the path is relative to the repository root. An `accept` line holds the fingerprint of the working tree's content and the head, the head for messages only. The last line for a scope and kind wins, and the plugin rewrites the file whole through a rename. The Claude Code port's `flow_check` reads the first three kinds the same way, but reads an OpenCode `accept` line as `stale` because it hashes a receipt file; the plugin reads a Claude Code `accept` line as stale too. Both ask again; neither passes a wrong record.
- **Presentations live in memory**, as in OMP. A plugin reload drops them, and `approve` then asks to present again.
- **The prompt is carried by the permission action text.** `approve` and `accept` assert an action such as `flow_gate approve contract demo (.flow/contracts/demo.md), implementation demo (.flow/contracts/demo.md)` with no `save`, and the plugin's `evaluate` hook sets `ask` for every `flow_gate ` action. Every agent's base policy allows `*`, so without the hook the assert would pass silently; the TUI shows only the action text, not the resources or metadata, and offers `Always allow` only when `save` is set.
- **A follow-up to a running child passes** unless it switches the child to another gated agent, so a stop request always reaches it. A follow-up to a finished child is checked like a dispatch, from its own `Flow gate:` block or else from the child's first prompt; an unreadable session or first prompt refuses.
- **Code shared with OMP is mirrored, not abstracted.** The secret-file matcher, the git helpers and tree identity, the plan digest and the capsule markers are copied byte for byte from `omp/extensions/`, and `tests/validate.py` fails when a copied block drifts. `tests/guard-cases.test.mjs` runs one case table against the OMP guards and the plugin.
- **The minimum version is OpenCode 2.2.5.** There is no runtime version check; OpenCode 1.x does not load V2 plugins, and `doctor` reports a plugin that did not load.
- **An auto-approving client is an accepted known miss.** `--auto`, `--yolo`, `--dangerously-skip-permissions` and the TUI's `autoaccept` answer the prompt for the user, and the server cannot tell the difference. This and the other known misses are listed in `docs/OPENCODE-COMPATIBILITY.md`.

## Open questions

- Whether Code Mode worktrees (`worktree_create`, `session_move`) can isolate a subagent writer.
- The exact glob matching rules of `permission.bash` for compound commands.
- Whether `todowrite` returns in a later OpenCode version.
- Which models suit the free profile.
- The plugin on Windows and macOS has CI and unit proof only. The PowerShell syntax and installer tests passed under `pwsh` on Linux (Developer Mode scenarios skipped); that the plugin loads on Windows is unproven until CI's Windows job runs the real `doctor`.
