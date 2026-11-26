# Changelog

Versions follow SemVer as described in the Versioning section of the README.

## Unreleased

### Added
- `omp/extensions/flow-credentials-guard.ts`: a guard that refuses, without asking, any tool call that would print a credentials file (`.env` files, `mcp.json` and `.mcp.json`, the OpenCode `service.json`, credentials files, private keys). It covers `read`, `grep`, and `bash` or `eval` text that reads one. Loading a file into a program stays allowed (`--env-file`, or sourcing in a quiet subshell). It is a backstop, not a sandbox; `docs/OMP-COMPATIBILITY.md` lists what it misses.
- OpenCode: `opencode/opencode.json` denies `read` on the same secret files through `permission.read` rules. It denies every `.pem` file, public certificates included.
- `flow_gate approve` takes several scopes and several kinds separated by commas, and `accept` takes several scopes, all behind one approval prompt. One chat yes for a contract and its `Plan: NONE` route is now one prompt.
- In-scope plan amendments: lines under the last line of a plan that is exactly `## In-scope amendments` stay out of the plan digest, so a fix inside the approved contract needs no new approval. The Claude Code port's `flow_digest` and the OpenCode `flow-guard` plugin hash plans the same way.
- The governance guard checks a `sonic` that carries a `Flow gate:` block like an executor, and checks a message to a parked writer like a new dispatch. A message to a live agent always goes through.
- OpenCode: the `flow-guard` plugin (`opencode/plugins/flow-guard/`) enforces the Flow gates. It adds the `flow_gate` tool; a gate on every `subagent` call that starts a planner, writer or verifier, or follows up a finished one, against current approvals; protection of `.flow/runtime/`, which only `flow_gate` writes; acceptance bound to the working tree; and the secret-file refusal on `read`, `grep` and `shell`. It needs OpenCode 2.2.5 or later; `docs/OPENCODE-COMPATIBILITY.md` lists what it misses.
- OpenCode: the `flow-evidence-verifier` agent, with a route in each profile, and the evidence order of `flow-execution` that dispatches it.
- `tests/guard-cases.test.mjs`: one case table run against the OMP guards and the OpenCode plugin.
- OpenCode: an `ask` primary agent replaces the built-in `plan`, which `opencode/agents/plan.md` turns off. `ask` offers `build`'s tools, but every edit, every shell command and every subagent dispatch asks first; a dispatched subagent runs under its own agent's permissions, so it would otherwise change files or run shell commands without a prompt. As OpenCode does for `plan`, the `flow-guard` plugin stores one reminder of that in the session when it switches to `ask` and one that the limits are lifted when it switches back, and restores one a request lost to compaction. `ask` runs on `build`'s model and effort in each profile, so a Shift+Tab switch keeps the model, effort and tool list; `doctor` checks the model and effort, and `install` ends with a note to keep `session.permissions` at `"prompt"`.

### Changed
- Command Code routing, in OMP and OpenCode: `slow` and `critical` move to DeepSeek V4.1 Flash `high` and GLM-5.3 leaves the profile. DeepSeek leads the independent comparisons and costs roughly a thirteenth as much per test, so the cross-family acceptance check was not buying capability. GLM-5.3 also never ran in OMP: the catalog routes it to Command Code's Responses endpoint, which rejects OMP's message items for missing `type` and returns 400. Evidence and the two remaining GLM-5.3 edges are in `docs/MODEL-ROUTING.md`.
- OpenCode: approvals are recorded through `flow_gate`, one permission prompt per yes, instead of the `flow_approve` and `flow_check` shell functions, which leave `opencode/AGENTS.md`. An OpenCode acceptance now binds the working tree, so an older `accept` line reads stale once; record it again.
- OpenCode: `flow-opencode install` links the plugin into `~/.config/opencode/plugins/`, and `doctor` reports whether it is active.
- Anthropic lineup, in OMP, Claude Code and OpenCode `claude-agent`: Fable 5.2 is dropped because it used up the plan allowance too fast. The planner (`plan`), the acceptance reviewer (`slow`) and `critical` run on Opus 5.5 at `high`. For a critical case, switch a role to Fable for one session only.
- `flow_gate accept` binds the working tree's content, not the commit, so committing the accepted tree or moving the folder keeps it current. An acceptance recorded before this change reads stale once; record it again.
- Approval records hold the artifact path relative to the repository, so a moved or renamed checkout keeps its approvals. Older records are still read.
- The tiny limit in `flow-execution` counts only hand-written production lines: the change's tests, CHANGELOG entry, docs and generated lines do not count. Skills, agents and rules are production.
- A finished subagent gets a follow-up only within 5 minutes of its last reply; after that, Flow starts a fresh agent. OMP parks an idle subagent after 7 minutes, and the first message after a park re-reads its whole context.
- On tiny work, Main may run one short device or browser check itself after the recovery checkpoint.
- Review work keeps an OMP `todo` list: Review and Publication for a PR review; Feedback, Fixes and Publication for author feedback.
- A reply that stops for an approval ends with the approval question, so OMP sends no duplicate todo reminder.
- `flow-evidence-verifier` lists `eval`, so it can drive a browser criterion with the `browser` helper.
- OpenCode: the `flow_gate` permission prompt names each pair's artifact path (`flow_gate approve contract demo (.flow/contracts/demo.md)`) and `accept` ends with `(working tree)`, because a different file presented under the same scope looked identical in the prompt.

### Removed
- The `blog-post` skill. It writes into one checkout, so it now lives in the `site` repository as an OMP project skill (`.omp/skills/blog-post`) and loads only in sessions started there.

### Fixed
- A dispatch sent in the same tool batch as its `flow_gate approve` now fails with a message that says the approval is presented but not recorded yet, instead of "artifact changed after approval".
- OpenCode: `flow-opencode doctor` no longer fails every profile's main-model check on OpenCode 2.4.1, which answers a one-shot `model.default` before the profile's model is set. It asks a server started for the profile once its plugins load, and reports a SKIP naming the version when even that gives no model.

## 1.4.0 — 2026-11-11

In the Anthropic lineup, Opus takes over execution, implementation and lens review, Fable 5.2 takes over acceptance, and Sonnet keeps only the little-change lanes.

### Changed
- Anthropic lineup, in OMP, Claude Code and OpenCode `claude-agent`: the plan executor, implementer and lens/audit reviewers run on Opus 5.5 (was Sonnet 5.5) at their existing effort, and the acceptance reviewer (`slow`) runs on Fable 5.2 at `high` (was Opus 5.5 `medium`). Sonnet 5.5 keeps only the little-change lanes (`smol`, `commit`, `vision`) and takes over `tiny` titles at `low` from Haiku 5.5, which the profile no longer uses.

## 1.3.0 — 2026-11-10

The planner and `critical` escalation move to Claude Fable 5.2, and the sh installers work on uutils coreutils.

### Changed
- The planner and `critical` escalation run on Claude Fable 5.2 at `high` (was Fable 5.1), in the OMP `anthropic` profile; the Claude Code planner uses `claude-fable-5-2`. The OpenCode `claude-agent` planner keeps the `fable` alias, which Claude Code 2.1.321 and later resolve to Fable 5.2.
- The OMP `anthropic` and `commandcode` profiles take OMP's own saved form: no comments or quotes, plus `setupVersion: 3` and `update.auto`. `anthropic` also gains `tui.textSizing`, `tui.completeScrollback` and `display.shimmer`; `commandcode` drops its empty web search order. The reasons behind each model choice stay in `docs/MODEL-ROUTING.md`.
- `WINDOWS-CHECKS.md` lists the checks to run for 1.2.0 on a real Windows machine.

### Fixed
- The sh installers refuse a dangling link with a `/../` or `/./` segment under the previous checkout name on uutils coreutils too (Ubuntu 26.04, the current `ubuntu-latest`). Its `readlink -f` resolves a path behind a missing folder instead of failing, so such a link was relinked. The installers now check the raw link target, as the PowerShell installers do.

## 1.2.1 — 2026-11-03

The PowerShell installers now follow the same link rules as the sh ones, and a few test gaps from the 1.2.0 review are closed.

### Fixed
- On Linux and macOS, the PowerShell installers resolve each link and the checkout itself with `readlink -f`, as the sh installers do. A working relative link with `..` into the checkout is relinked. A link that only looks like it points into the checkout, through `..`, a chain of links or a linked folder, is refused. The checkout is also found when you reach it through a linked folder, such as `/home -> /var/home`.
- On Windows, a broken folder link under the checkout whose target holds `..` or `.` is refused again, instead of being replaced.

### Changed
- `docs/WINDOWS.md` says how to capture or filter launcher output: run the launcher with `pwsh -NoProfile -File`.
- The validator runs the PowerShell doctors with no `omp` or `opencode` on `PATH`, so Windows CI no longer starts a real `opencode serve`.
- New test: `flow-opencode.ps1 run` passes OpenCode's exit code through.

## 1.2.0 — 2026-11-03

Flow now runs on native Windows with OMP, Claude Code and OpenCode, with Git Bash as the agent shell. Windows support is CI-tested, not yet field-tested on a real machine.

### Added
- `omp/bin/flow-omp.ps1` and `opencode/bin/flow-opencode.ps1`: PowerShell 7 launchers with the same commands and safety rules as the `sh` installers. They create real symlinks and stop before changing anything when Windows does not allow symlinks (turn on Developer Mode or use an elevated shell).
- `flow-opencode.ps1 run <profile>` sets OpenCode's shell to Git Bash for that launch only. OMP and Claude Code need no shell setting.
- `docs/WINDOWS.md`: prerequisites, install, the shell rule per harness, Git Bash notes and the manual checks still open.
- A `windows-latest` CI job: the validator, both PowerShell installer tests (including the Developer Mode stop), the `sh` tests under Git Bash, and checks against real OMP and OpenCode installs.

### Fixed
- Both `sh` installers resolve a symlinked launcher (such as `~/.local/bin/flow-omp`) to its checkout. Before, `flow-opencode` run from `~/.local/bin` looked for the repository in the wrong place.

### Changed
- `tests/run.sh` also runs the PowerShell tests when `pwsh` is on `PATH`, and a new test runs the Claude Code session-start hook.
- `.gitattributes` keeps every file LF, so the `sh` scripts work in a Windows checkout.

## 1.1.0 — 2026-11-02

Flow agents in the Claude Code and OpenCode ports now run on the model and effort of their OMP role, OpenCode gains a Command Code profile, and the Command Code routing changes after a look at real-world reports.

### Added
- OpenCode `commandcode` profile (`flow-opencode run commandcode`), using OpenCode's built-in Command Code provider. Store the key once with `/connect` (provider `commandcode`); it never goes into the repository.
- Effort levels for every Flow agent: `effort` in the Claude Code agents, `variant` in the OpenCode profiles, matching the OMP profile's roles.

### Changed
- Command Code routing, in OMP and OpenCode: DeepSeek V4.1 Flash now plans, builds and reviews (Main, planner, implementer, executor, lens reviewers and leaves), and GLM-5.3 does acceptance and critical escalation. GLM-5.3 Flash and Kimi K3 are no longer used. Users report recurring tool-call breakage on GLM-5.3 Flash and rate Kimi K3 weak and slow at checking a change, while DeepSeek V4.1 Flash led real-task tests on planning and self-review.
- OpenCode `claude-agent` profile: Main on Opus (was Sonnet) and the planner on Fable 5.1 (was Opus), matching OMP and Claude Code.
- `flow-opencode doctor` checks each agent's model and effort, including OpenCode's `build` agent, which carries Main's effort.
- The validator checks every port agent's model and effort against its OMP role, and rejects API keys, headers or another provider's block in a profile.
- `docs/MODEL-ROUTING.md` has a per-port routing table and the reasons for the Command Code routing.

## 1.0.0 — 2026-11-02

First versioned release. Flow is now one repository with one directory per harness, each installing on its own.

### Breaking: action needed
- The repository is renamed `fiatcode-gh/omp-stack` → `fiatcode-gh/flow-skills`, and its layout is now `omp/`, `claude-code/`, `opencode/`, `open-webui/`. Rerun `omp/bin/flow-omp install` and `opencode/bin/flow-opencode install` from the new checkout; both relink anything still pointing into the old `omp-stack` path.
- `scripts/omp-stack` is now `omp/bin/flow-omp`; `scripts/flow-sessions` is now `omp/bin/flow-sessions`.
- The Claude Code plugin is renamed `flow` → `fiatcode`: install `fiatcode@flow-skills`; skills and agents are `fiatcode:<name>`.
- Re-import `open-webui/system-prompt.md` and `open-webui/flow-handoff.md` into Open WebUI.

### Added
- OpenCode port (`opencode/`): skills, agents and `AGENTS.md` installed under `~/.config/opencode/` by `flow-opencode`, with per-provider model profiles (`flow-opencode run <profile>`) and a `doctor` check.
- One SemVer version for the repository (`VERSION`), shown by both `doctor` commands, the Claude plugin and the Open WebUI system prompt.

### Fixed
- `flow_approve` refuses a missing file instead of recording an empty hash, and `flow_check` matches scope and kind exactly (Claude Code and OpenCode ports).
- The installers refuse old-path links that contain `..` or `.` segments.

### Changed
- README rewritten for the per-harness layout.
