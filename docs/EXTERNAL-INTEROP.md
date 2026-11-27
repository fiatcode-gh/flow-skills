# External chat ↔ OMP Flow interoperability

An external chat, currently Open WebUI (self-hosted at `ask.fiatcode.dev`), carries a Flow port for design, planning and pull request review. The port and this OMP stack share **doctrine**, not identical mechanics.

## Shared surface

- `flow-design` — material WHAT/WHY decisions.
- `flow-review` — evidence-backed PR/change/audit review doctrine; the port carries PR reviewer mode only.
- `flow-planning` — shared execution-grade planning doctrine; the external port and OMP use different mechanics but the same plan contract/lens quality gate.

OMP additionally owns local execution/TDD/debugging/integration, task agents, Hub/isolation and formatter/test ownership. Do not copy those mechanics into the external planning port.

## Open WebUI port

The port's sources live in `open-webui/`. Import each skill file through Workspace > Skills > Import; its frontmatter fills the name and description. Paste `system-prompt.md` as the Open WebUI model's whole system prompt.

The chat reads through GitHub's read-only MCP server and writes nothing: no files, no GitHub writes, no approvals.

| Port file | Mirrors |
|---|---|
| `flow-design.md` | `flow-design` Process, Imported design context, Multi-unit work |
| `flow-planning.md` | `flow-planning` sections 1–5 |
| `flow-review.md` | `flow-review` Shared evidence contract and Change-lens selection, `review-lenses.md`, `pr-review.md` steps 1 and 3–7 |
| `flow-handoff.md` | `planning-handoff.md` Manifest schema v2 and HANDOFF.md contents, `planning-handoff.schema.json` |
| `system-prompt.md` | `AGENTS.md` Communication, Engineering principles, Documentation lookup and the Weft graph project-page rule; `flow-evidence` opening rule; `flow-safety` read-content, secrets and publication rules |

`tests/validate.py` fails when `flow-handoff.md` no longer names every required manifest field, constant and enum value in the schema.

The port carries none of the rules the 2026-11 Flow batch changed (approval prompts, in-scope amendments, the tiny limit, the follow-up window, the credentials guard): it records no approvals, dispatches no workers and has no shell.

## Claude Code port

`claude-code/` is a Claude Code plugin named `fiatcode`, the plugin name in its `.claude-plugin/marketplace.json` entry; its tool is `mcp__fiatcode__flow_gate` and its agents are `fiatcode:<agent>`. Unlike the Open WebUI chat, Claude Code has a shell, a checkout and subagents, so the port carries execution as well as design, planning and review.

| Port path | Mirrors |
|---|---|
| `hooks/flow-core.md`, `hooks/session-start.sh` | a 2 KB always-on core that points at `flow-context.md`; Claude Code keeps only about 2 KB of hook output |
| `hooks/flow-context.md` | `AGENTS.md` (Engineering principles, OMP / Flow execution, Weft graph, Commits, Communication, Documentation lookup, Python), `flow-safety`, `flow-evidence`, `flow-artifacts`; adds the approval record, the cloud-session rules and the Weft guard/publish functions |
| `hooks/hooks.json`, `hooks/guard.ts` | a hooks module (`modules: ["./guard.ts"]`) that enforces the gates in the Claude Code process; it needs Claude Code 2.1.299 or later |
| `hooks/guard/` | the record, tree identity, dispatch, secret-file, runtime-write and publication checks, behind one `Host` adapter |
| `skills/flow-tdd`, `skills/ui-design` | verbatim; `tests/validate.py` fails on drift |
| `skills/flow-design`, `flow-planning`, `flow-execution`, `flow-debugging`, `flow-integrating`, `flow-review` | the OMP skills, with OMP mechanics reworded |
| `skills/flow-review/references/` | `review-lenses.md`, `audit-lenses.md`, `pr-review.md`, `author-feedback.md`, `audit.md`; `github-operations.md` is rewritten for the GitHub MCP tools and absorbs `author-operations.md` |
| `skills/weft-worklog`, `weft-memory`, `weft-maintenance` | the OMP skills; `voice.md` and `page-archetypes.md` verbatim; `conventions.md` swaps never-commit for `weft_publish`; `memory-schema.md` adds the no-injector note |
| `skills/flow-external-session` | planning handoff intake, plus a handoff-out mode; the schema and validator are verbatim |
| `agents/` | the OMP agents, `flow-evidence-verifier` included, plus `flow-cor-reviewer` for the bundled OMP `reviewer` |

Mechanics map:

| OMP | Claude Code port |
|---|---|
| `flow_gate` and the guard extensions | the `flow_gate` tool behind the plugin's own dialog, records in `.flow/runtime/approvals.log`; the hooks module enforces the dispatch and resume gate, the tree-bound acceptance, the secret-file refusal and the publication prompts |
| roles `@plan`, `@slow`, `@execute`, `@task`, `@review_aux` | agent `model: opus`, each with the profile's `effort` |
| `sonic` (`@smol`), `scout` | a `general-purpose` agent with `model: sonnet`; the `Explore` agent |
| `hub` clarification and `hub wait` | the agent returns BLOCKED; Main continues it with `SendMessage`; background agents notify on completion |
| OMP `todo` | the task list |
| OMP isolation | `isolation: "worktree"` |
| `${WEFT_GRAPH}` as a local graph the user syncs | the same locally; in a cloud session `WEFT_GRAPH_REPO` makes `weft_guard` clone it shallow and `weft_publish` push each write to its default branch |
| `ai-memory` hub injection | `weft-memory` recall at the start of substantive work, with `## Harness: [[Claude]]` |
| `gh` publication behind `bash.patterns` prompts | GitHub MCP tools; the cloud harness pushes the session branch and opens a draft pull request |

On Windows the hook and the Bash tool run in Git Bash; see `docs/WINDOWS.md`.

The module's publication guard asks on the same commands as OMP's `bash.patterns`, split the way OMP 18.18.6 splits a command — on `;`, `&`, `|`, `(`, `)` and line breaks, plus backticks and `$(` inside double quotes — with quotes and escapes removed before matching. Its cloud exemption admits exactly two literal commands, run from the directory the session started in, with nothing before them and nothing a shell would have to expand: `git push`, optionally with `-u` or `--set-upstream`, optionally naming a remote the repository lists and the branch the session started on, while that branch is checked out and is not a remote's default branch; and `gh pr create --draft` with only `--title`, `--body`, `--fill` and `--base` besides it. Every other publication prompts, in a cloud session or not.

Every tool is covered. `Bash`, `PowerShell` and `Monitor` get the shell rules; `Read` and `Grep` the secret rule; `Write`, `Edit` and `NotebookEdit` the `.flow/runtime` rule. `Workflow` is refused by name. Any other tool whose input carries a `command`, `script` or `code` field is refused, naming the tool — on this build that refuses `AppifactRepl`. `Agent`, `SendMessage`, `TodoWrite`, `AskUserQuestion`, `ExitPlanMode`, `Skill`, `WebSearch`, `WebFetch` and `flow_gate` open no file the model names and keep their own checks. Every other tool has each single-line string in its input judged as a path — every key and every value, at any depth; a string that is one line once its surrounding whitespace is trimmed, in that trimmed form too; and a `file:` URI, with or without `//`, by its path: it is refused when it lands in `.flow/runtime`, when it cannot be resolved, or when it names a credentials file that exists under the session directory or the repository root.

Not ported: the checkpoint step and the device and manual acceptance it serves, which a cloud container has no use for; frozen LDD ledgers; codebase-memory and shell-awareness doctrine.

A plugin cannot ship `permissions.deny`: Claude Code reads deny rules only from user, project or managed settings. The hooks module refuses the same files in `Read`, `Grep`, `Bash`, `PowerShell`, `Monitor` and other tools' input strings, so the deny rules remain the first line for file tools. The user may add this to `~/.claude/settings.json`. Deny rules have no exceptions, so the list names exact files instead of `.env*`, which would also deny `.env.example`:

```json
{
  "permissions": {
    "deny": [
      "Read(**/.env)",
      "Read(**/.env.local)",
      "Read(**/.env.*.local)",
      "Read(**/.env.production)",
      "Read(**/.env.development)",
      "Read(**/.envrc)",
      "Read(**/mcp.json)",
      "Read(**/.mcp.json)",
      "Read(~/.config/opencode/service.json)",
      "Read(**/id_rsa)",
      "Read(**/id_ed25519)",
      "Read(**/*.key)",
      "Read(**/*.p12)"
    ]
  }
}
```

These rules cover Claude Code's file tools; the hooks module's secret-file refusal catches the `Bash`, `PowerShell` and `Monitor` commands that would print one.

A cloud session starts from a fresh container, so the cloud environment installs the plugin on every start. In the environment's settings:

- Setup script: `claude plugin marketplace add fiatcode-gh/flow-skills && claude plugin install fiatcode@flow-skills || echo "fiatcode plugin install failed"`. This repository is public, so the setup script can fetch it without the repository being attached to the session.
- Environment variables: `WEFT_GRAPH=/home/user/weft` and `WEFT_GRAPH_REPO=fiatcode-gh/fiat-codex`.

Keep `WEFT_GRAPH` on its own clone. A session that has `fiat-codex` attached checks it out on the session's own branch; `weft_publish` pushes to the default branch either way.

### Known misses

The module needs Claude Code 2.1.299 or later. It does not catch:

- **Mods off.** `--safe-mode`, `--bare`, `disableAllHooks`, an organization policy, or the engine's rollout switch for installed mods leave no gate. Stop and say so; do not approve by hand.
- **Claude Code older than 2.1.299.** The port does not claim enforcement there: treat the session as having no gate and stop.
- **Tool calls the module makes itself.** (The Workflow tool, whose subagents the dispatch gate cannot see, is refused.)
- **GitHub MCP writes in a cloud session.** The publication prompts cover shell commands only.
- **The exemption reads the command text, not the shell state.** It admits only literal commands, so a variable, `eval`, a separator or a substitution prompts, and it reads nothing else: a shell function or variable named `git` defined by an earlier call runs with no prompt, and an alias (`git <alias>`, `gh <alias>`) matches no publication pattern.
- **Git's own configuration of where a push goes.** The admission is textual, so the guard reads none of it: `push.default`, `remote.<name>.push`, `remote.<name>.pushurl`, `remote.pushDefault` and `url.*.insteadOf` (including `pushInsteadOf`) widen or rewrite what a bare `git push` or a configured remote stands for. The remote allow-list is also read at decision time, so `git remote add` or `set-url` in an earlier call can point a listed name anywhere — those commands are not publication patterns.
- **A wrapper or a global git option.** `sh -c 'git push …'`, `bash -c …`, `xargs … git push`, `command git push`, `git --no-pager push`, `git --git-dir=… push` and `env git push` match no publication pattern, so they prompt nothing, as in OMP; `\git push` and `"git" push` do prompt, because quotes and escapes are removed before matching.
- **An assignment before the command.** `GIT_TRACE=1 git push` matches no publication pattern, so it prompts nothing, as in OMP: the shared list has `env * git push*` but no pattern for a bare assignment.
- **A grep or shell command that names no secret file.** The secret-text rule is name-based, as OMP's is: a grep or shell command that names no secret file prints the contents it reads, even of `credentials.yml`, `id_rsa` or a `.pem`.
- **The five-minute follow-up window.** A resume is gated like a dispatch, but nothing measures the window.
- **`-p` runs.** No dialog can open, so `approve` and `accept` record nothing.
- **`dontAsk` sessions.** Whether the approval dialog opens is not documented; the live check records what it does.
- **`.flow/` loss in a reclaimed cloud session.** The approvals go with the container; rewrite the artifacts from the transcript and approve them again.
- **An artifact whose bytes are not UTF-8.** The module refuses to hash one: an artifact is hashed only when its bytes are exactly the UTF-8 encoding of its text.
- **A record torn mid-write.** The module writes the whole record with no rename; an interrupted write leaves it unreadable, and every gate refuses until `present` and `approve` run again.
- **Filenames that are not valid UTF-8.** An acceptance fingerprint can differ there from the OMP and OpenCode ones.
- **A working tree too large to fingerprint.** The fingerprint's git commands run under the engine's per-command limits, 30 s and 4 MiB of output each; an index past about 60 000 files or an `add -A` slower than 30 s makes `accept` and the verifier dispatch refuse. Measured on this repository (243 tracked files): 0.07–0.08 s.
- **A host with no canonical-path source.** Canonical paths come from the engine's `$.fs.stat(path, { resolve: true })`, which the guard passes, so ordinary and symlinked paths need no external tool. `realpath` is a fallback only for a host whose `stat` answers no `realPath` even with the option; when neither answers, the path-resolving checks refuse — `present`, `approve`, artifact reads and every write-target check — while `status`, `accept` and `clear` still run, since acceptance binds the tree and head it reads and needs no canonical path. A host whose `realPath` folds `..` before it resolves the links it crosses (`Node`'s `realpathSync` does; the shipped engine's `fs/promises` `realpath` does not) can be redirected through a symlinked `..`. The fallback's Windows form is unproven and matters only to such a host.
- **`GIT_CONFIG_COUNT` with `GIT_CONFIG_KEY_n` / `GIT_CONFIG_VALUE_n`.** The engine's environment answers a variable by its literal name, so the fingerprint's git child never sees an indexed override; a build that sets them can make the tree differ from the OpenCode port's. The file overrides (`GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM`, `XDG_CONFIG_HOME`) and `GIT_CONFIG_NOSYSTEM` are passed.
- **The scratch directory.** Each fingerprint leaves a small `flow-gate-tree-*` directory under the OS temp; the module's file API has no delete, so the OS cleans it.
- **`.flow/runtime` in shell text is a text check.** A command is refused when its text contains `.flow/runtime` in any case, with trailing dots or spaces on either part and repeated separators or `.` parts between them, as written or after quote and escape removal — glued to a redirect, an option or an assignment (`>.flow/runtime/x`, `-o.flow/runtime/x`, `of=.flow/runtime/x`) or inside a quoted program (`python3 -c "open('.flow/runtime/x','w')"`) included; when it enters `.flow` with `cd`, `pushd`, `-C` or `Set-Location` and names `runtime` as a path part anywhere, glued forms such as `cd .flow;printf x>runtime/a` included; or when the session directory is inside `.flow`. Being a text check, it also refuses text that only mentions the directory (`echo .flow/runtime`, `.flow/runtimes`, `x.flow/runtime`). A variable (`d=.flow/runtime; … > $d/x`), a glob (`.flow/runt?me`), a command built at run time, or a directory change the session directory does not report gets through, as in OMP.
- **Tools that run code the guard cannot read are refused**, not inspected: `Workflow` (by name, whatever its input), `AppifactRepl` and any tool with a `command`, `script` or `code` field. A tool is let through only by name, with its reason, in the guard's allow-list, which ships empty.
- **Other tools' inputs are judged string by string, not by field name.** A single-line string that lands in `.flow/runtime` or names an existing credentials file refuses the call whatever the field means: a key, a note, a title or a URL that spells `.flow/runtime/…` is refused, a report naming an existing `.env` is refused, and `Glob` or a read-only MCP tool pointed at `.flow/runtime` is refused although it writes nothing.
- **A secret named inside a multi-line string, a directory holding one, or a credentials file that does not exist yet.** A multi-line string is content, not a path, so a file named inside it is not judged (a string that is one line once trimmed is judged trimmed); a directory is not a file; and a file that does not exist yet cannot be printed.
- **A path the guard cannot see whole.** Other tools' strings are judged one at a time and as written, so a path split across two strings (`{ dir: ".flow", name: "runtime/approvals.log" }`) and several paths packed into one string (`"README.md,.env"`) get through, and so do shell brace expansion (`.flow/{runtime,x}/a`) and `$'…\x72untime'` escapes in shell text. OMP and OpenCode miss these too.
- **An MCP server that resolves paths against its own root.** The secret rule looks a relative string up from the session directory and from the repository root; a server rooted anywhere else can print a credentials file named relative to its own root. When both places hold a file by that name, the session directory's decides, so a plain file there hides a link to a credentials file at the root.
- **A string longer than the platform's path limit.** Once resolved, a string over 4 096 characters on POSIX or 32 767 on Windows is not looked up by the secret rule, and the `.flow/runtime` rule judges its text without following links; one that spells `.flow/runtime` is still refused. The limit is tested on the resolved form, so a relative string just under the limit whose resolved form is over it still opens relative to the session directory and is not judged as a file.
- **A `file:` URI with no `/` after the scheme** (`file:C:/x`, `file:.env`) is judged as the plain string it is, not decoded; URIs with `/`, `//` or `///` are decoded, with any `?query` or `#fragment` cut off.
- **Git for Windows' `realpath` and its mount table.** Where the engine's `stat` answers no real path, the guard asks `realpath`, which on Windows is usually Git's MSYS build. Its `/x/...` answer is read as drive `X:`; a one-letter folder under the Git install or a custom one-letter mount also prints as `/x/...` and would be read as that drive. Any other MSYS path is no answer and refuses.
- **`Get-Item <file> | Get-Content` in PowerShell.** The pipe names no file to the reader, as OMP's `xargs cat`.
- **Writes under `.git/`.** File tools can write `.git/config` or `.git/info/attributes`, which can change what the fingerprint sees; OMP's governance guard refuses `.git/` writes from file tools, this port does not.
- **A reload of the hooks module** re-reads the session's start branch and root from where the session then stands.
- **An engine build that ignores `stdin` or byte reads.** The fingerprint verifies its scratch index against the real one and refuses on a mismatch; an artifact the engine cannot read as bytes is refused at `present`.

## OpenCode port

`opencode/` is installed under `~/.config/opencode/` by `opencode/bin/flow-opencode`. Like Claude Code, OpenCode is a local harness with a shell, a checkout and subagents, so the port carries execution as well as design, planning and review. Every file is translated from the OMP source, not from the Claude Code port.

| Port path | Mirrors |
|---|---|
| `AGENTS.md` | `omp/AGENTS.md` sections, the three rules (`flow-safety`, `flow-evidence`, `flow-artifacts`) and the `flow_gate` description; loaded in full |
| `skills/flow-tdd`, `skills/ui-design` | verbatim; `tests/validate.py` fails on drift |
| the other `skills/` | the OMP skills with OMP mechanics reworded |
| `agents/` | the OMP agents, plus `flow-cor-reviewer`; the primary `ask`, which replaces OpenCode's `plan` (`plan.md` turns it off) |
| `opencode.json` | `bash.patterns` of `omp/profiles/*/config.yml`, as `permission.bash` asks; the credentials guard's secret-file list, as `permission.read` deny rules with the `.pub`, example and sample endings allowed last (the last matching rule wins; `*` also matches `/`, so each allow is a plain ending and every `.pem` is denied) |
| `profiles/` | `modelRoles`, as `model` and `agent.<name>.model` |
| `plugins/flow-guard/` | the three guard extensions `flow-governance-guard`, `flow-credentials-guard` and `flow-evidence-guard`; `tests/validate.py` pins the mirrored blocks, and `tests/guard-cases.test.mjs` runs one case table against all three ports |
| `bin/flow-opencode` | `omp/bin/flow-omp` |

Mechanics map:

| OMP | OpenCode port |
|---|---|
| `flow_gate` and the guard extensions | the `flow-guard` plugin: the `flow_gate` tool behind one permission prompt, records in `.flow/runtime/approvals.log`; dispatch, follow-up, record and secret-file checks are enforced in the plugin's tool hook |
| roles `@plan`, `@slow`, `@execute`, `@task`, `@review_aux` | the profile file maps each agent name to a model |
| `sonic` (`@smol`), `scout` | the built-in `general` and `explore` subagents |
| spawning through the OMP task tool | the `subagent` tool |
| `hub` clarification and `hub wait` | the subagent returns BLOCKED; Main continues it with its `sessionID`; background subagents notify on completion |
| OMP `todo` | no task-list tool; the stage list stays in the forward pointer |
| OMP isolation | not used; writers on the same files run one at a time |
| `skill://<name>` reads | the `skill` tool |
| `flow-evidence-verifier` | ported; its dispatch is enforced by the plugin (current acceptance and a complete capsule) |
| `ai-memory` hub injection | `weft-memory` recall, with `## Harness: [[OpenCode]]` |
| `bash.patterns` prompts | `permission.bash` asks in `opencode.json` |

On Windows `flow-opencode.ps1 run` sets OpenCode's shell to Git Bash; see `docs/WINDOWS.md`.

Not ported: OMP isolation and OMP todo. OpenCode also scans `~/.claude/skills` and `~/.agents/skills`; the installer reports a same-named skill there.

The plugin needs OpenCode 2.2.5 or later; its known misses are listed in `docs/OPENCODE-COMPATIBILITY.md`.

## Handoff rule

The external chat emits a versioned (schema v2) static `FLOW-HANDOFF.json` + `HANDOFF.md` bundle using the schema in `omp/skills/flow-external-session/references/planning-handoff.md`. When the user explicitly intends to continue in local OMP, that machine-readable bundle is mandatory; a standalone Markdown plan/design is only legacy evidence, not a complete protocol handoff. OMP validates and reconciles the bundle before use. The bundle may carry decisions and implementation strategy, but **never authorization**. Do not use embedded copy/paste kickoff prompts as a second orchestration protocol; the receiving OMP stack owns current mechanics.

The user saves the bundle at `.flow/handoffs/<slug>/` in the repository checkout (`flow-artifacts`). Local OMP keeps that `<slug>` as the Flow scope, so integration removes the bundle.

Local `docs/decisions/` records stay canonical. The external chat may propose changes to them; local OMP checks each proposal against current code in `flow-design` before it counts.

## Avoid duplicate reasoning

After validation:

- unresolved WHAT/WHY → `flow-design`;
- settled design + execution-grade current plan → request/confirm local execution approval, then constrained `flow-execution`;
- settled strategy but executor would still make consequential HOW/test/interface decisions → preserve the strategy and use `flow-planning` only to make those missing decisions execution-grade;
- tiny obvious implementation with no meaningful planning judgment → authorized semantic/direct execution without plan ceremony.

The port's `flow-planning` aims at the same execution-grade plan shape (locked decisions, task briefs, proof, discretion/escalation and plan quality-gate receipt). OMP still grades every `IMPLEMENTATION-PLAN.md` by `flow-planning` "External handoffs" rather than treating it as cheap-executor-ready.

A changed commit SHA triggers targeted revalidation, not automatic rejection or a full restart. A matching SHA does not erase local dirty-tree differences.

## Synchronization discipline

- When shared doctrine changes in OMP (`flow-design`, `flow-planning`, review lens semantics, PR reviewer mode, decision-record handling, the handoff schema, or the rules `system-prompt.md` mirrors), update `open-webui/` in the same change cycle.
- The table above names what each port file mirrors.
- When the exclude command in `flow-handoff.md` changes, prove it again with fish in a temporary git repository: fresh clone, missing trailing newline, linked worktree, outside a repository.
- OMP-only execution mechanics do not require a mirror in `open-webui/`. In `claude-code/`, port them by the mechanics map above.
- When an `omp/` skill, agent, rule or `AGENTS.md` section listed in the Claude Code port table changes, update its port file in the same change cycle.
- When an `omp/` skill, agent, rule or `AGENTS.md` section changes, update its `opencode/` file in the same change cycle; the validator pins the verbatim ones.
- When a guard under `omp/extensions/` changes, update `opencode/plugins/flow-guard/` in the same change cycle; the validator fails on a drifted mirrored block.
