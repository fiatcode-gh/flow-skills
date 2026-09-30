# User instructions

## Engineering principles

- **YAGNI:** do not build what is not needed yet.
- **DRY, without premature abstraction:** remove meaningful duplication. Do not add an abstraction before its shape is stable.
- **Separation of concerns:** keep each module and layer focused.
- **Self-explaining code:** let names and structure show *what* the code does. Write comments only for *why*, invariants, constraints or non-obvious context.
- Make the smallest coherent change that meets the requirement.
- Clean up unrelated code only when correctness needs it or the user asks for it.

## OMP / Flow execution

- Use OMP's own Plan mode, task-agent lifecycle, isolation, Agent Hub, Vibe, built-in review and security scanning. Flow skills add judgment and gates. Do not rebuild those mechanics.
- Load a Flow skill when its description matches the task. There is no bootstrap skill.
- Use `flow-design` before substantial work enters planning: write the governing WHAT/WHY contract, present it, and get explicit user approval. This holds for every start: a new or existing project, an internal brainstorm, an external handoff.
- Skip the separate contract file only for tiny or mechanical work whose scope is already explicit.
- `flow-design` says how to keep settled decisions and which questions to ask.
- Use `flow-planning` when the consequential implementation HOW must be decision-complete before coding. `flow-planner` (`@plan`) writes that plan, not Main.
- `flow-planning` and `flow-external-session` say when an external plan already counts as execution-grade.
- For substantial work, do not start planning until the user approves the completed contract.
- For substantial work, do not dispatch the first production-writing worker until the user approves the completed execution-grade plan.
- Treat a start or resume request as no approval. Example: the user says "go ahead" after you show the plan. Record the plan approval before you dispatch.
- Treat answers to clarification questions as no approval of the contract. Only an explicit approval of the completed contract counts.
- For durable Flow work, record each approval with the `flow_gate` tool: `present` the artifact summary, then `approve`.
- Carry the `Flow gate:` block in the planner or writer brief (`flow-planning` section 1, `flow-execution` section 1).
- Keep a recorded approval across resume while its artifact is unchanged. After a material edit to the contract or plan, get that approval again.
- Route task agents by agent name or role. Never put a concrete model id in a workflow prompt.
- Route each writer by what is left to decide:
  - a task from an execution-grade plan → `flow-plan-executor` (`@execute`);
  - unresolved semantic judgment, debugging, or a broken plan → `flow-implementer` (`@task`);
  - a settled mechanical or behavior-preserving edit, or an exact fix already diagnosed → `sonic` (`@smol`).
- Review planned work with one `flow-acceptance-reviewer` pass after the coherent change. Do not fan out COR/TTC/CRF lens reviewers by routine.
- Add a specialist reviewer only for a concrete residual risk, such as a security boundary.
- `flow-review` owns lens review for unplanned work, audits and PRs.
- After you accept the acceptance or closure receipt, record the repository state with `flow_gate` `accept`.
- Write production code as Main only in the Main-direct lane defined by `flow-execution`. Do not implement substantial planned or semantic work yourself.

## Commits

- Use Conventional Commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`.
- Before you commit, run the repository's declared formatter and linter on the changed files, and the verification the change needs.
- If the tooling is not documented, infer it from the repository configuration or the project's Weft page.
- Treat a local commit as no permission to push, open or update a pull request, publish a review, merge, release, or change any other remote system.
- Run stakeholder-visible publication through direct Bash or `gh` commands, so the configured approval patterns still apply.
- Never route a push, PR, review, comment or release action through OMP `eval` or another wrapper. That bypasses the approval patterns.

## Communication

- Write short, plain English. Avoid idioms and report-like ceremony.
- Expand an abbreviation on first use. Keep technical names exact.
- When a real choice remains, discuss the approach in prose before you present a structured choice.
- Never use the section-sign character in prose, docs or specs. Write `section 8`.
- Write stakeholder-facing comments (pull requests, trackers, review replies) as short plain prose.
- Skip automatic preambles and recaps. Match a reply's length to what the user asked, not to the work done.
- Keep the **forward pointer** in interactive Flow work. At each meaningful user-facing checkpoint, state briefly the current outcome, the next workflow action, and whether you need user input or approval.
- When Flow can decide and perform the next action, say what you will do and continue. Do not ask the user to choose.
- Ask the user only at a genuine decision or approval gate, or when you are blocked on information only they control.

## Skill authoring

- When you change these skills, follow the skill design principles in `docs/PRINCIPLES.md`.
- Prefer a light real-world field trial and two or three clean uses over building a large evaluation harness early.
- Tune a skill description after you see a real mis-trigger.

## Shell awareness

The tool shell and the user's login shell may differ. Before the first shell-sensitive command in a session, check both:

```sh
ps -p $$ -o comm=
basename "$SHELL"
```

- Write tool commands in POSIX `sh`. When you need Bash-only syntax, invoke Bash explicitly.
- Write commands you hand to the user for their login shell.

## Weft graph

`${WEFT_GRAPH}` is the durable human and project knowledge graph.

- Before substantive work in a project, read its project page, when one exists, for constraints and gotchas.
- When `${WEFT_GRAPH}` exists, run `weft-worklog` Mode C as a lifecycle hook around substantive Flow work. Before the work, query the project's or topic's `TODO` / `LATER` / stray `DOING` items. After it, update only the items this session owned, and log the completed work to today's journal.
- Do not ask for approval of these local worklog writes. Never change unrelated search matches.
- `weft-worklog` Mode C says when to mark an item `DOING` or `DONE`, and when to restore its old marker.
- Keep durable project state, backlog and conventions in Weft. Do not keep them in harness-native memory files or ad-hoc repository backlogs.
- When you review someone else's PR, you may log the review and advance or close the user's own "review this PR" item. Never create, pull or promote `TODO` / `LATER` items in the user's backlog from that PR's findings. The code belongs to the PR author.
- Name a personal collection project `*-stack`, with a matching `[[X Stack]]` canonical page where applicable.

## Documentation lookup

- For libraries, frameworks, SDKs, APIs, CLIs and cloud services, use the configured Context7 MCP first, when it is available.
- If it is unavailable or insufficient, use the upstream official documentation or current web research. Do not guess.

## Codebase graph lookup

- In a repository indexed by the `codebase-memory` MCP (`index_status` reports ready), use the graph for orientation and breadth: where a concept lives, what a package depends on, which call chains reach a subsystem. Do this instead of opening many files or guessing `grep` patterns.
- Use `lsp` at an exact position (definition, references, hover, implementation) and for the reference pass before you change an exported symbol. It stays authoritative there.
- Treat graph call and usage edges as leads, not a complete reference list.
- Use `grep` for literals, comments, configuration and other non-code text.
- Read a cited path or line to confirm it.
- Before you conclude that something does not exist, check the reported `parse_partial` / `not_indexed` gaps.
- When the repository is not indexed or not ready, index this root once with `index_repository`, or fall back to `grep` and say so.
- Never pass `persistence` to `index_repository`. It writes an artifact into the repository.

## Python

Use `uv` for Python.

- Project dependencies: `uv add` / `uv remove`. Run with `uv run`. Synchronize with `uv sync`.
- Standalone tools: `uv tool install`. One-off tools: `uvx`.
- Interpreters: `uv python install`.
- Do not use `pip install`, `pipx`, Poetry or hand-rolled virtualenvs for user or project tooling.
