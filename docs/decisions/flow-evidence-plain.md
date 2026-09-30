# Plain-language rewrite of the `flow-evidence` rule

Work: `4e79b97` (`test(flow): pin flow-evidence machine-read markers instead of prose`), `af4fbec` (`docs(flow): rewrite flow-evidence in plain language`), 2026-09-30.

## Decisions

- **Same rules, same words.** `agent/rules/flow-evidence.md` loads into every agent, so it follows `docs/PRINCIPLES.md` principle 3: one rule per bullet. Almost every sentence keeps its old wording. It shrank from 4,443 to 4,439 bytes, and no line is over 300 characters (six were, the longest 889).
- **Multi-step rules become a lead plus steps.** Claim-relevance staleness, carrying proof across a head, the stability-barrier reopen, and the dirty-file probe each have a lead line that carries the qualifier and sub-bullets for the steps.
- **Nothing moved out.** This rule is the home `flow-execution`, `docs/ARCHITECTURE.md` and `docs/PRINCIPLES.md` item 38 point to.
- **"This rule still decides" names itself.** After the split it reads "The `flow-evidence` rule still decides", so the referent survives reordering.
- **The description is shorter.** "Always-on" repeated `alwaysApply: true`, and the tail restated the layered-proof rule the body states. The bytes it freed paid for the splits.
- **No headings.** They did not fit the byte cap.
- **Tests pin names, not prose.** `tests/validate.py` checks `EVIDENCE_MARKERS`: the rule name and title, the claim, tool and receipt names, and the concept names other files point at. The two `EXCLUSIVE` phrases are unchanged.
- **No field-trial mark resets**, because no behavior changed (`docs/FIELD-TRIALS.md` rule 5).

## Rejected alternatives

- Keep the old description: the file would be 4,490 bytes, over the cap, unless splits were rejoined.
- Group bullets under headings: over the cap.

## Traps

- A small model that already carries this rule in its context answers a quiz on it from memory. Both the old and the new text scored full marks, so the quiz shows no regression but cannot show that the new wording is clearer.

## Open questions

- The first bullet starts with its condition ("When a command is the proof, run it now …"), not with the action as principle 3 asks. The action-first form costs 13 bytes the cap does not have.
- The marker `stability barrier` is satisfied by the definition line alone. Deleting the reopen steps, or the rule against rerunning the full suite as ceremony, would not fail `tests/validate.py`, although `flow-execution` points at both. Pinning `reopens the stability barrier` and `Do not rerun the same expensive full suite` would close that gap.
- The description says "destructive actions"; the body says "destructive or irreversible action".
