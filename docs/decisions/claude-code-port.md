# Claude Code Flow port

Work: `feat: add the Claude Code Flow port` and `feat: port the Weft skills to the Claude Code plugin` on `feat/claude-code-port`, 2026-10-28.

## Decisions

- **The port is a Claude Code plugin, `ports/claude-code/`, and this repository is its marketplace (`.claude-plugin/marketplace.json`).** A plugin carries skills, agents and hooks together, installs the same way locally and in a cloud session, and stays next to the doctrine it mirrors, like `ports/open-webui/`.
- **Always-on doctrine loads through a SessionStart hook in two layers.** Claude Code keeps only about 2 KB of hook output in context and saves the rest to a file the model may never open. So the hook prints a short core (`hooks/flow-core.md`) that names the gates and points at the full `hooks/flow-context.md` by absolute path; the model reads it before the first Flow skill, dispatch or commit. A headless session was checked to read it and answer from it.
- **Approvals are bound to artifact bytes by two shell functions, `flow_approve` and `flow_check`,** writing `.flow/runtime/approvals.log`. Main checks before dispatch. This keeps the "a material edit needs a new approval" rule without porting the OMP guard extensions.
- **Roles map to model aliases in agent frontmatter**: planning and acceptance on `opus`, execution, implementation and lens review on `sonnet`. The mechanical lane is a `general-purpose` agent on `sonnet`, read-only search is `Explore`.
- **In a cloud session, pushing the session branch and opening a draft pull request is the delivery, not a publication that needs a separate approval.** The cloud harness requires both, and a session that is reclaimed loses unpushed work. Ready-for-review, merge, review comments and replies on others' pull requests still need explicit approval.
- **The chat transcript is the durable copy of `.flow/`.** Contracts and plans are shown in full before approval; on resume after the container is reclaimed, they are rewritten from the transcript and approved again.
- **The Weft skills keep `WEFT_GRAPH` as a directory everywhere.** A cloud environment adds `WEFT_GRAPH_REPO` (`fiatcode-gh/fiat-codex`); `weft_guard` clones it shallow on first use and pulls with rebase before each use. Locally nothing changes: Flow never commits the graph.
- **In a cloud session every Weft write is committed and pushed straight to the graph's default branch by `weft_publish`, with no pull request.** The user asked for this; the graph is a personal notes repository. A rebase conflict aborts the rebase, keeps the commit locally and stops; nothing is ever force-pushed. Worklog lifecycle pushes need no approval, memory writes still need approval of the exact text.
- **Memory recall replaces the `ai-memory` injector.** The hub slice would not fit the 2 KB hook budget, and the graph is not cloned when a cloud session starts. The harness section is `## Harness: [[Claude]]`, after the graph's existing `Claude` page.
- **`flow-tdd`, `ui-design`, the handoff schema and its validator are verbatim copies**, and `tests/validate.py` fails when they drift. The validator also rejects OMP-only mechanics in the port and keeps the hook core under 1,900 bytes.

## Rejected alternatives

- Symlinks from the plugin to `agent/`: installed plugins are copied into a cache, and links that leave the plugin directory do not survive.
- One SessionStart hook printing all of `flow-context.md`: truncated to a 2 KB preview.
- A PreToolUse hook on the Agent tool to enforce approvals: more code than the rule needs while the port is on trial.
- `WEFT_GRAPH` holding a GitHub repository name in the cloud: the skills read and edit files, so it would need a second meaning and a branch in every guard.
- Porting `blog-post` now: it hardcodes the local site checkout.

## Open questions

- Which delivery path the user picks for cloud sessions: per-repository `.claude/settings.json`, the environment setup script, or the claude.ai organization library. None has been tried in a real cloud session yet.
- Whether a cloud session can fetch the marketplace when `fiatcode-gh/omp-stack` is private.
- The same day's journal edited locally and in a cloud session conflicts on the next local sync.
- Graph commits carry the container's git identity (`Claude <noreply@anthropic.com>`).
