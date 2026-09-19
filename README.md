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
scripts/omp-stack           install / verify / doctor
```

## Install

The installer provisions three native OMP profiles: `openai-codex`, `ollama-cloud`, and `anthropic`. It links `agent/keybindings.yml` into the shared agent directory once — named profiles inherit it and can still override single actions — symlinks the shared Flow surfaces and that profile's `config.yml` into each profile, refuses to clobber real managed-surface files/directories, and never writes `mcp.json`.

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

Then replace `ctx7sk-REPLACE-WITH-YOUR-KEY` in each copy with the real Context7 key. The ClickUp entry needs no secret — it authenticates over OAuth on first use. A profile whose `mcp.json` is missing simply has no MCP servers; OMP starts normally and the doctrine in `agent/AGENTS.md` falls back to `grep`/`glob` and upstream documentation.

`codebase-memory-mcp` keeps its own per-account index and background watcher outside this repository (`~/.cache/codebase-memory-mcp`). It indexes a project on explicit `index_repository` and re-indexes on git-detected change; `auto_index` is off by default, so a never-indexed repository answers nothing until it is indexed once. Never commit the optional `.codebase-memory/graph.db.zst` export — the watcher rewrites it constantly.

## Flow shape

The old 24-skill surface is reduced to 14 skills in the v8 trial:

* `flow-design` — material product/architecture decisions only.
* `flow-planning` — execution-grade HOW planning; front-loads interfaces/tests/ownership and lens concerns so implementation can be constrained.
* `flow-execution` — routes execution-grade work to cheap constrained executors, preserves semantic fallback, layered verification and bounded acceptance review.
* `flow-tdd` — behavior-first Red/Green/Refactor.
* `flow-debugging` — root-cause-first diagnosis.
* `flow-review` — local change, PR reviewer, PR author-feedback, and codebase-audit modes.
* `flow-integrating` — final evidence and user-owned integration decision.
* `flow-ldd` — durable architect/worker protocol for epics; architect never codes.
* `flow-external-session` — external worktrees, static planning/worker handoffs and filesystem mailbox when genuinely needed.
* `ui-design`, `blog-post` — domain capabilities.
* `weft-worklog`, `weft-memory`, `weft-maintenance` — grouped Weft operations.

Flow working state (contracts, plans, checkpoints, evidence, LDD ledgers, mailboxes) lives in the project's `.flow/` directory, hidden from git through `.git/info/exclude` by the always-on `flow-artifacts` rule; only shared-mode LDD ledgers and requested audit reports are tracked.

The old bootstrap (`flow-using-skills`), normal workspace ceremony and standalone verification skill remain gone. v8 deliberately restores **Flow planning doctrine** on top of native OMP Plan/model mechanics: substantial work becomes contract → execution-grade plan → constrained `@execute` implementation → one strong `@slow` acceptance review. `@task` remains the semantic/debugging fallback and `@smol` the mechanical lane. Review lenses are not deleted: they move left into the plan quality gate for planned work and remain specialist reviewers for unplanned/PR/audit paths. Writers still own focused proof, Main owns integration/final evidence, and LDD resumes from small durable pointers instead of replaying the whole epic.

## Model philosophy

Skills and agents use **roles**, never concrete models. Native OMP profiles provide provider-specific role maps while the Flow content stays shared.

The OpenAI Codex v8 trial keeps Terra as Main, uses Sol for planning/final acceptance, and adds Luna as `@execute` for decision-complete plan work. The Ollama Cloud trial keeps DeepSeek V4 Pro as Main/planning/final acceptance, uses DeepSeek V4.1 Flash for cheap mechanical roles, GLM-5.3-Flash for constrained execution/semantic coding/vision and auxiliary review, and Kimi K3 for explicit critical escalation. The Anthropic v8 profile uses Haiku 4.5 for cheap leaves, Sonnet 5 for constrained execution/semantic implementation/vision/auxiliary review, Opus 5 for Main/planning/correctness reasoning, and Fable 5.1 high for explicit critical escalation.

See `docs/MODEL-ROUTING.md`. Current OMP assumptions are recorded in `docs/OMP-COMPATIBILITY.md`.

## Validation

```sh
./tests/run.sh
```

The suite validates skill/agent/rule frontmatter, role references, removed legacy assumptions, shell syntax, installer safety shape, and AI-memory slicing behavior.
