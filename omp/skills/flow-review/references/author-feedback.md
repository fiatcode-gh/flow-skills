# Author-feedback mode

Reviewer comments are claims, not verdicts.

1. Collect submitted reviews, inline comments, actionable PR comments, required checks and bot/linter findings. Record source, reviewed commit, thread/comment id, location and verbatim request.
2. Re-anchor every finding to current remote head: `still applies`, `already addressed` or `obsolete`. If local branch and remote head unexpectedly diverge, resolve authority before editing/publishing.
3. Classify with evidence. Factual defect/coverage/contract claims are proven/refuted by code/checks. Judgment/preferences from a maintainer/requested reviewer normally govern project preference unless there is a concrete cost/constraint to raise once.
4. Every finding gets exactly one disposition: `fix`, `disproved`, `deferred` with destination, `needs clarification`, `already addressed`, or `obsolete`.
5. Show triage/evidence before making fixes unless those fixes are already explicitly authorized. Route authorized fixes through normal `flow-execution`: return semantic corrections to an existing unit owner when available, use `sonic` only for an exact diagnosed mechanical correction with proof, and keep executable behavior under `flow-tdd`.
6. Draft short factual replies. Resolve only terminal threads; never resolve `needs clarification`/`deferred`. Show exact reply/resolve/re-request set and wait for approval.
7. Re-query head immediately before GitHub writes. A moved head makes the draft stale.

For packet/reply commands, read `github-operations.md` and `author-operations.md`.
