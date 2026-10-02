---
name: flow-integrating
description: Use when implementation is locally complete and the user must decide how to integrate it; require fresh final evidence, reconcile scope, assess reviewability, then present merge/PR/keep/split choices without acting remotely first.
---

# Flow integrating

Integration belongs to the user.

## 1. Prove local completion

Ensure the appropriate final test/build/lint/format/static gates cover the **current final tree/head** and inspect the final diff/status.

Do not rerun an expensive final command merely because control moved into this skill. Reuse fresh proof by the `flow-evidence` rule.

Reconcile the result against the governing request/spec/approved plan. Name omissions/deviations rather than silently redefining done. When the work has a Flow gate scope, run `flow_gate action=status` for it before presenting integration choices. Any `stale` line is a blocker. A `missing` line for a kind the work never used is expected: `plan` for `Plan: NONE` work, `implementation` for planned work.

## 2. Record the decisions

For work with a governing contract (`.flow/contracts/<slug>.md`), except a unit finishing from a frozen `.flow/ldd/` ledger, which writes no record:

- Write or update `docs/decisions/<slug>.md`. Keep only what the code and tests cannot show: decisions and why, rejected alternatives, traps, open questions, and a link to the work commit or PR. Leave out AI-process detail such as gate digests, agent names or quiz scores.
- Commit it on the work's branch. Its commit message, and the PR description if any, carry a few lines from the contract: what the change is for and what it leaves out.
- In multi-unit work, the last unit also distills the parent contract into `docs/decisions/<parent-slug>.md`.

## 3. Assess cohesion/reviewability

Suggest splitting only when the change mixes independently valuable concerns or unrelated risk domains, or would be clearer to review separately.

## 4. Ask for the integration decision

Present only choices that are actually available, for example:

- merge locally;
- push/open or update a pull request;
- keep the branch/worktree for later;
- split into coherent units first.

Carry out none of these until the user chooses the exact action (`flow-safety`).

Never end a locally complete integration checkpoint with only a status summary: ask for the integration decision now, or name the blocker and what happens next.

## 5. After integration

Delete a local feature branch only when it is integrated and safe. Report a user-owned external worktree as removable (`flow-safety`).

After confirmed integration:

- Call `flow_gate action=clear` for the integrated scope.
- Remove its `.flow/contracts`, `.flow/plans`, `.flow/handoffs`, `.flow/checkpoints` and `.flow/evidence` entries (`flow-artifacts` lifecycle). Report what was removed.
- After the last unit, do both for the parent.
- Never touch a frozen `.flow/ldd/` ledger.
