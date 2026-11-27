# Claude Code Flow port

Work: `feat: add the Claude Code Flow port` and `feat: port the Weft skills to the Claude Code plugin` on `feat/claude-code-port`, 2026-10-28.

## Decisions

- **The port is a Claude Code plugin, `claude-code/`, and this repository is its marketplace (`.claude-plugin/marketplace.json`).** A plugin carries skills, agents and hooks together, installs the same way locally and in a cloud session, and stays next to the doctrine it mirrors, like `open-webui/`.
- **Always-on doctrine loads through a SessionStart hook in two layers.** Claude Code keeps only about 2 KB of hook output in context and saves the rest to a file the model may never open. So the hook prints a short core (`hooks/flow-core.md`) that names the gates and points at the full `hooks/flow-context.md` by absolute path; the model reads it before the first Flow skill, dispatch or commit. A headless session was checked to read it and answer from it.
- **A hooks module (a mod), not a `PreToolUse` settings hook.** Claude Code 2.1.331 runs a plugin's TypeScript hooks module in its own process, so the guard carries a TypeScript copy of the OpenCode port's matcher, record and tree-identity recipe — pinned to OMP by `tests/validate.py` and proven equal by the shared case table — instead of a second implementation in POSIX `sh`. The port needs 2.1.299 or later; a session where mods are off has no gate. Approvals are bound to artifact bytes through `flow_gate`, written to `.flow/runtime/approvals.log`; only the main conversation presents, approves, accepts and clears.
- **Roles map to models and effort in agent frontmatter, following the OMP Anthropic profile**: planning, execution, implementation, lens review and acceptance on `opus`, each with the profile's `effort` (planner, implementer, reviewers and acceptance `high`, executor `medium`); `tests/validate.py` keeps agents of one role identical and both the model and the effort equal to the profile's. Planning and acceptance ran on `claude-fable-5-2` until 2026-11-24, when Fable was dropped because it used up the plan allowance too fast. The mechanical lane is a `general-purpose` agent on `sonnet`, read-only search is `Explore`.
- **In a cloud session, pushing the session branch and opening a draft pull request is the delivery, not a publication that needs a separate approval.** The cloud harness requires both, and a session that is reclaimed loses unpushed work. Ready-for-review, merge, review comments and replies on others' pull requests still need explicit approval.
- **Cloud sessions get the plugin from the environment's setup script**, which installs it from this public repository on every start; the Weft variables live in the same environment. Per-repository settings would need a commit in every repository; the claude.ai organization library would share the plugin with colleagues.
- **The session-start hook states the Weft setup as fact** (not configured, local, or cloud with its repository and path). A first cloud session guessed `WEFT_GRAPH` was unset from the core's conditional wording.
- **`weft_publish` pulls from and pushes to the graph's default branch by name**, so a `WEFT_GRAPH` that points at a session checkout on a session branch still writes to the default branch.
- **The chat transcript is the durable copy of `.flow/`.** Contracts and plans are shown in full before approval; on resume after the container is reclaimed, they are rewritten from the transcript and approved again.
- **The Weft skills keep `WEFT_GRAPH` as a directory everywhere.** A cloud environment adds `WEFT_GRAPH_REPO` (`fiatcode-gh/fiat-codex`); `weft_guard` clones it shallow on first use and pulls with rebase before each use. Locally nothing changes: Flow never commits the graph.
- **In a cloud session every Weft write is committed and pushed straight to the graph's default branch by `weft_publish`, with no pull request.** The user asked for this; the graph is a personal notes repository. A rebase conflict aborts the rebase, keeps the commit locally and stops; nothing is ever force-pushed. Worklog lifecycle pushes need no approval, memory writes still need approval of the exact text.
- **Memory recall replaces the `ai-memory` injector.** The hub slice would not fit the 2 KB hook budget, and the graph is not cloned when a cloud session starts. The harness section is `## Harness: [[Claude]]`, after the graph's existing `Claude` page.
- **`flow-tdd`, `ui-design`, the handoff schema and its validator are verbatim copies**, and `tests/validate.py` fails when they drift. The validator also rejects OMP-only mechanics in the port and keeps the hook core under 1,900 bytes.

## Implementation notes

- `$` is read only in `hooks/guard/host.ts`. The loader scans every `$` use, so the other modules stay plain TypeScript the tests load.
- `flow_gate` is served in `tool.call`. `tool.run` needs Claude Code 2.1.326, above the 2.1.299 floor.
- Presentations live in module memory, not `$.store`. A presentation must not outlive the conversation or cross checkouts.
- The record is written whole with no rename, because the file API has none. A torn write leaves it unreadable, and every gate refuses.
- The fingerprint loads the real index's entries into a scratch index and verifies the load, because the file API writes text only.
- Artifacts are hashed only when their bytes are exactly the UTF-8 encoding of their text.
- The cloud exemption's start branch and root live in module memory, set only by `session.start`.
- Every gating registration's `.catch` answers its event's refusal shape, and `session.start`'s calls `next`.
- The `.flow/runtime` rule folds case and trailing dots on every platform, because the floor build has no platform read.
- Shell text is matched by path parts and by substring, because a path glued to a redirect, an option or an assignment has no part equal to `.flow`.
- Other tools' inputs are judged string by string, keys as well as values, because MCP tools name files under keys no list foresees (`source`, `destination`, `pathInProject`, `uri`) and sometimes as keys; a multi-line string is content, and the secret rule needs an existing file, so prose does not refuse. The file is looked up from the session directory and from the repository root, because MCP and IDE servers often resolve relative paths against the project root.
- A string longer than the platform's path limit is judged by its text only, and `canonicalPath` walks a path's ancestors from one scan without stat-ing any past the limit, because a long string with many separators otherwise cost time and memory that grew with its length times its separators.

## Rejected alternatives

- Symlinks from the plugin to `agent/`: installed plugins are copied into a cache, and links that leave the plugin directory do not survive.
- One SessionStart hook printing all of `flow-context.md`: truncated to a 2 KB preview.
- A `PreToolUse` settings hook on the Agent tool for approvals: reversed 2026-11-26; the plugin ships a hooks module instead, so no second copy in POSIX `sh` is needed.
- `WEFT_GRAPH` holding a GitHub repository name in the cloud: the skills read and edit files, so it would need a second meaning and a branch in every guard.
- Porting `blog-post` now: it hardcodes the local site checkout.

## Open questions

- The same day's journal edited locally and in a cloud session conflicts on the next local sync.
- Graph commits carry the container's git identity (`Claude <noreply@anthropic.com>`).
