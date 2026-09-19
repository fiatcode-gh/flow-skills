# Migration from ai-stack OMP tenant

Your previous default OMP config registered:

```yaml
extensions:
  - .../ai-stack/omp/extensions/flow-skills.ts
  - .../ai-stack/omp/extensions/ai-memory.ts
skills:
  customDirectories:
    - .../ai-stack/shared/skills
```

The profiled stack should not carry those entries forward.

Why:

- `flow-skills.ts` injected the old bootstrap; OMP now discovers the redesigned skills/rules natively.
- the old `customDirectories` points at obsolete same-named Flow skills and can shadow/collide with the OMP-native set.
- `ai-memory.ts` is auto-discovered from each active profile's `extensions/` symlink after install, so an explicit path is unnecessary.

## Recommended sequence

1. Extract/clone `omp-stack` somewhere stable.
2. Run `./scripts/omp-stack install`. This provisions `openai-codex`, `ollama-cloud`, and `anthropic` under OMP's native profile roots.
3. If a profile already had a real `config.yml`, the installer links it only when it is byte-identical to `profiles/<name>/config.yml`. Otherwise it warns and leaves the file alone: merge the wanted settings into the repository template, delete the profile copy, and rerun `install` so the profile ends up pointing at the single source of truth.
4. Remove any old `ai-stack` `extensions:` registrations and `skills.customDirectories` entries from the profile configs.
5. Authenticate each profile/provider as needed. Named OMP profiles do not inherit runtime/auth state from the default profile or from each other. `OLLAMA_CLOUD_API_KEY` may instead be supplied through the environment. For the Anthropic Team profile, use OMP's Anthropic/Claude OAuth login inside `omp --profile anthropic`; never commit Team credentials.
6. Copy `mcp.example.json` into each profile as `mcp.json` and replace the Context7 key; keep the copies identical so every profile sees the same servers. MCP is intentionally profile-owned and the installer never writes credentials. See the `MCP servers` section in `README.md`.
7. Run `./scripts/omp-stack verify` and `./scripts/omp-stack doctor`.
8. Launch with native OMP profile selection:

   ```sh
   omp --profile openai-codex
   omp --profile ollama-cloud
   omp --profile anthropic
   ```

The old default `~/.omp/agent` tree is left untouched. Delete or retire it only after all named profiles behave as expected.

## Routing changes

The v8 trial changes routing because execution-grade planning separates judgment from plan-following:

OpenAI Codex:

- `default` / `task`: Terra;
- `execute`: Luna;
- `plan` / `slow`: Sol high;
- `review_aux`: Terra high;
- `critical`: Sol xhigh;
- cheap roles remain Luna.

Ollama Cloud:

- `default` / `plan` / `slow`: DeepSeek V4 Pro high (controller trial);
- `execute` / `task` / `vision` / `review_aux`: GLM-5.3-Flash high;
- `smol` / `tiny` / `commit`: DeepSeek V4.1 Flash low;
- `critical`: Kimi K3 high.

Anthropic:

- `smol` / `tiny` / `commit`: Claude Haiku 4.5;
- `execute` / `task` / `vision` / `review_aux`: Claude Sonnet 5 high;
- `default` / `plan` / `slow`: Claude Opus 5 high;
- `critical`: Claude Fable 5.1 high (explicitly not max).

All three v8 baseline configs add explicit OMP approval prompts for normal push/PR/review/comment/release commands through direct Bash patterns; `gh api` prompts only when a method or body flag is present. Blanket `tools.approval.eval: prompt` is intentionally unset because it interrupts ordinary eval usage too broadly; do not wrap publication commands in eval to bypass the direct-command prompts. **A divergent installed profile config is never overwritten by `omp-stack install`**: the installer warns and exits non-zero. Merge the wanted settings into `profiles/<name>/config.yml`, delete the profile copy, and rerun `install` so the profile points at the template (step 3 above).

See `docs/MODEL-ROUTING.md` for the reasoning.
