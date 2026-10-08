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
| tiny metadata/title/background | `@tiny` | GPT-6 Luna low | DeepSeek V4.1 Flash low | Haiku 5.5 medium |
| commit/changelog generation | `@commit` | GPT-6 Luna low | DeepSeek V4.1 Flash low | Sonnet 5.5 low |
| repo exploration | bundled `scout` / `@smol` | GPT-6 Luna low | DeepSeek V4.1 Flash low | Sonnet 5.5 low |
| behavior-preserving mechanical work / diagnosed exact correction | bundled `sonic` / `@smol` | GPT-6 Luna low | DeepSeek V4.1 Flash low | Sonnet 5.5 low |
| Main/controller | `@default` | GPT-6 Luna auto | GLM-5.3 high | Opus 5.5 medium |
| execution-grade plan follower | `flow-plan-executor` / `@execute` | GPT-6 Luna xhigh | DeepSeek V4.1 Flash high | Sonnet 5.5 medium |
| residual semantic judgment / broken-plan fallback | `flow-implementer` / `@task` | GPT-6.1 Sol medium | DeepSeek V4.1 Flash high | Sonnet 5.5 high |
| deliberate execution planning | `flow-planner` / `@plan` | GPT-6.1 Sol high | GLM-5.3 high | Opus 5.5 medium |
| final planned acceptance / hard reasoning | `flow-acceptance-reviewer` / `@slow` | GPT-6.1 Sol high | GLM-5.3 high | Opus 5.5 medium |
| TTC/CRF/audit auxiliary lenses (exceptional/planned escalation + standalone review) | `@review_aux` | GPT-6.1 Sol high | DeepSeek V4.1 Flash high | Sonnet 5.5 high |
| vision / multimodal inspection | `@vision` | GPT-6 Luna medium | DeepSeek V4.1 Flash high | Sonnet 5.5 medium |
| exceptional security/concurrency/data-integrity escalation | `@critical` | GPT-6.1 Sol xhigh | Kimi K3 high | Fable 5.1 high |

`slow` intentionally stops below the most expensive explicit escalation. `critical` is the escape hatch; no automatic Flow agent binds `@critical` on purpose. Escalation should be a conscious model/session choice, not accidental fan-out.

## Provider profiles

`profiles/openai-codex/config.yml`, `profiles/ollama-cloud/config.yml`, and `profiles/anthropic/config.yml` are the single source of truth for each profile's settings, not runtime overlays. `scripts/omp-stack install` symlinks each profile's `config.yml` to its template; a real file is replaced only when it is byte-identical, otherwise the installer warns, leaves it alone, and exits non-zero. Merge a divergent copy into the template, delete the copy, and rerun `install`.

OMP named profiles isolate the full OMP-native user root, not merely model selection. The installer therefore links the same `AGENTS.md`, agents, rules, skills, extensions and support library into every managed profile root. MCP remains profile-owned and opt-in. Sessions, blobs, `agent.db` and provider authentication remain genuinely separate by design.

## OpenAI Codex selection rationale

Efforts follow OpenAI's GPT-6 model-selection ladder (Luna low → Luna xhigh → GPT-6.1 Sol medium → Sol xhigh → Astra):

- **GPT-6 Luna** owns `smol` / `tiny` / `commit` at low (well-scoped edits and extraction), `vision` at its default medium, and `execute` at xhigh (problems with clear constraints, which is what an execution-grade plan gives the executor). Main stays on Luna with OMP's adaptive `auto` effort, capped at `xhigh` by `providers.autoThinkingMaxEffort`.
- **GPT-6.1 Sol** owns `task` at its default medium (complex technical work), `plan` / `slow` / `review_aux` at high (deep planning and review), and `critical` at xhigh (decisions built from conflicting evidence). GPT-6.1 Sol replaces GPT-6 Sol; it does not accept `none` effort.
- **GPT-6 Astra** is deliberately unused: the profile runs on a ChatGPT Plus plan, and Astra would use up its allowance quickly.

OMP discovers Codex models from the signed-in account, so a model newer than OMP's bundled catalog (GPT-6.1 Sol at OMP 18.4.5) still resolves once the account has access.

## Ollama Cloud selection rationale

- **DeepSeek V4.1 Flash low** owns `smol` / `tiny` / `commit`: cheap reasoning is appropriate for discovery, mechanical leaves and background text.
- **GLM-5.3 high** owns `default` / `plan` / `slow`.
- **DeepSeek V4.1 Flash high** owns `execute` / `task` / `vision` / `review_aux`; auxiliary review stays on a separate model family from the controller.
- **Kimi K3** owns `critical`: it is reserved for explicit frontier escalation. The profile uses `high`, matching OMP's generic Ollama Cloud effort mapping rather than inventing an unsupported `max` lane.

Keep the exact model IDs under review when OMP or Ollama Cloud changes its discovered catalog. The role topology matters more than any one model name.

## Anthropic selection rationale

- **Claude Haiku 5.5 medium** owns `tiny` only. Its 100k context window is too small for scout exploration, mechanical-edit leaves and large commit diffs, but title and metadata generation never comes near it. Haiku 5.5 uses adaptive thinking with the same effort ladder as Sonnet/Opus/Fable; `medium` is Anthropic's default for it.
- **Claude Sonnet 5.5** owns `smol` / `commit` / `execute` / `task` / `vision` / `review_aux`: it is the high-throughput constrained-execution, semantic-implementation and multimodal lane, while auxiliary review stays independent from the Opus correctness lane. Sonnet 5.5 recalibrated its effort levels, so the Sonnet 5 `high` setting is not carried over. `smol` and `commit` run at `low`: they take Haiku's former leaves for the larger context window, not for more reasoning. Anthropic recommends `medium` for well-specified agentic work and `high` for harder or longer work: `execute` (decision-complete plans) and `vision` run at `medium`; `task` (unresolved judgment, debugging) and `review_aux` (independent review) run at `high`.
- **Claude Opus 5.5 medium** owns `default` / `plan` / `slow`: the Team Premium profile spends its larger allowance on controller reliability, long-horizon orchestration, architecture and primary correctness reasoning rather than making Main another implementation-tier session. `medium` is Anthropic's default for Opus 5.5 and matches or beats Opus 5 at `high` on agentic tasks.
- **Claude Fable 5.1 high** owns `critical`: the role is explicit-only, and `high` is deliberate. Do not pin `max` here; maximum effort would burn Team Premium allowance too aggressively for a reusable baseline.

Authenticate the profile through OMP's Anthropic/Claude OAuth flow so Team entitlement remains profile-local. Do not put account credentials in this repository. Keep exact model IDs under review when OMP or Anthropic changes the first-party catalog.

## Routing principle

Use the strongest model for **unresolved judgment**, not for routine plan transcription/execution. `flow-planning` deliberately moves consequential interfaces/tests/ownership/error semantics into the `@plan` stage. A task becomes eligible for `@execute` only when its plan is execution-grade and states locked decisions, concrete proof, discretion and escalation conditions.

`@execute` is still above `sonic`: it may implement new behavior/TDD from a decision-complete brief, but it must escalate contradictions instead of redesigning. `@task` remains the semantic fallback for debugging, broken plans and deliberately unresolved implementation judgment. `sonic` remains reserved for one-obvious-result mechanical work.

## External-effect approval backstop

All three v8 baseline profiles add OMP-native `bash.patterns` prompts for normal GitHub publication commands: `git push` (also after `git -C <dir>` or `git -c <key=value>`, or behind `env …`), every `gh` command behind `env …`, the `gh pr`/`gh issue`/`gh release`/`gh repo` write subcommands, `gh secret set`, `gh workflow run`, and `gh api` calls that carry a request-method or body flag as its own token. Plain `gh api` reads do not prompt; `docs/OMP-COMPATIBILITY.md` lists the spellings the patterns miss. Blanket `tools.approval.eval` prompting is deliberately unset because it interrupts ordinary eval use; publication commands must stay on the direct Bash surface rather than being wrapped in eval. These prompts are a runtime backstop for Flow's user-authorization rule, not sandbox containment: another already-approved program can still perform network effects through its own APIs. The user-facing Flow gate remains authoritative. Because the profile `config.yml` is a symlink to the template, the patterns reach every managed profile with the next `install`; `tests/bash-patterns.test.mjs` proves the list against OMP's matcher.

The same lists add one rule, `*.flow/runtime*`, that prompts for any shell line or segment naming `.flow/runtime`: only `flow_gate` writes gate state. It over-prompts on reads of that path and misses the spellings listed in `docs/OMP-COMPATIBILITY.md`; eval is not covered.

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

For unplanned/ad-hoc changes, PR review and audits, the existing `flow-review` specialist doctrine remains intact: COR and CRF always run on the initial review, TTC/SEC run or skip with reason, affected-lens reruns after fixes.

## Nested delegation

`flow-implementer` may spawn only `scout` and `sonic`. This uses the default shallow nested-agent budget without making implementers unrestricted orchestrators. Delegate only when a leaf has one obvious correct outcome under the approved contract and a mechanical acceptance check. Questions rise `sonic/scout → flow-implementer → Main → user/design` only as high as necessary.
