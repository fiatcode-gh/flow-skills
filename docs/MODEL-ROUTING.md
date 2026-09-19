# Model routing

The stack encodes **intent in roles**, not concrete model names. Native OMP profiles map the same role vocabulary to different providers:

```sh
omp --profile openai-codex
omp --profile ollama-cloud
omp --profile anthropic
```

The Flow skills/agents are symlinked into all managed profiles, so workflow semantics stay provider-independent while OMP keeps each profile's config, sessions, runtime database and authentication state isolated.

## Routing

| Load | Role / agent | OpenAI Codex profile | Ollama Cloud profile | Anthropic profile |
|---|---|---|---|---|
| tiny metadata/title/background | `@tiny` | Luna low | DeepSeek V4.1 Flash low | Haiku 4.5 |
| commit/changelog generation | `@commit` | Luna low | DeepSeek V4.1 Flash low | Haiku 4.5 |
| repo exploration | bundled `scout` / `@smol` | Luna | DeepSeek V4.1 Flash low | Haiku 4.5 |
| behavior-preserving mechanical work / diagnosed exact correction | bundled `sonic` / `@smol` | Luna | DeepSeek V4.1 Flash low | Haiku 4.5 |
| Main/controller | `@default` | Terra | **DeepSeek V4 Pro high (v8 trial)** | Opus 5 high |
| execution-grade plan follower | `flow-plan-executor` / `@execute` | **Luna** | **GLM-5.3-Flash high** | Sonnet 5 high |
| residual semantic judgment / broken-plan fallback | `flow-implementer` / `@task` | Terra | GLM-5.3-Flash high | Sonnet 5 high |
| deliberate execution planning | `flow-planner` / `@plan` | Sol high | DeepSeek V4 Pro high | Opus 5 high |
| final planned acceptance / hard reasoning | `flow-acceptance-reviewer` / `@slow` | Sol high | DeepSeek V4 Pro high | Opus 5 high |
| TTC/CRF/audit auxiliary lenses (exceptional/planned escalation + standalone review) | `@review_aux` | Terra high | GLM-5.3-Flash high | Sonnet 5 high |
| vision / multimodal inspection | `@vision` | Luna | GLM-5.3-Flash high | Sonnet 5 high |
| exceptional security/concurrency/data-integrity escalation | `@critical` | Sol xhigh | Kimi K3 high | Fable 5.1 high |

`slow` intentionally stops below the most expensive explicit escalation. `critical` is the escape hatch; no automatic Flow agent binds `@critical` on purpose. Escalation should be a conscious model/session choice, not accidental fan-out.

## Provider profiles

`profiles/openai-codex/config.yml`, `profiles/ollama-cloud/config.yml`, and `profiles/anthropic/config.yml` are first-install baselines, not runtime overlays. `scripts/omp-stack install` copies a baseline only when the corresponding native profile has no `config.yml`; later installs leave profile-owned config untouched.

OMP named profiles isolate the full OMP-native user root, not merely model selection. The installer therefore links the same `AGENTS.md`, agents, rules, skills, extensions and support library into every managed profile root. MCP remains profile-owned and opt-in. Sessions, blobs, `agent.db` and provider authentication remain genuinely separate by design.

## Ollama Cloud selection rationale

- **DeepSeek V4.1 Flash** owns `smol` / `tiny` / `commit`: cheap reasoning is appropriate for discovery, mechanical leaves and background text.
- **DeepSeek V4 Pro** owns `default` / `plan` / `slow` in the v8 trial. Unit 2 showed GLM could implement substantial code but slipped on orchestration constraints; this keeps stronger controller/planning/final-acceptance judgment without moving routine execution onto the expensive lane.
- **GLM-5.3-Flash** owns `execute` / `task` / `vision` / `review_aux`: constrained plan-following is its primary v8 lane; `task` remains the semantic fallback while auxiliary review stays on a separate model family from the controller.
- **Kimi K3** owns `critical`: it is reserved for explicit frontier escalation. The profile uses `high`, matching OMP's generic Ollama Cloud effort mapping rather than inventing an unsupported `max` lane.

Keep the exact model IDs under review when OMP or Ollama Cloud changes its discovered catalog. The role topology matters more than any one model name.

## Anthropic selection rationale

- **Claude Haiku 4.5** owns `smol` / `tiny` / `commit`: cheap bounded work does not need the premium reasoning tier. The baseline intentionally leaves Haiku's effort suffix unpinned because its first-party OMP effort surface is not the same adaptive ladder as Sonnet/Opus/Fable.
- **Claude Sonnet 5 high** owns `execute` / `task` / `vision` / `review_aux`: it is the high-throughput constrained-execution, semantic-implementation and multimodal lane, while auxiliary review stays independent from the Opus correctness lane.
- **Claude Opus 5 high** owns `default` / `plan` / `slow`: the Team Premium profile spends its larger allowance on controller reliability, long-horizon orchestration, architecture and primary correctness reasoning rather than making Main another implementation-tier session.
- **Claude Fable 5.1 high** owns `critical`: the role is explicit-only, and `high` is deliberate. Do not pin `max` here; maximum effort would burn Team Premium allowance too aggressively for a reusable baseline.

Authenticate the profile through OMP's Anthropic/Claude OAuth flow so Team entitlement remains profile-local. Do not put account credentials in this repository. Keep exact model IDs under review when OMP or Anthropic changes the first-party catalog.

## Routing principle

Use the strongest model for **unresolved judgment**, not for routine plan transcription/execution. `flow-planning` deliberately moves consequential interfaces/tests/ownership/error semantics into the `@plan` stage. A task becomes eligible for `@execute` only when its plan is execution-grade and states locked decisions, concrete proof, discretion and escalation conditions.

`@execute` is still above `sonic`: it may implement new behavior/TDD from a decision-complete brief, but it must escalate contradictions instead of redesigning. `@task` remains the semantic fallback for debugging, broken plans and deliberately unresolved implementation judgment. `sonic` remains reserved for one-obvious-result mechanical work.

## External-effect approval backstop

All three v8 baseline profiles add OMP-native `bash.patterns` prompts for normal GitHub publication commands and `tools.approval.eval: prompt`. These are a runtime backstop for Flow's user-authorization rule, not sandbox containment: another already-approved program can still perform network effects through its own APIs. The user-facing Flow gate remains authoritative. Existing installed profile configs must merge these settings manually because `omp-stack install` never overwrites profile-owned config.

## Concurrency

`task.maxConcurrency: 3` allows useful fan-out without a quota-burning swarm. Flow further limits fan-out by dependency shape: only independent units/lenses run together. Unit owners normally keep no more than two useful nested cheap-model children live at once; concurrency is a ceiling, not a utilization target.

## Isolation

Enable `task.isolation.enabled: true` with `isolation.backend: auto`. This exposes per-spawn isolation as a capability; it is **not** a default for every writer.

- sole/sequential unit owner on a suitable feature checkout → normally non-isolated and resumable;
- independent concurrent writers → isolated when available;
- nested cheap-model leaves → share the unit owner's workspace, no isolation-inside-isolation;
- explicitly disposable/risky experiment → isolation when useful.

OMP resolves the actual backend with fallback. Plan mode remains read-only and does not expose task isolation.

## Effort hints

Keep `task.enableEffort: false`. Quality intent is represented by role selection. This prevents a task prompt from silently mapping a cheap worker to its model's maximum supported effort.

Do not cap `flow-implementer` below its `@task`/auto policy yet. First optimize lifecycle, verification and cheap-leaf delegation; tune model effort only after observing those changes in real sessions.

## Prewalk

Do not globally prewalk semantic implementers down to the cheap role at first write. Reasoning often continues after the first edit (test failure, redesign, integration). Instead, keep the semantic model as unit owner and explicitly delegate sufficiently mechanical leaves to bundled `sonic`; use `scout` for read-only discovery. The parent still verifies and integrates all child work.

## Planning and review economics

For substantial planned work, spend judgment once: `@plan` applies COR/TTC/CRF/SEC as a **plan quality gate**, then `@execute` implements the locked plan and `@slow` performs one integrated final acceptance review. The acceptance reviewer checks plan conformance **and** independently challenges correctness so a defective plan cannot launder a defect into approval.

Do not automatically dispatch COR/TTC/CRF again after execution-grade plan work. Add a specialist only for concrete residual risk, batch verified findings into one correction round, and use one scoped acceptance closure review by default.

For unplanned/ad-hoc changes, PR review and audits, the existing `flow-review` applicability-driven specialist doctrine remains intact: COR initial, TTC/CRF/SEC run or skip with reason, affected-lens reruns after fixes.

## Nested delegation

`flow-implementer` may spawn only `scout` and `sonic`. This uses the default shallow nested-agent budget without making implementers unrestricted orchestrators. Delegate only when a leaf has one obvious correct outcome under the approved contract and a mechanical acceptance check. Questions rise `sonic/scout → flow-implementer → Main → user/design` only as high as necessary.
