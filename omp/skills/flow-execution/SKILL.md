---
name: flow-execution
description: Use when local implementation is authorized; prefer constrained execution from an execution-grade plan, preserve semantic fallback for unresolved judgment, verify by ownership, and close planned work with one strong acceptance review plus bounded correction.
---

# Flow execution

- OMP owns task spawning, isolation and Agent Hub. The Flow guard extensions provide `flow_gate` and the spawn checks. This skill decides who does what and when.

## 1. Check authorization

- Read the governing contract, the plan and the project rules. Check branch and dirty state per the `flow-safety` rule.
- Require two recorded approvals before the first production-writing worker on substantial work: the contract, then the plan (`flow_gate` `present`, then `approve`).
- Treat a start or resume command as no approval. A "go ahead" after you show the plan in chat lets you call `flow_gate` for `kind=plan`. Dispatch only after the approval is recorded.
- An external handoff approves nothing (`flow-safety`): validate it locally, then record the contract and plan approvals here.
- Carry this block (the Flow gate block) in the brief of every writer on contract work: `flow-plan-executor`, `flow-implementer`, `sonic`. The guard checks both digests at spawn and when you message a parked writer. It blocks a missing or stale approval.

```text
Flow gate:
- Scope: <contract slug>
- Contract: <approved contract path>
- Plan: <approved PLAN.md path>
```

- Write `Plan: NONE` when the approved contract's work needs no separate plan. Example: a debugged fix sent to `flow-implementer`. Show the `Plan: NONE` route in chat, with the contract when you can, so one yes covers both. End your turn. Once the user agrees, `present` `kind=implementation` against the contract and `approve` it before dispatch. When the yes covers the contract too, approve both in one call: `kind=contract,implementation`.
- Tiny work needs no contract. Work is tiny only when all hold:
  - at most 30 hand-written changed production lines (added plus removed) across at most 3 production files;
  - no behavior beyond the user's exact request;
  - no migration, schema change, data rewrite or release pipeline, whatever its size.
- These do not count: the regression or unit tests for the change, its CHANGELOG entry, its docs, and lines a tool generated (lockfiles, codegen output, regenerated snapshots). Example: a 9-line fix with a 40-line regression test is tiny.
- Skills, agents and rules that a harness loads as instructions are production, not docs.
- Work that is not tiny needs a `flow-design` contract, even when the user chose the fix in chat.
- Run a throwaway spike the user asks for on a scratch branch, with no contract. Never merge any of it; merging spike code needs the normal flow.

## 2. Route the work

Work to owner:
- A task from an execution-grade plan → fresh `flow-plan-executor` (`@execute`).
- Open judgment, debugging, or a plan contradiction → `flow-implementer` (`@task`), or back to `flow-planning`/`flow-design`.
- An exact mechanical edit, or a correction already diagnosed with one obvious result and existing proof → `sonic` (`@smol`).
- Read-only fact finding → `scout`. Give it the paths and symbols you already know.
- A tiny cohesive edit (section 1), where spawning costs more than the edit → Main writes it under `flow-tdd`. This is the Main-direct lane. It applies to multi-unit work too.

Rules:
- Never send ambiguous or new behavior, architecture, migration, concurrency or error semantics, or root-cause diagnosis to `sonic`.
- Send those to `flow-plan-executor` only when the plan has settled them. The executor follows locked decisions and escalates contradictions.

## 3. Order and ownership

- Map the dependency graph first, not a task list.
- You may run independent units on the same base concurrently.
- Run dependent units in order, starting each from the verified updated base.
- Give one writer at a time to units that touch the same files, even in isolated workspaces.
- Give each plan task one fresh `flow-plan-executor`, in order. Never reuse an executor across plan tasks.
- Send a follow-up to a finished subagent only within 5 minutes of its last reply. OMP parks an idle subagent after 7 minutes, and a parked one re-reads its whole context. After that, start a fresh agent with the artifact paths and that receipt.
- Isolation follows the `flow-safety` rule.
- You may write a short resume handoff at a clean boundary under context pressure. It is optional and never a gate, unlike the section 9 checkpoint. Keep working in the current session.

## 4. Write the brief

- Make the brief self-contained: behavior, scope, constraints and interfaces, acceptance criteria, workspace and concurrency context, verification scope.
- Pass artifact paths, not pasted plans or conversation: contract, `PLAN.md`, the one assigned `plan-tasks/*.md`, base head.
- End every writer brief with this footer (the Verification ownership block). Fill all four entries concretely before you spawn.

```text
Verification ownership:
- Focused proof: <commands/checks the writer must run>
- Formatter: <scoped formatter command or concrete safety exception>
- Focused static/build: <allowed/required checks>
- Main-owned gates: <broader commands and why they stay with Main>
```

## 5. Clarify and wait

- Expect workers to derive what they can, then ask you over `hub` when the answer would change approved behavior, scope, interfaces, data or architecture.
- Answer within the approved contract only. Never widen authorization.
- For a new design, product or user choice, or a wrong plan: tell the worker to stop at a clean boundary and return BLOCKED, then route it through `flow-design`, `flow-planning` or the user.
- Change a locked plan decision only by a plan edit, never by a message or a correction brief. Stop the worker first, as above. `flow-planning` sections 1 and 6 say who writes the edit and how it is approved. Example: an executor reports that locked decision D4 cannot work → stop it, edit the plan, get approval, dispatch.
- Do independent work while children run. Use one `hub wait` when you need that result next.
- Do not poll: no repeated short `hub wait` calls or `hub jobs` snapshots.
- Never wait on a messaged owner's old job id: wait for its reply.

## 6. Accept work

1. Read the receipt first. It is a claim, not proof.
2. Inspect the actual diff, including nested children's changes.
3. Confirm the worker ran focused proof for its surface.
4. Independently verify the consequential claim or integration boundary.
5. Check integration with already accepted work.
6. Correct deviations before dependent work starts.

## 7. Route corrections

- Verify and deduplicate findings. Batch the verified set into one correction round.
- Send an exact diagnosed fix to `sonic`.
- For a formatter-only failure, have the owner run the canonical formatter on its touched files, or send the exact fix to `sonic`. Never hand-imitate formatter output.
- Send a fix that keeps every locked decision to a fresh `flow-plan-executor` with one correction brief and its focused proof. A fix that changes one needs a plan edit (section 5).
- Send a fix needing semantic context to its `flow-implementer` while section 3 allows a follow-up. Otherwise send it to a fresh `flow-implementer`.
- Stop that work for a plan defect or invalid contract. Return through `flow-planning`, `flow-design` or the user.
- Rerun only the proof the correction affects, plus gates it made stale.
- Before acceptance, run one scoped closure review by default. Run another only for a concrete unresolved acceptance risk.
- After acceptance, follow section 8.

## 8. Review proportionally

- Dispatch one `flow-acceptance-reviewer` (`@slow`) after the coherent change and its focused/integration proof, for planned work. Give it the contract, plan and task paths, diff/base and evidence.
- Treat the acceptance review as a barrier. Start no device, emulator, manual or external evidence until it and its corrections settle. Read-only preparation is fine.
- After you accept the review receipt, show its verdict and findings in chat and end your turn. Once the user agrees, run `flow_gate action=accept` with the scope and the receipt as source.
- A production, asset or build change after acceptance reopens the stability barrier defined in the `flow-evidence` rule. The guard blocks verifier dispatch until a new `flow_gate action=accept`. A commit of the accepted tree keeps the record current.
- You may park minor findings that carry no load.
- Follow the change-lens selection in `flow-review` for unplanned changes.

## 9. Close execution

- Commit coherent behavior units (`AGENTS.md` Commits). Do not commit once per worker by rule.
- Write `.flow/checkpoints/<head>.md` before the first device, emulator, manual or external acceptance action.
- Treat each of these as that action:
  - the first ADB or device command, driving an emulator or app, a screenshot, a manual smoke step;
  - the first command against a live production server or other hard-to-recover remote host (deploy, migration, service restart, config change, on-host check);
  - anything likely to cross a provider/session window.
- Record head/tree, dirty and user-owned state, accepted evidence and why it is fresh, remaining criteria, device/remote state and the exact next action in the checkpoint.
- `flow_gate action=accept` covers the reviewed change. Check a contract criterion that the user judges (a look, a playtest) after it, in this order:
  1. `flow_gate action=accept`;
  2. the checkpoint above;
  3. capture by `flow-evidence-verifier`, or one trivial observation by Main;
  4. the user's verdict.
- A change made from that verdict is a change after acceptance (section 8).
- On planned work, never drive multi-step device or manual capture yourself, as Main. Never give verifier-role capture to a generic `task` agent.
- Tiny work has no gate scope and no verifier. After the checkpoint above, you may run one short device or browser check yourself.
- Put this manifest (the Evidence capsule block) in each verifier task's own brief. The guard rejects a verifier dispatch without it.
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
- Give each verifier the exact acceptance criteria and the environment/device changes it may make. Send evidence to `.flow/evidence/<head>/<capsule-id>/` (an absolute path when the verifier runs in another checkout).
- Follow the `MATCH` self-consistency rule in `flow-evidence` for restore receipts. Inspect consequential evidence and own acceptance as Main.
- Use `flow-integrating` next.
