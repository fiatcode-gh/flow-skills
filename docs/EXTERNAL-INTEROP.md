# External chat ↔ OMP Flow interoperability

An external chat, currently Open WebUI (self-hosted at `ask.fiatcode.dev`), carries a Flow port for design, planning and pull request review. The port and this OMP stack share **doctrine**, not identical mechanics.

## Shared surface

- `flow-design` — material WHAT/WHY decisions.
- `flow-review` — evidence-backed PR/change/audit review doctrine; the port carries PR reviewer mode only.
- `flow-planning` — shared execution-grade planning doctrine; the external port and OMP use different mechanics but the same plan contract/lens quality gate.

OMP additionally owns local execution/TDD/debugging/integration, task agents, Hub/isolation and formatter/test ownership. Do not copy those mechanics into the external planning port.

## Open WebUI port

The port's sources live in `ports/open-webui/`. Import each skill file through Workspace > Skills > Import; its frontmatter fills the name and description. Paste `system-prompt.md` as the Open WebUI model's whole system prompt.

The chat reads through GitHub's read-only MCP server and writes nothing: no files, no GitHub writes, no approvals.

| Port file | Mirrors |
|---|---|
| `flow-design.md` | `flow-design` Process, Imported design context, Multi-unit work |
| `flow-planning.md` | `flow-planning` sections 1–5 |
| `flow-review.md` | `flow-review` Shared evidence contract and Change-lens selection, `review-lenses.md`, `pr-review.md` steps 1 and 3–7 |
| `flow-handoff.md` | `planning-handoff.md` Manifest schema v2 and HANDOFF.md contents, `planning-handoff.schema.json` |
| `system-prompt.md` | `AGENTS.md` Communication, Engineering principles and Documentation lookup; `flow-evidence` opening rule; `flow-safety` read-content, secrets and publication rules |

`tests/validate.py` fails when `flow-handoff.md` no longer names every required manifest field, constant and enum value in the schema.

## Handoff rule

The external chat emits a versioned (schema v2) static `FLOW-HANDOFF.json` + `HANDOFF.md` bundle using the schema in `agent/skills/flow-external-session/references/planning-handoff.md`. When the user explicitly intends to continue in local OMP, that machine-readable bundle is mandatory; a standalone Markdown plan/design is only legacy evidence, not a complete protocol handoff. OMP validates and reconciles the bundle before use. The bundle may carry decisions and implementation strategy, but **never authorization**. Do not use embedded copy/paste kickoff prompts as a second orchestration protocol; the receiving OMP stack owns current mechanics.

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

- When shared doctrine changes in OMP (`flow-design`, `flow-planning`, review lens semantics, PR reviewer mode, decision-record handling, the handoff schema, or the rules `system-prompt.md` mirrors), update `ports/open-webui/` in the same change cycle.
- The table above names what each port file mirrors.
- When the exclude command in `flow-handoff.md` changes, prove it again with fish in a temporary git repository: fresh clone, missing trailing newline, linked worktree, outside a repository.
- OMP-only execution mechanics do not require a mirror.
