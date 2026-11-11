# External chat ↔ OMP Flow interoperability

An external chat, currently Open WebUI (self-hosted at `ask.fiatcode.dev`), carries a Flow port for design, planning and pull request review. The port and this OMP stack share **doctrine**, not identical mechanics.

## Shared surface

- `flow-design` — material WHAT/WHY decisions.
- `flow-review` — evidence-backed PR/change/audit review doctrine; the port carries PR reviewer mode only.
- `flow-planning` — shared execution-grade planning doctrine; the external port and OMP use different mechanics but the same plan contract/lens quality gate.

OMP additionally owns local execution/TDD/debugging/integration, task agents, Hub/isolation and formatter/test ownership. Do not copy those mechanics into the external planning port.

## Open WebUI port

The port's sources live in `open-webui/`. Import each skill file through Workspace > Skills > Import; its frontmatter fills the name and description. Paste `system-prompt.md` as the Open WebUI model's whole system prompt.

The chat reads through GitHub's read-only MCP server and writes nothing: no files, no GitHub writes, no approvals.

| Port file | Mirrors |
|---|---|
| `flow-design.md` | `flow-design` Process, Imported design context, Multi-unit work |
| `flow-planning.md` | `flow-planning` sections 1–5 |
| `flow-review.md` | `flow-review` Shared evidence contract and Change-lens selection, `review-lenses.md`, `pr-review.md` steps 1 and 3–7 |
| `flow-handoff.md` | `planning-handoff.md` Manifest schema v2 and HANDOFF.md contents, `planning-handoff.schema.json` |
| `system-prompt.md` | `AGENTS.md` Communication, Engineering principles, Documentation lookup and the Weft graph project-page rule; `flow-evidence` opening rule; `flow-safety` read-content, secrets and publication rules |

`tests/validate.py` fails when `flow-handoff.md` no longer names every required manifest field, constant and enum value in the schema.

## Claude Code port

`claude-code/` is a Claude Code plugin named `flow`; `.claude-plugin/marketplace.json` lists it. Unlike the Open WebUI chat, Claude Code has a shell, a checkout and subagents, so the port carries execution as well as design, planning and review.

| Port path | Mirrors |
|---|---|
| `hooks/flow-core.md`, `hooks/session-start.sh` | a 2 KB always-on core that points at `flow-context.md`; Claude Code keeps only about 2 KB of hook output |
| `hooks/flow-context.md` | `AGENTS.md` (Engineering principles, OMP / Flow execution, Weft graph, Commits, Communication, Documentation lookup, Python), `flow-safety`, `flow-evidence`, `flow-artifacts`; adds the approval record, the cloud-session rules and the Weft guard/publish functions |
| `skills/flow-tdd`, `skills/ui-design` | verbatim; `tests/validate.py` fails on drift |
| `skills/flow-design`, `flow-planning`, `flow-execution`, `flow-debugging`, `flow-integrating`, `flow-review` | the OMP skills, with OMP mechanics reworded |
| `skills/flow-review/references/` | `review-lenses.md`, `audit-lenses.md`, `pr-review.md`, `author-feedback.md`, `audit.md`; `github-operations.md` is rewritten for the GitHub MCP tools and absorbs `author-operations.md` |
| `skills/weft-worklog`, `weft-memory`, `weft-maintenance` | the OMP skills; `voice.md` and `page-archetypes.md` verbatim; `conventions.md` swaps never-commit for `weft_publish`; `memory-schema.md` adds the no-injector note |
| `skills/flow-external-session` | planning handoff intake, plus a handoff-out mode; the schema and validator are verbatim |
| `agents/` | the OMP agents except `flow-evidence-verifier`, plus `flow-cor-reviewer` for the bundled OMP `reviewer` |

Mechanics map:

| OMP | Claude Code port |
|---|---|
| `flow_gate` and the two guard extensions | `flow_approve` / `flow_check` in `flow-context.md`: a sha256 per approved artifact in `.flow/runtime/approvals.log`, checked by Main before dispatch. No hook enforces it. |
| roles `@plan`, `@slow`; `@execute`, `@task`, `@review_aux` | agent `model: claude-fable-5-2`; `model: opus`, each with the profile's `effort` |
| `sonic` (`@smol`), `scout` | a `general-purpose` agent with `model: sonnet`; the `Explore` agent |
| `hub` clarification and `hub wait` | the agent returns BLOCKED; Main continues it with `SendMessage`; background agents notify on completion |
| OMP `todo` | the task list |
| OMP isolation | `isolation: "worktree"` |
| `${WEFT_GRAPH}` as a local graph the user syncs | the same locally; in a cloud session `WEFT_GRAPH_REPO` makes `weft_guard` clone it shallow and `weft_publish` push each write to its default branch |
| `ai-memory` hub injection | `weft-memory` recall at the start of substantive work, with `## Harness: [[Claude]]` |
| `gh` publication behind `bash.patterns` prompts | GitHub MCP tools; the cloud harness pushes the session branch and opens a draft pull request |

On Windows the hook and the Bash tool run in Git Bash; see `docs/WINDOWS.md`.

Not ported: `blog-post` needs a local site checkout; `flow-evidence-verifier` and the checkpoint step serve device and manual acceptance, which a cloud container has no use for; frozen LDD ledgers; codebase-memory and shell-awareness doctrine.

A cloud session starts from a fresh container, so the cloud environment installs the plugin on every start. In the environment's settings:

- Setup script: `claude plugin marketplace add fiatcode-gh/flow-skills && claude plugin install fiatcode@flow-skills || echo "fiatcode plugin install failed"`. This repository is public, so the setup script can fetch it without the repository being attached to the session.
- Environment variables: `WEFT_GRAPH=/home/user/weft` and `WEFT_GRAPH_REPO=fiatcode-gh/fiat-codex`.

Keep `WEFT_GRAPH` on its own clone. A session that has `fiat-codex` attached checks it out on the session's own branch; `weft_publish` pushes to the default branch either way.

## OpenCode port

`opencode/` is installed under `~/.config/opencode/` by `opencode/bin/flow-opencode`. Like Claude Code, OpenCode is a local harness with a shell, a checkout and subagents, so the port carries execution as well as design, planning and review. Every file is translated from the OMP source, not from the Claude Code port.

| Port path | Mirrors |
|---|---|
| `AGENTS.md` | `omp/AGENTS.md` sections, the three rules (`flow-safety`, `flow-evidence`, `flow-artifacts`) and the approval record; loaded in full |
| `skills/flow-tdd`, `skills/ui-design` | verbatim; `tests/validate.py` fails on drift |
| the other `skills/` | the OMP skills with OMP mechanics reworded |
| `agents/` | the OMP agents except `flow-evidence-verifier`, plus `flow-cor-reviewer` |
| `opencode.json` | `bash.patterns` of `omp/profiles/*/config.yml`, as `permission.bash` asks |
| `profiles/` | `modelRoles`, as `model` and `agent.<name>.model` |
| `bin/flow-opencode` | `omp/bin/flow-omp` |

Mechanics map:

| OMP | OpenCode port |
|---|---|
| `flow_gate` and the two guard extensions | `flow_approve` / `flow_check` in `AGENTS.md`, logging to `.flow/runtime/approvals.log`; Main checks before dispatch |
| roles `@plan`, `@slow`, `@execute`, `@task`, `@review_aux` | the profile file maps each agent name to a model |
| `sonic` (`@smol`), `scout` | the built-in `general` and `explore` subagents |
| spawning through the OMP task tool | the `subagent` tool |
| `hub` clarification and `hub wait` | the subagent returns BLOCKED; Main continues it with its `sessionID`; background subagents notify on completion |
| OMP `todo` | no task-list tool; the stage list stays in the forward pointer |
| OMP isolation | not used; writers on the same files run one at a time |
| `skill://<name>` reads | the `skill` tool |
| `flow-evidence-verifier` | not ported; the checkpoint step keeps Main's own observation or the user's own look |
| `ai-memory` hub injection | `weft-memory` recall, with `## Harness: [[OpenCode]]` |
| `bash.patterns` prompts | `permission.bash` asks in `opencode.json` |

On Windows `flow-opencode.ps1 run` sets OpenCode's shell to Git Bash; see `docs/WINDOWS.md`.

Not ported: `blog-post`, `flow-evidence-verifier`, OMP isolation and OMP todo. OpenCode also scans `~/.claude/skills` and `~/.agents/skills`; the installer reports a same-named skill there.

## Handoff rule

The external chat emits a versioned (schema v2) static `FLOW-HANDOFF.json` + `HANDOFF.md` bundle using the schema in `omp/skills/flow-external-session/references/planning-handoff.md`. When the user explicitly intends to continue in local OMP, that machine-readable bundle is mandatory; a standalone Markdown plan/design is only legacy evidence, not a complete protocol handoff. OMP validates and reconciles the bundle before use. The bundle may carry decisions and implementation strategy, but **never authorization**. Do not use embedded copy/paste kickoff prompts as a second orchestration protocol; the receiving OMP stack owns current mechanics.

The user saves the bundle at `.flow/handoffs/<slug>/` in the repository checkout (`flow-artifacts`). Local OMP keeps that `<slug>` as the Flow scope, so integration removes the bundle.

Local `docs/decisions/` records stay canonical. The external chat may propose changes to them; local OMP checks each proposal against current code in `flow-design` before it counts.

## Avoid duplicate reasoning

After validation:

- unresolved WHAT/WHY → `flow-design`;
- settled design + execution-grade current plan → request/confirm local execution approval, then constrained `flow-execution`;
- settled strategy but executor would still make consequential HOW/test/interface decisions → preserve the strategy and use `flow-planning` only to make those missing decisions execution-grade;
- tiny obvious implementation with no meaningful planning judgment → authorized semantic/direct execution without plan ceremony.

The port's `flow-planning` aims at the same execution-grade plan shape (locked decisions, task briefs, proof, discretion/escalation and plan quality-gate receipt). OMP still grades every `IMPLEMENTATION-PLAN.md` by `flow-planning` "External handoffs" rather than treating it as cheap-executor-ready.

A changed commit SHA triggers targeted revalidation, not automatic rejection or a full restart. A matching SHA does not erase local dirty-tree differences.

## Synchronization discipline

- When shared doctrine changes in OMP (`flow-design`, `flow-planning`, review lens semantics, PR reviewer mode, decision-record handling, the handoff schema, or the rules `system-prompt.md` mirrors), update `open-webui/` in the same change cycle.
- The table above names what each port file mirrors.
- When the exclude command in `flow-handoff.md` changes, prove it again with fish in a temporary git repository: fresh clone, missing trailing newline, linked worktree, outside a repository.
- OMP-only execution mechanics do not require a mirror in `open-webui/`. In `claude-code/`, port them by the mechanics map above.
- When an `omp/` skill, agent, rule or `AGENTS.md` section listed in the Claude Code port table changes, update its port file in the same change cycle.
- When an `omp/` skill, agent, rule or `AGENTS.md` section changes, update its `opencode/` file in the same change cycle; the validator pins the verbatim ones.
