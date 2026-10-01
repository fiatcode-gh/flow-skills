# Audit fix batch (2026-09-30)

Work: `4de298c`..`cac301e` on `fix/audit-2026-09-30`, 2026-10-01. Findings: `docs/reports/2026-09-30-audit-omp-stack.md`.

## Decisions

- **The installer resolves every profile before it touches the filesystem.** `each_profile` resolves all profiles in the main shell first, then runs the shared step and the per-profile steps. A destination must match `/*[!/]*`: absolute, and not made only of slashes. `linked` prints only after `ln` succeeds.
- **The guards share one agent-name normalizer** (`agent/lib/agent-name.ts`). OMP trims the name before it resolves the agent, so the guards trim it too. A capsule marker counts only at line start, optionally after `- `.
- **The acceptance fingerprint reads raw `git diff` bytes, with a 256 MiB limit.** Only exit 1 from `rev-parse --verify --quiet HEAD` means an unborn HEAD, which diffs against the empty tree. Every other git failure propagates and fails closed. The hash input is unchanged, so fingerprints recorded earlier stay valid for UTF-8 diffs. `accept` adds the `.flow/` exclude before it fingerprints.
- **Publication prompts cover `git -C`/`git -c` push, `env`-prefixed `git push` and `gh`, and the missing `gh` writes**, identically in all three profiles. This deliberately over-prompts: `git -C * push*` fires on ` push` anywhere later in the line, and `env * gh *` also fires on reads.
- **Only `flow_gate` writes `.flow/runtime/`.** This is a doctrine line only.
- **The gate rule names the gated roles**: planner, executor, implementer and verifier. `sonic` is not gated, and it takes diagnosed fixes that have no contract.
- **The Ollama Cloud docs state the mapping the config uses, with no rationale.** The old "GLM less reliable at orchestration" reasoning described the reverse mapping and was removed. `validate.py` pins the YAML role map, not prose.
- **`dev.autoqaConsent: denied` in every profile.** When consent is granted, OMP stores tool-issue reports and pushes them to its collector.
- **`flow-debugging` resets to 0/2.** Main now routes the root-cause fix by `flow-execution` section 2 instead of fixing it inline.

## Rejected alternatives

- Derive the doc routing assertion from the YAML: it adds a doc convention and a stricter test for little gain. The exact YAML pin stays.
- Extend `validate.py`'s exact-pattern list: `tests/bash-patterns.test.mjs` already proves behavior against OMP's matcher.
- Patterns for a bare `VAR=x` prefix, `git --git-dir`, or wrappers (`sudo`, `xargs`, `sh -c`): they are documented as residuals in `docs/OMP-COMPATIBILITY.md` instead.
- A `tool_call` hook that blocks `write`/`edit` on `.flow/runtime/`: left in the backlog.

## Traps

- Since `75c98f2`, the profiles are live, so a session prompts for any bash line or segment that matches. That includes over-matches such as `git -C dir commit -m "fix push order"` and `env LC_ALL=C gh pr view 1`. Edit files with tools rather than shell lines that start with a publication spelling.
- `/?*` looks like it excludes the root, but it accepts `//`.
- The guard extensions run in Bun under OMP, while the tests run them in Node. The `maxBuffer` limit is proven only under Node.
- "Writer" in `AGENTS.md` includes `sonic`. Doctrine that means the gated writers must name `flow-plan-executor` and `flow-implementer`.

## Open questions

- Closed on 2026-10-01 (`fix/audit-residuals`): the fingerprint now ignores `diff.external`/textconv and counts index-only changes. See `docs/decisions/audit-backlog-2026-10-01.md`.
- No test pins `dev.autoqaConsent: denied`.
- Backlog from the audit: A8, A9, A10, B2–B5, C5–C7, D3.
