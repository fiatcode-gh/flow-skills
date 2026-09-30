# Plain-language rewrite of `agent/AGENTS.md`

Work: `48f9500` (`test(flow): pin AGENTS.md machine-read markers instead of prose`), `33e4a93`, `5a99de4` (`docs(flow): rewrite AGENTS.md in plain language`), `6441fd9`, 2026-09-30.

## Decisions

- **Same rules, plainer words.** The file loads in every session, so it follows `docs/PRINCIPLES.md` principle 3: one rule per bullet, action first, exact names. No rule changed what it requires. It shrank from 9,683 to 8,663 bytes.
- **Always-loaded triggers stay in the file.** Rules that must hold before a skill loads stay as short instructions: contract approval before planning, plan approval before the first writer, start or resume is not approval, clarification answers are not approval, `flow_gate` recording, role routing, the three writer lanes, one acceptance review, the Main-direct lane, publication, the Weft hook and the PR-reviewer exception, the forward pointer.
- **Restatements of always-loaded rules are deleted.** Isolation and resumability live in `flow-safety`. Writer self-verification and the stale-binding verifier block live in `flow-evidence`. Running independent units concurrently lives in `flow-execution` section 3.
- **Skill-level detail becomes a pointer, only where the home already states it.** Keeping settled decisions and reconciling intent with the project (`flow-design`), when an external plan counts as execution-grade (`flow-planning`, `flow-external-session`), the `Flow gate:` block format (`flow-planning` and `flow-execution` section 1), lens review (`flow-review`), and when to mark a Weft item (`weft-worklog` Mode C).
- **Tests pin names, not prose.** `tests/validate.py` checks `AGENTS_MARKERS`: the heading `README.md` names, the shell-check commands, and the skill, agent and tool names that route behavior. The one-home `EXCLUSIVE` and `POINTS_TO` checks guard each pointer. The negative check against blanket Main coding permission stays.
- **No field-trial mark resets**, because no skill's behavior changed (`docs/FIELD-TRIALS.md` rule 5).

## Rejected alternatives

- Cut the Flow section to a short index of skills: smaller, but "start is not approval" and "contract before planning" would apply only after the skill loads. The governance guard enforces writer gates, not the contract-before-planning gate.
- Move text into skills so that AGENTS.md can drop it: out of scope for a wording change. Text with no other home stays.

## Traps

- Small wording changes can tighten or widen a rule. The first rewrite dropped "consequential" from the planning trigger and "durable" from the `flow_gate` rule, and added an "only" to tuning skill descriptions. Compare each rewritten rule's qualifiers with the old text.
- The marker list must hold on both the old and the new text, because it lands before the rewrite. The one-home entries must land with the rewrite, because the old text fails them.

## Open questions

- The deleted restatements have no `EXCLUSIVE` pin, so re-adding them to AGENTS.md would not fail `tests/validate.py`.
