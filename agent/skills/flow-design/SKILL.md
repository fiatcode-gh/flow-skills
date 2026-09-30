---
name: flow-design
description: Use before substantial planning to reconcile the user's intent with current project reality, resolve material WHAT/WHY decisions, and write the approved governing contract; tiny/mechanical work with an already-explicit scope may skip it.
---

# Flow design

Resolve and record the **what/why** before implementation.

## When this is warranted

- Use this skill before substantial work enters planning. The start can be a new request, an existing project, an internal brainstorm or an external handoff.
- Tiny or mechanical work may skip a separate contract artifact when its WHAT/WHY and acceptance boundary are already explicit. Examples: a typo, dependency bump, obvious one-file bug after root cause.
- You may reuse a current, already-approved governing contract while it is materially unchanged.

## Process

1. Explore the relevant project reality first: the instructions, current implementation, tests/contracts, recent history and the `docs/decisions/` records for the area.
   - Use read-only scouts when breadth helps.
   - Check each record against current code. Never trust a record you have not checked.
   - Correct or delete a record the code contradicts, in this same unit.
2. State your reading of the user's intended outcome, important constraints, acceptance boundary and any material forks.
   - Separate facts from assumptions.
   - Do this step even when the input is a detailed brainstorm or external handoff. Imported detail is evidence, not a substitute for a local intent/authority check.
3. Clarify the intention with the user.
   - Ask only questions whose answers materially change behavior, boundaries, architecture, acceptance criteria or scope.
   - Do not manufacture questions when the intended answer is already explicit.
4. Offer alternatives only when genuinely viable alternatives exist. Name your recommendation and trade-offs.
5. Converge on the smallest design that satisfies the requirement. Cover only relevant surfaces: components/boundaries, data/control flow, errors, compatibility and test strategy.
6. Consolidate the settled result into the completed governing contract.
   - It must state, as applicable: intended outcome; in-scope/out-of-scope behavior; material boundaries/interfaces; constraints and invariants; acceptance criteria/proof expectations; settled decisions; intentionally deferred non-goals.
   - Keep consequential implementation HOW out of the contract.
7. Present the completed contract and get explicit user approval of its WHAT/WHY boundary before substantial planning begins.
   - Answers to clarification questions do not themselves approve the resulting completed or materially amended contract.
   - For durable substantial work, bind that approval to the exact artifact revision with the native `flow_gate` tool: call `present` for `kind=contract` with the stable Flow scope, the contract path and the user-facing behavior/boundary/acceptance summary, then call `approve`.
   - `approve` forces OMP's native user confirmation, even under yolo, and records the approved artifact digest.
8. After approval, keep the forward pointer to `flow-planning`.
   - A material WHAT/boundary/acceptance change later reopens contract approval. Present and approve the amended revision before planning resumes.

## Imported design context

- A validated external planning handoff may contain user-approved design decisions.
- Preserve still-valid settled decisions. Do not re-run brainstorming by ritual.
- Still reconcile those decisions with current project reality and consolidate the locally governing contract before planning.
- Reopen only decisions that are stale, contradicted, materially incomplete or not actually user-approved.

## Durability

For substantial work:

- Run the `flow-artifacts` exclude guard first.
- Write the governing contract to `.flow/contracts/<slug>.md`.
- Record the head it was written against.
- Use `<slug>` as the stable `flow_gate` scope.

## Multi-unit work

- Propose a split into units when the scope has parts that could ship separately. Example: a search rework whose indexer, API and UI can each be released alone. The user decides the split.
- After the user agrees, write one parent contract, `.flow/contracts/<parent-slug>.md`, that lists the units and the decisions they share. Present and approve it like any contract (step 7), with scope `<parent-slug>`. Then write one contract per unit that names the parent.
- Take each unit through the normal flow: contract approval, plan approval, execution, integration. Its gate scope is its own slug. Start no unit before the parent is approved. A material parent change reopens approval of every unit not yet integrated.
- Resume step, for an epic with a frozen `.flow/ldd/<epic>/` ledger (`flow-artifacts`): read that ledger once, write the decisions that still hold to `docs/decisions/<epic>.md` (skip old harness instructions), then write the parent contract for the remaining units.

## Rules

- Main owns the contract. Do not delegate WHAT/WHY authority to `flow-planner`.
