---
name: flow-tdd
description: Use when adding or changing executable behavior; establish a failing behavioral proof before production code, then Red/Green/Refactor with verification scoped to the owning layer.
---

# Flow TDD

For executable behavior: **no production behavior without a failing proof first**.

## Cycle

0. **Baseline** — when touching an existing tested surface, run the relevant existing tests first. Pre-existing red stays separate; do not silently repair unrelated failures.
1. **RED** — write one minimal behavioral test/reproduction for one behavior. Prefer real code and public seams; mock only where the boundary requires it.
2. Run it and confirm the failure is for the intended missing/broken behavior, not a typo/setup failure.
3. **GREEN** — make the smallest production change that satisfies the behavior. No unrelated features/options.
4. Run the focused test, then the broader regression scope appropriate to **your ownership and workspace safety**.
5. If the green result could be hard-coded/accidental, add a second case that forces the real rule.
6. **REFACTOR** — improve names/structure/remove duplication while staying green.

Repeat per behavior.

Proof layers follow the `flow-evidence` rule. Never skip the focused proof you can run because a higher layer verifies later.

## Test philosophy

- Every **new or changed behavior** needs regression protection that would fail if that behavior regressed. Do not require a test merely because a new function exists.
- Bug fix: reproduce the bug in a failing test/check first.
- Test outcomes/contracts, not implementation trivia.
- One behavior per test; split compound scenarios where failure meaning becomes ambiguous.
- Hard-to-test behavior is design feedback; simplify the seam before reaching for excessive mocks.
- Test code follows the same clarity standard as production code. Do not add Arrange/Act/Assert comments mechanically; comments still explain why/non-obvious context only.

## Legitimate non-TDD surfaces

Pure documentation, static metadata/config changes, generated artifacts or legacy areas with no viable test harness may not admit Red/Green. State that explicitly and use the strongest repository-native executable/static proof available. Do not invent a framework just to satisfy ceremony.
