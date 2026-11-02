# Model routing

The stack encodes **intent in roles**, not concrete model names. Native OMP profiles map the same role vocabulary to different providers:

```sh
omp --profile openai-codex
omp --profile anthropic
omp --profile commandcode
```

The Flow skills/agents are symlinked into all managed profiles, so workflow semantics stay provider-independent while OMP keeps each profile's config, sessions, runtime database and authentication state isolated.

## Routing

| Load | Role / agent | OpenAI Codex profile | Anthropic profile | Command Code profile |
|---|---|---|---|---|
| tiny metadata/title/background | `@tiny` | GPT-6 Luna low | Haiku 5.5 medium | DeepSeek V4.1 Flash low |
| commit/changelog generation | `@commit` | GPT-6 Luna low | Sonnet 5.5 low | DeepSeek V4.1 Flash low |
| repo exploration | bundled `scout` / `@smol` | GPT-6 Luna low | Sonnet 5.5 low | DeepSeek V4.1 Flash low |
| behavior-preserving mechanical work / diagnosed exact correction | bundled `sonic` / `@smol` | GPT-6 Luna low | Sonnet 5.5 low | DeepSeek V4.1 Flash low |
| Main/controller | `@default` | GPT-6 Luna auto | Opus 5.5 medium | DeepSeek V4.1 Flash high |
| execution-grade plan follower | `flow-plan-executor` / `@execute` | GPT-6 Luna xhigh | Sonnet 5.5 medium | DeepSeek V4.1 Flash high |
| residual semantic judgment / broken-plan fallback | `flow-implementer` / `@task` | GPT-6.1 Sol medium | Sonnet 5.5 high | DeepSeek V4.1 Flash high |
| deliberate execution planning | `flow-planner` / `@plan` | GPT-6.1 Sol high | Fable 5.1 high | DeepSeek V4.1 Flash high |
| final planned acceptance / hard reasoning | `flow-acceptance-reviewer` / `@slow` | GPT-6.1 Sol high | Opus 5.5 medium | GLM-5.3 high |
| TTC/CRF/audit auxiliary lenses (exceptional/planned escalation + standalone review) | `@review_aux` | GPT-6.1 Sol high | Sonnet 5.5 high | DeepSeek V4.1 Flash high |
| vision / multimodal inspection | `@vision` | GPT-6 Luna medium | Sonnet 5.5 medium | DeepSeek V4.1 Flash high |
| exceptional security/concurrency/data-integrity escalation | `@critical` | GPT-6.1 Sol xhigh | Fable 5.1 high | GLM-5.3 high |

`slow` intentionally stops below the most expensive explicit escalation. `critical` is the escape hatch; no automatic Flow agent binds `@critical` on purpose. Escalation should be a conscious model/session choice, not accidental fan-out.

## Provider profiles

`omp/profiles/openai-codex/config.yml`, `omp/profiles/anthropic/config.yml`, and `omp/profiles/commandcode/config.yml` are the single source of truth for each profile's settings, not runtime overlays. `omp/bin/flow-omp install` symlinks each profile's `config.yml` to its template; a real file is replaced only when it is byte-identical, otherwise the installer warns, leaves it alone, and exits non-zero. Merge a divergent copy into the template, delete the copy, and rerun `install`.

OMP named profiles isolate the full OMP-native user root, not merely model selection. The installer therefore links the same `AGENTS.md`, agents, rules, skills, extensions and support library into every managed profile root. MCP remains profile-owned and opt-in. Sessions, blobs, `agent.db` and provider authentication remain genuinely separate by design.

## OpenAI Codex selection rationale

Efforts follow OpenAI's GPT-6 model-selection ladder (Luna low → Luna xhigh → GPT-6.1 Sol medium → Sol xhigh → Astra):

- **GPT-6 Luna** owns `smol` / `tiny` / `commit` at low (well-scoped edits and extraction), `vision` at its default medium, and `execute` at xhigh (problems with clear constraints, which is what an execution-grade plan gives the executor). Main stays on Luna with OMP's adaptive `auto` effort, capped at `xhigh` by `providers.autoThinkingMaxEffort`.
- **GPT-6.1 Sol** owns `task` at its default medium (complex technical work), `plan` / `slow` / `review_aux` at high (deep planning and review), and `critical` at xhigh (decisions built from conflicting evidence). GPT-6.1 Sol replaces GPT-6 Sol; it does not accept `none` effort.
- **GPT-6 Astra** is deliberately unused: the profile runs on a ChatGPT Plus plan, and Astra would use up its allowance quickly.

OMP discovers Codex models from the signed-in account, so a model newer than OMP's bundled catalog (GPT-6.1 Sol at OMP 18.4.5) still resolves once the account has access.

## Anthropic selection rationale

- **Claude Haiku 5.5 medium** owns `tiny` only. Its 100k context window is too small for scout exploration, mechanical-edit leaves and large commit diffs, but title and metadata generation never comes near it. Haiku 5.5 uses adaptive thinking with the same effort ladder as Sonnet/Opus/Fable; `medium` is Anthropic's default for it.
- **Claude Sonnet 5.5** owns `smol` / `commit` / `execute` / `task` / `vision` / `review_aux`: it is the high-throughput constrained-execution, semantic-implementation and multimodal lane, while auxiliary review stays independent from the Opus correctness lane. Sonnet 5.5 recalibrated its effort levels, so the Sonnet 5 `high` setting is not carried over. `smol` and `commit` run at `low`: they take Haiku's former leaves for the larger context window, not for more reasoning. Anthropic recommends `medium` for well-specified agentic work and `high` for harder or longer work: `execute` (decision-complete plans) and `vision` run at `medium`; `task` (unresolved judgment, debugging) and `review_aux` (independent review) run at `high`.
- **Claude Opus 5.5 medium** owns `default` / `slow`: the Team Premium profile spends its larger allowance on controller reliability, long-horizon orchestration and primary correctness reasoning rather than making Main another implementation-tier session. `medium` is Anthropic's default for Opus 5.5 and matches or beats Opus 5 at `high` on agentic tasks.
- **Claude Fable 5.1 high** owns `plan` and `critical`. Planning is one long, judgment-heavy session per unit, so it gets the frontier tier; `high` is Anthropic's default and recommended starting effort for Fable 5.1. `critical` is explicit-only on the same setting. Do not pin `max` on either; maximum effort would burn Team Premium allowance too aggressively for a reusable baseline.

Authenticate the profile through OMP's Anthropic/Claude OAuth flow so Team entitlement remains profile-local. Do not put account credentials in this repository. Keep exact model IDs under review when OMP or Anthropic changes the first-party catalog.

## Command Code selection rationale

The profile runs open models on the Command Code [GOAT plan](https://commandcode.ai/docs/plans/goat) ($10 a month, with usage limits of up to $20 per 5 hours, $50 per week and $100 per month). Flow sessions resend a large, mostly cached prompt (`AGENTS.md`, rules, skill text, tool output) on every turn, so for long tool loops the cache-read price decides the cost, not the output price. At about 100k cached tokens a turn, DeepSeek V4.1 Flash costs well under a tenth of a cent and GLM-5.3 about $0.03.

The rule is that DeepSeek produces and GLM-5.3 judges. Acceptance runs in a different family from everything it reviews.

- **DeepSeek V4.1 Flash** owns `default`, `task`, `execute`, `plan`, `vision` and `review_aux` at `high`, and `smol`, `tiny` and `commit` at `low`. In Bito's runs of real coding sessions it scored 80% against 74% for GLM-5.3 and 72% for Kimi K3, at $0.14 a long session against $2.86 for GLM-5.3 and $2.46 for Kimi K3, and it led on failure analysis, planning and self-audit ([Bito](https://bito.ai/blog/best-open-weight-model-for-coding-kimi-k3-1-pro-glm-5-3-deepseek/)). It is also the cheapest image-capable model.
- **GLM-5.3 high** owns `slow` and `critical`. Its audit score in Bito's runs (59%) ties Kimi K3's, so it is chosen for family separation (it is not DeepSeek, so acceptance does not grade work from its own family) and for its better overall (74% against 72%) and short-question (83% against 80%) scores. `critical` stays explicit-only and uses the same model and effort as `slow`.
- **GLM-5.3 Flash is not used.** Users report recurring tool-call failures and broken sessions with it across more than ten sessions ([Kilo Code issue 14475](https://github.com/Kilo-Org/kilocode/issues/14475)).
- **Kimi K3 is not used.** A hands-on review found it close to Opus on simple tasks but failing 36% of trap tasks against 8% for Opus, though the tester built those traps to target Kimi's known weaknesses, so the everyday gap is likely smaller ([MindStudio](https://www.mindstudio.ai/blog/kimi-k3-real-world-coding-review)). Bito's audit score for it was 59% against 70% for DeepSeek, so it is not the better checker either; the acceptance reviewer's job is checking a change.
- **MiMo V2.6 Pro is not used.** It proved weaker in field use.

DeepSeek V4.1 Flash costs about double at peak hours: 01:00 to 04:00 and 06:00 to 10:00 UTC, Monday to Friday. Schedule long runs outside them when that matters. In long OpenCode sessions DeepSeek can fall into repetition loops ([OpenCode issue 57377](https://github.com/anomalyco/opencode/issues/57377)); `/compact` or a new session usually clears it.

Authenticate with `COMMAND_CODE_API_KEY` or OMP's login inside `omp --profile commandcode`; never commit the key. Catalog IDs are case-sensitive (`zai-org/GLM-5.3`); keep them under review when Command Code changes its catalog.

## Ports

The Claude Code and OpenCode ports route each Flow agent the way OMP routes its role, so a role means the same thing in every harness. Each agent takes the role from `omp/agents/<name>.md`; the COR reviewer exists only in the ports and takes `review_aux`. `tests/validate.py` checks every agent's model and effort, OpenCode's top-level `model` and its `build` agent against the matching OMP profile (`anthropic` for Claude Code and `claude-agent`, `commandcode` for `commandcode`), mapping OMP's Anthropic ids to each port's names.

| Role | Flow agents | Claude Code | OpenCode `claude-agent` | OpenCode `commandcode` |
|---|---|---|---|---|
| `default` (Main) | OpenCode `build` and `model` | session model | `opus` medium | `deepseek/deepseek-v4.1-flash` high |
| `plan` | `flow-planner` | `claude-fable-5-1` high | `fable` high | `deepseek/deepseek-v4.1-flash` high |
| `slow` | `flow-acceptance-reviewer` | `opus` medium | `opus` medium | `zai-org/GLM-5.3` high |
| `execute` | `flow-plan-executor` | `sonnet` medium | `sonnet` medium | `deepseek/deepseek-v4.1-flash` high |
| `task` | `flow-implementer` | `sonnet` high | `sonnet` high | `deepseek/deepseek-v4.1-flash` high |
| `review_aux` | `flow-cor-reviewer`, `flow-ttc-reviewer`, `flow-craft-reviewer`, the three audit agents | `sonnet` high | `sonnet` high | `deepseek/deepseek-v4.1-flash` high |

The OpenCode `opencode` profile stays on `opencode/big-pickle` for every agent, with no effort, until models are picked for it.

**Claude Code.** `model` and `effort` sit in each agent's frontmatter; the planner names the full `claude-fable-5-1` id because the `fable` alias resolves to Fable 5 in Claude apps gateway sessions.

**OpenCode.** OpenCode 2.2.5 calls an effort a *variant* (`low`, `medium`, `high`, `xhigh`, `max`). Two probes showed where a variant takes effect:

- `agent.<name>.variant` is applied. For `claude-agent` the spawned `claude` process runs with `--effort=<variant>`; for `commandcode` the request body carries `reasoning_effort`.
- A `#variant` suffix on the top-level `model` or on an agent's `model` is ignored, and an agent `model` with a `#` suffix does not resolve at all. Only the `-m provider/model#variant` flag honours it.

So a profile sets `variant` next to `model` on each agent. The top-level `model` cannot carry an effort, so the profile also overrides the built-in `build` agent (OpenCode's default primary agent) with Main's model and variant. `build` must use the top-level `model`.

`claude-agent/fable` is "Fable 5.1" in the provider's catalog, the same model as `claude-fable-5-1`, so the planner uses the alias; the catalog has no `claude-fable-5-1` id. The provider passes the alias to `claude --model=fable`, so in a Claude apps gateway session the OpenCode planner may get Fable 5 (not tested). `commandcode` is a built-in OpenCode provider with both profile models in its catalog and a `low`/`high`/`max` variant ladder, so the profile has no `provider` block. The key comes from OpenCode's own credential store (`/connect`, provider `commandcode`) and never appears in the repository. `tests/validate.py` requires `build` in each profile with an OMP counterpart, rejects any `apiKey` or `headers` object in a profile, and any `provider` block for another provider id.

## Routing principle

Use the strongest model for **unresolved judgment**, not for routine plan transcription/execution. `flow-planning` deliberately moves consequential interfaces/tests/ownership/error semantics into the `@plan` stage. A task becomes eligible for `@execute` only when its plan is execution-grade and states locked decisions, concrete proof, discretion and escalation conditions.

`@execute` is still above `sonic`: it may implement new behavior/TDD from a decision-complete brief, but it must escalate contradictions instead of redesigning. `@task` remains the semantic fallback for debugging, broken plans and deliberately unresolved implementation judgment. `sonic` remains reserved for one-obvious-result mechanical work.

## External-effect approval backstop

Every v8 baseline profile adds OMP-native `bash.patterns` prompts for normal GitHub publication commands: `git push` (also after `git -C <dir>` or `git -c <key=value>`, or behind `env …`), every `gh` command behind `env …`, the `gh pr`/`gh issue`/`gh release`/`gh repo` write subcommands, `gh secret set`, `gh workflow run`, and `gh api` calls that carry a request-method or body flag as its own token. Plain `gh api` reads do not prompt; `docs/OMP-COMPATIBILITY.md` lists the spellings the patterns miss. Blanket `tools.approval.eval` prompting is deliberately unset because it interrupts ordinary eval use; publication commands must stay on the direct Bash surface rather than being wrapped in eval. These prompts are a runtime backstop for Flow's user-authorization rule, not sandbox containment: another already-approved program can still perform network effects through its own APIs. The user-facing Flow gate remains authoritative. Because the profile `config.yml` is a symlink to the template, the patterns reach every managed profile with the next `install`; `tests/bash-patterns.test.mjs` proves the list against OMP's matcher.

The same lists add one rule, `*.flow/runtime*`, that prompts for any shell line or segment naming `.flow/runtime`: only `flow_gate` writes gate state. It over-prompts on reads of that path and misses the spellings listed in `docs/OMP-COMPATIBILITY.md`; eval is not covered.

## Concurrency

`task.maxConcurrency: 4` lets all four review lenses run together without a quota-burning swarm. Flow further limits fan-out by dependency shape: only independent units/lenses run together. Unit owners normally keep no more than two useful nested cheap-model children live at once; concurrency is a ceiling, not a utilization target.

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
