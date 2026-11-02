# Changelog

Versions follow SemVer as described in the Versioning section of the README.

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
