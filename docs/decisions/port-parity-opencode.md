# OpenCode enforcement (port enforcement parity, unit 1)

Work: branch `feat/port-parity-opencode`, 2026-11-24, unit 1 of port enforcement parity (Claude Code is unit 2). The port's own record is `docs/decisions/opencode-port.md`; known misses are in `docs/OPENCODE-COMPATIBILITY.md`.

## Decisions

- **The gates are a V2 OpenCode plugin, `opencode/plugins/flow-guard/`.** OpenCode 2.2.5 runs V2 plugins only. One `execute.before` hook refuses calls, one permission `evaluate` hook forces the approval prompt, and a `flow_gate` tool records approvals. OpenCode goes first because its plugin runs TypeScript in process like OMP's guards, and because a recorded leak was a secret printed through the OpenCode shell.
- **Approvals go through the plugin's `flow_gate` tool, not a shell function under an `ask`.** The tool asserts a permission whose action names every scope and kind pair, because the TUI shows only `Call tool <action>`. The request carries no `save`, so `Always allow` is never offered, and the hook forces `ask` even after a saved rule. Only the parent session may present, approve, accept or clear.
- **The prompt names each pair's artifact path** (`flow_gate approve contract demo (.flow/contracts/demo.md)`), and `accept` ends with `(working tree)`: without the path, a different file presented under the same scope and kind read exactly like the approved one.
- **`doctor` reads a profile's main model from a server for that profile when the one-shot call answers null.** OpenCode 2.4.1 answers `api --standalone model.default` before the config plugin sets the profile's model, so the check failed with `'NoneType' object is not subscriptable` on every profile. A server started with the profile's `OPENCODE_CONFIG` answers once its `plugin.list` is not empty; when it does not, the check is a SKIP naming the version, never a FAIL.
- **OMP code is copied, not shared.** `omp/` stays unchanged, so seven OMP regions are copied byte for byte into the plugin and `tests/validate.py` fails when one drifts. `tests/fixtures/guard-cases.json` runs the same secret-file, gate, digest and tree cases against OMP and the plugin, and both must record equal digests.
- **The record stays `.flow/runtime/approvals.log`, line-compatible with the Claude Code port.** An `accept` line holds the working-tree fingerprint and the head; each port reads the other's `accept` line as stale and asks again.
- **A follow-up to a finished gated session is checked like a dispatch; a running one goes through.** Running or finished comes from the session's busy and idle times. The brief comes from the follow-up's own `Flow gate:` block or the child's first message.
- **A tool named `bash` is checked like `shell`.** OpenCode's own input repair renames it, but the order of its hook and the plugin's is unproven.
- **`flow_gate` stays out of Code Mode (`codemode: false`).** Code Mode settles tool permissions unattended, where the forced `ask` would resolve by rule with no prompt. Tool calls nested in Code Mode reach the plugin's hook, so Code Mode stays on.
- **Tests drive the plugin through a model of the 2.2.5 host** (`tests/opencode-plugin-host.mjs`) and never start OpenCode. A live session on 2.2.5 covered what the model cannot: the real prompt text, refusals, and the running and finished session readings.
- **An `ask` primary agent replaces OpenCode's `plan`, with Main's model and effort and `build`'s tools.** `opencode/agents/plan.md` turns the built-in `plan` off with `disable: true` for plain `opencode` and profile runs alike, since `opencode.json` keeps only `$schema` and `permission`. `ask` has `edit: ask`, `bash: ask` and `task: ask` after the base rules and nothing else, so every edit-tool call, every shell command and every subagent dispatch prompts while the tool list stays `build`'s: OpenCode drops a tool only when its last rule is a `*` deny. Subagents ask too because a dispatched `general` or `explore` runs under its own agent's permissions, so without the prompt it would change files or run shell commands that `ask` itself must ask for; OpenCode's `plan` reminder forbids asking a subagent to modify files for the same reason. The same tool list keeps the request prefix cached across a Shift+Tab switch and spares the claude-agent provider the process restart a changed tool list causes. Every profile that maps `build` maps `ask` to the same model and effort. Because the tools look the same, the model is told its mode as OpenCode tells it about `plan` (`packages/core/src/plugin/plan.ts`): the plugin stores one `<system-reminder>` user message when a session is created as or switches to `ask`, one more when it switches from `ask` to another agent, and its session `context` hook adds and stores whichever one a request lost to compaction or a revert. `flow-opencode install` ends with a note on `session.permissions` instead of editing the user's `cli.json`.

## Rejected alternatives

- `flow_approve` as a shell function behind a permission `ask`: it depends on command text, and any other command could still append to the log.
- Sharing modules with `omp/extensions/`: the contract keeps `omp/` unchanged.
- Turning Code Mode off: nested calls already pass the hook.
- Routing OpenCode's `plan` agent to the OMP `plan` role: a Shift+Tab switch would change the model and effort mid-session.
- Denying the edit tools in `ask` as `plan` does, with or without denying the shell: a `*` deny removes the tools, so a switch changes the tool list, loses the cached prefix and restarts the claude-agent process. With the shell left open, the live check also saw the model write a file through it.
- Adding the `ask` reminder to each `ask` request without storing it: it sits just before the prompt or last, so each step's request differs from the one before at that spot. OpenCode's default cache policy puts the conversation breakpoint on the tail message (`packages/ai/src/cache-policy.ts`, `AUTO` with `messages: { tail: 1 }`, lines 17-21 and 155-174), so the tail entry each `ask` step writes is never read back.

## Traps

- **An auto-answering client records approvals with no prompt.** `--auto`, `--yolo`, `--dangerously-skip-permissions` and the TUI's `session.permissions: "autoaccept"` in `~/.config/opencode/cli.json` answer every request with "once", and the plugin cannot tell. The live session first hit this: `autoaccept` had been on since 2026-11-02, so step 4 recorded two approvals with no box. With `prompt` the box appeared.
- The checkout is the live install: between the doctrine change and `flow-opencode install`, the linked `AGENTS.md` names `flow_gate` before the plugin exists.
- OMP's credentials guard refused a commit message whose text had a reader word before "credentials file". Word commit and command text around it.

## Open questions

- Whether the plugin loads on Windows and macOS. The PowerShell installer tests pass under Linux `pwsh`; the Windows load waits for CI's Windows job.
- Whether OpenCode's input-repair hook runs before the plugin's.
