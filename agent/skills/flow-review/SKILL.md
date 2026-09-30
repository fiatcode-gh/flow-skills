---
name: flow-review
description: Use for reviewing a local change or existing GitHub pull request, handling feedback on the user's own PR, or auditing a codebase/area.
---

# Flow review

One review doctrine, four modes. Determine the mode first. Load its reference when needed:

- **Local/change review** — inspect current/explicit diff; no GitHub publication.
- **PR reviewer** — existing PR; read-only contributor branch; `references/pr-review.md`.
- **Author feedback** — feedback on the user's own PR; re-anchor/triage/fix/reply; `references/author-feedback.md`.
- **Codebase audit** — repository/area at rest; `references/audit.md`.

`references/review-lenses.md` is the standard of record for change reviews. `references/audit-lenses.md` defines whole-tree audit lenses.

All Flow-created temporary review state follows the shared `review_tmp` convention in `references/github-operations.md`. Do not invent fixed `/tmp` paths for packets, payloads, disposable worktrees or other review scratch state.

## Shared evidence contract

- Specialist reports are claims.
- Verify every Critical/Important finding by reading cited/surrounding code and using targeted diagnostics/tests when they add proof.
- Cheaply verify Minor findings.
- Label or omit unverified leftovers.
- Merge duplicate root causes.
- Investigate conflicts instead of voting.
- Review/audit specialists are read-only.
- In PR reviewer mode:
  - read-only includes the pinned review checkout;
  - apply the mutation-safe verification rules in `references/pr-review.md` before running diagnostics/tests that may rewrite tracked files.

## Change-lens selection

- Run COR and CRF always for the initial coherent change review.
- Run TTC only when executable behavior/tests/validation/migrations/types/schemas/contracts changed.
- Run SEC only when a real security boundary is involved (authentication/authorization, secrets, cryptography, payments, destructive operations, untrusted-input boundaries, privileged filesystem/process/network access, etc.).
- Route COR to bundled `reviewer`, TTC to `flow-ttc-reviewer` and CRF to `flow-craft-reviewer`.
- Route SEC to built-in `security-reviewer`, or to native `security_scan` when a dedicated scan is warranted.
- Do not pass concrete model names.
- Before spawning specialists, record an explicit disposition for all four change lenses: `COR run`, `CRF run`, then `TTC run/skip + reason` and `SEC run/skip + reason`.
- Reasons should cite the changed surface/risk, not cost alone.
- The disposition can stay concise in controller reasoning/work notes. It is an auditability guard, not a user-facing checklist.
- Run applicable lenses in parallel and blind to one another.
- After fixes:
  - do **not** automatically repeat every original lens;
  - re-run the lens that raised the finding when independent confirmation matters;
  - also re-run any lens newly made applicable by the fix's changed surface;
  - repeat COR/the full lens set only when the corrections materially changed the reviewed design/behavior/risk or the original review target moved substantially.
- Main's final verification is separate from specialist re-review.
- At a user-facing review checkpoint, state the review outcome and the next action.
- If findings are actionable and locally authorized, route fixes rather than stopping at a passive summary.
- If review is clean, continue to final verification/integration or state the exact user gate that remains.

## Publication gate

- Any GitHub write — review verdict/comment, reply, resolve action, reviewer request — requires the user's approval of the **exact** draft/action set.
- Re-query the remote head immediately before publishing.
- If the remote head moved, post nothing until the draft is rebuilt against the new head.
