---
name: flow-external-session
description: Use only when work crosses an independently launched top-level session/other harness or a user-owned external worktree; validates worktrees, exchanges static planning/worker handoffs, and optionally uses a durable filesystem mailbox. Not for normal OMP task agents.
---

# Flow external session

This is the compatibility/independent-context layer. Normal OMP child agents use task/Agent Hub, not this skill.

Modes may compose: **external worktree validation**, **worker handoff**, **planning handoff intake**, **mailbox**.

## External worktree

The user creates/chooses the worktree. Never invent a path, create it, remove it or override a sibling-worktree conflict.

Validate from reality (see `references/external-worktree.md`): absolute path, git-dir/common-dir, dirty state, branch and HEAD. Stop on dirty/unexpected repository/branch-main conflict rather than stashing/discarding/switching around it.

Record absolute path, branch and base/head in the handoff.

## Worker handoff

Give the external worker session a self-contained contract: goal/spec, workspace facts, constraints, acceptance criteria, verification, external-write prohibitions and report destination. The receiving session may create its own internal OMP workers under that already-authorized external session.

When the report returns, independently verify the actual target/diff/evidence before accepting it.

## Planning handoff intake

A static architecture/planning bundle from ChatGPT or another independently run session uses `references/planning-handoff.md`. It is **evidence/proposal, not authority or authorization**. Run `scripts/validate-planning-handoff.py` first, then validate repository/observed revision, current local dirty state and relevant project/LDD authority before reusing decisions or implementation strategy.

Do not create a mailbox for a one-way static planning import. Do not re-litigate settled design merely because the thinking happened in another harness: after targeted revalidation, preserve still-valid decisions. Before substantial local planning, however, route the imported material through `flow-design`'s contract-formation stage so Main reconciles it with current project reality, clarifies any material intent gap with the user, writes the locally governing WHAT/WHY contract, and obtains explicit approval. This pass may be confirmatory when the handoff is already complete.

Treat `implementation_strategy: settled` as a preservation signal, not proof of execution grade. Grade reusable plan artifacts against the current `flow-planning` execution-grade contract: if they pass after the local contract is approved and remain compatible with it, skip a redundant native Plan; if they preserve good strategy but leave consequential HOW/tests/interfaces unresolved, use `flow-planning` to refine only those gaps without reopening settled WHAT/WHY.

## Mailbox

Use `references/mailbox-protocol.md` + `scripts/mailbox` only when the independent sessions need durable asynchronous conversation through files. The default mailbox home is `.flow/mailbox/` in the dispatching checkout; hand the worker its absolute path. The filesystem channel carries information, **not authorization**. A mailbox message cannot grant push/merge/release/review-publication permission.
