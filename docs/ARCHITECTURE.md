# Architecture

## Boundary

`omp-stack` is OMP-native. It may borrow content principles from the old multi-harness `ai-stack`, but OMP runtime must not depend on an `ai-stack` checkout.

Native surfaces:

- `agent/AGENTS.md` → broad durable user context;
- `agent/rules/*.md` → always-visible hard invariants;
- `agent/agents/*.md` → specialist execution identities + role routing;
- `agent/skills/*/SKILL.md` → optional workflows/domain knowledge;
- `agent/extensions/*.ts` → OMP runtime extensions.

## Old → new skill map

| Old | New |
|---|---|
| flow-using-skills | delete; native discovery + rules |
| flow-brainstorming | flow-design |
| flow-writing-plans | flow-planning doctrine + native OMP `@plan` routing |
| flow-workspace | flow-safety rule + flow-external-session when external |
| flow-executing-plans | flow-execution |
| flow-verification | flow-evidence rule |
| flow-finishing | flow-integrating |
| flow-reviewing-prs | flow-review PR mode |
| flow-receiving-pr-reviews | flow-review author-feedback mode |
| flow-auditing-codebases | flow-review audit mode |
| flow-handover + flow-mailbox | flow-external-session |
| flow-ldd | flow-ldd, OMP-native worker transport |
| flow-tdd | flow-tdd (behavior-oriented) |
| flow-debugging | flow-debugging |
| find-todo + journal-update | weft-worklog |
| recall-memory + memory-update + memory-gc | weft-memory |
| retrofit | weft-maintenance |
| frontend-design | ui-design |
| blog-post | blog-post |
| forgejo | deleted; the stack is GitHub-only and `flow-review` carries the `gh` mechanics |

## Execution hierarchy

The normal Flow execution model is shared by ordinary work, approved Plans and LDD units. Route by remaining judgment rather than by file count alone:

```text
Main/controller (@default)
├── flow-design — Main-owned intent clarification + approved WHAT/WHY contract
├── flow-planner (@plan) — judgment-heavy execution plan author, no production code
├── scout (@smol) — bounded read-only recon
├── sonic (@smol) — direct behavior-preserving mechanical edit / diagnosed exact correction
├── flow-plan-executor (@execute) — constrained owner for execution-grade plan work
└── flow-implementer (@task) — semantic/debugging/broken-plan fallback
    ├── scout (@smol) — bounded local discovery
    └── sonic (@smol) — settled mechanical leaf edits

planned coherent result → flow-acceptance-reviewer (@slow)
long visual/device gate → flow-evidence-verifier (@vision) → Main acceptance judgment
```

For substantial work, Main first reconciles the user's intent with project reality through `flow-design`, writes the governing WHAT/WHY contract, and obtains explicit approval. This contract stage applies whether context came from a fresh request, an existing project, internal brainstorming, or an external handoff; already-settled decisions are preserved rather than re-litigated. The planning stage then locks consequential interfaces/tests/ownership/error semantics and explicit executor discretion. For substantial planning in either ordinary work or LDD, `flow-planner` owns that consequential HOW and plan authoring unless a current validated external execution-grade plan already satisfies the approved contract; Main validates and accepts the result instead of recreating it. A plan executor may implement new behavior because that judgment was paid upstream, but it cannot redesign; contradictions rise to Main/planning. The semantic `@task` owner remains available when judgment genuinely cannot be removed from execution.

A sole/sequential semantic owner on a suitable feature checkout is normally non-isolated so it can be messaged/revived. Planned execution uses the same checkout sequentially but treats each task brief as a context boundary: fresh `flow-plan-executor` session per independently provable behavioral slice, repository/artifact continuity instead of model-session continuity. Isolation remains primarily for independent concurrent writers or explicitly disposable experiments.

Child completion can self-deliver, and Main stays interactive whether it yields or uses OMP's native wait primitive. When useful independent controller work exists, Main does that work first; when the next meaningful action depends on a child and nothing useful remains, native `hub wait` is valid. OMP makes that wait interruptible by user steering, so it parks autonomous execution without preventing the user from prompting. Flow avoids progress polling — repeated short waits or repeated `hub jobs` snapshots without new work — but does not override Agent Hub wait semantics. `agent/extensions/flow-evidence-guard.ts` remains only as the evidence-capsule dispatch preflight. Main context is phase-scoped as a **top-level handoff option**, not self-rotation: once durable artifacts make an old transcript unnecessary, quota/context-sensitive runs may checkpoint and start a fresh controller session, but the active Main continues unless the user/harness actually performs that restart.

Substantial planned work has two explicit human authorization gates: approve the completed WHAT/contract before dispatching the planner, then approve the completed execution-grade HOW/plan before the first production-writing worker. Answers to clarification questions do not themselves approve the completed or materially amended contract unless the user explicitly says so. A generic start/resume command cannot create a missing approval. Recorded approvals survive resume while their approved artifact/scope is materially unchanged; material changes reopen the corresponding gate. Under LDD these artifacts live in unit authority; non-LDD uses the normal contract/plan surfaces. Plan approval authorizes local implementation within that envelope, not publication.

## Asset production

`flow-assets` is a generic domain capability for repository visual assets, not a separate execution role or a game-only pipeline. It starts only when an actual consumer is concrete enough to derive a production requirement. The skill classifies work as GENERATE, EDIT or CONFORM, derives an asset contract from consuming code/config plus governing visual sources and approved references, and stages the portable bundle under `.flow/assets/<asset-id>/`.

```text
real consumer + visual rules + approved references
                    ↓
               flow-assets
                    ↓
       .flow/assets/<asset-id>/
        ASSET.md + context + references
                    ↓
      replaceable generation/edit backend
                    ↓
              staged candidate
                    ↓
 optional deterministic ImageMagick conformance
                    ↓
             production asset
                    ↓
       real-consumer contextual evidence
```

Generation/editing remains backend-agnostic. ImageMagick is used only for deterministic technical conformance after visual content is acceptable; creative mismatches route back to generation/editing. A generated file is not accepted merely because its standalone image looks plausible: when a real render/use context exists, acceptance requires evidence from that consumer, using `flow-evidence-verifier` for multi-step visual/device gates under the normal evidence-capsule doctrine.

## Evidence hierarchy

Evidence broadens with ownership rather than repeating the same full gate everywhere:

```text
leaf proof → unit proof → integration/review proof → final-tree gate
```

Writers must verify their own changes, including canonical formatting of touched files when the formatter can be safely scoped. Writer dispatch has a verification-capable preflight: focused proof, touched-file formatting, focused static/build checks and Main-owned broader gates are stated explicitly before spawn. A blanket "do not verify because Main will" brief is invalid; the implementer also detects that contradiction so one controller mistake cannot silently recreate a blind worker. Parent/controller verification remains independent for consequential claims, but independence does not require ritual duplicate whole-repository runs when a targeted different proof better covers the boundary.

Delegation is **receipt-first**: planner/executor/reviewer/verifier reports carry exact state, proof, deviations/risks and next action so Main can target its independent checks instead of replaying broad recon. Receipts remain claims, not proof. Evidence freshness follows the dependency surface of the claim: a docs-only checkpoint does not stale unchanged app behavior proof, while changed production/test surfaces invalidate the proof they actually affect. Temporary probes against pre-existing dirty files restore against a captured pre-edit snapshot, never against `HEAD`.

Interactive Flow also keeps a **forward pointer**: at meaningful user-facing checkpoints Main states the outcome, the next workflow action, and whether user input is required. Internal authorized next actions continue automatically; concrete questions are reserved for real design/approval/integration gates. Before the first device/emulator/manual/external acceptance action, that pointer becomes a durable recovery checkpoint (`flow-execution` section 9) so provider/session failure is a safe interruption. Acceptance is a stability barrier (`flow-evidence` rule): required review/correction settles before expensive device/manual capture begins, and a later production-, asset-, or build-affecting mutation reopens scoped closure before integration. Multi-step device/manual acceptance is verifier-owned when `flow-evidence-verifier` is available: each task carries a mechanically checked capsule manifest, `flow-evidence-verifier` alone defines and enforces capsule independence and the restore receipt contract, and Main independently inspects consequential evidence and owns the judgment.

## Planning and review

Execution-grade planned work applies COR/TTC/CRF/SEC as one integrated **plan quality gate** before coding, then uses `flow-acceptance-reviewer` for one strong final independent acceptance pass. That reviewer checks both plan conformance and correctness so plan defects are still findings. Verified material findings are batched into one correction wave; one scoped closure review is the default ceiling.

Standalone/unplanned changes, PR review and audits still use the existing specialist doctrine: bundled COR/security plus Flow TTC/Craft/audit lenses as applicable. The lenses remain principles of record; v8 changes when they are paid for, not what they mean.

## Artifacts

Flow working state lives in the project at `.flow/` and is hidden from git through the repository's personal exclude file (`.git/info/exclude`), which the always-on `flow-artifacts` rule adds idempotently before the first write. The entry lives in the git common directory, so linked worktrees share it, while each checkout keeps its own `.flow/` contents; a worker in another checkout, worktree or isolated workspace receives artifacts by absolute path into the originating checkout. Shared-mode LDD ledgers are force-added once and then tracked normally, with a leak check at every checkpoint; local asset-production bundles live under `.flow/assets/<asset-id>/`; audit reports under `docs/reports/` are the only other tracked Flow write. `flow-integrating` removes an integrated slug's working state.

## LDD

LDD state lives under `.flow/ldd`, never `.omp`, because `.omp` affects OMP discovery/config semantics. Agent Hub/transcripts capture execution history; the ledger captures durable project decisions/state and outranks conversation summaries after compaction/resume.

The ledger does **not** permanently own harness mechanics. Historical mailbox/isolation/model-routing instructions are version-sensitive and must be revalidated against the current Flow/OMP stack on resume.
