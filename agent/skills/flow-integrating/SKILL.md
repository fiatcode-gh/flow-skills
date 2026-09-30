---
name: flow-integrating
description: Use when implementation is locally complete and the user must decide how to integrate it; require fresh final evidence, reconcile scope, assess reviewability, then present merge/PR/keep/split choices without acting remotely first.
---

# Flow integrating

Integration belongs to the user.

## 1. Prove local completion

Ensure the appropriate final test/build/lint/format/static gates cover the **current final tree/head** and inspect the final diff/status.

Do not rerun an expensive final command merely because control moved into this skill: a just-completed Main-owned result remains fresh if no relevant file/head/environment changed and its scope is sufficient.

Reconcile the result against the governing request/spec/approved plan. Name omissions/deviations rather than silently redefining done. For governed durable work, run `flow_gate action=status` for the scope before presenting integration choices; a stale contract/plan approval or acceptance binding is a blocker, not an integration-ready state.

## 2. Record the decisions

For work with a governing contract (`.flow/contracts/<slug>.md`):

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

Do not push, open/update a PR, request reviewers, merge or release until the user chooses the exact action.

Do not end a locally-complete integration checkpoint with only a status summary. Either ask the concrete integration decision now, or state the specific blocker that prevents presenting the choices and what happens next.

## 5. After integration

Delete a local feature branch only when it is integrated and safe. For a user-owned external worktree, report it as removable; do not remove it yourself unless explicitly instructed.

After confirmed integration, call `flow_gate action=clear` for the integrated scope, then remove the integrated slug's `.flow/contracts`, `.flow/plans`, `.flow/checkpoints` and `.flow/evidence` entries per the `flow-artifacts` lifecycle and report what was removed. After the last unit, also for the parent. Never touch a frozen `.flow/ldd/` ledger.
