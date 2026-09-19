---
name: flow-integrating
description: Use when implementation is locally complete and the user must decide how to integrate it; require fresh final evidence, reconcile scope, assess reviewability, then present merge/PR/keep/split choices without acting remotely first.
---

# Flow integrating

Integration belongs to the user.

## 1. Prove local completion

Ensure the appropriate final test/build/lint/format/static gates cover the **current final tree/head** and inspect the final diff/status. Re-test the original symptom for bug fixes. State pre-existing/unverified failures separately.

Do not rerun an expensive final command merely because control moved into this skill: a just-completed Main-owned result remains fresh if no relevant file/head/environment changed and its scope is sufficient. Any material edit after that proof makes the affected evidence stale and requires the corresponding gate again.

Reconcile the result against the governing request/spec/approved plan. Name omissions/deviations rather than silently redefining done.

## 2. Assess cohesion/reviewability

Judge whether the change is one coherent review unit. Changed-line count is evidence, not a threshold. Suggest splitting only when there are independently valuable concerns, unrelated risk domains, or a review would be materially clearer as separate changes.

## 3. Ask for the integration decision

Present only choices that are actually available, for example:

- merge locally;
- push/open or update a pull request;
- keep the branch/worktree for later;
- split into coherent units first.

Do not push, open/update a PR, request reviewers, merge or release until the user chooses the exact action.

Do not end a locally-complete integration checkpoint with only a status summary. Either ask the concrete integration decision now, or state the specific blocker that prevents presenting the choices and what happens next. This is a required user-facing forward pointer.

## 4. After integration

Re-check actual remote/local result before claiming integration succeeded. Delete a local feature branch only when it is genuinely integrated and safe. For a user-owned external worktree, report it as removable; do not remove it yourself unless explicitly instructed.

After confirmed integration, remove the integrated slug's `.flow/contracts`, `.flow/plans`, `.flow/checkpoints` and `.flow/evidence` entries per the `flow-artifacts` lifecycle and report what was removed. Never touch a tracked shared-LDD ledger.
