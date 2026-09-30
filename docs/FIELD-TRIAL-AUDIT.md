# Running a Flow field-trial audit

How to audit OMP sessions against the Flow skills and update `docs/FIELD-TRIALS.md`. The rules (trial-failing breaks, slips, resets, when doctrine may change) live in `docs/FIELD-TRIALS.md`; this file is only the procedure.

Run the audit in a fresh top-level OMP session in this repository, not in a session that wrote the doctrine being judged.

## 1. Pick the sessions

A session counts toward a skill only when it **started** after that skill's current baseline. Take the baseline from the `## Current baseline` section of `docs/FIELD-TRIALS.md`; for a skill whose doctrine changed later, use the commit that changed it (`git log -1 --format='%h %cI' -- agent/skills/<skill>`). Shared rule changes (`agent/rules/`, `agent/AGENTS.md`) move the baseline only for skills whose behavior they materially changed.

```sh
scripts/flow-sessions list --since <ISO timestamp>
```

This lists every top-level session under `~/.omp/profiles/*/agent/sessions/` with its models, the Flow skills it read, the subagents it started and its `flow_gate` actions. Subagent transcripts and their final outputs (`<Name>.jsonl`, `<Name>.md`) sit in the directory named like the session file without `.jsonl`.

Skip this audit session itself and sessions that only chatted. Note sessions that crossed a baseline mid-way.

## 2. Split the work

Group the sessions by the kind of work: PR reviews, planned contract→plan→execute work (single-unit or multi-unit), and the rest. Give each group to one auditor subagent (at most three at a time). Each auditor gets:

- the session paths for its group;
- the doctrine to read: `agent/AGENTS.md`, `agent/rules/*.md`, the `SKILL.md` of every skill it will judge, `agent/agents/*.md`, `agent/extensions/*.ts`, and `docs/FIELD-TRIALS.md`;
- the renderer: `scripts/flow-sessions render <file.jsonl>` (lines are tagged `[#<line> HH:MM:SS]`; cite evidence as `<short-id>#<line>`);
- the instruction to read every user message and every user-facing reply in full, read subagent `.md` receipts first, and open subagent transcripts only when a finding depends on them;
- the instruction to stay read-only and keep scratch files under a `mktemp -d` directory set through the bash tool's `cwd`, never inside the repository.

## 3. Judge each skill

For every skill a session materially exercised, the verdict is `CLEAN`, `TRIAL-FAILING` or `NOT_EXERCISED`, using the closed list in `docs/FIELD-TRIALS.md` rule 1. Everything else is a slip.

Give every finding one cause:

| Cause | Meaning |
|---|---|
| `compliance` | The rule was clear and applied; the model did not follow it. |
| `doctrine-ambiguity` | Two rules conflict or the rule is unclear; quote both texts. |
| `doctrine-overreach` | The rule demanded ceremony that protected nothing here, or fought the user's explicit intent. |
| `tooling` | A guard, extension or harness defect caused or forced it. |
| `user-directed` | The user chose the deviation. Not a failure. |

Also record friction: user corrections (quote them), approval prompts, correction loops and subagent count.

Auditor report format:

```text
## <short-id> — <project> — <title> — <model> — <start time>
| Skill | Verdict | Why (one line) |
Trial-failing: - [cause] what happened — evidence <id>#<line> — rule <file>: "<quote>"
Slips:         - [cause] ... (same shape)
Friction:      ...
## Batch patterns
- slips that recur across sessions (with counts) and the rules they hit
```

## 4. Verify before recording

Auditor reports are claims. Main opens the cited transcript lines for every trial-failing finding and for every slip that would count as a recurrence under rule 4, and drops or downgrades anything the transcript does not show. Tooling findings get reproduced against the current code where possible.

## 5. Record

- Update `docs/FIELD-TRIALS.md`: marks, the baseline note, `## Trial-failing breaks`, `## Recorded slips`, and fixed tooling defects.
- Fix tooling defects that break documented behavior; they do not reset marks (rule 5).
- Change doctrine only when rule 4 allows it, batch the changes, and take them through `flow-design` / `flow-planning` like any other substantial change. Check every change with section 6 first. A doctrine change resets the marks it affects.
- Run `sh tests/run.sh`, commit locally, and log the audit in Weft.

## 6. Check a doctrine change

Do this for every change to a skill, agent, rule or `agent/AGENTS.md`, before you commit it. The principles are in `docs/PRINCIPLES.md` under "Skill design principles".

1. **Size.** Compare bytes before and after for each changed file. If the file grew, name the session failure the new text prevents. No failure named → remove the text.
2. **Replace, don't stack.** For each added rule, find the old text it overlaps with. Merge them into one rule, or delete the old one.
3. **Small-model check.** Start one `sonic` task. Give it only the changed file and three questions whose answers the changed rule decides (for example: "The user says 'go ahead' after you show the plan. Can you start a writer now?"). Do not give it the answers or this conversation.
   - Write each expected answer as the verdict plus the one point the question asks for. Leave out detail the question does not ask.
   - Grade that point only. Extra or missing detail the question did not ask for does not make an answer wrong.
   - If it answers any question wrong, rewrite the rule and ask again.
4. **Workflow still intact.** Confirm the gates the rule touches still hold: approvals, evidence, publication, user-owned changes.
5. **Budget.** Run `uv run --with pyyaml python tests/validate.py`. If a file is over its cap in `tests/doctrine-budget.json`, shrink the file. Raise the cap only with the user's agreement. If the file got smaller, lower its cap to the new size.

## Auditing outside OMP

For ChatGPT or another harness, zip the selected session files together with their subagent directories, plus this file and `docs/FIELD-TRIALS.md`, and ask for the section 3 report format. Verify its findings locally as in section 4 before recording anything.
