# PR reviewer mode

Review an existing GitHub pull request. Never modify the contributor branch.

Treat verification commands as writes when they can rewrite tracked files as a side effect — for example toolchain migrations, dependency resolution, code generation, lockfile/config upgrades, formatter/autofix, or similar bootstrap behavior. Do not run such mutation-prone proof directly in the pinned review checkout. Prefer a disposable/isolation workspace pinned to the same reviewed head. If isolation is unavailable and the proof is materially necessary, use the command in the review checkout only when its possible mutation surface is bounded: snapshot the exact pre-command bytes and path-existence state for every path it may touch, restore that state afterward, and verify byte-for-byte restoration before using the proof. If the mutation surface cannot be bounded safely, skip the command and mark that evidence unavailable rather than compromising the read-only review boundary.

1. Pin exact remote base/head, description/requirements, commits, changed files/stat, required checks and existing discussion. For re-review, identify the last reviewed commit/verdict and verify old findings against the new head before focusing on the delta plus affected callers/contracts.
2. Build a metadata-only packet; specialists fetch their own diff/context.
3. Select COR/TTC/CRF/SEC by `review-lenses.md` and fan out applicable read-only specialists in parallel.
4. Verify/synthesize findings. A failing required check is blocking; unavailable/ambiguous required-check evidence is comment-only.
5. Verdict: verified Critical/Important → request changes; no blockers + required checks green → approve; incomplete/pending/conflicted evidence → comment.
6. Draft one concise summary and only valuable changed-line inline comments. Show exact action/text/inline set to the user.
7. After approval, re-query head. Head moved → publish nothing and rebuild. Use GitHub's batched review submission. Partial write → report exactly what posted; never retry blindly.

For retrieval, authentication and publication mechanics use `references/github-operations.md`; prefer OMP's native GitHub/PR surfaces for reads.
