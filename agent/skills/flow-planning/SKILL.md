---
name: flow-planning
description: Use after the governing WHAT/WHY contract is approved when consequential implementation HOW should be made decision-complete before coding; write an execution-grade plan that moves judgment up front so constrained executors can work cheaply and escalate contradictions instead of improvising.
---

# Flow planning

Flow planning converts an approved contract/specification into an **execution-grade plan**. The goal is decision completeness, not document volume: pay for consequential engineering judgment once, encode it durably, then make implementation mostly plan-following.

Use this skill when the implementer would otherwise need to decide material file/module ownership, interfaces, state/data flow, error semantics, compatibility behavior, test shape, performance/lifetime constraints, or integration sequencing. Skip it for a tiny/bounded change whose implementation is already obvious from the contract and repository pattern.

## 1. Establish the planning boundary

Read the approved governing contract/spec, current source seams, tests, project rules, branch/worktree state and any validated external planning handoff. For substantial work, `flow-design` owns formation/approval of the WHAT/WHY contract before this skill begins. Planning does not carry implementation authorization.

For LDD, write under `.flow/ldd/<epic>/units/<unit>/`:

```text
PLAN.md
plan-tasks/
  01-<task>.md
  02-<task>.md
  ...
```

For non-LDD work, write `.flow/plans/<slug>/PLAN.md` plus `plan-tasks/`; the `flow-artifacts` rule owns the exclude guard and lifecycle. A compact one-file `PLAN.md` is fine when it stays readable and no worker needs a sliced brief.

For substantial planning — LDD or non-LDD — Main/controller must dispatch `flow-planner` (`@plan`) to own consequential HOW recon/writing unless a current validated external plan already satisfies this skill's execution-grade contract. Dispatch only after the completed governing contract/WHAT boundary has explicit user approval. Answers to clarification questions do not themselves approve the completed or materially amended contract. Main owns the governing contract, validates the planner receipt, and owns plan acceptance, but it does not author substantial consequential HOW itself.

Record the source revision/dirty-state assumptions the plan was derived from. A revision change triggers targeted revalidation, not ritual replanning.

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

Use exact symbols, file paths and repository-native commands. Include code/pseudocode only where an exact recipe prevents rediscovery; do not make line count a goal or paste large code merely to appear complete.

A task is right-sized when it owns one **independently provable behavioral slice** and is worth one implementation/context boundary. Split a brief when it contains multiple Red→Green proof clusters that can each reach a valid repository handoff state independently, when it crosses multiple independently checkpointable seams, or when unrelated subsystems can be verified separately. If a proposed task names more than one independent proof cluster, the planner must split it **or explicitly state why no valid intermediate handoff exists** (for example, an atomic schema/type migration that cannot leave the repository buildable between halves). Do not split one inseparable behavior merely to satisfy a numeric file/turn/token target, and do not create a fresh task for setup or one-line propagation that belongs to a neighboring deliverable.

Each `plan-tasks/*.md` must also be a **fresh-executor capsule**: enough current paths/symbols/preconditions, locked decisions, proof commands and expected handoff state for a new executor session to start without prior worker transcript/context. State the expected starting repository condition and the compact completion receipt the next controller should receive. When a task depends on an earlier task, depend on repository state/artifacts and named proof, not on remembered conversation.

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

The executor is allowed to recognize a bad plan. It is not allowed to silently redesign it.

## 4. Plan quality gate — move review left

Before the plan becomes execution-grade, inspect it through the normal review concerns. This is one integrated planning gate, not four automatic reviewer dispatches.

- **COR** — invariants, ownership, edge/error paths, integration and consequential failure modes are decided.
- **TTC** — changed behavior maps to named tests/proofs, including negative/boundary/compatibility cases where applicable; expected Red evidence is stated.
- **CRF** — responsibilities/decomposition are coherent; avoid planned dead abstractions, needless indirection, duplication, pathological lifetime/allocation behavior and mixed responsibilities.
- **SEC** — record run/skip with reason; when applicable, security boundaries and abuse/error behavior are explicit in the plan.

Challenge the plan itself. Plan compliance is not correctness: if a planned instruction would create a defect, repair the plan rather than teaching later reviewers to defend it.

The plan must end with a compact `Plan quality gate` receipt giving COR/TTC/CRF/SEC dispositions and any residual risks deliberately left to implementation evidence.

## 5. Mark execution grade

A plan is `execution-grade` only when:

- no consequential implementation choice is silently delegated to the executor;
- task interfaces agree across producer/consumer boundaries;
- each task has concrete proof and escalation conditions;
- placeholders such as TODO/TBD/"handle edge cases" are gone;
- source assumptions are current enough for the planned surfaces;
- the integrated plan quality gate passes.

If these do not hold, keep the artifact as strategy/draft and route unresolved judgment through planning/design rather than pretending it is cheap execution work.

## 6. Execution handoff

Main/controller validates the plan receipt and obtains/retains the normal implementation authorization boundary. For substantial planned work, plan receipt validation does not itself authorize implementation: Main presents the completed execution-grade plan and obtains **explicit user plan approval** before the first production-writing worker. A generic start/resume command does not create missing approval; a recorded prior approval remains valid while the approved plan envelope is materially unchanged. Under `flow-ldd`, this is the second gate after contract approval; non-LDD substantial work uses the same plan-approval boundary without LDD ledger mechanics. Then `flow-execution` chooses:

- current execution-grade plan → `flow-plan-executor` (`@execute`) for the constrained implementation lane;
- task/plan contradiction or deliberately unresolved semantic judgment → `flow-implementer` (`@task`) or return to planning/design;
- exact mechanical leaf → `sonic` (`@smol`).

Prefer handing workers artifact paths instead of pasting whole plans into prompts. **One execution-grade task brief normally gets one fresh `flow-plan-executor` session.** Sequential tasks stay non-isolated in the same suitable feature checkout and run one writer at a time, so repository state carries forward while model context does not. Do not preserve an executor across adjacent plan tasks merely to avoid cold start; Unit 3 field evidence showed resident-context growth can dominate that cost. Independent tasks may use isolated/concurrent executors only when they are genuinely independent.

The planner's handoff is receipt-first: source/base revision and dirty-state assumption, plan/task paths, dependency shape, quality-gate disposition, residual risks and the exact next action. Main uses that receipt to target any independent recheck instead of broadly replaying planner recon.

## External handoffs

A validated ChatGPT/other-harness bundle may already contain an execution-grade plan. Judge it against this contract and the approved governing WHAT/WHY contract. If it passes, remains compatible with that contract, and source assumptions remain current, preserve it and do not repeat planning. If it contains a good strategy but not an execution-grade plan, keep the settled strategy and refine only the missing HOW; do not reopen settled WHAT/WHY.
