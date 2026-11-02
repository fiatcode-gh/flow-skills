---
name: flow-review
description: Review a GitHub pull request read-only and report verified findings by correctness, tests, craft and security.
---

# Flow review: PR reviewer mode

Review an existing GitHub pull request. Never modify the contributor branch.

This skill posts nothing. It is not for feedback on the user's own PR, and it is not for whole-codebase audits.

## When to Use

- The user says "review PR #N" or gives a PR URL.
- The user asks for a re-review of a PR you already reviewed.

## Prerequisites

- GitHub MCP read access to the PR: metadata, diff and changed files, commits, check status, and existing reviews and comments.
- You cannot run code or tests here. Read them instead.

## Procedure

1. Pin exact remote base and head SHAs, the description and requirements, commits, changed files and stat, required checks and existing discussion.
   - For re-review, find the last reviewed commit and verdict, and verify the old findings against the new head.
   - Then focus on the delta plus affected callers and contracts.
2. Choose the lenses.
   - Run COR and CRF always.
   - Run TTC only when executable behavior, tests, validation, migrations, types, schemas or contracts changed.
   - Run SEC only when a real security boundary is involved: authentication/authorization, secrets, cryptography, payments, destructive operations, untrusted-input boundaries, privileged filesystem/process/network access, etc.
   - State the disposition in the reply: `COR run`, `CRF run`, `TTC run/skip + reason`, `SEC run/skip + reason`.
   - Reasons cite the changed surface or risk, not cost.
3. Run each applicable lens as a separate pass over the diff and the surrounding code at the head SHA. Lens definitions are in `## Lenses`.
4. Verify the findings.
   - Verify every Critical/Important finding by reading the cited and surrounding code at the head SHA.
   - Cheaply verify Minor findings.
   - Label leftovers `Cannot verify`, or omit them.
   - Merge duplicate root causes.
   - Investigate conflicts instead of voting.
   - A failing required check is blocking.
   - Unavailable or ambiguous required-check evidence is comment-only.
5. Give a verdict recommendation for the user. First set aside findings that are only about craft (CRF): they are non-blocking comments, even when Important. Then:
   - a verified Critical/Important finding remains → request changes;
   - none remains and required checks are green → approve;
   - evidence is incomplete, pending or conflicted → comment.

   Example: the only finding is dead code and required checks are green → approve, with one non-blocking comment on the dead code.
6. Draft one concise summary and only valuable changed-line inline comments, each with `path:line`.
   - Give the draft to the user. Post nothing.
   - Name the head SHA you reviewed.
   - Tell the user to check, before posting it themselves, that the head has not moved, and to have the draft rebuilt if it has.

## Lenses

Each lens reviews code but never edits it.

**COR — always.** Check governing requirements/rules, correctness, regressions, edge cases, compatibility, architecture, security/performance/concurrency side effects and changed failure paths.
Look for swallowed errors, broad catches, unjustified fallbacks, hidden retries, misleading defaults, missing cleanup and unactionable errors.
Distinguish changed defects from pre-existing code.

**TTC — conditional.** Applies to executable behavior/test/validation/migration/type/schema/contract changes.
Map each changed behavior to a behavioral regression test; name existing coverage when sufficient.
Check boundaries, negative/error/async/integration behavior, invalid states, serialization and compatibility.
Never infer TDD chronology from a combined/squashed diff.
Judge coverage by reading the tests; you cannot run them.

**CRF — always.** Run CRF on every change review, like COR. Verify comments/docs against implementation. Check names, cohesion, duplication, abstraction, nesting, separable concerns, and the repository's domain model. No rigid line-count threshold.

Rate each of these craft defects Important. In a PR review they are still non-blocking comments (step 5):

- unclear or misleading names;
- a unit that does more than one job;
- dead code;
- needless abstraction;
- comments that narrate the code or contradict it;
- names or boundaries that do not follow the repository's domain model, when it has one.

Do not impose a domain model the repository does not have. Rate pure taste Minor. Example: the current name is accurate and clear, but you would prefer another.

**SEC — conditional.** Applies when a meaningful security boundary changed. Check the changed security boundary yourself: step 2's categories, checked against the exact head SHA. Rate a confirmed compromise path Critical.

## Output

State the head SHA and scope reviewed. Existing comments are context, not truth. Report strengths and `Cannot verify` items.

Finding shape:

```text
ID: <PREFIX>-N
Severity: Critical | Important | Minor
Confidence: 0-100
Location: file:line
Title: concise defect statement
Evidence: violated requirement/contract or reproducible failure path
Impact: user/correctness/security/maintenance consequence
Remedy: specific direction, not a full patch
Verification: code read at <head SHA> (path:line), or static evidence only; no command was run
```

Critical = security compromise, data loss, outage, destructive behavior or broken primary functionality.
Important = verified defect/requirement miss/regression/missing behavioral coverage/contract break/architecture violation with concrete risk.
Minor = useful non-blocking cleanup, such as pure taste.
The CRF lens lists the craft defects that are Important.

Reply in this order:

1. the disposition line;
2. findings by severity;
3. strengths;
4. `Cannot verify`;
5. the verdict recommendation;
6. the draft summary and inline comments.

## Pitfalls

- Make no GitHub writes of any kind.
- Never claim a check or test ran in this chat.
- Read check status only from GitHub.
- Do not infer TDD chronology from a squashed diff.
- Separate changed defects from pre-existing code.
- Pure taste is Minor.

## Verification

Before replying, check:

- Every Critical/Important finding cites `path:line` at the head SHA, and you read that code.
- The disposition line is present.
- CRF-only findings are not blocking.
- The reply says nothing was posted.
