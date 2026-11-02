# Change review lenses

## Shared finding contract

Each specialist reviews code but never edits it. State the supplied head/scope and stop on mismatch. Existing comments are context, not truth. Report strengths and `Cannot verify` items.

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
Verification: code traced and command run, or static evidence only
```

Critical = security compromise, data loss, outage, destructive behavior or broken primary functionality. Important = verified defect/requirement miss/regression/missing behavioral coverage/contract break/architecture violation with concrete risk. Minor = useful non-blocking cleanup, such as pure taste. The CRF section lists the craft defects that are Important.

## COR — always

Check governing requirements/rules, correctness, regressions, edge cases, compatibility, architecture, security/performance/concurrency side effects and changed failure paths. Look for swallowed errors, broad catches, unjustified fallbacks, hidden retries, misleading defaults, missing cleanup and unactionable errors. Distinguish changed defects from pre-existing code.

## TTC — conditional

Applies to executable behavior/test/validation/migration/type/schema/contract changes. Map each changed behavior to a behavioral regression test; name existing coverage when sufficient. Check boundaries, negative/error/async/integration behavior, invalid states, serialization and compatibility. Never infer TDD chronology from a combined/squashed diff.

## CRF — always

Run CRF on every change review, like COR. Verify comments/docs against implementation. Check names, cohesion, duplication, abstraction, nesting, separable concerns, and the repository's domain model. No rigid line-count threshold.

Rate each of these craft defects Important. Each one blocks acceptance:

- unclear or misleading names;
- a unit that does more than one job;
- dead code;
- needless abstraction;
- comments that narrate the code or contradict it;
- names or boundaries that do not follow the repository's domain model, when it has one.

Do not impose a domain model the repository does not have. Rate pure taste Minor. Example: the current name is accurate and clear, but you would prefer another. PR reviewer mode posts craft-only findings as non-blocking comments (`pr-review.md` step 5).

## SEC — conditional

Applies when a meaningful security boundary changed. Prefer OMP's security specialist/native security scan rather than reimplementing a security checklist here. Validate important security findings against the exact target snapshot before synthesis.
