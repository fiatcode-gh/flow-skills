# Plain-language rewrite of `flow-review`

Work: `629cb0c` (`test(flow): pin flow-review machine-read markers instead of prose`), `3a15934` (`docs(flow): rewrite flow-review in plain language`), 2026-09-30.

## Decisions

- **Same rules, plainer words.** `agent/skills/flow-review/SKILL.md` follows `docs/PRINCIPLES.md` principle 3: one rule per bullet, and no line over 300 characters (three were). It shrank from 3,806 to 3,790 bytes.
- **Conditions become leads.** "In PR reviewer mode:" and "After fixes:" carry their qualifier over the bullets they cover. "Main's final verification is separate" stays outside "After fixes:", because it never depended on a fix.
- **The SEC route reads one way.** "Route SEC to built-in `security-reviewer`, or to native `security_scan` when a dedicated scan is warranted." The old sentence let a reader attach the condition to both routes, which left SEC with no route when no dedicated scan was warranted.
- **Two restatements are gone.** "Never expose secret values" (the always-loaded `flow-safety` rule says it with a wider scope), and the domain-model sentence in `agent/agents/flow-craft-reviewer.md` (`flow-review/references/review-lenses.md` states it, and the agent already points there). The agent shrank from 1,014 to 914 bytes.
- **The description keeps the four trigger situations** and drops its tail, which restated the lens-selection and publication-gate sections.
- **Tests pin names, not prose.** `tests/validate.py` checks `REVIEW_MARKERS`: the mode names and reference paths, the headings, "TTC only when" and "SEC only when", the lens routes, the disposition labels and the two reference pointers. The `EXCLUSIVE` COR/CRF phrase and the craft reviewer's `POINTS_TO` entry are unchanged.
- **No field-trial mark resets**, because no behavior changed (`docs/FIELD-TRIALS.md` rule 5).

## Rejected alternatives

- Keep the old description: the one-rule-per-bullet body would be about 3,900 bytes, over the cap.

## Traps

- A sentence can read two ways without anyone noticing until a small model picks the other reading. The old SEC route was one; the quiz on the old text found it.

## Open questions

- Four bullets still start with their condition, not the action (the checkpoint statement, routing fixes, a clean review, the GitHub write gate).
- The markers pin each lens route name, not the pairing. Swapping the TTC and CRF agents would not fail a test. The re-run rule, "Do not pass concrete model names" and the "exact" and "immediately" words of the publication gate are no longer pinned either.
