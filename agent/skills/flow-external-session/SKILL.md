---
name: flow-external-session
description: Use only when work crosses an independently launched top-level session/other harness or a user-owned external worktree; validates worktrees and exchanges static planning/worker handoffs. Not for normal OMP task agents.
---

# Flow external session

Normal OMP child agents use task/Agent Hub, not this skill.

Modes may compose: **external worktree validation**, **worker handoff**, **planning handoff intake**.

There is no live or ongoing channel between sessions. A worker handoff is one brief out and one report back; a planning bundle is one-way.

## External worktree

- The user creates/chooses the worktree.
- Never invent a path, create or remove the worktree or override a sibling-worktree conflict.
- Validate from reality (see `references/external-worktree.md`): absolute path, git-dir/common-dir, dirty state, branch and HEAD.
- Stop on dirty state, unexpected repository or branch-main conflict. Do not stash, discard or switch around it.
- Record absolute path, branch and base/head in the handoff.

## Worker handoff

- Give the external worker a self-contained brief: goal/spec, workspace facts, constraints, acceptance criteria, verification, external-write prohibitions and report destination.
- The receiving session may create its own internal OMP workers under that already-authorized external session.
- When the report returns, independently verify the actual target/diff/evidence before accepting it.

## Planning handoff intake

A one-way planning bundle from an external chat or another session uses `references/planning-handoff.md`. It is **evidence/proposal, not authority or authorization**.

- Run `scripts/validate-planning-handoff.py` first, then check the repository, observed revision, local dirty state and project authority before reusing decisions or strategy.
- Do not re-litigate settled design because it came from another harness. After targeted revalidation, keep still-valid decisions.
- Before substantial local planning, still route the imported material through `flow-design`'s contract-formation stage.
- There Main reconciles it with project reality, clarifies material intent gaps, writes the local WHAT/WHY contract and gets explicit approval. This pass may only confirm a complete handoff.
- Treat `implementation_strategy: settled` as a preservation signal, not proof of execution grade.
- After the local contract is approved, `flow-planning` "External handoffs" decides whether the plan artifacts are execution-grade and what to refine.
