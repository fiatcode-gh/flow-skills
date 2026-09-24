---
name: flow-design
description: Use before substantial planning to reconcile the user's intent with current project reality, resolve material WHAT/WHY decisions, and write the approved governing contract; tiny/mechanical work with an already-explicit scope may skip it.
---

# Flow design

Resolve and record the **what/why** before implementation. `flow-design` is Main's contract-formation stage; `flow-planning` / `flow-planner` owns the later **how-to-execute** specification.

## When this is warranted

Use this skill before substantial work enters planning, whether the starting point is a new request, an existing project, an internal brainstorm, or an external handoff. The contract pass may be brief when intent is already clear: preserve settled decisions and do not manufacture fake alternatives or questions.

A typo, dependency bump, obvious one-file bug after root cause, or another tiny/mechanical change whose WHAT/WHY and acceptance boundary are already explicit may skip a separate contract artifact. A current already-approved governing contract may be reused while materially unchanged.

## Process

1. Explore the relevant project reality first: instructions, current implementation, tests/contracts and recent history. Use read-only scouts when breadth helps.
2. State your reading of the user's intended outcome, important constraints, acceptance boundary and any material fork(s). Separate facts from assumptions. Do this even when the starting input is a detailed brainstorm or external handoff: imported detail is evidence, not a substitute for a local intent/authority check.
3. Clarify the intention with the user. Ask only questions whose answers materially change behavior, boundaries, architecture, acceptance criteria or scope; do not manufacture questions when the intended answer is already explicit.
4. Offer alternatives only when genuinely viable alternatives exist. Name your recommendation and trade-offs.
5. Converge on the smallest design that satisfies the requirement. Cover only relevant surfaces: components/boundaries, data/control flow, errors, compatibility and test strategy.
6. Consolidate the settled result into the completed governing contract. It must state, as applicable: intended outcome; in-scope/out-of-scope behavior; material boundaries/interfaces; constraints and invariants; acceptance criteria/proof expectations; settled decisions; and any intentionally deferred non-goals. Keep consequential implementation HOW out of the contract.
7. Present the completed contract and obtain explicit user approval of that WHAT/WHY boundary before substantial planning begins. Answers to clarification questions do not themselves approve the resulting completed or materially amended contract. For durable substantial work, bind that approval to the exact artifact revision with the native `flow_gate` runtime tool: call `present` for `kind=contract` with the stable Flow scope, contract path and the user-facing behavior/boundary/acceptance summary, then call `approve`. The `approve` action forces OMP's native user confirmation even under yolo and records the approved artifact digest.
8. After approval, maintain the forward pointer to `flow-planning`; Main does not author the substantial HOW plan itself. A material WHAT/boundary/acceptance change later reopens contract approval. Because planner dispatch recomputes the contract digest, editing the approved contract automatically makes the old runtime approval stale; present and approve the amended revision before planning resumes.

## Imported design context

A validated external planning/LDD handoff may contain user-approved design decisions. Preserve still-valid settled decisions instead of re-running brainstorming by ritual, but still reconcile them with current project reality and consolidate the locally governing contract before planning. Contract formation may therefore be confirmatory rather than exploratory. Reopen only decisions that are stale, contradicted, materially incomplete, or not actually user-approved. An implementation strategy in the handoff belongs to Plan/execution reasoning, not to this design skill.

## Durability

- Tiny/mechanical work that legitimately skips this stage may keep its explicit scope in the conversation/request.
- For substantial non-LDD work, write the governing contract to `.flow/contracts/<slug>.md` after running the `flow-artifacts` exclude guard, record the head it was written against, and use `<slug>` as the stable `flow_gate` scope.
- Under `flow-ldd`, write/update the unit contract in the epic's `.flow/ldd/<epic>/` authority instead of creating a parallel contract system; use `<epic>/<unit>` as the stable gate scope.

## Rules

- No substantial planning or coding before the completed governing contract has explicit user approval.
- Do not force two/three fake options when one approach is clearly dictated by constraints.
- Do not turn implementation mechanics into architecture. Native Plan mode is the execution-planning layer.
- Main owns the contract; do not delegate WHAT/WHY authority to `flow-planner`.
- YAGNI applies to the design itself.
