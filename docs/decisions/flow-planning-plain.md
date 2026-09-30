# Plain-language rewrite of `flow-planning`

Work: `1fd9161` (`test(flow): pin flow-planning machine-read markers instead of prose`), `46275fc` (`docs(flow): rewrite flow-planning in plain language`), 2026-09-30.

## Decisions

- **Same rules, plainer words.** `agent/skills/flow-planning/SKILL.md` follows `docs/PRINCIPLES.md` principle 3. No rule changed what it requires. It shrank from 9,646 to 9,567 bytes, and no line is over 300 characters.
- **Restatements become pointers, only where the home states the rule with the same force.** What does not count as contract approval (`flow-design` step 7), what does not count as plan approval (`flow-execution` section 1), writer routing, task order and isolation, and artifact paths in briefs (`flow-execution` sections 2 to 4).
- **"One fresh `flow-plan-executor` session per task brief, normally" stays in the file.** Its home, `flow-execution` section 3, says "never reuse", which is stronger. Moving it would have changed the rule's force.
- **Units and tasks get one example each.** Parts that can be released alone are units, which Main proposes to the user. Slices that can be proved alone inside one release are tasks, which the planner splits itself. The old wording let a same-release task split read as a unit to report.
- **The guard's digest check has its own bullet with an example** ("the contract was edited after approval"). Next to the source-revision bullet, the combined sentence read as "revalidate and continue".
- **Tests pin names, not prose.** `tests/validate.py` checks `PLANNING_MARKERS`: the section headings, the `Flow gate:` block, the section 3 brief labels, the quality-gate and lens names, and the tool and path names. `POINTS_TO` guards each new pointer; the `EXCLUSIVE` external-handoff entry and the `doctrine_drift` check stay.
- **No field-trial mark resets**, because no skill's behavior changed (`docs/FIELD-TRIALS.md` rule 5).

## Rejected alternatives

- Move the executor-session rule to `flow-execution` with the other restatements: it would drop "normally", which the home does not have.
- Add the rule that a plan with locked text in `plan-tasks/` needs a `PLAN.md` edit so an amendment reopens `flow_gate`: a real failure, but a new rule, out of scope for a wording change.

## Traps

- Splitting one sentence into bullets can drop a qualifier that covered both halves. "For substantial planned work, receipt validation does not authorize …: Main presents … and gets explicit plan approval" lost "substantial" on the second half when split. Put the qualifier on the bullet that carries the requirement.
- Word swaps change counts: "multiple" means two or more, "several" can be read as more than two. Use "more than one".
- "This block" must sit directly above the block it names.

## Open questions

- `POINTS_TO` checks only that a pointer is present, not that its home still states the rule. The clarification-answers rule is pinned only in `docs/PRINCIPLES.md`, and "start or resume" and "pass artifact paths" are not pinned in `flow-execution`. Deleting one there would leave a pointer to nothing without failing a test.
- `flow-execution` section 1 points to `flow-planning` for what counts as execution-grade; that pointer has no `POINTS_TO` entry.
- The tasks example ("a new database column, then the API that fills it") sits near the rule against separate tasks for setup. A column added only for that API could be read as setup.
- "Normally one fresh executor per task" here is weaker than "never reuse an executor" in `flow-execution` section 3.
