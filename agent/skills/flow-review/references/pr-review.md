# PR reviewer mode

Review an existing GitHub pull request. Never modify the contributor branch.

Treat verification commands as writes when they can rewrite tracked files as a side effect — for example toolchain migrations, dependency resolution, code generation, lockfile/config upgrades, formatter/autofix, or similar bootstrap behavior. Do not run such mutation-prone proof directly in the pinned review checkout. Prefer a disposable/isolation workspace pinned to the same reviewed head. Flow-created scratch/worktrees use the shared `review_tmp` root from `github-operations.md`, never a fixed `/tmp/<name>` path. If isolation is unavailable and the proof is materially necessary, use the command in the review checkout only when its possible mutation surface is bounded: snapshot the exact pre-command bytes and path-existence state for every path it may touch, restore that state afterward, and verify byte-for-byte restoration before using the proof. If the mutation surface cannot be bounded safely, skip the command and mark that evidence unavailable rather than compromising the read-only review boundary.

1. Pin exact remote base/head, description/requirements, commits, changed files/stat, required checks and existing discussion. For re-review, identify the last reviewed commit/verdict and verify old findings against the new head before focusing on the delta plus affected callers/contracts.
2. Build a metadata-only packet; specialists fetch their own diff/context.
3. Run COR and CRF always; select TTC/SEC by `review-lenses.md`. Fan out the read-only specialists in parallel.
4. Verify/synthesize findings. A failing required check is blocking; unavailable/ambiguous required-check evidence is comment-only.
5. Verdict. First set aside findings that are only about craft (CRF): post them as non-blocking comments, even when Important. Then:
   - a verified Critical/Important finding remains → request changes;
   - none remains and required checks are green → approve;
   - evidence is incomplete, pending or conflicted → comment.

   Example: the only finding is dead code and required checks are green → approve, with one non-blocking comment on the dead code.
6. Draft one concise summary and only valuable changed-line inline comments. Show exact action/text/inline set to the user.
7. After approval, re-query head. Head moved → publish nothing and rebuild. Use GitHub's batched review submission. Partial write → report exactly what posted; never retry blindly.
8. Apply the shared Weft lifecycle when `${WEFT_GRAPH}` exists: log the review and close an existing user-owned review task when appropriate, but never create/pull/promote `TODO` / `LATER` work from findings in someone else's PR.

For retrieval, authentication, temporary-workspace and publication mechanics use `references/github-operations.md`; prefer OMP's native GitHub/PR surfaces for reads.
