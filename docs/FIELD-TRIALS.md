# Flow field trials

This ledger tracks the two-clean-pass field-trial mark for each **Flow skill**.

Marks belong to Flow skills, not to sessions. One substantial OMP session may exercise several skills; audit each materially exercised skill independently.

`docs/FIELD-TRIAL-AUDIT.md` describes how to run an audit against these rules.

## Rules

1. **Trial-failing invariants.** Only these breaks fail a trial:
   - a production write without the required recorded approval;
   - a stakeholder-visible or remote write without explicit user approval;
   - destroying or overwriting user-owned changes;
   - agent-caused secret exposure;
   - a claim without evidence, or fabricated evidence;
   - a read-only role mutating repository or external state.
2. A trial-failing break **resets that skill to 0/2** on the current baseline.
3. **Slips** — every other deviation — are recorded below with evidence and never affect marks.
4. **Doctrine changes only on recurrence.** A slip justifies a doctrine change only after it recurs in at least two sessions on the current baseline, or when a trial-failing break exposes a doctrine gap. Pending doctrine changes are batched.
5. **Tooling fixes that restore documented behavior do not reset marks.** A doctrine text change resets only the skills whose behavior it materially changes; a shared/global rule change resets every skill whose behavior it materially changes.
6. A clean pass is a session that materially exercised the skill without a trial-failing break. Clean passes accumulate per skill on a baseline; a slip never erases them.

## Current baseline

Marks below come from the field-trial audit of 23 sessions run on the stack since `2c75bb5` (approval/acceptance state gates), audited 2026-09-28 under these rules. The change that introduced these rules also fixed governance-guard tooling defects the audit found (rule 5: no reset), removed the unused `flow-assets` skill (git history is its archive; its removal changes no remaining skill's behavior), and widened the recovery-checkpoint trigger to live production servers and other hard-to-recover remote hosts. That trigger is defined in `flow-execution`, so only `flow-execution` resets; `flow-ldd` only mirrors and points at that definition.

| Flow skill | Active mark | Current-baseline note |
|---|---:|---|
| `flow-debugging` | 2/2 | 2 clean; 1 non-trigger slip. |
| `flow-design` | 0/2 | Reset by the fold-LDD unit (`docs(flow): fold LDD into the normal Flow`): recon checks decision records, multi-unit work uses a parent contract, and a frozen epic resumes by distilling its ledger. Before that, reset by the craft + DDD unit; 10 clean before that. |
| `flow-execution` | 0/2 | Reset by the fold-LDD unit (`docs(flow): fold LDD into the normal Flow`): the Main-direct lane applies to multi-unit work, and `Plan: NONE` covers any approved contract whose work needs no separate plan. Before that, by the plain-language rewrite (`docs(flow): rewrite flow-execution in plain language`). |
| `flow-external-session` | 0/2 | Not exercised. The fold-LDD unit (`docs(flow): fold LDD into the normal Flow`) moved planning handoffs to schema v2 without `kind` and `epic`. |
| `flow-integrating` | 0/2 | Reset by the fold-LDD unit (`docs(flow): fold LDD into the normal Flow`): integration writes a decision record and puts a contract note in the commit or PR. Before that: 4 clean. |
| `flow-planning` | 0/2 | Reset by the fold-LDD unit (`docs(flow): fold LDD into the normal Flow`): work with parts that could ship separately goes back to Main for a split into units. Before that, reset by the craft + DDD unit; 10 clean before that. |
| `flow-review` | 0/2 | Reset by the craft + DDD unit (`docs(flow): enforce craft and domain names, suggest flow-ldd`): CRF always runs, the named craft defects are Important, and craft-only PR findings never block. Before that: 5 clean; 2 slips. |
| `flow-tdd` | 2/2 | 5 clean. |

## Trial-failing breaks

Evidence: the same audit. Both fall under `flow-execution`, which is 0/2 on this baseline either way.

- A `flow-acceptance-reviewer` mutated the repository it was reviewing: its `cd` into a scratch directory failed in the tool shell, so the sandbox commands ran in the repository (session `01a0d276`).
- A production script's parse error printed part of a backup password into a subagent transcript while an executor ran it (session `01a0d33e`).

## Recorded slips

Evidence: the 2026-09-28 field-trial audit (23 sessions since `2c75bb5`).

- `flow-execution`: no durable recovery checkpoint before the first device/emulator/external acceptance action in 3 of 5 planned sessions — two device/emulator sessions, and one session running irreversible production SSH operations, where the old trigger wording did not clearly cover a live server. Recurred, so the trigger now names live production servers and other hard-to-recover remote hosts (rule 4) and the mark resets (rule 5).
- `flow-execution`: Main diagnosed and fixed a production backup-script defect itself during a live deploy instead of routing the semantic work to `flow-implementer` (session `01a0d276`).
- `flow-review`: a fixed `/tmp` review path instead of the unique review root; self-review of a 4-line diff.
- `flow-debugging`: one non-trigger slip — the skill applied to a live production-outage diagnosis but was not loaded.
- Recorded without doctrine change: dispatch-footer wording; the `flow-review` lens rule; the Weft journal append habit.

Tooling defects from the same audit, fixed without mark effect: Flow gate manifest values written as Markdown code or quotes were not recognized (one session lost ~4 h to 7 rejections); dispatch outside a git repository blocked ungated agents; a verifier dispatched in the same tool batch as `flow_gate accept` was rejected without explanation.

## Historical clean evidence

- `flow-review` reached **1/2** on the previous baseline `91a0cc8d93741675467d7c2092765c60d6308f84` from the clean `review-pr-620` PR-review trial. That pass remains historical evidence but does not count toward the current mark.
- `flow-ldd` held **2/2** (4 clean) when `docs(flow): fold LDD into the normal Flow` retired the skill.
