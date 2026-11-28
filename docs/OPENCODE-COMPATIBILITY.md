# OpenCode compatibility assumptions

The `flow-guard` plugin (`opencode/plugins/flow-guard/`) was checked against OpenCode 2.2.5 (2026-11-24), on the installed binary and in its source at tag `v2.2.5`. OpenCode 2.2.5 is the minimum version; there is no runtime version check. OpenCode 1.x does not load V2 plugins, and `./opencode/bin/flow-opencode doctor` shows a plugin that did not load (`FAIL: plugin flow-guard is not loaded` or `… failed to load`).

The plugin loading on Windows and macOS is not yet proven: it was checked on Linux only. The PowerShell installer tests passed under Linux `pwsh`, and the Windows load awaits CI's Windows job.

## Relied-on behavior

- A directory, or a symlink to one, under `<config>/plugins/` loads its `index.ts`. `@opencode/plugin` resolves with no `node_modules`, `./x.ts` imports and `node:` built-ins work, the runtime is Bun, and an edit reloads the plugin. The plugin depends on this to load from the installer's link with no `package.json`, and to load with `OPENCODE_CONFIG` set, as `flow-opencode run` does.
- `plugin.list` returns each plugin's id, its link path and `active` or `failed` with the error. `doctor` reads it from a running server to print `ok: plugin flow-guard is active at …`, and waits for the list, which is empty right after start. `api --standalone plugin.list` answers before plugins load, so `doctor` does not use it.
- `model.default` returns the model a session with no explicit model uses. The config's `model` is set by a config plugin (`packages/core/src/config/plugin/provider.ts`). On 2.2.5 the handler waits for plugins, so `api --standalone model.default` with `OPENCODE_CONFIG` returns the profile's model. On 2.4.1 it no longer waits (`packages/server/src/handlers/model.ts`; the CLI's own commands wait for `plugin.list` instead), so that one-shot call returns `data: null`. `doctor` then starts a server with the profile's `OPENCODE_CONFIG`, waits until its `plugin.list` is not empty, and asks it. Only null data from that server prints `SKIP: profile <stem>: main model (not readable on OpenCode <version>)`. Any other outcome without a model prints `FAIL: profile <stem>: main model unavailable: …` and names why: the server reported no listening URL within `FLOW_OPENCODE_SERVE_WAIT` seconds, `model.default` on it exited non-zero (followed by OpenCode's error output when there is any), or its answer held no model.
- `ctx.tool.hook("execute.before", …)` sees every agent tool call, child sessions included, with the tool name and its input, and a thrown `Error` fails that call alone. All of the plugin's refusals (secret files, `.flow/runtime` writes, dispatch and follow-up) are thrown there.
- A tool call nested in Code Mode `execute` fires `execute.before` again under the nested tool's own name, and a throw fails the nested call. So Code Mode stays on and `opencode/opencode.json` keeps only `$schema` and `permission`.
- Tool inputs are `read {path}`, `grep {pattern, path?, include?}`, `shell {command, workdir?}`, `edit {path, …}`, `write {path, content}`, `patch {patchText}` with `*** Add File:`, `*** Update File:`, `*** Delete File:` and `*** Move to:` headers, and `subagent {agent, description, prompt, model?, sessionID?, background?}`. Paths resolve against the session directory with a leading `~` expanded. The secret-file and `.flow/runtime` checks read exactly these fields and resolve paths the same way. OpenCode's input repair renames a `bash` call to `shell`, but its order against the hook is unproven, so the plugin checks a `bash` call exactly like `shell`.
- `ctx.tool.transform` adds a direct tool with a JSON Schema input, and its `execute` gets the session, agent, message and call ids. This is how `flow_gate` is registered, with Code Mode off for it. The tool stays out of Code Mode because OpenCode settles Code Mode tools in an unattended mode where the forced `ask` would resolve by rule with no prompt.
- Every agent's base policy allows `*`, and a `ctx.permission.hook("evaluate", …)` runs after config and saved rules and can set `effect = "ask"`. The plugin sets `ask` for every action that starts with `flow_gate `, so no rule or saved answer can approve for the user.
- The TUI shows a custom action only as `Call tool <action>` and `Tool: <action>`, with no resources, metadata or message, and offers `Always allow` only when the request has `save`. So `flow_gate` puts every pair with its artifact path in the action text (`flow_gate approve contract demo (.flow/contracts/demo.md), implementation demo (.flow/contracts/demo.md)`), so a different file under the same scope reads differently, and `accept` names its scopes and what it binds (`flow_gate accept demo (working tree)`). It sends no `save`.
- An `always` answer does not stop the hook from asking again, a plain reject fails the assert, and a reject with feedback fails it with the feedback. `flow_gate` writes nothing when the assert fails and passes the rejection on unchanged.
- `ctx.session.get` returns `agent`, `parentID` and `time.busy`/`time.idle` in epoch milliseconds: running when `busy` is set and `idle` is unset or older, finished when `idle > busy`. `flow_gate` refuses `present`, `approve`, `accept` and `clear` in a session with a `parentID`, and the follow-up rule lets a message to a running child through and checks one to a finished child.
- `ctx.session.context` returns the messages after the last compaction, and a child's first message is a `user` message starting `You are a subagent spawned by another session.` followed by its prompt. A follow-up with no `Flow gate:` block of its own is checked against that first prompt.
- A `subagent` call with a `sessionID` and a different `agent` switches the child to that agent, and agent ids match exactly. The follow-up rule therefore checks the agent named in the call, and a running child switched to a gated agent is checked like a new dispatch.
- A tool leaves the request only when the last rule for its permission action is a `*` deny; an `ask` rule keeps it listed and prompts per call (`packages/core/src/tool.ts`, `whollyDisabled`). `edit`, `write` and `patch` share the `edit` action, the V1 key `bash` becomes `shell` and the V1 key `task` becomes `subagent` (`packages/core/src/v1/config/migrate.ts`, `normalizeAction`). A config agent's own rules come after the base config's. So `ask`'s `edit: ask`, `bash: ask` and `task: ask` keep `build`'s tool list, and with it the cached prefix and the claude-agent process, whose launch key holds the system prompt and the tools.
- `ctx.event.subscribe({ types: ["session.created", "session.agent.selected"] })` yields each new session with its `agent` and each agent switch with the new `agent` and the `previous` one, published even when the two are the same. `ctx.session.synthetic({ sessionID, text, resume: false })` stores a message in the session without starting a turn, and a stored synthetic message reaches the model as a user message of its text. `ctx.session.hook("context", …)` gets each primary request as `{sessionID, agent, model, system, messages, options, tools}` just before it goes out, and `messages` is that request's own list, built from the stored session. OpenCode's own `plan` (`packages/core/src/plugin/plan.ts`) uses these three: it stores a `<system-reminder>` user message once when a session enters `plan` and once when it leaves, and its `context` hook adds and stores whichever one compaction or a revert dropped, just before the user's prompt when the request ends on one, otherwise last. The plugin does exactly this for `ask` and never touches `system` or `tools`.

## Known misses

- `--auto`, `--yolo`, `--dangerously-skip-permissions` and the TUI setting `session.permissions: "autoaccept"` in `cli.json` make the client answer every permission prompt itself. The server cannot tell that answer from the user's, so `flow_gate` records an approval nobody gave, and `ask` edits files, runs shell commands and dispatches subagents as freely as `build`. This is accepted as a known miss.
- An `Always allow` answer to an edit, shell or subagent prompt in `ask` saves a rule, and saved rules come after the agent's own (`packages/core/src/permission.ts:179`), so later matching calls in `ask` go ahead without asking.
- A subagent that `ask` dispatches after the user approves runs under its own agent's permissions: a `general` subagent edits files and runs shell commands, and an `explore` one runs shell commands, without asking.
- A project `opencode.json` can switch the plugin off with `"plugins": ["-flow-guard"]`.
- A Claude Code session reads the OpenCode record through its hooks module, with the same digest and the same working-tree fingerprint, so an `accept` line written by either port is current in the other; `tests/guard-cases.test.mjs` asserts the agreement on all three ports. Neither port passes a record it could not reproduce.
- `!` shell commands typed by the user do not pass the tool hook.
- Shell commands are matched by text, so the plugin has the residuals OMP lists for the `*.flow/runtime*` rule and for the credentials guard's `bash` text: see those two lists in `docs/OMP-COMPATIBILITY.md`.
- Tools from MCP servers or from other plugins that write files are not checked for `.flow/runtime`.
- File-tool writes under `.git/` are not refused (OMP refuses them).
- OMP's `ast_edit`, `eval` and hashline inputs, its shared `context` block and its double-encoded task repair have no OpenCode counterpart and are not ported.
- `grep` with an `include` brace form (`*.{pem,key}`) is not expanded, so it is not matched as a secret file. A `grep` over a whole directory that holds a secret file is not refused either.
- A follow-up with no `Flow gate:` block of its own, to a finished `general` or gated session whose first prompt was compacted away, is refused; start a fresh subagent.
- A session interrupted by a server shutdown reads as running until it resumes at the next start, so a follow-up to it passes unchecked unless it switches the session to another gated agent.
- A shell command that answers the prompt through `opencode api` is not detected.
- Clients other than the TUI may not show the scope and kind pairs of the prompt.
- `accept`, a verifier dispatch and `status` run git synchronously in the server.
- The `source` of `accept` travels in the permission request's metadata but is not stored in the record, and the TUI does not show metadata.

## Upgrade smoke test

After upgrading OpenCode:

```sh
sh tests/run.sh
./opencode/bin/flow-opencode doctor
```

Expect `ok: plugin flow-guard is active at …/plugins/flow-guard` and no `FAIL`. Then, in a scratch repository with a contract at `.flow/contracts/demo.md`, a plan at `.flow/plans/demo/PLAN.md` and a `.env` file, start `opencode` (not `--auto`) and:

1. Ask it to call the `subagent` tool with agent `flow-planner`, description `probe`, and this prompt: `Flow gate:`, `- Scope: demo`, `- Contract: .flow/contracts/demo.md`, a blank line, then `Reply READY and stop.` Expect the call to fail with `Flow governance preflight failed: … scope demo: no recorded contract approval`.
2. Ask it to call `flow_gate` `present` for scope `demo`, kind `contract`, path `.flow/contracts/demo.md`, summary `Demo contract`; then the same with kind `implementation` and summary `Plan: NONE route`; then `approve` with scope `demo` and kind `contract,implementation`. Expect one permission prompt reading `Call tool flow_gate approve contract demo (.flow/contracts/demo.md), implementation demo (.flow/contracts/demo.md)`, with `Allow once` and `Reject` and no `Always allow`. Choose `Allow once`. `! cat .flow/runtime/approvals.log` shows two lines for `demo`.
3. Ask it to run the shell command `cat .env`, then to read `.env` with the `read` tool. Expect both refused with `Flow credentials guard: this shell call would print a credentials file (.env)` and `… this read call …`.
4. Ask it to run the shell command `git push`. Expect a permission prompt for the command; choose `Reject`.

If a step fails, update the plugin deliberately; do not paper over a changed OpenCode contract inside skills.
