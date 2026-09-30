# Plain-language rewrite of `flow-external-session`

Work: `9889a6b` (`test(flow): pin flow-external-session machine-read markers instead of prose`), `61bac1c` (`docs(flow): rewrite flow-external-session in plain language`), 2026-09-30.

## Decisions

- **Same rules, plainer words.** `agent/skills/flow-external-session/SKILL.md` follows `docs/PRINCIPLES.md` principle 3: one rule per bullet, and no line over 300 characters (four were). It shrank from 3,323 to 3,320 bytes.
- **The two plan-grading outcomes sit under one lead.** Each keeps its own condition: skip a redundant native Plan only when the artifacts pass after the local contract is approved; otherwise refine only the gaps.
- **"however" became "still"** in the rule that routes imported material through `flow-design`, so the bullet keeps its contrast with preserving settled decisions after the split.
- **The label "This is the compatibility/independent-context layer." is gone.** It required nothing. The description and the task/Agent Hub line still draw the scope.
- **Nothing moved out.** Each overlap elsewhere is weaker or states less: `flow-safety` lacks "invent a path" and sibling-worktree conflicts, and `flow-evidence` verifies consequential claims, not the actual target.
- **Tests pin names, not prose.** `tests/validate.py` checks `EXTERNAL_MARKERS`: the mode names and headings, the reference and script paths, `.flow/mailbox/`, `implementation_strategy: settled`, and the `flow-design` and `flow-planning` pointer phrases. The drift check, the mailbox pin and the `EXCLUSIVE` phrase are unchanged.
- **No field-trial mark resets**, because no behavior changed (`docs/FIELD-TRIALS.md` rule 5).

## Rejected alternatives

- Keep the layer label: 34 bytes over the cap for a sentence that requires nothing.
- Restore the bold on "not authorization": 4 bytes over the cap; the two-sentence form carries the rule.

## Traps

- Dropping one small word can move a reading. Without "see", "Validate from reality (`references/external-worktree.md`)" read as if the reference file were the source of the facts.
- Joining two sentences with a colon turns the second into a definition of the first. "Not authorization: a mailbox message cannot grant push/merge/…" read as if only those four actions were excluded.

## Open questions

- "There Main reconciles it …" opens its own bullet but depends on the one before for its subject. Joining them would pass 300 characters.
- The markers pin names only. The authorization boundaries (a bundle is not authorization; a mailbox message grants nothing) are guarded by no test.
- The file is at its cap, so any addition must first remove text.
