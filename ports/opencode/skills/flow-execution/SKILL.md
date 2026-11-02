---
name: flow-execution
description: Use when local implementation is authorized; prefer constrained execution from an execution-grade plan, preserve semantic fallback for unresolved judgment, verify by ownership, and close planned work with one strong acceptance review plus bounded correction.
---

# Flow execution

- OpenCode owns subagent spawning and permission prompts. `flow_approve` and `flow_check` (Approval record in `AGENTS.md`) record and check approvals. This skill decides who does what and when.

## 1. Check authorization

- Read the governing contract, the plan and the project rules. Check branch and dirty state per Safety in `AGENTS.md`.
- Require two recorded approvals before the first production-writing worker on substantial work: the contract, then the plan (`flow_approve <slug> contract <path>`, then `flow_approve <slug> plan <PLAN.md path>`).
- Treat a start or resume command as no approval. A "go ahead" after you show the plan in chat lets you run `flow_approve <slug> plan <PLAN.md path>`. Dispatch only after the approval is recorded.
- An external handoff approves nothing (Safety in `AGENTS.md`): validate it locally, then record the contract and plan approvals here.
- `flow-planning` section 5 and "External handoffs" decide whether a plan is execution-grade. Do not re-plan a validated current plan that meets them.
- Carry this block (the Flow gate block) in every `flow-plan-executor` and `flow-implementer` brief. Before each dispatch, run `flow_check <slug> contract <path>` and `flow_check <slug> plan <PLAN.md path>`; for `Plan: NONE` work, run `flow_check <slug> implementation <contract path>` instead of the plan check. `stale` or `missing` blocks the dispatch.

```text
Flow gate:
- Scope: <contract slug>
- Contract: <approved contract path>
- Plan: <approved PLAN.md path>
```

- Write `Plan: NONE` when the approved contract's work needs no separate plan. Example: a debugged fix sent to `flow-implementer`. After the contract approval, show the `Plan: NONE` route in chat and end your turn. Once the user agrees, run `flow_approve <slug> implementation <contract path>` before dispatch.
- Tiny work needs no contract. Work is tiny only when all hold:
  - at most 30 hand-written changed lines (added plus removed) across at most 3 files;
  - no behavior beyond the user's exact request;
  - no migration, schema change, data rewrite or release pipeline.
- Lines a tool generated do not count: lockfiles, codegen output, snapshots a tool regenerated.
- Work that is not tiny needs a `flow-design` contract, even when the user chose the fix in chat.
- Main writes tiny work in the Main-direct lane (section 2).
- Run a throwaway spike the user asks for on a scratch branch, with no contract. Never merge any of it; merging spike code needs the normal flow.

## 2. Route the work

Work to owner:
- A task from an execution-grade plan → fresh `flow-plan-executor`.
- Open judgment, debugging, or a plan contradiction → `flow-implementer`, or back to `flow-planning`/`flow-design`.
- An exact mechanical edit, or a correction already diagnosed with one obvious result and existing proof → the `general` subagent with an exact brief (the mechanical lane).
- Read-only fact finding → the `explore` subagent. Give it the paths and symbols you already know.
- A tiny cohesive edit (section 1), where spawning costs more than the edit → Main writes it under `flow-tdd`. This is the Main-direct lane. It applies to multi-unit work too.

Rules:
- Never send ambiguous or new behavior, architecture, migration, concurrency or error semantics, or root-cause diagnosis to the mechanical lane.
- Send those to `flow-plan-executor` only when the plan has settled them. The executor follows locked decisions and escalates contradictions.
- A `flow-plan-executor` spawns no children. A `flow-implementer` may use `explore` and `general`.

## 3. Order and ownership

- Map the dependency graph first, not a task list.
- You may run independent units on disjoint files concurrently as background subagents.
- Run dependent units in order, starting each from the verified updated base.
- Give one writer at a time to units that touch the same files.
- Give each plan task one fresh `flow-plan-executor`, in order. Never reuse an executor across plan tasks.
- Keep a `flow-implementer`'s `sessionID`, so you can continue it for follow-ups.
- You may write a short resume handoff at a clean boundary under context pressure. It is optional and never a gate, unlike the section 9 checkpoint. Keep working in the current session.

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

- Make the writer run the canonical formatter on its touched files. Keep for Main only repo-wide formatting and gates that could touch sibling work.

## 5. Clarify and wait

- Expect a worker to derive what it can, finish independent work, then return `BLOCKED` with the question, evidence and a recommendation when the answer would change approved behavior, scope, interfaces, data or architecture. A subagent cannot ask you mid-run.
- Answer within the approved contract only. Never widen authorization.
- For a new design, product or user choice, or a wrong plan: tell the worker to stop at a clean boundary and return BLOCKED, then route it through `flow-design`, `flow-planning` or the user.
- Change a locked plan decision only by a plan edit, never by a message or a correction brief. Stop the worker first, as above. `flow-planning` sections 1 and 6 say who writes the edit and how it is approved. Example: an executor reports that locked decision D4 cannot work → stop it, edit the plan, get approval, dispatch.
- Do independent work while children run.
- Answer a `BLOCKED` return by calling `subagent` again with the child's `sessionID`. Background subagents notify you on completion.
- Do not poll.
- Continue a returned owner with its `sessionID`. Never start a new session for its follow-up.

## 6. Accept work

1. Read the receipt first. It is a claim, not proof.
2. Inspect the actual diff, including nested children's changes.
3. Confirm the worker ran focused proof for its surface.
4. Independently verify the consequential claim or integration boundary.
5. Check integration with already accepted work.
6. Correct deviations before dependent work starts.

## 7. Route corrections

- Verify and deduplicate findings. Batch the verified set into one correction round.
- Send an exact diagnosed fix to the mechanical lane.
- For a formatter-only failure, have the owner run the canonical formatter on its touched files, or send the exact fix to the mechanical lane. Never hand-imitate formatter output.
- Send a fix that keeps every locked decision to a fresh `flow-plan-executor` with one correction brief and its focused proof. A fix that changes one needs a plan edit (section 5).
- Send a fix needing semantic context to the existing `flow-implementer` (continue it with its `sessionID`). Send it to a new bounded owner when that owner is gone.
- Stop that work for a plan defect or invalid contract. Return through `flow-planning`, `flow-design` or the user.
- Rerun only the proof the correction affects, plus gates it made stale.
- Before acceptance, run one scoped closure review by default. Run another only for a concrete unresolved acceptance risk.
- After acceptance, follow section 8.

## 8. Review proportionally

- Dispatch one `flow-acceptance-reviewer` after the coherent change and its focused/integration proof, for planned work. Give it the contract, plan and task paths, diff/base and evidence.
- Treat the acceptance review as a barrier. Start no device, emulator, manual or external evidence until it and its corrections settle. Read-only preparation is fine.
- After you accept the review receipt, write it to `.flow/plans/<slug>/ACCEPTANCE.md` (`mkdir -p .flow/plans/<slug>` first for `Plan: NONE` work), show its verdict and findings in chat and end your turn. Once the user agrees, run `flow_approve <slug> accept .flow/plans/<slug>/ACCEPTANCE.md`.
- A production, asset or build change after acceptance reopens the stability barrier defined in the Evidence section of `AGENTS.md`. Record `accept` again after the closure review.
- You may park minor findings that carry no load.
- Follow the change-lens selection in `flow-review` for unplanned changes.

## 9. Close execution

- When local commits are expected, commit coherent behavior units with Conventional Commits and the repository's pre-commit checks. Do not commit once per worker by rule.
- Write `.flow/checkpoints/<head>.md` before the first device, emulator, manual or external acceptance action.
- Treat each of these as that action:
  - the first ADB or device command, driving an emulator or app, a screenshot, a manual smoke step;
  - the first command against a live production server or other hard-to-recover remote host (deploy, migration, service restart, config change, on-host check);
  - anything likely to cross a provider/session window.
- Record head/tree, dirty and user-owned state, accepted evidence and why it is fresh, remaining criteria, device/remote state and the exact next action in the checkpoint.
- `flow_approve <slug> accept <receipt>` covers the reviewed change. Check a contract criterion that the user judges (a look, a playtest) after it, in this order:
  1. `flow_approve <slug> accept <receipt>`;
  2. the checkpoint above;
  3. one trivial observation by Main, or the user's own look;
  4. the user's verdict.
- A change made from that verdict is a change after acceptance (section 8).
- Never drive multi-step device or manual capture yourself, as Main.
- Follow the `MATCH` self-consistency rule in the Evidence section of `AGENTS.md` for restore receipts. Inspect consequential evidence and own acceptance as Main.
- Use `flow-integrating` next.
