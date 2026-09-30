---
name: flow-execution
description: Use when local implementation is authorized; prefer constrained execution from an execution-grade plan, preserve semantic fallback for unresolved judgment, verify by ownership, and close planned work with one strong acceptance review plus bounded correction.
---

# Flow execution

- OMP owns task spawning, isolation and Agent Hub. This repo's `flow-governance-guard` and `flow-evidence-guard` extensions provide `flow_gate` and the spawn checks. This skill decides who does what and when.

## 1. Check authorization

- Read the governing contract, the plan and the project rules. Check branch and dirty state per the `flow-safety` rule.
- Require two recorded approvals before the first production-writing worker on substantial work: the contract, then the plan (`flow_gate` `present`, then `approve`).
- Treat a start or resume command as no approval. Example: the user says "go ahead" after you show the plan. Call `flow_gate` for `kind=plan` first. Dispatch after the approval is recorded.
- Treat an external handoff (external chat or harness) as evidence. It approves nothing: validate it locally, then record the contract and plan approvals here.
- Read `flow-planning` for what counts as an execution-grade plan. A detailed strategy is not one. Do not re-plan a validated current plan that already meets it.
- Carry this block (the Flow gate block) in every `flow-plan-executor` and `flow-implementer` brief. The guard checks both artifact digests at spawn and blocks a missing or stale approval.

```text
Flow gate:
- Scope: <contract slug>
- Contract: <approved contract path>
- Plan: <approved PLAN.md path>
```

- Write `Plan: NONE` when the approved contract's work needs no separate plan. Example: a debugged fix sent to `flow-implementer`. After the contract approval, record approval with `flow_gate` `present` `kind=implementation` against the contract, then `approve`, before dispatch.
- Run tiny work on the user's concrete request alone. It runs in the Main-direct lane (section 2).

## 2. Route the work

Work to owner:
- A task from an execution-grade plan → fresh `flow-plan-executor` (`@execute`).
- Open judgment, debugging, or a plan contradiction → `flow-implementer` (`@task`), or back to `flow-planning`/`flow-design`.
- An exact mechanical edit, or a correction already diagnosed with one obvious result and existing proof → `sonic` (`@smol`).
- Read-only fact finding → `scout`. Give it the paths and symbols you already know.
- A tiny cohesive edit, where spawning costs more than the edit → Main writes it under `flow-tdd`. This is the Main-direct lane. It applies to multi-unit work too.

Rules:
- Never send ambiguous or new behavior, architecture, migration, concurrency or error semantics, or root-cause diagnosis to `sonic`.
- Send those to `flow-plan-executor` only when the plan has settled them. The executor follows locked decisions and escalates contradictions.
- A `flow-plan-executor` spawns no children. A `flow-implementer` may use `scout` and `sonic`.

## 3. Order and ownership

- Map the dependency graph first, not a task list.
- You may run independent units on the same base concurrently.
- Run dependent units in order, starting each from the verified updated base.
- Give one writer at a time to units that touch the same files, even in isolated workspaces.
- Give each plan task one fresh non-isolated `flow-plan-executor`, in order, in the same feature checkout. Never reuse an executor across plan tasks.
- Keep a semantic owner (`flow-implementer`) non-isolated and keep its id, so you can revive it for follow-ups.
- Isolate only independent concurrent writers or disposable experiments. A completed isolated workspace may not be revivable.
- You may write a checkpoint and a short resume handoff at a durable boundary under context pressure, since Main cannot rotate itself. It is optional and never a gate. Keep working in the current session.

## 4. Write the brief

- Make the brief self-contained: behavior, scope, constraints and interfaces, acceptance criteria, workspace and concurrency context, verification scope.
- Pass artifact paths, not pasted plans: contract, `PLAN.md`, the one assigned `plan-tasks/*.md`, base head.
- Do not paste the conversation. Do not name models.
- End every writer brief with this footer (the Verification ownership block). Fill all four entries concretely before you spawn.

```text
Verification ownership:
- Focused proof: <commands/checks the writer must run>
- Formatter: <scoped formatter command or concrete safety exception>
- Focused static/build: <allowed/required checks>
- Main-owned gates: <broader commands and why they stay with Main>
```

- Never tell a writer to skip its own tests, formatter or build because Main verifies later (`flow-evidence` rule: writers verify their own work).
- Make the writer run the canonical formatter on its touched files. Keep for Main only repo-wide formatting and gates that could touch sibling work.

## 5. Clarify and wait

- Expect workers to derive what they can, then ask you over `hub` when the answer would change approved behavior, scope, interfaces, data or architecture.
- Answer within the approved contract only. Never widen authorization.
- For a new design, product or user choice, or a wrong plan: tell the worker to stop at a clean boundary and return BLOCKED, then route it through `flow-design`, `flow-planning` or the user.
- Do independent work while children run.
- Use one `hub wait` when you need that result next. User steering can interrupt it.
- Do not poll. Repeated short `hub wait` calls or repeated `hub jobs` snapshots are polling.
- Wait on a completed owner revived with `hub send` using `await: true`, or a peer-filtered reply wait, never on its old job id. It is a live agent.

## 6. Accept work

1. Read the receipt first. It is a claim, not proof.
2. Inspect the actual diff, including nested children's changes.
3. Confirm the worker ran focused proof for its surface.
4. Independently verify the consequential claim or integration boundary.
5. Check integration with already accepted work.
6. Correct deviations before dependent work starts.

Each layer proves its own scope. Do not rerun full suites as ritual (`flow-evidence` rule).

## 7. Route corrections

- Verify and deduplicate findings. Batch the verified set into one correction round.
- Send an exact diagnosed fix to `sonic`.
- For a formatter-only failure, have the owner run the canonical formatter on its touched files, or send the exact fix to `sonic`. Never hand-imitate formatter output.
- Send a fix inside a still-valid plan to a fresh `flow-plan-executor` with one correction brief and its focused proof.
- Send a fix needing semantic context to the existing `flow-implementer` (wait as in section 5). Send it to a new bounded owner when that owner is gone.
- Stop that work for a plan defect or invalid contract. Return through `flow-planning`, `flow-design` or the user.
- Rerun only the proof the correction affects, plus gates it made stale.
- Run one scoped closure review by default. Run another only for a concrete unresolved acceptance risk.
- For a production, asset or build change after acceptance, follow the stability-barrier steps in section 8 of this skill.

## 8. Review proportionally

- Dispatch one `flow-acceptance-reviewer` (`@slow`) after the coherent change and its focused/integration proof, for planned work. Give it the contract, plan and task paths, diff/base and evidence.
- Do not fan out lens reviewers automatically. Add a specialist only for a concrete residual risk (a real security boundary, hard concurrency or data integrity).
- Treat the acceptance review as a barrier. Start no device, emulator, manual or external evidence until it and its corrections settle. Read-only preparation is fine.
- Run `flow_gate action=accept` with the scope and the receipt as source, after you accept the review receipt.
- A later production, asset or build change reopens the stability barrier defined in the `flow-evidence` rule: run a scoped closure review, rerun the affected evidence, then record `flow_gate action=accept` again. Until then the guard blocks verifier dispatch.
- You may park minor findings that carry no load.
- Follow the change-lens selection in `flow-review` for unplanned changes.

## 9. Close execution

- When local commits are expected, commit coherent behavior units with Conventional Commits and the repository's pre-commit checks. Do not commit once per worker by rule.
- Reuse fresh final proof by the claim it covers (`flow-evidence` rule).
- Write `.flow/checkpoints/<head>.md` before the first device, emulator, manual or external acceptance action.
- Treat each of these as that action:
  - the first ADB or device command, driving an emulator or app, a screenshot, a manual smoke step;
  - the first command against a live production server or other hard-to-recover remote host (deploy, migration, service restart, config change, on-host check);
  - anything likely to cross a provider/session window.
- Record head/tree, dirty and user-owned state, accepted evidence and why it is fresh, remaining criteria, device/remote state and the exact next action in the checkpoint.
- Do not drive multi-step device or manual acceptance yourself, as Main, when `flow-evidence-verifier` (`@vision`) is available. A single trivial observation may stay with Main.
- Put this manifest (the Evidence capsule block) in each verifier task's own brief. One verifier session owns one evidence capsule. The guard rejects a verifier dispatch without it.
- Start each verifier brief with the Flow gate block, with at least `- Scope:`. The guard blocks verifier dispatch without it, and until `flow_gate action=accept` matches the current repository state.

```text
Evidence capsule:
- ID: <stable short id>
- Owns: <one coherent scene family/device state/acceptance cluster>
- Independent split check: none | <why the named evidence is inseparable>
- Excludes: <other capsules left to fresh verifier sessions>
- Restore obligation: NONE | <state that must be restored>
```

- Split the gate by the capsule-independence rules defined once in `flow-evidence-verifier`, before dispatch.
- Give each verifier the exact acceptance criteria and the environment/device changes it may make. Send evidence to `.flow/evidence/<head>/<capsule-id>/` (an absolute path when the verifier runs in another checkout). Never let the verifier edit production code or declare acceptance.
- Follow the `MATCH` self-consistency rule in `flow-evidence` for restore receipts. Inspect consequential evidence and own acceptance as Main.
- Use `flow-integrating` next.
- Keep the forward pointer at user-facing checkpoints: the outcome, the next Flow action, and whether user input is needed. Continue authorized internal actions.
