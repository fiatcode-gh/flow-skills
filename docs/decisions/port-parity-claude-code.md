# Claude Code enforcement (port enforcement parity, unit 2)

Work: [flow-skills#14](https://github.com/fiatcode-gh/flow-skills/pull/14), merged 2026-11-27 as `2a12668`, unit 2 of port enforcement parity (OpenCode was unit 1). The port's own record is `docs/decisions/claude-code-port.md`; known misses are in `docs/EXTERNAL-INTEROP.md`.

## Decisions

- **The gates are a Claude Code hooks module, `claude-code/hooks/guard.ts`, not a `PreToolUse` settings hook.** Claude Code 2.1.331 runs a plugin's TypeScript module in its own process, so the guard reuses the OpenCode port's record, digest and tree recipe instead of a second copy in POSIX `sh`. The floor is 2.1.299: below it, or when the version cannot be read, every gated dispatch and every `SendMessage` refuses, because the resume event does not fire there.
- **Approvals use the plugin's own dialog (`$.ui.ask`); publication uses the real permission prompt (`tool.check` `ask`).** Neither path can write a record without the user's answer. A dismissed dialog, `-p` and `dontAsk` write nothing (seen live). The publication ask still fires under `bypassPermissions`.
- **Every tool is covered, fail-closed.** `Bash`, `PowerShell` and `Monitor` get the shell rules. `Workflow`, and any tool whose input carries `command`, `script` or `code`, is refused, with an allow-list that ships empty. Every other tool has each single-line string in its input, keys included, judged as a path by the `.flow/runtime` rule and, when it names an existing file, by the secret rule. Tools that touch no files (`Agent`, `SendMessage`, `TodoWrite`, `AskUserQuestion`, `ExitPlanMode`, `Skill`, `WebSearch`, `WebFetch`, `flow_gate`) are exempt by name. A list of tools to block left `Monitor`, a shell tool, wide open.
- **The fingerprint loads the real index's entries into a scratch index and verifies the load.** The file API writes text only, so the index cannot be copied; starting from an empty index lost force-added ignored files and the index's file modes, and an edit to such a file left acceptance current.
- **Shell text is matched by path parts and by substring**, after the shell's own quote and escape removal. Either alone missed spellings: parts miss `>.flow/runtime/x` and code inside `python3 -c`; a substring misses `cd .flow; … runtime/x`.
- **A resumed child missing from `$.agent.list()` is finished.** The resume event fires only for a finished or stopped child, and a finished foreground subagent leaves the list (seen live on 2.1.332). Treating it as unknown refused every resume of a finished writer.
- **The cloud push exemption is two exact commands**: a bare `git push [-u] [<listed remote> <start branch>]` from the session root on the branch the session started on, when that is not a remote's default branch, and `gh pr create --draft` with only title, body, fill or base. The earlier version parsed `-C`, `env` and directory changes and still let mirror pushes and pushes of `main` through.
- **The command splitter is OMP 18.18.6's**, plus backticks and `$(` inside double quotes, so `&`, subshells, `"git"` and `\git` prompt.
- **On Windows, `realpath` is usually Git's MSYS build.** Its `/c/...` answer is read as drive `C:`, a `//host/share` answer as UNC, and any other `/...` answer as no answer. This fallback runs only when the engine's `stat` gives no `realPath`.

## Rejected alternatives

- A list of known dangerous tools: every new engine tool would start unguarded.
- Judging only strings under a fixed list of path keys: MCP tools name files under `source`, `destination`, `pathInProject`, `uri` and as object keys.
- Judging every string by the secret rule regardless of whether a file exists: prose such as "Fix credentials guard" was refused.
- `$.store` for presentations or the cloud start facts: it is shared across checkouts and processes.

## Traps

- The test host is a hand-written model of the engine. It once accepted answer shapes the engine ignores, and hid the `realpath` and 8.3-name problems Windows CI found. Keep it at least as strict as the engine.
- On Windows, Node's `realpathSync` keeps 8.3 names (`RUNNER~1`); git and the engine answer the long form. Tests use `realpathSync.native`.
- A Windows path pasted after `file://` puts the drive in the URI's authority; build URIs with `pathToFileURL`.
- The session's own OMP credentials guard refuses shell text naming `.env`; put probes in a script file.

## Open questions

- Whether Claude Code on Windows fills `stat().realPath`, and how the `PowerShell` tool behaves there.
- An installed marketplace copy still runs plugin 1.4.0 until the version is bumped.
