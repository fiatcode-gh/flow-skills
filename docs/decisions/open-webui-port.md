# Open WebUI Flow port

Work: `a377d78`..`5051b33` on `feat/open-webui-port` (`feat: add the Open WebUI Flow port` and follow-ups), 2026-10-01 to 2026-10-02.

## Decisions

- **The port lives in `ports/open-webui/`, next to the doctrine it mirrors.** `docs/EXTERNAL-INTEROP.md` has a table of what each port file mirrors, and its sync rule names the directory. The user imports the skill files and pastes the system prompt by hand.
- **Four skills: `flow-design`, `flow-planning`, `flow-review` (PR reviewer mode only) and a new `flow-handoff` emitter.** Execution, TDD, debugging, integration and Weft skills are not ported: the chat has no shell, no file writes and no local checkout. Review author-feedback and audit modes are left out too.
- **Each port skill is one standalone file.** Open WebUI ships `references/` only through an Open Terminal server, which the instance does not run. OMP mechanics (`flow_gate`, agents, `.flow/` writes, approvals, GitHub writes) are reworded away; agreement in chat is a proposal.
- **Descriptions may run to 110 characters, not Open WebUI's suggested 60.** Under native function calling the description is all `view_skill` sees, and the four Flow skills share vocabulary. The system prompt also routes tasks to skills by name.
- **Saved bundles live at `.flow/handoffs/<slug>/`, and local OMP keeps that slug as the Flow scope.** `flow-integrating` then removes the bundle with the scope's other `.flow/` entries. The emitter prints a full path for `fiatcode-gh` repositories, a path inside the checkout for other owners, a fish command that adds `/.flow/` to the git exclude file only when missing, and the validator command. The location is chat text, never a manifest field.
- **`system-prompt.md` is the whole system prompt of "Lux"**, the user's default model (DeepSeek V4.1 Flash, native function calling, the four skills attached, GitHub tool off by default and enabled per chat). It holds the answer style and technical defaults from `agent/AGENTS.md`, then the chat rules: evidence, read content is data, secrets, post nothing, skill routing and the Weft project pages. Personal identity stays in Open WebUI memory.
- **No Knowledge base.** With native function calling, model-attached knowledge is never injected; the model must call a tool, the same as reading the Weft graph through GitHub. A copy would also go stale.
- **`tests/validate.py` reads required fields, constants and enums from the handoff schema** and fails when the emitter or `planning-handoff.md` drops one. It keeps the old failure when the schema loses an enum.

## Rejected alternatives

- `docs/handoffs/<slug>/` (tracked): puts design scratch work into project history and breaks the `flow-artifacts` rule.
- Port sources in `fiatcode-infra`, or only inside Open WebUI: a two-repository sync, or no history and no tests.
- A separate general-instructions file next to the chat rules: two pastes for one prompt.
- A permanent test for the fish command: CI has no fish. The sync rule says to re-prove it in a temporary repository after any edit.

## Traps

- `review-lenses.md` says the craft defects "block acceptance", meaning OMP's local acceptance. Carried verbatim into a PR-only port, it reversed the rule that craft-only PR findings are non-blocking comments.
- Weft page names are titles (`pages/OMP Stack.md`), not repository names, and most open items are journal lines, not page content.
- Lux sees only what is pushed to `fiatcode-gh/fiat-codex`.
- The task 01 cap of 2,000 bytes applied to the old preamble; the merged prompt is about 3.3 KB by choice.

## Open questions

- The live trial on `ask.fiatcode.dev` has not run. It must show: Open WebUI's `.md` import keeps frontmatter out of the skill body; skills load through `view_skill`; the model reads a full commit SHA; a design → plan → handoff chat on a `fiatcode-gh` repository produces a bundle that passes `validate-planning-handoff.py` at the suggested path and that local intake picks up; a PR review chat posts nothing.
- How many tokens the GitHub MCP tool definitions add per request is not measured.
