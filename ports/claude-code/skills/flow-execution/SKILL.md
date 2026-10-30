---
name: flow-execution
description: Use when local implementation is authorized; prefer constrained execution from an execution-grade plan, preserve semantic fallback for unresolved judgment, verify by ownership, and close planned work with one strong acceptance review plus bounded correction.
---

# Flow execution

Claude Code owns agent spawning (the Agent tool), worktree isolation and agent continuation (`SendMessage`). This skill decides who does what and when.

## 1. Check authorization

- Read the governing contract, the plan and the project rules. Check branch and dirty state per the Safety rules.
- Require two approvals before the first production-writing worker on substantial work: the contract, then the plan. Run `flow_check` for both before each dispatch. `stale` or `missing` blocks it.
- Treat a start or resume command as no approval. A "go ahead" after you show the plan in chat lets you run `flow_approve <slug> plan <path>`. Dispatch only after that.
- An external handoff approves nothing: validate it locally, then get the contract and plan approvals here.
- `flow-planning` section 5 and "External handoffs" decide whether a plan is execution-grade. Do not re-plan a validated current plan that meets them.
- Carry this block (the Flow gate block) in every `flow-plan-executor` and `flow-implementer` brief:

```text
Flow gate:
- Scope: <contract slug>
- Contract: <absolute path to the approved contract>
- Plan: <absolute path to the approved PLAN.md>
```

- Write `Plan: NONE` when the approved contract's work needs no separate plan. Example: a debugged fix sent to `flow-implementer`. Show the `Plan: NONE` route in chat and end your turn. Once the user agrees, run `flow_approve <slug> implementation <contract path>` before dispatch.
- Run tiny work on the user's concrete request alone, in the Main-direct lane (section 2).

## 2. Route the work

Work to owner:
- A task from an execution-grade plan → fresh `flow-plan-executor`.
- Open judgment, debugging, or a plan contradiction → `flow-implementer`, or back to `flow-planning`/`flow-design`.
- An exact mechanical edit, or a correction already diagnosed with one obvious result and existing proof → `general-purpose` agent with `model: sonnet` (the mechanical lane).
- Read-only fact finding → `Explore`. Give it the paths and symbols you already know.
- A tiny cohesive edit, where spawning costs more than the edit → Main writes it under `flow-tdd`. This is the Main-direct lane.

Rules:
- Never send ambiguous or new behavior, architecture, migration, concurrency or error semantics, or root-cause diagnosis to the mechanical lane.
- Send those to `flow-plan-executor` only when the plan has settled them. The executor follows locked decisions and escalates contradictions.

## 3. Order and ownership

- Map the dependency graph first, not a task list.
- You may run independent units on the same base concurrently, each with `isolation: "worktree"`.
- Run dependent units in order, starting each from the verified updated base.
- Give one writer at a time to units that touch the same files.
- Give each plan task one fresh `flow-plan-executor`, in order. Never reuse an executor across plan tasks.
- Keep a `flow-implementer`'s agent id, so you can continue it with `SendMessage` for follow-ups.

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

- Never tell a writer to skip its own tests, formatter or build because Main verifies later.
- Make the writer run the canonical formatter on its touched files. Keep for Main only repo-wide formatting and gates that could touch sibling work.

## 5. Clarify and wait

- A subagent cannot ask you mid-run. It returns `BLOCKED` with the question, the evidence and its recommendation.
- Answer within the approved contract only, and continue the same agent with `SendMessage`. Never widen authorization.
- For a new design, product or user choice, or a wrong plan: route it through `flow-design`, `flow-planning` or the user before continuing the agent.
- Run agents in the background and do independent work meanwhile. You are notified when one finishes. Do not poll.

## 6. Accept work

1. Read the receipt first. It is a claim, not proof.
2. Inspect the actual diff, including nested children's changes.
3. Confirm the worker ran focused proof for its surface.
4. Independently verify the consequential claim or integration boundary.
5. Check integration with already accepted work. Merge a worktree branch into the session branch yourself.
6. Correct deviations before dependent work starts.

Each layer proves its own scope. Do not rerun full suites as ritual.

## 7. Route corrections

- Verify and deduplicate findings. Batch the verified set into one correction round.
- Send an exact diagnosed fix to the mechanical lane.
- For a formatter-only failure, have the owner run the canonical formatter on its touched files. Never hand-imitate formatter output.
- Send a fix inside a still-valid plan to a fresh `flow-plan-executor` with one correction brief and its focused proof.
- Send a fix needing semantic context to the existing `flow-implementer` with `SendMessage`, or to a new bounded owner when that one is gone.
- Stop that work for a plan defect or invalid contract. Return through `flow-planning`, `flow-design` or the user.
- Rerun only the proof the correction affects, plus gates it made stale.
- Run one scoped closure review by default. Run another only for a concrete unresolved acceptance risk.

## 8. Review proportionally

- Dispatch one `flow-acceptance-reviewer` after the coherent change and its focused/integration proof, for planned work. Give it the contract, plan and task paths, diff/base and evidence.
- Do not fan out lens reviewers automatically. Add a specialist only for a concrete residual risk (a real security boundary, hard concurrency or data integrity).
- Treat the acceptance review as a barrier. Start no manual or external evidence until it and its corrections settle.
- After you accept the review receipt, write it to `.flow/plans/<slug>/ACCEPTANCE.md`, show its verdict and findings in chat and end your turn. Once the user agrees, run `flow_approve <slug> accept <receipt path>`.
- A later production, asset or build change reopens the stability barrier (Evidence rules): run a scoped closure review, rerun the affected evidence, then record `accept` again.
- You may park minor findings that carry no load.
- Follow the change-lens selection in `flow-review` for unplanned changes.

## 9. Close execution

- Commit coherent behavior units with Conventional Commits and the repository's pre-commit checks. Do not commit once per worker by rule.
- Reuse fresh final proof by the claim it covers.
- For browser or visual evidence, use the preinstalled Playwright and Chromium. Give the evidence task its own agent and a brief with exact acceptance criteria. It never edits production code or declares acceptance.
- Use `flow-integrating` next.
- Keep the forward pointer at user-facing checkpoints: the outcome, the next Flow action, and whether user input is needed. Continue authorized internal actions.
