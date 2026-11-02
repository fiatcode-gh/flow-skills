---
name: flow-planning
description: Turn an agreed design into a decision-complete plan with task briefs, proof and a lens gate.
---

# Flow planning

Flow planning turns an agreed contract or specification into an **execution-grade plan**. The goal is decision completeness, not document volume: pay for consequential judgment once, write it into the plan, and let implementation mostly follow the plan.

- Planning carries no implementation authorization.
- This skill does not decide WHAT/WHY: the contract does, and `flow-design` forms it.
- This chat cannot run code or tests. It reads the repository through GitHub MCP and replies with the plan.

## When to Use

- Use this skill when the implementer would otherwise decide something material: file/module ownership, interfaces, state/data flow, error semantics, compatibility behavior, test shape, performance/lifetime constraints, or integration order.
- Skip it for a tiny, bounded change whose implementation is already obvious from the contract and repository patterns.
- Triggers: "plan this", "how do we implement", or the user has agreed a `flow-design` contract and asks what comes next.

## Prerequisites

- An agreed contract, from this chat or pasted by the user. If there is none, use `flow-design` first.
- GitHub MCP read access to the repository, at the commit SHA the contract pinned.

## Procedure

### 1. Establish the planning boundary

- Read the contract, current source seams, tests and project rules at the pinned SHA.
- Record that SHA, and state that the local checkout's uncommitted state was not observable.
- The plan is `IMPLEMENTATION-PLAN.md` plus `plan-tasks/01-<task>.md`, `02-<task>.md` and so on, in the reply, for `flow-handoff`.
- A compact single `IMPLEMENTATION-PLAN.md` is fine when no task needs its own brief.
- When the work has parts that could ship separately, stop and propose a unit split to the user. That is a design question for `flow-design`.
- Split slices that can be proved alone inside one release into tasks yourself (section 2). Example: a new database column, then the API that fills it; each is proved alone, but they ship together.

### 2. Front-load consequential judgment

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

- Make each `plan-tasks/*.md` a **fresh-executor capsule**: a fresh local executor session starts from it without any earlier worker transcript or context.
- Give it current paths/symbols/preconditions, locked decisions, proof commands and the expected handoff state.
- State the starting repository condition and the compact completion receipt the next controller should receive.
- When a task depends on an earlier task, depend on repository state/artifacts and named proof, not remembered conversation.

### 3. Define executor discretion

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

### 4. Plan quality gate

Before the plan becomes execution-grade, check it against the normal review concerns. This is one integrated planning gate.

- **COR** — invariants, ownership, edge/error paths, integration and consequential failure modes are decided.
- **TTC** — changed behavior maps to named tests/proofs, including negative/boundary/compatibility cases where applicable. Expected Red evidence is stated. Mark expected Red evidence as predicted: no test runs in this chat.
- **CRF**:
  - each planned code unit has one job; no planned dead code, needless abstraction, duplication or pathological lifetime/allocation behavior;
  - new files, types and interfaces use the repository's domain model and names. Example: the repository says `Order`, so name it `OrderRefund`, not `PurchaseReversal`. If the repository has no domain model, impose none.
- **SEC** — record run or skip, with the reason. When applicable, the plan makes security boundaries and abuse/error behavior explicit.

- Challenge the plan itself. Plan compliance is not correctness.
- When a planned instruction would create a defect, repair the plan. Do not teach later reviewers to defend it.
- End the plan with a compact `Plan quality gate` receipt: COR/TTC/CRF/SEC dispositions and any residual risks deliberately left to implementation evidence.

### 5. Mark execution grade

A plan is `execution-grade` only when:

- no consequential implementation choice is silently delegated to the executor;
- task interfaces agree across producer/consumer boundaries;
- each task has concrete proof and escalation conditions;
- placeholders such as TODO/TBD/"handle edge cases" are gone;
- source assumptions are current for the pinned SHA; local uncommitted state stays a local check;
- the integrated plan quality gate passes.

When any of these fails, keep the artifact as strategy/draft and route the unresolved judgment through planning/design.

## Output

`IMPLEMENTATION-PLAN.md`, in this order:

- a header with `Source: owner/name at <full SHA>`;
- `Status: proposal; local OMP grades and approves it`;
- the contract it implements (`CONTRACT.md` or the user's pasted contract);
- file/module map;
- global locked decisions;
- dependency shape;
- per-task summary;
- the `Plan quality gate` receipt (COR/TTC/CRF/SEC dispositions plus residual risks).

`plan-tasks/NN-<task>.md`, in this order:

- starting repository condition;
- deliverables;
- the four boundaries, with the section 3 labels exactly: `Locked decisions`, `Executor discretion`, `Proof`, `Escalate when`;
- the completion receipt the next controller should receive.

Hand the plan to `flow-handoff`. Local OMP grades it against its own planning doctrine and asks for its own plan approval.

## Pitfalls

- Never claim a test or command ran.
- Red evidence is predicted.
- Do not decide or change WHAT/WHY: go back to `flow-design`.
- Never say the plan is approved or execution-ready locally.
- No placeholders: TODO, TBD or "handle edge cases".

## Verification

Before replying, check the plan against section 5:

- every task has the four boundaries and a proof;
- Red is marked predicted;
- interfaces agree between producer and consumer tasks;
- the `Plan quality gate` receipt is present;
- the source SHA is recorded.
