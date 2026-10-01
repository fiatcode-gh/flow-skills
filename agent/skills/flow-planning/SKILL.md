---
name: flow-planning
description: Use after the governing WHAT/WHY contract is approved when consequential implementation HOW should be decision-complete before coding; write an execution-grade plan that moves judgment up front so constrained executors can work cheaply and escalate contradictions instead of improvising.
---

# Flow planning

Flow planning turns an approved contract or specification into an **execution-grade plan**. The goal is decision completeness, not document volume: pay for consequential judgment once, record it durably, and let implementation mostly follow the plan.

- Use this skill when the implementer would otherwise decide something material: file/module ownership, interfaces, state/data flow, error semantics, compatibility behavior, test shape, performance/lifetime constraints, or integration order.
- Skip it for a tiny, bounded change whose implementation is already obvious from the contract and repository patterns.

## 1. Establish the planning boundary

- Read the approved governing contract/spec, current source seams, tests, project rules, branch/worktree state and any validated external planning handoff.
- For substantial work, `flow-design` forms the WHAT/WHY contract and gets it approved before this skill begins.
- Planning carries no implementation authorization.
- Write `.flow/plans/<slug>/PLAN.md` plus `plan-tasks/01-<task>.md`, `02-<task>.md` and so on. The `flow-artifacts` rule owns the exclude guard and the lifecycle.
- A compact one-file `PLAN.md` is fine when it stays readable and no worker needs a sliced brief.

Who plans:

- For substantial planning, Main must dispatch `flow-planner` (`@plan`) to own the consequential HOW recon and writing.
- Skip that dispatch only when a current, validated external plan already meets this skill's execution-grade bar (section 5 and "External handoffs").
- Dispatch the planner only after the user explicitly approves the completed governing contract (the WHAT boundary). `flow-design` step 7 says what counts as that approval.
- Put this block (the Flow gate block) in every planner task brief.

```text
Flow gate:
- Scope: <contract slug>
- Contract: <path to the approved contract>
```

- `flow-governance-guard` rejects the dispatch when the contract approval is missing or its digest no longer matches the current artifact. Example: the contract was edited after approval.
- Main owns the governing contract, validates the planner's receipt and owns plan acceptance.
- Main does not write substantial consequential HOW itself.
- Record the source revision and dirty-state assumptions the plan was derived from.
- When the source revision changes, revalidate the affected parts. Do not replan by ritual.

Units and tasks:

- When the work has parts that could ship separately, stop and report that to Main. These are units: Main proposes the split to the user (`flow-design` "Multi-unit work"). Example: an invoice export and a payment-retry job that can each be released alone.
- Split slices that can be proved alone inside one release into tasks yourself (section 2). Example: a new database column, then the API that fills it; each is proved alone, but they ship together.

## 2. Front-load consequential judgment

An execution-grade plan settles, where applicable:

- exact files/modules and their responsibilities;
- task dependency/order and independently verifiable boundaries;
- interfaces/signatures/data ownership/state flow;
- error, edge, async/concurrency and compatibility semantics;
- concrete behavioral tests and expected Red/Green evidence;
- integration points and migration/serialization concerns;
- performance/allocation/lifetime constraints when material;
- explicit non-goals and forbidden scope expansion.

- Use exact symbols, file paths and repository-native commands.
- Include code/pseudocode only where an exact recipe prevents rediscovery. Do not paste large code just to look complete.

Right-sized tasks:

- Give each task one **independently provable behavioral slice**, worth one implementation/context boundary.
- Split a brief when any of these holds:
  - it holds more than one Red→Green proof cluster that can each reach a valid repository handoff state on its own;
  - it crosses more than one independently checkpointable seam;
  - it covers unrelated subsystems that can be verified separately.
- When a task names more than one independent proof cluster, split it, or state explicitly why no valid intermediate handoff exists. Example: an atomic schema or type migration that cannot leave the repository buildable between its halves.
- Do not split one inseparable behavior just to meet a file, turn or token count.
- Do not make a separate task for setup or one-line propagation that belongs to a neighboring deliverable.

Fresh-executor capsule:

- Make each `plan-tasks/*.md` a **fresh-executor capsule**: a new executor session starts from it without any earlier worker transcript or context.
- Give it current paths/symbols/preconditions, locked decisions, proof commands and the expected handoff state.
- State the starting repository condition and the compact completion receipt the next controller should receive.
- When a task depends on an earlier task, depend on repository state/artifacts and named proof, not remembered conversation.

## 3. Define executor discretion

Every implementation task states four boundaries:

```text
Locked decisions:
- behavior/interfaces/ownership that must not drift

Executor discretion:
- inconsequential local choices the worker may make without escalation

Proof:
- failing/behavioral proof, focused checks, formatter/static checks

Escalate when:
- repository reality contradicts the plan
- a required interface/test cannot work as specified
- following the plan would knowingly introduce a defect
- scope/data/architecture/error semantics must change
```

The executor may recognize a bad plan. It may not silently redesign it.

## 4. Plan quality gate — move review left

Before the plan becomes execution-grade, check it against the normal review concerns. This is one integrated planning gate, not four automatic reviewer dispatches.

- **COR** — invariants, ownership, edge/error paths, integration and consequential failure modes are decided.
- **TTC** — changed behavior maps to named tests/proofs, including negative/boundary/compatibility cases where applicable. Expected Red evidence is stated.
- **CRF**:
  - each planned code unit has one job; no planned dead code, needless abstraction, duplication or pathological lifetime/allocation behavior;
  - new files, types and interfaces use the repository's domain model and names. Example: the repository says `Order`, so name it `OrderRefund`, not `PurchaseReversal`. If the repository has no domain model, impose none.
- **SEC** — record run or skip, with the reason. When applicable, the plan makes security boundaries and abuse/error behavior explicit.

- Challenge the plan itself. Plan compliance is not correctness.
- When a planned instruction would create a defect, repair the plan. Do not teach later reviewers to defend it.
- End the plan with a compact `Plan quality gate` receipt: COR/TTC/CRF/SEC dispositions and any residual risks deliberately left to implementation evidence.

## 5. Mark execution grade

A plan is `execution-grade` only when:

- no consequential implementation choice is silently delegated to the executor;
- task interfaces agree across producer/consumer boundaries;
- each task has concrete proof and escalation conditions;
- placeholders such as TODO/TBD/"handle edge cases" are gone;
- source assumptions are current enough for the planned surfaces;
- the integrated plan quality gate passes.

When any of these fails, keep the artifact as strategy/draft and route the unresolved judgment through planning/design.

## 6. Execution handoff

- Main validates the plan receipt and obtains or retains the normal implementation authorization boundary.
- Plan receipt validation does not itself authorize implementation.
- For substantial planned work, Main presents the completed execution-grade plan and gets **explicit user plan approval** before the first production-writing worker.
- Bind that approval with `flow_gate`: call `present` for `kind=plan` with the same Flow scope, the exact `PLAN.md` path and the user-facing dependency/locked-decision/proof summary. Then call `approve`.
- `flow-execution` section 1 says what does not count as plan approval.
- A recorded prior approval stays valid while the approved plan artifact is materially unchanged.
- Editing the plan changes its digest. That mechanically blocks production-writer dispatch until the amended plan is presented and approved again.
- Then `flow-execution` routes each writer (section 2), orders and isolates the tasks (section 3) and writes the briefs (section 4).
- One execution-grade task brief normally gets one fresh `flow-plan-executor` session.
- The planner's handoff is receipt-first: source/base revision and dirty-state assumption, plan/task paths, dependency shape, quality-gate disposition, residual risks and the exact next action.

## External handoffs

- A validated external bundle may already contain an execution-grade plan. Preserve it and do not repeat planning when it satisfies this skill and the approved governing WHAT/WHY contract, and its source assumptions are still current.
- When it holds a good strategy but not an execution-grade plan, keep the settled strategy and refine only the missing HOW. Do not reopen settled WHAT/WHY.
