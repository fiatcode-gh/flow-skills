# Plain-language rewrite of `flow-design`

Work: `f4eeb8d` (`test(flow): pin flow-design machine-read markers instead of prose`), `4bcfd10` (`docs(flow): rewrite flow-design in plain language`), 2026-09-30.

## Decisions

- **Same rules, plainer words.** `agent/skills/flow-design/SKILL.md` follows `docs/PRINCIPLES.md` principle 3. No rule changed what it requires. It shrank from 5,084 to 5,071 bytes, and no line is over 300 characters.
- **Numbered steps keep their numbers.** A long step became a short lead plus indented sub-bullets, so step 7 is still the approval step that `flow-planning` points to.
- **One restatement is gone.** Step 8 no longer says that Main does not write the HOW plan; `flow-planning` section 1 and `agent/AGENTS.md` say it. The clarification-answers rule stays, because `flow-planning` points here for what counts as contract approval.
- **Durability uses a lead-in** ("For substantial work:") so the one qualifier covers all four bullets.
- **Tests pin names, not prose.** `tests/validate.py` checks `DESIGN_MARKERS`: the headings, the step 7 opener and the "Resume step" name that other files point at, and the tool and path names. The six `EXCLUSIVE` phrases homed here are unchanged.
- **No field-trial mark resets**, because no skill's behavior changed (`docs/FIELD-TRIALS.md` rule 5).

## Rejected alternatives

- Add an example to step 7: it did not fit the 5,084-byte cap, and the rule reads one way.
- Split the "Multi-unit work" bullets: about 30-40 bytes over the cap once each subject is restated, and they were already one idea per sentence.

## Traps

- "Name your recommendation and trade-offs" became "and its trade-offs" in the first draft. "Its" narrows the trade-offs to the recommended option. A possessive can narrow a rule as easily as a lost qualifier.
- A quiz key written from the draft text shares the draft's wording, so it cannot catch that drift. Write the key from the old text.

## Open questions

- The "Multi-unit work" bullets still hold two to four rules each, a known exception to principle 3. The two gate rules ("Start no unit before the parent is approved", "A material parent change reopens …") sit at the end of a four-rule bullet.
- The prose phrases the old test pinned ("main owns the contract", "native user confirmation", "artifact digest") are no longer pinned anywhere.
