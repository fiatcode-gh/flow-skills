# User instructions

## Engineering principles

- **YAGNI** — do not build what is not needed yet.
- **DRY, without premature abstraction** — remove meaningful duplication; do not create abstractions before the shape is stable.
- **Separation of concerns** — keep modules and layers focused.
- **Self-explaining code** — code explains *what* through names and structure. Comments explain *why*, invariants, constraints, or non-obvious context only.
- Prefer the smallest coherent change that satisfies the requirement. Avoid opportunistic cleanup unless it is required for correctness or explicitly requested.

## OMP / Flow execution

OMP owns Plan mode, task-agent lifecycle, isolation, Agent Hub, Vibe, built-in review and security scanning. Flow skills add judgment and gates; they do not recreate those mechanics.

- Load a Flow skill when its description matches the task. There is no bootstrap skill.
- Before substantial work enters planning, use `flow-design` to reconcile the user's intent with current project reality, write the governing WHAT/WHY contract, present the completed contract, and obtain explicit user approval. This applies to new/existing projects and internal/external brainstorms or handoffs. Preserve already-settled decisions and do not manufacture questions or alternatives; tiny/mechanical work with an already-explicit boundary may skip a separate contract artifact.
- Use `flow-planning` when consequential implementation HOW should be made decision-complete before coding. Native Plan reasoning / `flow-planner` owns that judgment. A validated external **execution-grade** plan may satisfy the stage only when it remains compatible with the approved governing contract; a strategy-only handoff does not become execution-grade merely because `implementation_strategy` is settled.
- A start/resume request does not create missing approval. For substantial work, require explicit user approval of the completed governing contract before planning, then explicit user approval of the completed execution-grade plan before any production-writing worker. Answers to clarification questions do not themselves approve the completed or materially amended contract unless the user explicitly says so. A recorded prior approval remains valid across resume while its approved artifact/scope is materially unchanged; a material contract/plan change reopens the corresponding gate. Under `flow-ldd`, the unit-start kickoff authorizes recon and contract drafting only and the governing contract remains the unit contract in LDD authority; if a tiny/obvious LDD unit deliberately skips a separate plan, obtain explicit local implementation approval after contract approval before the first production-writing worker.
- Route task agents by agent name/role. Do not pass or hard-code concrete model identifiers in workflow prompts.
- Parallelize independent work, not merely divisible work. Dependency structure decides isolation and concurrency. A sole/sequential semantic owner on a suitable feature checkout should normally stay non-isolated so it can be resumed. This resumability rule does not preserve planned executors: execution-grade plan tasks rotate through fresh `flow-plan-executor` (`@execute`) sessions while sharing repository state.
- Writers verify their own changes with focused repository-native proof. Controller/final verification is additive; never make workers blind merely to preserve independence.
- Route execution-grade plan work to `flow-plan-executor` (`@execute`); route unresolved semantic judgment/debugging/broken-plan fallback to `flow-implementer` (`@task`); route settled behavior-preserving/mechanical edits and already-diagnosed exact corrections to bundled `sonic` (`@smol`).
- For execution-grade plan work, prefer one strong integrated `flow-acceptance-reviewer` pass after the coherent implementation instead of routine COR/TTC/CRF fan-out. Specialist lenses remain available for unplanned work, audits, PR review, security boundaries, or escalation.
- Outside `flow-ldd`, Main may code only in the Main-direct lane defined by `flow-execution`; non-LDD is not blanket permission for Main to implement substantial planned or semantic work. Under `flow-ldd`, the architect is strictly non-coding and delegates production edits.

## Commits

Use Conventional Commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`.

Before committing, run the repository's declared formatter/linter on changed files and the verification appropriate to the change. If tooling is not documented, infer it from repository configuration or the project's Weft page.

A local commit is not permission to push, open/update a pull request, publish a review, merge, release, or otherwise affect a remote system.

Use the direct Bash/gh command surface for stakeholder-visible publication actions so configured approval patterns remain effective. Never route push/PR/review/comment/release actions through OMP `eval` or another wrapper to bypass those approval patterns.

## Communication

Use short, plain English. Expand abbreviations on first use while keeping technical names exact. Avoid idioms and report-like ceremony. Discuss the approach in prose before presenting a structured choice when a real choice remains.

Never use the section-sign character in prose/docs/specs; write `section 8`.

Stakeholder-facing comments (pull requests, trackers, review replies) are short plain prose. Avoid automatic preambles and recaps; response length follows what the user asked for, not the work performed.

Maintain the **forward pointer** in interactive Flow work. At each meaningful user-facing checkpoint, briefly state the current outcome, the next workflow action Main intends to take, and whether user input/approval is required. If Flow can determine and perform the next action, say what you will do and continue rather than asking the user to choose. Ask the user only at a genuine decision/approval gate or when blocked on information they uniquely control.

## Skill authoring

When evolving these skills, prefer a light real-world field trial and two or three clean uses over building a large evaluation harness prematurely. Tune descriptions after observing real mis-triggers.

## Shell awareness

Two shells may differ: the tool shell and the user's login shell. Before the first shell-sensitive command in a session, check reality:

```sh
ps -p $$ -o comm=
basename "$SHELL"
```

Write tool commands in POSIX `sh`. When Bash-only syntax is necessary, invoke Bash explicitly. Commands handed to the user must fit their login shell.

## Weft graph

`${WEFT_GRAPH}` is the durable human/project knowledge graph.

- Before substantive work in a project, read the matching project page when available for constraints and gotchas.
- When `${WEFT_GRAPH}` exists, substantive Flow work uses `weft-worklog` as a lifecycle hook: before the work, query project/topic-scoped `TODO` / `LATER` / stray `DOING`; after the work, re-query that scope, update only items this session actually owned, and automatically log completed work to today's journal. This standing authorization applies to those local Weft worklog/status writes; never mutate unrelated search matches.
- When an existing `TODO` / `LATER` is the exact work item the session takes ownership of, mark it `DOING` when action begins; mark it `DONE` with result context when completed. If work stops incomplete, leave `DOING` only when it is genuinely still active/owned; otherwise restore the prior open marker.
- Durable project state, backlog and conventions belong in Weft rather than harness-native memory files or ad-hoc repository backlogs.
- PR reviewer mode is a hard ownership exception: reviewing someone else's PR may be logged and an existing user-owned "review this PR" work item may be advanced/closed, but findings from that PR must not create, pull, or promote `TODO` / `LATER` items in the user's Weft backlog. The code belongs to the PR author.
- Personal collection projects use a `*-stack` repository name and matching `[[X Stack]]` canonical page where applicable.

## Documentation lookup

For libraries, frameworks, SDKs, APIs, CLIs and cloud services, prefer the configured Context7 MCP when available. If it is unavailable or insufficient, use upstream official documentation or current web research rather than guessing.

## Codebase graph lookup

In a repository indexed by the `codebase-memory` MCP (`index_status` reports ready), use
the graph for orientation and breadth — where a concept lives, what a package depends on,
which call chains reach a subsystem — instead of opening many files or guessing at `grep`
patterns.

- `lsp` stays authoritative at an exact position (definition, references, hover,
  implementation) and for the reference pass before changing an exported symbol. Graph
  call/usage edges are leads, not a complete reference list. `grep` stays the tool for
  literals, comments, configuration and other non-code text.
- Confirm a cited path or line by reading it; check the reported `parse_partial` /
  `not_indexed` gaps before concluding something does not exist.
- Not indexed or not ready: index this root once with `index_repository` (never with
  `persistence`, which writes an artifact into the repository), or fall back to `grep`
  and say so.

## Python

Use `uv` for Python.

- Project dependencies: `uv add` / `uv remove`; run via `uv run`; synchronize via `uv sync`.
- Standalone tools: `uv tool install`; one-off tools: `uvx`.
- Interpreters: `uv python install`.
- Do not use `pip install`, `pipx`, Poetry or hand-rolled virtualenvs for user/project tooling.
