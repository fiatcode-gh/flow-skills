---
name: flow-execution
description: Use when local implementation is authorized; prefer constrained execution from an execution-grade plan, preserve semantic fallback for unresolved judgment, verify by ownership, and close planned work with one strong acceptance review plus bounded correction.
---

# Flow execution

OMP owns plan approval, task spawning, isolation and Agent Hub. This skill owns execution judgment. The same execution model applies inside and outside LDD.

## 1. Orient

Read the governing request/spec/approved execution strategy and project rules. An accepted external planning handoff is evidence after local validation; it does not carry implementation authorization. For substantial work, a generic start/resume command is not local implementation authorization: before dispatching a production-writing worker, require recorded explicit approval of the governing contract and execution-grade plan. Under `flow-ldd`, the same authorization rule applies within the unit-contract authority; when a tiny/obvious LDD unit deliberately skips a separate plan, require explicit direct-implementation approval after contract approval. Ordinary tiny/mechanical non-LDD work remains governed by the user's concrete request and the Main-direct lane. Inspect branch/worktree and dirty state. Identify the **dependency graph**, not just a task list.

Classify the execution lane before dispatch:

- current **execution-grade plan** satisfying `flow-planning` → constrained `flow-plan-executor` lane;
- consequential HOW still unresolved / plan contradiction / debugging or semantic diagnosis → `flow-implementer` (`@task`) or return through `flow-planning`/design;
- exact behavior-preserving/mechanical leaf or already-diagnosed correction → `sonic` (`@smol`).

Do not treat a strategy document as execution-grade merely because it is detailed. The plan must lock consequential decisions, concrete proof and escalation boundaries. Conversely, do not rerun planning when a validated current external plan already meets that contract.

Classify units:

- independent against the same base → may run concurrently;
- dependent on another unit's result/interface → serialize or start from the verified updated base;
- overlapping mutable surface → one writer at a time unless the units are explicitly redesigned to be independent.

Separate unresolved **judgment** from plan-following work. Move consequential judgment up into `flow-planning` when doing so will make a substantial unit cheaper/safer to execute; do not manufacture a plan artifact for a tiny obvious edit.

## 2. Route by work type

Use the cheapest owner that can correctly own the remaining judgment:

- **non-LDD only:** tiny cohesive edit where spawn overhead exceeds the work → Main may implement directly under `flow-tdd`; while `flow-ldd` is active, production edits remain delegated, including tiny corrections;
- bounded read-only fact finding → bundled `scout`, handed the symbols/paths already
  known so it verifies rather than rediscovers;
- fully specified **behavior-preserving** mechanical edit, or an already-diagnosed exact correction with an existing failing/mechanical proof and one obvious result → bundled `sonic` may be dispatched directly;
- new executable behavior whose consequential HOW/tests/interfaces are locked by a current execution-grade plan → `flow-plan-executor` (`@execute` constrained owner);
- semantic implementation/debugging/integration that still requires judgment, or a plan task promoted after contradiction → `flow-implementer` (`@task` semantic owner).

`@execute` is not a synonym for `@smol`. It may implement new behavior because the expensive judgment and required proof were deliberately settled upstream; its contract is to follow locked decisions and escalate contradictions rather than improvise.

Do not route ambiguous/new behavior, architecture, migration semantics, concurrency/error semantics or root-cause diagnosis to `sonic`. Do not route them to `flow-plan-executor` unless the execution-grade plan has actually settled them.

A `flow-implementer` may itself use `scout` for bounded discovery and `sonic` for settled mechanical leaves. A `flow-plan-executor` does not spawn children; reducing orchestration fan-out is part of the planned lane's economics.

## 3. Preserve semantic ownership; rotate plan executors

Preserve the unit owner when semantic judgment benefits from persistent context; rotate task-scoped plan executors instead of carrying their model context across execution-grade task boundaries.

For unresolved semantic work on a suitable feature checkout, prefer a **non-isolated** `flow-implementer` owner so its judgment context can survive clarification and semantic corrections.

For execution-grade planned work, preserve the **workspace**, not the executor session: each `plan-tasks/*.md` normally gets one fresh non-isolated `flow-plan-executor`, run sequentially in the same suitable feature checkout. Repository state/artifacts carry prior-task results forward; model context does not. Do not batch adjacent plan tasks into one persistent executor merely to avoid cold start.

Use task isolation for independent concurrent writers or an explicitly disposable experiment. Do not isolate by reflex: a completed isolated task is intentionally disposable and may not be revivable after its workspace is applied/cleaned.

Keep a semantic unit owner's agent id/name when that ownership is useful. Do not preserve/revive a plan executor across plan-task boundaries. If evidence reveals missing/invalid plan judgment, repair/promote through `flow-planning`/`flow-implementer` rather than asking the cheap executor to redesign.

Treat Main/controller context as phase-scoped, but an active Main cannot rotate itself. At a durable phase boundary — especially plan accepted → execution supervision, or coherent implementation accepted → long device/integration verification — if quota/context pressure makes a fresh controller useful and durable artifacts already carry the needed state, write a recovery/forward checkpoint and prepare a terse top-level resume handoff. Continue the current interactive session unless the user or harness actually starts a fresh one; do not interrupt useful interaction solely for context hygiene. Rotation is an optional quota/context optimization, never a hidden orchestration step or a new approval gate.

## 4. Write a verification-capable brief

Worker briefs are self-contained: intended behavior, exact scope/subsystem, governing constraints/interfaces, observable acceptance criteria, workspace/concurrency context and verification scope. Do not paste the whole conversation. Do not pass concrete model names.

For `flow-plan-executor`, prefer artifact references over pasted plan prose: give the contract path, `PLAN.md` path, exact assigned `plan-tasks/*.md`, current base/head and verification ownership. The executor reads the small plan index/global constraints plus its assigned task files, not the entire epic/history.

Before spawning a writing worker, run a **dispatch preflight**. The brief must positively state all four of these:

1. the focused behavioral/static proof the writer owns;
2. the canonical formatter responsibility for touched files (or the concrete reason it cannot be run safely);
3. which focused lint/type/build checks the writer may run;
4. which broader/project-wide gates remain with Main, and why.

If any of those are absent or the brief contains a blanket verification prohibition, repair the brief before dispatch. Use a compact footer when helpful so the permission cannot disappear in prose:

```text
Verification ownership:
- Focused proof: <commands/checks the writer must run>
- Formatter: <scoped formatter command or concrete safety exception>
- Focused static/build: <allowed/required checks>
- Main-owned gates: <broader commands and why they stay with Main>
```

Do not spawn a writing worker until all four entries are concrete.

Never broadly tell a writer "do not test/build/format because Main will verify." Instead:

- require focused repository-native proof of the writer's own changes;
- make touched-file formatting the writer's responsibility when the repository's canonical formatter can be scoped safely to those files; do not reserve ordinary touched-file formatting for Main;
- allow focused lint/type/build checks owned by the writer's surface;
- explicitly authorize broader/project-wide gates when the worker is the sole writer or otherwise isolated from sibling in-progress edits;
- reserve repo-wide autoformatting and final cross-unit/full-repository acceptance for Main when those commands could rewrite/check sibling-owned or unrelated work.

## 5. Clarify live

Workers should not terminally fail at the first real ambiguity. They first derive what they can from the contract, repository, tests and tools. When the unresolved point would change/extend approved behavior, scope, interface, data contract or architecture, the `flow-implementer` asks Main through `hub` with concise evidence + recommendation and continues any independent work. It awaits only when completely blocked.

Main may clarify within the already-approved contract. Main must not silently expand authorization. If the answer requires a new product/design/user choice or proves the governing plan wrong, tell the worker to stop at a clean boundary and return BLOCKED, then route through design/Plan/user decision.

When Main has useful independent controller work, do it while children run. When the next meaningful action depends on a child and no useful independent work remains, native `hub wait` is valid. In OMP, `hub wait` is interruptible by user steering: it parks Main's autonomous execution but does not prevent the user from prompting, and ordinary child job results may also self-deliver.

Choose waiting by dependency, not ritual. Prefer one appropriately scoped wait when Main genuinely needs the result next; otherwise yield and let completion self-deliver. Do not turn waiting into progress polling: repeated short `hub wait` calls or repeated `hub jobs` snapshots without new work are orchestration noise. `hub send` with `await: true` or a peer-filtered reply wait remains useful for targeted live request/response. A completed non-isolated owner revived by `hub send` is a live agent, not a new task job: do not wait on its old task job id after revival.

The `flow-evidence-guard` runtime extension deliberately does not intercept Agent Hub waits. OMP owns wait and steering mechanics; this extension only backstops the evidence-verifier capsule manifest.

## 6. Accept by layered evidence

Consume delegated work **receipt-first**. Planner/executor/reviewer/verifier receipts should identify status, start/base and resulting head or dirty state, artifact/task scope, files/evidence changed, proof commands/results, deviations or residual risks, and the exact next action. Use that receipt to target inspection; it is still a claim, not proof, so independently inspect consequential diffs/evidence instead of broadly replaying the child's entire recon.

For each completed unit/wave:

1. inspect the actual patch/files, not only worker prose;
2. inspect material nested-child changes as part of the owning unit;
3. confirm the worker ran focused proof appropriate to its changed surface;
4. independently verify the **consequential claim or integration boundary**, not necessarily the exact same full suite again;
5. check integration points with already accepted work;
6. reject/correct deviations before dependent work proceeds.

A child proves its leaf; the semantic unit owner proves the combined unit; Main proves integration/high-risk claims and owns final repository acceptance. Delegation never transfers verification responsibility, but independent evidence does not require ritual duplicate full-suite runs.

## 7. Route corrections cheaply

When verification/review finds a problem:

- first verify/deduplicate material findings and **batch the verified set** into one correction round where possible; do not wake the owner once per reviewer arrival;
- exact, fully diagnosed mechanical correction with an existing failing/mechanical proof and one obvious result → direct `sonic` is appropriate;
- formatter-only failure → have the current owner run the canonical formatter on its touched files, or route the exact formatter correction to `sonic`; never ask a semantic owner to imitate formatter output by hand;
- correction inside a still-valid execution-grade plan → dispatch a **fresh bounded** `flow-plan-executor` with one exact correction brief and focused proof; do not revive a large prior executor context;
- correction needing semantic context/judgment → message/revive the existing `flow-implementer` owner when available; when waiting for a revived owner, use `hub send` with `await: true` or a peer-filtered reply wait rather than the completed task's old job id;
- owner unavailable/non-revivable → dispatch the appropriate new bounded owner as fallback;
- correction exposes a plan defect or invalidates the governing contract → stop the affected work and return through `flow-planning`/design/user decision.

After a correction, rerun the proof affected by that edit plus any integration/final gates made stale. Do not restart the entire workflow by ritual. Planned acceptance gets at most one scoped closure review by default; a further review generation requires a concrete unresolved acceptance risk.

If a production-, asset-, or build-affecting correction happens after the coherent result already crossed acceptance — including a defect discovered during device/manual/external evidence — re-enter the stability barrier defined in the `flow-evidence` rule before integration: scoped independent closure on the changed final tree, rerun of the evidence whose dependency surface changed, an explicit rationale for any reused evidence, and an additional scoped closure when that downstream failure is itself an unresolved acceptance risk.

## 8. Review proportionally

### Execution-grade planned path

The plan quality gate already moved COR/TTC/CRF/SEC reasoning left. Do **not** automatically pay for the same specialist fan-out again after implementation. After the coherent planned change and focused/integration proof, dispatch one `flow-acceptance-reviewer` (`@slow`) with the governing contract, execution-grade plan/task paths, exact diff/base and evidence. It independently checks contract satisfaction, plan conformance, correctness, tests/contracts, craft and applicable security; it must challenge bad plans rather than advocate for them.

Treat any required acceptance/closure review or correction capable of changing the evidence surface as a **stability barrier** before expensive downstream acceptance. While that dependency is unresolved, Main remains interactive and may do read-only preparation that cannot create or stale acceptance evidence, but it **must not begin device/emulator/manual/external evidence capture** whose validity depends on the reviewed tree. Consume the completion event, verify/deduplicate findings, complete required corrections and refresh affected automated proof before starting that gate. Non-blocking orchestration means foreground interactivity, not speculative execution past unresolved dependency boundaries.

Verify Critical/Important findings, deduplicate them, send one batched correction round, then use one scoped acceptance closure review when independent confirmation is still needed. Minor non-load-bearing findings may be parked rather than forcing another expensive loop. Specialist review is added only when a concrete residual risk warrants it (for example a meaningful security boundary or hard concurrency/data-integrity issue).

### Unplanned / standalone review path

For changes that did not come through an execution-grade plan, keep the existing applicability-driven lens doctrine:

- Correctness: OMP bundled `reviewer` (normal strong review).
- TTC: `flow-ttc-reviewer` when behavior/tests/validation/migrations/types/schemas/contracts changed.
- Craft: `flow-craft-reviewer` for non-trivial logic, abstractions, docs/comments, cross-module refactors, duplication/nesting or mixed responsibilities.
- Security: built-in `security-reviewer` or native `security_scan` when the change crosses a meaningful security boundary.

Before specialist dispatch, record an explicit disposition for **COR / TTC / CRF / SEC**: run or skip, with one short reason grounded in the actual changed surface. Run applicable lenses in parallel and blind to one another. Verify Critical/Important findings before acting. After fixes, rerun only affected/newly applicable lenses; a complete review round is not automatic.

## 9. Close execution

When the governing plan/user expects local commits, commit coherent behavior units rather than one mechanical task per commit by ritual; use Conventional Commits and the repository's pre-commit checks. Do not create commits merely because an internal worker boundary existed.

Run or reuse fresh Main-owned final verification while its evidence remains fresh for the claims it covers. Inspect the final diff and classify any later edit by which proof it actually invalidates instead of ritual-rerunning every broad gate.

Before the **first device/emulator/manual/external acceptance action** — not after setup has already started — write a **durable recovery checkpoint** at `.flow/checkpoints/<head>.md` when the work has a durable state surface; under `flow-ldd`, record the same checkpoint in the ledger. This includes the first ADB/device command, emulator/app driving, screenshot capture, manual smoke interaction, or other acceptance action likely to cross a provider/session window. Record exact head/tree and dirty/user-owned state, evidence already accepted and why it is still fresh, remaining acceptance criteria, relevant external/device state and the exact next action. A session/provider failure after that checkpoint must be safely resumable without reconstructing hidden conversation state.

When the remaining gate is primarily visual/device evidence rather than implementation judgment, Main **must not personally drive a multi-step device/manual acceptance sequence** when `flow-evidence-verifier` (`@vision`) is available. Main owns the durable checkpoint, acceptance brief, consequential evidence inspection and final acceptance judgment; fresh bounded verifier sessions own the designated environment/device operations and evidence capture. A trivial single read/observation that does not benefit from delegation may stay with Main.

**One verifier session owns one coherent evidence capsule.** Before dispatch, split the gate into independently restartable capsules. Every `flow-evidence-verifier` task brief must contain this manifest **inside that task's own brief** (not only shared batch context):

```text
Evidence capsule:
- ID: <stable short id>
- Owns: <one coherent scene family/device state/acceptance cluster>
- Independent split check: none | <why the named evidence is inseparable>
- Excludes: <other capsules left to fresh verifier sessions>
- Restore obligation: NONE | <state that must be restored>
```

The evidence-capsule runtime preflight rejects verifier dispatches missing these markers; the verifier independently rejects a manifest that still packs separable work. Capsule independence — the modality/operator split and the ban on proxy input for criteria that require physical interaction — is defined once in `flow-evidence-verifier`; split the gate by those rules before dispatch.

Fresh verifier sessions share durable device/repository/evidence state, not transcript context. Give each verifier exact acceptance criteria, allowed environment/device mutations and evidence destination (default `.flow/evidence/<head>/<capsule-id>/`, as an absolute path when the verifier runs in another checkout). It may operate the designated verification environment and capture evidence but does not edit production behavior or declare the unit accepted. Restore-bearing receipts follow the receipt contract in `flow-evidence-verifier` and the `MATCH` self-consistency rule in `flow-evidence`: Main must not infer `MATCH` from a contradictory receipt, and may reuse an unchanged `MATCH` receipt until later mutation or contrary evidence makes it stale. Main consumes each compact receipt, independently inspects consequential evidence, and owns the acceptance decision.

Then use `flow-integrating` for the user's integration choice.

At meaningful user-facing checkpoints, maintain the forward pointer: state the outcome, name the next Flow action, and say whether user input is needed. When the next action is internal and authorized, continue it rather than ending with a generic "what next?".
