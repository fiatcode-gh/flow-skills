# omp-stack

Personal, OMP-native coding-agent stack for fiatcode.

This repository intentionally does **not** emulate the old cross-harness `ai-stack` layout. OMP owns execution mechanics — Plan mode, task agents, isolation, Agent Hub, built-in review/security — while Flow owns engineering judgment, safety, review lenses, TDD, debugging, durable epic state, and external-effect gates.

## Dependencies

- `omp` — the harness itself.
- [`codebase-memory-mcp`](https://github.com/DeusData/codebase-memory-mcp) — the codebase graph that `agent/AGENTS.md` routes structural lookups to. Without it, `Codebase graph lookup` has nothing to query and agents fall back to `grep`/`glob`.
- `@upstash/context7-mcp` via `npx` — library documentation lookup, also named in `agent/AGENTS.md`.

Both MCP servers are configured per profile; see [MCP servers](#mcp-servers).

## Layout

```text
agent/
  AGENTS.md                 durable user context
  TITLE_SYSTEM.md           session-title prompt (verb-first kebab-case, 4-5 words)
  rules/                    always-apply Flow invariants
  agents/                   role-backed OMP task agents
  skills/                   optional workflow/domain capabilities
  extensions/               auto-discovered OMP extensions
  lib/                      extension support code
  keybindings.yml           shared chord remaps (zellij-safe)
profiles/
  openai-codex/config.yml   first-install baseline for `omp --profile openai-codex`
  ollama-cloud/config.yml   first-install baseline for `omp --profile ollama-cloud`
  anthropic/config.yml      first-install baseline for `omp --profile anthropic`
mcp.example.json            MCP server template, copied per profile (see below)
ports/
  open-webui/               Flow port for the Open WebUI chat (docs/EXTERNAL-INTEROP.md)
scripts/
  omp-stack                 install / verify / doctor
  flow-sessions             list and render OMP sessions for field-trial audits
tests/                      validation suite; entry point tests/run.sh
docs/
  decisions/                committed decision records
  FIELD-TRIALS.md           per-skill field-trial marks and rules
  FIELD-TRIAL-AUDIT.md      how to run a field-trial audit
```

## Install

The installer provisions three native OMP profiles: `openai-codex`, `ollama-cloud`, and `anthropic`. It links `agent/keybindings.yml` into the shared agent directory once — named profiles inherit it and can still override single actions — symlinks the shared Flow surfaces and that profile's `config.yml` into each profile, refuses to clobber real managed-surface files/directories or symlinks that point outside this repository (it names the link and its target), relinks symlinks that point into it, and never writes `mcp.json`.

`profiles/<name>/config.yml` is the single source of truth: each profile's `config.yml` is a symlink back to it, so a settings change belongs in this repository. An existing real file is replaced by the symlink only when it is already byte-identical to the template; otherwise the installer warns, leaves it alone, and exits non-zero so the divergence is visible. Merge it by hand, then rerun `install`. Editing settings through OMP's own settings UI rewrites the target file in this repository — review it with `git diff` like any other change.

```sh
./scripts/omp-stack install
./scripts/omp-stack doctor
```

Launch OMP directly with the native profile selector:

```sh
omp --profile openai-codex
omp --profile ollama-cloud
omp --profile anthropic
```

See `docs/MIGRATION.md` for moving an existing profile onto the linked config.

## MCP servers

MCP stays profile-owned: the installer never writes or links `mcp.json`, because the file carries credentials and per-profile enablement. Every profile is meant to see the **same** servers, so copy the template into each one and keep the copies identical:

```sh
for p in openai-codex ollama-cloud anthropic; do
  cp mcp.example.json "$(omp --profile "$p" config path)/mcp.json"
done
```

Then replace `ctx7sk-REPLACE-WITH-YOUR-KEY` in each copy with the real Context7 key. A profile whose `mcp.json` is missing simply has no MCP servers; OMP starts normally and the doctrine in `agent/AGENTS.md` falls back to `grep`/`glob` and upstream documentation.

ClickUp is deliberately **not** in the template: it is configured per project, only in work repositories, as an untracked `<repo>/.omp/mcp.json` hidden through that checkout's `.git/info/exclude` (`/.omp/mcp.json`). OMP reads project MCP config from `<cwd>/.omp/mcp.json` only — no ancestor walk — so each repository needs its own copy and OMP must be launched from the repository root:

```json
{
	"mcpServers": {
		"clickup": { "type": "http", "url": "https://mcp.clickup.com/mcp" }
	}
}
```

The entry needs no secret. OAuth runs on first use (`/mcp reauth clickup`), and the credential is stored per profile, keyed by URL, so one sign-in per profile covers every repository that defines it.

`codebase-memory-mcp` keeps its own per-account index and background watcher outside this repository (`~/.cache/codebase-memory-mcp`). It indexes a project on explicit `index_repository` and re-indexes on git-detected change; `auto_index` is off by default, so a never-indexed repository answers nothing until it is indexed once. Never commit the optional `.codebase-memory/graph.db.zst` export — the watcher rewrites it constantly.

## Flow shape

The old 24-skill surface is reduced to 13 skills in the v8 trial:

* `flow-design` — material product/architecture decisions only.
* `flow-planning` — execution-grade HOW planning; front-loads interfaces/tests/ownership and lens concerns so implementation can be constrained.
* `flow-execution` — routes execution-grade work to cheap constrained executors, preserves semantic fallback, layered verification and bounded acceptance review.
* `flow-tdd` — behavior-first Red/Green/Refactor.
* `flow-debugging` — root-cause-first diagnosis.
* `flow-review` — local change, PR reviewer, PR author-feedback, and codebase-audit modes.
* `flow-integrating` — final evidence and user-owned integration decision.
* `flow-external-session` — external worktrees and static planning/worker handoffs.
* `ui-design`, `blog-post` — domain capabilities.
* `weft-worklog`, `weft-memory`, `weft-maintenance` — grouped Weft operations.

Flow working state (contracts, plans, checkpoints, evidence, runtime approval/acceptance bindings) lives in the project's `.flow/` directory, hidden from git through `.git/info/exclude` by the always-on `flow-artifacts` rule; only decision records under `docs/decisions/` and requested audit reports are tracked.

The old bootstrap (`flow-using-skills`), normal workspace ceremony and standalone verification skill remain gone. v8 deliberately restores **Flow planning doctrine** on top of native OMP Plan/model mechanics: substantial work becomes contract → execution-grade plan → constrained `@execute` implementation → one strong `@slow` acceptance review. `@task` remains the semantic/debugging fallback and `@smol` the mechanical lane. Review lenses are not deleted: they move left into the plan quality gate for planned work and remain specialist reviewers for unplanned/PR/audit paths. Writers still own focused proof, Main owns integration/final evidence, and integration distills each contract into a short committed decision record.

## Model philosophy

Skills and agents use **roles**, never concrete models. Native OMP profiles provide provider-specific role maps while the Flow content stays shared.

The OpenAI Codex profile follows OpenAI's GPT-6 model/effort ladder: GPT-6 Luna for Main (adaptive effort), cheap leaves (low), vision (medium) and constrained execution (xhigh); GPT-6.1 Sol for semantic implementation (medium), planning/final acceptance/auxiliary review (high) and explicit critical escalation (xhigh). GPT-6 Astra is left out to protect the ChatGPT Plus allowance.

The Ollama Cloud profile uses GLM-5.3 high for Main/planning/final acceptance, DeepSeek V4.1 Flash low for cheap mechanical roles, DeepSeek V4.1 Flash high for constrained execution/semantic coding/vision and auxiliary review, and Kimi K3 for explicit critical escalation. The Anthropic v8 profile uses Haiku 5.5 medium for tiny metadata only (its 100k context is too small for other leaves), Sonnet 5.5 low for scout/mechanical leaves and commits, Sonnet 5.5 for constrained execution/semantic implementation/vision/auxiliary review, Opus 5.5 for Main/planning/correctness reasoning, and Fable 5.1 high for explicit critical escalation.

See `docs/MODEL-ROUTING.md`. Current OMP assumptions are recorded in `docs/OMP-COMPATIBILITY.md`.

## Validation

```sh
./tests/run.sh
```

The suite runs `tests/validate.py` (skill/agent/rule frontmatter, role references, removed legacy assumptions, machine-read markers, and the per-file byte caps in `tests/doctrine-budget.json`), behavioral tests for both Flow guards (`tests/flow-evidence-guard.test.mjs`, `tests/flow-governance-guard.test.mjs`), the bash approval patterns (`tests/bash-patterns.test.mjs`), the `.flow/` exclude guard (`tests/flow-exclude.test.sh`), the installer (`tests/install.test.sh`), the planning-handoff validator, `scripts/flow-sessions` (`tests/flow-sessions.test.py`) and AI-memory slicing, plus shell syntax checks.

CI (`.github/workflows/ci.yml`) runs the same suite on every pull request and on pushes to `main`, with Node 24, Bun and `uv`; the three extension tests run under both runtimes because OMP loads extensions under Bun.
