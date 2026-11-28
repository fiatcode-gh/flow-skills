# flow-skills

Flow is an engineering workflow for coding agents. It makes an agent agree with you on what to build before it builds, prove its work before it claims it is done, and ask before it does anything other people can see. Substantial work goes from your request to an approved contract, an execution-grade plan, verified code and an integration you choose.

It is for people who already work with a coding agent and want it to behave like a careful engineer rather than an eager one. This repository holds Flow for four harnesses, one directory each, with each harness's setup next to its doctrine:

| Harness | Directory | Installs into | How |
|---|---|---|---|
| [OMP](https://github.com/can1357/oh-my-pi) (canonical) | `omp/` | `~/.omp/profiles/<profile>/agent/` | `omp/bin/flow-omp install` |
| Claude Code | `claude-code/` | Claude Code's plugin cache | `claude plugin install fiatcode@flow-skills` |
| OpenCode | `opencode/` | `~/.config/opencode/` | `opencode/bin/flow-opencode install` |
| Open WebUI | `open-webui/` | a model's system prompt and prompts | manual import |

Each harness installs from its own directory and keeps working when the others are removed from the machine.

**Status:** this is the author's personal setup, shared as-is. Issues and ideas are welcome. There is no promise of support, and no promise that pull requests will be merged. Some parts are personal to the author; [Adapting it](#adapting-it) says which, and how to drop or replace them.

## Why

Left alone, a coding agent tends to start writing code on its first guess of what you meant, drift from what you asked, say "done" or "tests pass" without running anything, tidy away your uncommitted changes, and push or comment in public without asking. Flow adds engineering judgment and gates on top of each harness's own mechanics (subagents, plan mode, tools) to stop that:

- **Contract first.** Substantial work starts with a short WHAT/WHY contract (`flow-design`). You approve it in chat before planning starts.
- **Execution-grade plans.** A planner settles files, interfaces, tests and error handling up front (`flow-planning`), so cheaper constrained executors can implement without redesigning. You approve the plan before any production code is written.
- **Gates bound to bytes.** An approval is recorded against the artifact's hash. Editing an approved contract or plan makes the approval stale until you approve the new text.
- **Evidence over claims.** No "done" or "fixed" without fresh proof. Agent reports are claims; the controller checks them.
- **One acceptance review**, then you pick how to integrate: merge, pull request, or keep the branch (`flow-integrating`). Every push, PR or comment needs your explicit yes.
- **Safety.** Pre-existing changes are yours; no reset, stash or discard. Credentials are never printed.

Working state (contracts, plans, checkpoints, approvals) lives in the project's `.flow/` directory, which the always-on `flow-artifacts` rule hides from git through `.git/info/exclude`. Only decision records under `docs/decisions/` and requested audit reports are committed.

## What a session looks like

One substantial change, from request to integration. Say a health check in your tool reports SKIP when the real cause is a broken setup:

1. **Request.** You ask the agent to fix the misleading SKIP.
2. **The one real choice.** The agent reads the code, explains the bug, and asks the only question it cannot answer from the code: should that case be a FAIL or stay a SKIP? You choose FAIL.
3. **Contract.** The agent writes a short WHAT/WHY contract to `.flow/contracts/<slug>.md`: the outcome, the facts, what is in and out of scope, the settled decisions and how acceptance is checked. It shows the contract in chat and asks whether you approve it.
4. **Approval.** You say yes. The agent records the approval with `flow_gate`, bound to the contract file's hash. If anyone edits the contract later, the approval is stale until you approve the new text.
5. **Plan, or not.** Here the contract already settles the behavior, so the route is `Plan: NONE`. Bigger work gets an execution-grade plan written by the `flow-planner` agent, shown to you, and a second approval before any code.
6. **Execution.** Writer subagents implement test-first: a failing test for each behavior, then the code that makes it pass. The main agent checks their diffs and proof rather than trusting their reports.
7. **Acceptance.** One `flow-acceptance-reviewer` pass checks the change against the contract.
8. **Integration.** The agent shows the evidence and the exact pull request text, and asks before pushing. You choose how to integrate: merge, open a pull request, or keep the branch.

You decide at steps 2, 4 and 8 (and approve the plan when there is one). Everything else the agent does on its own, and tells you what comes next.

## Install

Clone the repository. The OMP and OpenCode installers link into the clone, so keep it where it is.

```sh
git clone https://github.com/fiatcode-gh/flow-skills.git
cd flow-skills
```

Both installers follow the same rules: they create symlinks, replace only a missing file or a link they own (into this checkout, or into its previous name `omp-stack`), refuse anything else and name it, and never write credentials. `verify` checks the links; `doctor` checks the harness sees what it should.

### OMP

```sh
./omp/bin/flow-omp install
./omp/bin/flow-omp doctor
omp --profile anthropic        # or openai-codex, commandcode
```

The installer links `AGENTS.md`, `rules/`, `agents/`, `skills/`, `extensions/`, `lib/` and the profile's `config.yml` into each of the three profiles, and `keybindings.yml` into the shared agent directory. `omp/profiles/<name>/config.yml` is the source of truth: OMP's settings screen writes through the link into this repository, so review those edits with `git diff`. An existing real `config.yml` is replaced only when it is identical to the template; otherwise the installer warns and exits non-zero. See `docs/MIGRATION.md`.

**MCP servers.** The installer never touches `mcp.json`, because it holds credentials. Copy the template into each profile and add the Context7 key:

```sh
for p in openai-codex anthropic commandcode; do
  cp omp/mcp.example.json "$(omp --profile "$p" config path)/mcp.json"
done
```

The template configures [`codebase-memory-mcp`](https://github.com/DeusData/codebase-memory-mcp) (code graph lookups) and Context7 (library docs). Without them the doctrine falls back to `grep`, `glob` and upstream documentation. The author configures ClickUp per work repository as an untracked `<repo>/.omp/mcp.json`; OMP reads project MCP config only from the launch directory.

### Claude Code

```sh
claude plugin marketplace add fiatcode-gh/flow-skills
claude plugin install fiatcode@flow-skills
```

The plugin namespaces its parts: skills are `fiatcode:<skill>`, agents `fiatcode:<agent>`. A session-start hook prints a short core and points at the full instructions. The plugin ships a hooks module that enforces the Flow gates: approvals go through the plugin's own dialog, and a dispatch without a current approval is refused. It needs Claude Code 2.1.299 or later, and cloud sessions install the plugin from the environment's setup script; see `docs/EXTERNAL-INTEROP.md`.

### OpenCode

```sh
./opencode/bin/flow-opencode install
opencode reload
./opencode/bin/flow-opencode doctor
```

The installer links `AGENTS.md`, `skills/`, `agents/`, `profiles/` and the base `opencode.json` into `~/.config/opencode/`, and `plugins/flow-guard/` into `~/.config/opencode/plugins/`. The `flow-guard` plugin enforces the Flow gates (it records approvals through `flow_gate` and refuses a gated subagent without them) and refuses tool calls that would print a secret file; `doctor` reports whether it is active. It needs OpenCode 2.2.5 or later; what it does not catch is listed in `docs/OPENCODE-COMPATIBILITY.md`. Beside the plugin, the base config adds approval prompts for publication commands (`git push`, `gh pr create`, ...).

Models are chosen per provider. Each `opencode/profiles/<provider>.json` maps every Flow agent to a model and an effort, following the OMP profile of the same role; add a provider by adding one file. Launch with a profile:

```sh
./opencode/bin/flow-opencode run claude-agent   # or: run commandcode, run opencode
```

The `commandcode` profile uses OpenCode's built-in Command Code provider. Add the key once, in OpenCode: `/connect`, pick Command Code (or, under Other, provider id `commandcode`) and paste it. The key stays in OpenCode's own credential store; no profile or repository file holds it.

A profile launch runs a private server (`--standalone`) because the background service ignores per-launch config; plain `opencode` uses the base config. OpenCode also scans other tools' global skill folders; the installer reports any same-named copy there so it does not drift. Details: `docs/decisions/opencode-port.md`.

### Open WebUI

Import `open-webui/system-prompt.md` as a model's system prompt and the other files as prompts. Open WebUI has no shell or checkout, so it covers design, planning, review and handoff to a local harness (`flow-handoff.md`), not execution. See `docs/EXTERNAL-INTEROP.md`.

### Windows

Prerequisites: Windows 10 or 11, [Git for Windows](https://git-scm.com/download/win), PowerShell 7.2 or newer, and Developer Mode on (Settings > System > For developers) or an elevated shell. Allow local scripts once: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

```powershell
git clone https://github.com/fiatcode-gh/flow-skills.git
cd flow-skills

.\omp\bin\flow-omp.ps1 install            # OMP
.\omp\bin\flow-omp.ps1 doctor

claude plugin marketplace add fiatcode-gh/flow-skills   # Claude Code, same commands as above
claude plugin install fiatcode@flow-skills

.\opencode\bin\flow-opencode.ps1 install  # OpenCode
opencode reload
.\opencode\bin\flow-opencode.ps1 doctor
.\opencode\bin\flow-opencode.ps1 run claude-agent
```

The launchers create real symlinks, and stop before any change when Windows does not allow it. As on other systems, they link into the clone, so keep it where it is.

To run the launchers from anywhere, link them into a folder on `PATH` and add the `oc` shortcut to your PowerShell profile. Run this from the clone, or set `$repo` to its path:

```powershell
$bin = "$HOME\.local\bin"; New-Item -ItemType Directory -Force $bin | Out-Null
$repo = (Get-Location).Path   # the flow-skills clone
[IO.File]::CreateSymbolicLink("$bin\flow-omp.ps1", "$repo\omp\bin\flow-omp.ps1")
[IO.File]::CreateSymbolicLink("$bin\flow-opencode.ps1", "$repo\opencode\bin\flow-opencode.ps1")
# add $bin to your user PATH, then put this in $PROFILE:
function oc { flow-opencode run @args }
```

Windows support is CI-tested on `windows-latest` and not yet field-tested on a real machine. Shell rules, paths and what CI covers: `docs/WINDOWS.md`.

## Adapting it

### What is personal

Most of the repository is the general Flow workflow. These parts are the author's own, and you can keep, change or drop them:

- **Standing instructions.** `omp/AGENTS.md` mixes the Flow workflow with the author's taste: engineering principles, Conventional Commits, a plain-English writing style, `uv` for Python, the shell check, and the Context7 and `codebase-memory` lookups. Edit them to yours. The ports carry the same text in `opencode/AGENTS.md` and `claude-code/hooks/flow-context.md`.
- **Weft.** The `weft-worklog`, `weft-memory` and `weft-maintenance` skills, the "Weft graph" section of the instructions and the OMP AI memory extension (`omp/extensions/ai-memory.ts`) work with the author's Weft knowledge graph, a personal notes graph found through the `WEFT_GRAPH` environment variable. With `WEFT_GRAPH` unset they stay idle: the instructions run the worklog steps only when the graph exists, and the extension adds nothing. Leaving them in place is the simplest choice. Removing them touches more than the three skill folders in `omp/` and each port: the Weft sections of the instructions, the Claude Code session-start hook, the PR review reference in `flow-review`, the AI memory extension and its library, their tests and the lines in `tests/run.sh` that run them, and the skill set and Weft checks in `tests/validate.py`. Start from `git grep -n -i -e weft -e ai-memory -e fiat-codex` (the old `ai-stack` path warnings it also finds can stay), then run the suite.
- **Open WebUI prompts.** `open-webui/system-prompt.md` points the model at the author's notes repository (`fiatcode-gh/fiat-codex`), and `open-webui/flow-handoff.md` assumes the author's GitHub owner (`fiatcode-gh`), checkout layout (`~/Development/Projects/fiatcode-gh/<repo>`) and the fish shell for its local commands. Change them to yours, or drop the notes lines, before importing.
- **Providers and models.** The OMP profiles (`omp/profiles/<name>/config.yml`) and the OpenCode profiles (`opencode/profiles/<provider>.json`) follow the author's subscriptions. Skills and agents name roles, never models, so changing a model touches only these files and the expected models `tests/validate.py` pins for them. The OMP installers list their profiles in `PROFILES` in `omp/bin/flow-omp` and `omp/bin/flow-omp.ps1`. `docs/MODEL-ROUTING.md` gives the reasons for each choice.
- **ClickUp.** The author's work tracker. The safety rule names ClickUp writes among the actions that need your yes; if you do not use ClickUp, that line does nothing.
- **The `fiatcode` name.** The Claude Code plugin and the marketplace owner use the author's persona name. Keeping it is simplest. The plugin name is also part of the approval tool's id, `mcp__fiatcode__flow_gate`, which the hooks module and the tests spell out; a rename that misses it leaves approvals unrecorded. To rename, go through every match of `git grep -n fiatcode -- claude-code .claude-plugin tests` (some are the repository URL, not the plugin name), then update the docs that `git grep -n -e 'fiatcode@' -e 'fiatcode:' -e mcp__fiatcode -- README.md docs WINDOWS-CHECKS.md` finds, then run the suite.

### Fork and change

OMP is the source, and the ports follow it. Fork the repository, change doctrine in `omp/` first, then carry the change into each port in the same commit. `docs/EXTERNAL-INTEROP.md` maps each OMP mechanic to its port equivalent. Then run the suite:

```sh
sh tests/run.sh
```

It checks, among other things, that each port contains no other harness's mechanics or model ids and that verbatim copies have not drifted, so it catches a shared file you forgot to carry into a port. [Maintaining](#maintaining) lists what else it covers.

### Port to another harness

A port translates harness mechanics only: how skills load, how subagents are dispatched, how an approval is recorded and enforced, how risky tool calls are stopped. Flow's rules stay as they are. Read `docs/ARCHITECTURE.md` for how the parts fit, and `docs/EXTERNAL-INTEROP.md` for how each existing port maps OMP's mechanics. Add the port as a directory beside the others, and give it checks in `tests/validate.py` as the existing ports have.

## Reference

### Skills

| Skill | Use |
|---|---|
| `flow-design` | Agree the WHAT/WHY contract before substantial work |
| `flow-planning` | Write the execution-grade plan |
| `flow-execution` | Route plan tasks to executors, verify, run acceptance |
| `flow-tdd` | Behavior-first Red/Green/Refactor |
| `flow-debugging` | Root cause before any fix |
| `flow-review` | Local change, PR reviewer, PR author feedback, codebase audit |
| `flow-integrating` | Final evidence and the user's integration choice |
| `flow-external-session` | External worktrees and planning handoffs |
| `ui-design` | Interface design |
| `weft-worklog`, `weft-memory`, `weft-maintenance` | The author's Weft knowledge graph (`WEFT_GRAPH`) |

Agents: `flow-planner`, `flow-plan-executor`, `flow-implementer`, `flow-acceptance-reviewer`, the TTC, craft and (outside OMP) COR lens reviewers, and three audit agents. Skills and agents name roles, never concrete models; each harness's setup maps roles to models.

### Layout

```text
omp/                          OMP: the canonical doctrine and its setup
  AGENTS.md                   always-on user instructions
  rules/                      always-apply invariants (flow-safety, flow-evidence, flow-artifacts)
  agents/  skills/            task agents and skills
  extensions/  lib/           OMP extensions (flow_gate, evidence guard, credentials guard, AI memory) and support code
  profiles/<name>/config.yml  per-provider model roles and bash approval prompts
  keybindings.yml  TITLE_SYSTEM.md  mcp.example.json
  bin/flow-omp                install / verify / doctor
  bin/flow-omp.ps1            the same for Windows (PowerShell 7)
  bin/flow-sessions           list and render OMP sessions for field-trial audits
claude-code/                  Claude Code plugin: skills, agents, session-start hook, hooks module
opencode/                     OpenCode port: AGENTS.md, skills, agents, base config,
                              plugins/flow-guard, profiles/<provider>.json,
                              bin/flow-opencode, bin/flow-opencode.ps1
open-webui/                   system prompt and design/planning/review/handoff prompts
.claude-plugin/marketplace.json   makes this repository a Claude Code marketplace
VERSION  CHANGELOG.md         the repository's one SemVer version and its release notes
LICENSE                       MIT
docs/                         architecture, principles, interop, model routing, field trials, Windows
docs/decisions/               decision records
tests/                        validation suite; entry point tests/run.sh
```

### Model routing

OMP profiles map Flow roles (`default`, `smol`, `execute`, `task`, `plan`, `slow`, `critical`, ...) to models:

- **anthropic:** Opus 5.5 for Main, planning, execution, implementation, review, acceptance and critical escalation; Sonnet 5.5 for leaves, commits, titles and vision.
- **openai-codex:** GPT-6 Luna for Main, leaves and execution; GPT-6.1 Sol for implementation, planning and review.
- **commandcode:** DeepSeek V4.1 Flash for every role: `low` for leaves, commits and titles, `high` for Main, planning, implementation, execution, review, acceptance and critical escalation.

The Claude Code port sets `model` and `effort` in agent frontmatter (`opus` for every Flow agent); OpenCode sets `model` and `variant` in its profile files, with the same role-to-model map as OMP's `anthropic` and `commandcode` profiles. Reasons, effort levels and the per-port table: `docs/MODEL-ROUTING.md`. Assumptions about OMP itself: `docs/OMP-COMPATIBILITY.md`.

### Versioning

The whole repository has one SemVer version, `MAJOR.MINOR.PATCH`, set in `VERSION`. Three places show it and must match: the Claude Code plugin (`claude-code/.claude-plugin/plugin.json`), the first line of `open-webui/system-prompt.md` (`Flow <version>`), and the first line of both `doctor` commands (`flow-skills <version>`, read from `VERSION`). `tests/validate.py` fails when any of them differ. The marketplace entry sets no version.

- **Major:** you must act (reinstall, relink or re-import) or the approval gates changed.
- **Minor:** a new or changed rule, skill or agent behavior.
- **Patch:** wording, docs or tests with no behavior change.

To release: bump `VERSION`, update `plugin.json` and the Open WebUI line to match, add the entry to `CHANGELOG.md`, commit, push `main`, tag `vX.Y.Z`, push the tag and publish the GitHub release with the changelog entry as its notes. The Claude Code plugin only updates when its `version` changes, so a release is what delivers a change to it.

### Maintaining

- **OMP is the source.** Change doctrine in `omp/` first, then carry the change into each port in the same commit. A port translates harness mechanics only; a rule that exists in one port but not in OMP is a bug. `docs/EXTERNAL-INTEROP.md` maps each OMP mechanic to its port equivalent.
- **Run the suite** before committing:

  ```sh
  sh tests/run.sh
  ```

  On Windows: `pwsh tests/run.ps1`. It checks skill, agent and rule frontmatter and role references; that each port contains no other harness's mechanics or model ids; that verbatim copies have not drifted; per-file byte caps (`tests/doctrine-budget.json`, raised only deliberately); both installers' safety; the PowerShell launchers (under `pwsh`, on any OS); the OMP extensions (under Node and Bun); the bash approval patterns against OMP's matcher; and the `.flow/` exclude guard. CI runs the same suite on pull requests and pushes to `main`, and a Windows job.
- **Decisions** are recorded in `docs/decisions/<slug>.md`: what was chosen, why, what was rejected. Field-trial results per skill are in `docs/FIELD-TRIALS.md`; how to run an audit is in `docs/FIELD-TRIAL-AUDIT.md`.
- **Writing doctrine:** `docs/PRINCIPLES.md`. **How the parts fit:** `docs/ARCHITECTURE.md`.

Commits follow Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`).

## License

MIT. See `LICENSE`. You may use, change and port all of it; copies must keep the copyright and license notice.
