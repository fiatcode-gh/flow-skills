# Changelog

Versions follow SemVer as described in the Versioning section of the README.

## Unreleased

### Changed
- The planner and `critical` escalation run on Claude Fable 5.2 at `high` (was Fable 5.1), in the OMP `anthropic` profile; the Claude Code planner uses `claude-fable-5-2`. The OpenCode `claude-agent` planner keeps the `fable` alias, which Claude Code 2.1.321 and later resolve to Fable 5.2.

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
