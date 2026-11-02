# Changelog

Versions follow SemVer as described in the Versioning section of the README.

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
