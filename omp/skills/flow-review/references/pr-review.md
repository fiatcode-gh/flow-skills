# PR reviewer mode

Review an existing GitHub pull request. Never modify the contributor branch.

Treat verification commands as writes when they can rewrite tracked files as a side effect — for example toolchain migrations, dependency resolution, code generation, lockfile/config upgrades, formatter/autofix, or similar bootstrap behavior. Never run such mutation-prone proof in the pinned review checkout. Run it in a disposable copy of the reviewed head under the shared `review_tmp` root from `github-operations.md` (`flow-safety` probe rule), never a fixed `/tmp/<name>` path. If no copy can run it, skip the command and mark that evidence unavailable.

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
8. When `${WEFT_GRAPH}` exists, apply `weft-worklog` Mode C and the PR-review rule in `AGENTS.md` (Weft graph section).

For retrieval, authentication, temporary-workspace and publication mechanics use `references/github-operations.md`; prefer OMP's native GitHub/PR surfaces for reads.
