# OMP compatibility assumptions

This stack's v8 trial assumptions were revalidated against the public `can1357/oh-my-pi` main branch at commit `9b2a43514bfcfc0b9607ac9ac160115aec897f06` (2026-09-14). Anthropic profile selectors and adaptive-effort support were additionally re-checked against `a2501722aa05670eeab327ea1325e3fde55e51a9` / OMP 18.1.21 (2026-09-14). Agent Hub wait behavior was re-checked against OMP 18.1.22 (`23a5b9a`, 2026-09-14), whose unified waits use an adaptive window while remaining interruptible through the normal tool-abort/steering path. Extension tool approval policy (`policy: prompt` / `deny` under yolo), `formatApprovalDetails`, essential custom tools, and fail-closed `tool_call` interception were re-checked against OMP 18.2.10 (`da58b16`, 2026-09-22). OMP moves quickly; re-check these assumptions when upgrading across substantial releases.

The design relies on these native behaviors:

- named profiles (`omp --profile <name>`) relocate the whole OMP-native user root to the profile-specific agent directory and do not inherit the default profile config;
- user skills are discovered from the active agent directory `skills/*/SKILL.md`;
- user task agents are discovered from `agents/*.md` and may bind arbitrary custom `modelRoles` aliases plus `autoloadSkills`; v8 uses `@execute` in addition to OMP's conventional roles;
- user rules are discovered from `rules/*.{md,mdc}`, including `alwaysApply`;
- user TypeScript/JavaScript extensions are auto-discovered from `extensions/`;
- custom extension tools can declare explicit `policy: prompt` / `deny` approval decisions that remain authoritative under yolo, can add `formatApprovalDetails`, and can be kept `loadMode: essential`; Flow uses this for the interactive `flow_gate` artifact-approval boundary rather than transcript parsing;
- extension `tool_call` interception is fail-closed and sees `task` inputs before execution, so Flow can reject stale/missing governance manifests without replacing OMP's task/Hub implementation;
- Plan mode is read-only and owns plan approval/execution semantics;
- task batches support per-item agents and optional per-spawn isolation when `task.isolation.enabled` is on;
- task model selection comes from agent overrides/frontmatter roles rather than a per-call model field;
- headless subagents cannot prompt for approvals, so Flow constrains writer authority in the task contract and verifies results at the controller;
- child agents can coordinate with their parent/Main through `hub`; ordinary non-isolated agents are revivable after parking, while completed isolated task runs are torn down and are not revivable; unified Hub waits wake on watched job completion or peer messages and are interruptible by user steering, so a wait parks the current autonomous run without preventing the user from prompting; ordinary task results may also self-deliver, and `send` can await one peer reply; Flow leaves native wait/steering semantics intact, does useful independent work first, may wait when the next meaningful action depends on the result, and avoids progress polling; targeted peer-reply waits remain available for bounded request/response cases;
- nested agents are depth-gated by OMP; `flow-implementer` intentionally restricts nested spawning to bundled `scout` and `sonic`;
- Agent Hub/history/agent artifacts are execution records, not replacements for LDD's durable ledger;
- bundled `reviewer` handles ordinary correctness review, while security review/scan remains OMP-native; Flow may bind its planned acceptance reviewer to `@slow`;
- ordered `bash.patterns` support explicit `prompt` rules that remain effective under yolo. The matcher (`packages/coding-agent/src/tools/bash.ts` at `78b7531`, OMP 18.2.6, 2026-09-18) trims and whitespace-collapses the pattern, turns each `*` into `.*` with every other character literal, anchors at both ends, and is case-sensitive; `prompt`/`deny` rules fire on the whole command or any segment of a compound line, and the first matching rule wins. `tests/bash-patterns.test.mjs` ports that matcher. Known residual: a command prefixed with an environment assignment (`GH_TOKEN=x gh api …`) does not match an anchored `gh …` pattern; the semantic rule in `flow-safety` still governs it. The baseline intentionally leaves blanket `tools.approval.eval` prompting unset because it creates excessive friction for ordinary eval use; stakeholder-visible publication actions must stay on the direct guarded Bash surface rather than being wrapped in eval. Headless subagents cannot satisfy a direct publication prompt and therefore fail closed on those explicitly prompted commands;
- the first-party Anthropic provider exposes `claude-sonnet-5`, `claude-opus-5`, and `claude-fable-5-1` with adaptive effort including `high`; Haiku 4.5 is kept without an explicit effort suffix in the baseline;
- Anthropic OAuth credentials are profile-local under named profiles; the repository never stores Team credentials.

## Asset-production boundary

`flow-assets` v0.1 depends only on normal user-skill discovery, repository/filesystem access, and the existing Flow artifact/evidence boundaries. It deliberately does **not** require OMP's native image-generation tool or a specific model/provider, so the generation/editing backend can change without rewriting Flow doctrine.

The optional `flow-assets` `scripts/conform-image` helper is outside the OMP runtime contract. It shells out to ImageMagick for deterministic technical conformance and fails clearly when ImageMagick is unavailable; no OMP compatibility assumption should paper over that external dependency.

## Upgrade smoke test

After upgrading OMP:

```sh
./tests/run.sh
./scripts/omp-stack doctor
```

Then sanity-check `omp --profile openai-codex`, `omp --profile ollama-cloud`, and `omp --profile anthropic`.

Then sanity-check in OMP that `flow-planner`, `flow-plan-executor`, `flow-acceptance-reviewer`, `flow-implementer` and the Flow skills are discoverable; confirm `@execute` resolves per profile, publication Bash commands prompt, and an isolated test task exposes the `isolated` field. Do not paper over a changed OMP contract inside skills; update the native boundary deliberately.
