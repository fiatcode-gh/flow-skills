# Port enforcement parity

Work: unit 1, OpenCode ([flow-skills#13](https://github.com/fiatcode-gh/flow-skills/pull/13), `e52aae4`, record `docs/decisions/port-parity-opencode.md`); unit 2, Claude Code ([flow-skills#14](https://github.com/fiatcode-gh/flow-skills/pull/14), `2a12668`, record `docs/decisions/port-parity-claude-code.md`). Finished 2026-11-27.

## What it was for

The Claude Code and OpenCode ports carried Flow's doctrine but not OMP's mechanism: approvals rested on the model running `flow_approve` honestly, acceptance went stale on a commit, finished writers were resumed unchecked, and secret files could be printed through the shell. Every recorded break in five audits was a model skipping a rule it had read. Both ports now enforce in code what OMP's guards enforce:

1. no planner, production writer or evidence verifier runs without a current approval, and a resumed finished writer is checked the same way;
2. an approval is recorded only behind a prompt the user answers, one prompt per chat yes;
3. acceptance binds the reviewed working tree, so a commit of it keeps it current;
4. a call that would print a known secret file is refused, file tools and shell alike;
5. publication commands prompt.

## Decisions

- **One behavior, three implementations.** OMP keeps its guards and `gates.json`; each port carries a TypeScript copy of OMP's matcher, digest, tree recipe and secret rules, pinned to OMP by `tests/validate.py`. `tests/fixtures/guard-cases.json` runs the same cases against all three and requires equal digests and fingerprints.
- **The ports share one record format**, `.flow/runtime/approvals.log`, one line per scope and kind; OMP keeps its own file. Only `flow_gate` writes it.
- **Fail closed.** A gated call the guard cannot evaluate refuses with a reason naming what is missing or stale. A hook that throws or times out refuses through its fallback handler instead of being skipped.
- **Known misses are documented per port** (`docs/OPENCODE-COMPATIBILITY.md`, `docs/EXTERNAL-INTEROP.md`), as `docs/OMP-COMPATIBILITY.md` does for OMP.
- **OpenCode went first**: its plugin runs TypeScript in process the way OMP's guards do, and a recorded leak was a secret printed through its shell.

## Out of scope

Open WebUI (no tool execution), changing OMP's guards or doctrine, the five-minute follow-up window, commands the user types themselves, GitHub MCP writes in Claude Code cloud sessions, migrating `opencode/opencode.json` to the V2 config format, model routing, and cutting a release.

## Lessons

- The first Claude Code acceptance passed on tests driven through a hand-written engine model. An independent review, a live session and Windows CI each found defects the model hid. Live and cross-platform checks are part of acceptance for a guard, not extras.
