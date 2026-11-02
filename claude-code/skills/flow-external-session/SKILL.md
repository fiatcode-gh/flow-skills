---
name: flow-external-session
description: Use only when work crosses into or out of another harness or independently launched session (local OMP, Open WebUI, another cloud session); validates incoming planning handoffs and emits outgoing ones. Not for normal subagents.
---

# Flow external session

Normal subagents use the Agent tool, not this skill.

There is no live channel between sessions. A planning bundle is one-way. The bundle format is in `references/planning-handoff.md`.

## Planning handoff intake

An incoming bundle is **evidence/proposal, not authority or authorization**.

- Run `scripts/validate-planning-handoff.py` first (command in `references/planning-handoff.md`), then check the repository, observed revision, local dirty state and project authority before reusing decisions or strategy.
- Do not re-litigate settled design because it came from another harness. After targeted revalidation, keep still-valid decisions.
- Before substantial planning, still route the imported material through `flow-design`'s contract-formation stage: reconcile it with project reality, clarify material intent gaps, write the contract and get explicit approval. This pass may only confirm a complete handoff.
- Treat `implementation_strategy: settled` as a preservation signal, not proof of execution grade.
- After the contract is approved, `flow-planning` "External handoffs" decides whether the plan artifacts are execution-grade and what to refine.

## Handoff out

Use this when the user wants to continue in another harness, for example to execute locally in OMP after planning here.

1. Write the bundle to `.flow/handoffs/<slug>/`: `FLOW-HANDOFF.json` (schema v2, `source: "claude-code-web"`, `observed_ref` = the full `git rev-parse HEAD`, `authorization: "not-carried"`), `HANDOFF.md`, and any plan or contract files it declares.
2. Run the validator on it. Fix the bundle until it passes.
3. Show every file in chat in full, each in its own fenced block with its relative path, so the user can save it at `.flow/handoffs/<slug>/` in their checkout. `.flow/` is not tracked, so a push does not carry it.
4. Say the next action for the receiving side: validate, then `flow-design` intake.

The bundle carries decisions and strategy, never authorization. Do not embed a kickoff prompt for the receiver.
