---
name: flow-integrating
description: Use when implementation is locally complete and the user must decide how to integrate it; require fresh final evidence, reconcile scope, record decisions, assess reviewability, then deliver through the session branch and a draft pull request or ask for the integration choice.
---

# Flow integrating

Integration belongs to the user.

## 1. Prove local completion

Ensure the appropriate final test/build/lint/format/static gates cover the **current final tree/head** and inspect the final diff/status.

Do not rerun an expensive final command merely because control moved into this skill. Reuse fresh proof by the Evidence rules.

Reconcile the result against the governing request/spec/approved plan. Name omissions/deviations rather than silently redefining done. When the work has a Flow scope, run `flow_check` for each kind it used. Any `stale` line is a blocker. A `missing` line for a kind the work never used is expected: `plan` for `Plan: NONE` work, `implementation` for planned work.

## 2. Record the decisions

For work with a governing contract (`.flow/contracts/<slug>.md`):

- Write or update `docs/decisions/<slug>.md`. Keep only what the code and tests cannot show: decisions and why, rejected alternatives, traps, open questions, and a link to the work commit or PR. Leave out AI-process detail such as approval hashes or agent names.
- Commit it on the work's branch. Its commit message, and the PR description, carry a few lines from the contract: what the change is for and what it leaves out.
- In multi-unit work, the last unit also distills the parent contract into `docs/decisions/<parent-slug>.md`.

## 3. Assess cohesion/reviewability

Suggest splitting only when the change mixes independently valuable concerns or unrelated risk domains, or would be clearer to review separately.

## 4. Deliver or ask

In a cloud session, push the session branch and open a draft pull request (Cloud sessions in the Flow instructions). That is the delivery the session exists for, not a merge.

Every further step is the user's choice. Present only the choices that are actually available, for example:

- mark the pull request ready for review;
- merge it;
- keep it as a draft for later;
- split it into coherent units first.

Carry out none of these until the user chooses the exact action.

Never end a locally complete integration checkpoint with only a status summary: deliver and ask for the next decision now, or name the blocker and what happens next.

## 5. After integration

After confirmed integration, remove the scope's `.flow/contracts`, `.flow/plans` and `.flow/handoffs` entries and its `approvals.log` lines. Report what was removed. After the last unit, do the same for the parent.
