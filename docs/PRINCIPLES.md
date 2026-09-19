# Principle preservation ledger

This file records what the `ai-stack` skill sweep kept, improved, merged or deliberately deleted. It is the guard against accidental simplification during future edits.

| Old skill | Principle preserved/improved | OMP-stack home |
|---|---|---|
| `flow-using-skills` | Important doctrine must stay discoverable | deleted as bootstrap; native skill discovery + `flow-safety` / `flow-evidence` rules |
| `flow-brainstorming` | resolve material intent/design decisions before speculative code; YAGNI | `flow-design`, but no ceremony for decision-free work |
| `flow-writing-plans` | execution spec removes implementation ambiguity and moves costly judgment before coding | `flow-planning` doctrine + native OMP `@plan` mechanics; LDD unit contracts remain WHAT while execution-grade plans lock consequential HOW |
| `flow-workspace` | protect dirty/user state; no silent main work; safe concurrency | `flow-safety`; native task isolation; external worktree validation in `flow-external-session` |
| `flow-executing-plans` | bounded execution, TDD, independent acceptance and controller ownership | `flow-execution`; execution-grade `@execute` lane, semantic `@task` fallback, persistent ownership and bounded acceptance closure |
| `flow-tdd` | failing proof first; minimal green; regression protection | `flow-tdd`; tests behavior rather than every function; proof scope follows ownership/workspace safety |
| `flow-debugging` | reproduce/root-cause/hypothesis before permanent fix | `flow-debugging`; read-only scout fan-out and deliberate escalation after repeated failures |
| `flow-verification` | claims need fresh evidence; worker reports are not proof | always-apply `flow-evidence`; layered leaf→unit→integration→final proof avoids both blind workers and ritual duplicate full gates |
| `flow-finishing` | final proof + user owns integration | `flow-integrating`; cohesion/reviewability replaces rigid line threshold; unchanged fresh final evidence may be reused |
| `flow-reviewing-prs` | exact-head read-only review; COR always; TTC/CRF conditional; verify findings; exact publication approval | `flow-review` PR mode + specialist agents |
| `flow-receiving-pr-reviews` | reviewer findings are claims; re-anchor; factual/judgment split; explicit dispositions; exact reply gate | `flow-review` author-feedback mode |
| `flow-auditing-codebases` | read-only whole-tree audit; four mandatory lenses; controller verifies | `flow-review` audit mode; SEC uses OMP security reviewer/scan |
| `flow-handover` | independent context may be useful; returned work/planning is independently revalidated | `flow-external-session` worker/planning handoff modes |
| `flow-mailbox` | durable external-session channel survives process/session loss; channel conveys no authorization | `flow-external-session` mailbox mode only |
| `flow-ldd` | architect owns intent/decisions/spec/verification and durable continuity | `flow-ldd`; architect remains strictly non-coding; normal Flow execution owns current worker mechanics |
| `find-todo` | conservative open-work query; preserve graph text; query before mutation | `weft-worklog` query mode |
| `journal-update` | terse human work facts, project grouping, append-first, no AI-process narration | `weft-worklog` log mode |
| `recall-memory` | scope-aware relevant recall; read-only | `weft-memory` recall mode |
| `memory-update` | durable/general/new; retrieval-based placement; exact approval before durable write | `weft-memory` update mode |
| `memory-gc` | injected memory is scarce; re-home/merge before deleting; proposal/per-item approval | `weft-memory` GC mode |
| `retrofit` | historical rewrites are dangerous; dry-run/proposal; preserve history/voice | `weft-maintenance` |
| `frontend-design` | intentional aesthetics and production craft | `ui-design`; existing product/accessibility/platform conventions now outrank novelty |
| `blog-post` | live corpus outranks static voice rules; concrete first-person thesis; user owns publishing | `blog-post` |
| `forgejo` | mechanics distinct from judgment; token safety; no silent stakeholder writes | deleted with Forgejo support; the principle survives in `flow-review` GitHub mechanics and the `flow-safety` publication rule |

## Non-negotiable invariants

Future refactors should preserve these even if filenames change:

1. Fresh evidence before material completion/correctness claims.
2. Pre-existing user state is never silently destroyed or hidden.
3. External/stakeholder-visible writes require explicit user authorization.
4. Executable behavior gets a failing regression proof before its permanent implementation when a viable test surface exists.
5. Debugging finds/supports root cause before a permanent fix.
6. Writers verify their own changes; controller verification is additive, not a reason to suppress focused worker proof.
7. Reviewer/worker output is a claim until the controller verifies consequential findings/results.
8. Evidence broadens leaf → unit → integration → final tree; do not duplicate expensive full gates at every layer by ritual.
9. Review concerns are never dropped: standalone/unplanned change review keeps applicability-driven COR/TTC/CRF/SEC; execution-grade planned work moves those concerns into the plan quality gate and uses one integrated final acceptance reviewer, with specialist escalation only when concrete residual risk warrants it.
10. Whole-codebase audit still runs CDH/TTC/DST/SEC.
11. LDD architect never writes production code.
12. LDD ledger is durable project truth, not backlog/transcript or permanent harness mechanics; Weft owns durable human backlog/project knowledge.
13. Isolation follows independence/concurrency structure; a sole suitable feature-branch writer is normally non-isolated/resumable.
14. Routing follows remaining judgment: exact mechanical work → `@smol`; new behavior with execution-grade locked HOW/proof → constrained `@execute`; unresolved semantic/debugging/integration implementation judgment → `@task`, with Main coordinating/escalating rather than becoming the production writer. Executors escalate plan contradictions instead of redesigning.
15. Native `hub wait` is a legitimate dependency primitive, not an interaction lock: OMP makes it interruptible by user steering, so it can park Main's autonomous run without preventing user prompts. Main does useful independent work first; when the next meaningful action depends on a child and nothing useful remains, one dependency-driven wait is valid. Repeated short waits or repeated `hub jobs` snapshots used as progress polling are orchestration noise.
16. Writers own safe touched-file formatting; Main owns final repo-wide cleanliness/integration gates, not basic formatting discovery.
17. Interactive Flow maintains a forward pointer: every meaningful checkpoint says what is true, what happens next, and whether the user is needed; Flow does not hand orchestration back to the user when the next action is already determined.
18. Writer dispatch is verification-capable by construction: focused proof, touched-file formatting, focused static/build checks and Main-owned broader gates are explicit before spawn; a blanket "stay blind because Main verifies" brief is invalid.
19. Temporary probes against pre-existing dirty files restore exact captured pre-edit bytes rather than assuming `HEAD` is the original state.
20. Model routing is role-based; concrete model selectors live in user config, not workflow content.
21. Cross-harness planning handoffs are evidence/proposals, never execution authorization; after targeted freshness checks, preserve valid settled decisions/strategy rather than forcing duplicate design work.
22. Substantial work establishes an approved governing WHAT/WHY contract before planning, regardless of whether context came from a new/existing project, internal brainstorm or external handoff. Main/`flow-design` owns intention clarification and contract authorship; settled decisions are preserved rather than ceremonially reopened. Substantial consequential HOW is then planner-owned: `flow-planner` (`@plan`) writes the execution-grade plan for both LDD and non-LDD work unless a current validated external plan already satisfies the approved contract. Main validates and accepts the plan rather than authoring the substantial HOW itself; decision completeness matters, not plan length.
23. Planned execution normally closes with one strong acceptance review plus at most one scoped closure round; verified findings are batched rather than triggering reviewer-by-reviewer correction loops.
24. LDD resume is context-budget aware: RESUME + active contract + active plan/task + git state first; older ledger/history is read only when the pointer/contradiction requires it.
25. Runtime approval patterns backstop normal publication commands, but they do not replace the semantic rule that stakeholder-visible effects require explicit user authorization.
26. Execution-grade task briefs are model-context boundaries: sequential tasks share repository state but normally use fresh `@execute` sessions; request-budget warnings or repeated same-blocker churn force an early yield/escalation instead of preserving a bloated executor context.
27. Execution-grade task briefs are independently provable behavioral slices: split multiple separable Red→Green clusters or independently checkpointable seams into fresh executor capsules. A multi-cluster task must justify why no valid intermediate handoff exists; never impose a numeric file/turn/token quota on an inseparable behavior.
28. Delegated work is receipt-first: compact state/proof/deviation/next-action receipts target Main's independent inspection without replacing proof or encouraging broad replay of child recon.
29. Before the first device/emulator/manual/external acceptance action, durable work records a recovery checkpoint with exact head/tree, dirty/user-owned state, fresh evidence, remaining criteria, environment state and the exact next action.
30. Visual/device evidence collection uses fresh bounded capsules: one `@vision` verifier session owns one coherent scene/state/acceptance cluster; independent scene families use fresh verifier sessions that share durable environment/artifacts, never transcript context. Verifiers never edit production behavior or own acceptance.
31. Main/controller context is phase-scoped only as an explicit top-level handoff option. An active Main cannot rotate itself; after a durable boundary it may prepare a terse fresh-session handoff when quota/context pressure warrants it, but it continues unless the user/harness actually starts the new controller.
32. Evidence freshness follows claim dependency, not ritual head identity: later edits stale only the proof they can affect, with uncertain dependency surfaces rerun conservatively and repository-required final gates still honored.
33. Substantial planned work has two explicit user approval gates: approve the completed governing contract before planning dispatch, then approve the completed execution-grade plan before the first production-writing worker. Answers to clarification questions do not themselves approve the completed or materially amended contract unless the user explicitly says so. A start/resume command never creates a missing approval; recorded unchanged approvals remain valid, and material contract/plan changes reopen their gate. LDD uses the same rule within unit authority.
34. Acceptance is a stability barrier, not a one-way phase transition: required acceptance/closure review and corrections that can change an evidence surface must settle before expensive device/manual/external evidence capture begins, and any later production-, asset-, or build-affecting mutation reopens scoped independent closure before integration. Rerun only evidence whose owned dependency surface changed; reuse unaffected evidence only with an explicit freshness rationale.
35. Multi-step device/manual acceptance is verifier-owned when `@vision` verification is available. Main checkpoints and briefs the gate, independently inspects consequential evidence and owns acceptance; fresh verifier capsules operate the environment and capture evidence.
36. Flow does not override native Agent Hub wait semantics. OMP owns wait/steering behavior, including user interruption; the runtime extension only preflights evidence-verifier capsule manifests.
37. Evidence-verifier dispatch is capsule-manifested by construction: every verifier task names one `Evidence capsule` with owns/excludes/split-check/restore fields, and missing manifests are rejected before dispatch. The verifier still independently rejects semantically separable bundles before tool use.
38. Restore-bearing verifier receipts record each protected target's before/after identity or hash and MATCH/MISMATCH/UNKNOWN; fresh MATCH proof should be reused unless later mutation or contrary evidence makes it stale.
39. Flow working state lives in the project's `.flow/` directory, hidden from git by the personal exclude guard rather than by `.gitignore` edits. Shared-mode LDD ledgers and requested audit reports are the only tracked Flow writes, workers in other checkouts receive artifacts by absolute path, and integration removes the slug's working state.
