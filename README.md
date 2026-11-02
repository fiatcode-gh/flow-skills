# flow-skills

Flow is fiatcode's engineering doctrine for coding agents: how an agent turns a request into an agreed contract, an execution-grade plan, verified code and a change the user chooses how to integrate. This repository holds Flow for four harnesses, one directory each, with each harness's setup next to its doctrine.

| Harness | Directory | Installs into | How |
|---|---|---|---|
| [OMP](https://github.com/can1357/oh-my-pi) (canonical) | `omp/` | `~/.omp/profiles/<profile>/agent/` | `omp/bin/flow-omp install` |
| Claude Code | `claude-code/` | Claude Code's plugin cache | `claude plugin install fiatcode@flow-skills` |
| OpenCode | `opencode/` | `~/.config/opencode/` | `opencode/bin/flow-opencode install` |
| Open WebUI | `open-webui/` | a model's system prompt and prompts | manual import |

Each harness installs from its own directory and keeps working when the others are removed from the machine.

## What Flow does

Flow adds engineering judgment and gates on top of each harness's own mechanics (subagents, plan mode, tools):

- **Contract first.** Substantial work starts with a short WHAT/WHY contract (`flow-design`). The user approves it in chat before planning starts.
- **Execution-grade plans.** A planner settles files, interfaces, tests and error handling up front (`flow-planning`), so cheaper constrained executors can implement without redesigning. The user approves the plan before any production code is written.
- **Gates bound to bytes.** An approval is recorded against the artifact's hash. Editing an approved contract or plan makes the approval stale until the user approves the new text.
- **Evidence over claims.** No "done" or "fixed" without fresh proof. Agent reports are claims; the controller checks them.
- **One acceptance review**, then the user picks how to integrate: merge, pull request, or keep the branch (`flow-integrating`). Every push, PR or comment needs the user's explicit yes.
- **Safety.** Pre-existing changes are the user's; no reset, stash or discard. Credentials are never printed.

Working state (contracts, plans, checkpoints, approvals) lives in the project's `.flow/` directory, which the always-on `flow-artifacts` rule hides from git through `.git/info/exclude`. Only decision records under `docs/decisions/` and requested audit reports are committed.

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
| `weft-worklog`, `weft-memory`, `weft-maintenance` | The user's Weft knowledge graph (`WEFT_GRAPH`) |
| `blog-post` | Blog write-ups (OMP only) |

Agents: `flow-planner`, `flow-plan-executor`, `flow-implementer`, `flow-acceptance-reviewer`, the TTC, craft and (outside OMP) COR lens reviewers, and three audit agents. Skills and agents name roles, never concrete models; each harness's setup maps roles to models.

## Layout

```text
omp/                          OMP: the canonical doctrine and its setup
  AGENTS.md                   always-on user instructions
  rules/                      always-apply invariants (flow-safety, flow-evidence, flow-artifacts)
  agents/  skills/            task agents and skills
  extensions/  lib/           OMP extensions (flow_gate, evidence guard, AI memory) and support code
  profiles/<name>/config.yml  per-provider model roles and bash approval prompts
  keybindings.yml  TITLE_SYSTEM.md  mcp.example.json
  bin/flow-omp                install / verify / doctor
  bin/flow-sessions           list and render OMP sessions for field-trial audits
claude-code/                  Claude Code plugin: skills, agents, session-start hook
opencode/                     OpenCode port: AGENTS.md, skills, agents, base config,
                              profiles/<provider>.json, bin/flow-opencode
open-webui/                   system prompt and design/planning/review/handoff prompts
.claude-plugin/marketplace.json   makes this repository a Claude Code marketplace
VERSION  CHANGELOG.md         the repository's one SemVer version and its release notes
docs/                         architecture, principles, interop, model routing, field trials
docs/decisions/               decision records
tests/                        validation suite; entry point tests/run.sh
```

## Install

Clone the repository; the OMP and OpenCode installers link into the clone, so keep it where it is.

```sh
git clone git@github.com:fiatcode-gh/flow-skills.git ~/Development/Projects/fiatcode-gh/flow-skills
cd ~/Development/Projects/fiatcode-gh/flow-skills
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

The template configures [`codebase-memory-mcp`](https://github.com/DeusData/codebase-memory-mcp) (code graph lookups) and Context7 (library docs). Without them the doctrine falls back to `grep`, `glob` and upstream documentation. ClickUp is configured per work repository as an untracked `<repo>/.omp/mcp.json`; OMP reads project MCP config only from the launch directory.

### Claude Code

```sh
claude plugin marketplace add fiatcode-gh/flow-skills
claude plugin install fiatcode@flow-skills
```

The plugin namespaces its parts: skills are `fiatcode:<skill>`, agents `fiatcode:<agent>`. A session-start hook prints a short core and points at the full instructions. Approvals are recorded by two shell functions, `flow_approve` and `flow_check`. Cloud sessions install the plugin from the environment's setup script; see `docs/EXTERNAL-INTEROP.md`.

### OpenCode

```sh
./opencode/bin/flow-opencode install
opencode reload
./opencode/bin/flow-opencode doctor
```

The installer links `AGENTS.md`, `skills/`, `agents/`, `profiles/` and the base `opencode.json` into `~/.config/opencode/`. The base config only adds approval prompts for publication commands (`git push`, `gh pr create`, ...).

Models are chosen per provider. Each `opencode/profiles/<provider>.json` maps every Flow agent to a model and an effort, following the OMP profile of the same role; add a provider by adding one file. Launch with a profile:

```sh
./opencode/bin/flow-opencode run claude-agent   # or: run commandcode, run opencode
```

The `commandcode` profile uses OpenCode's built-in Command Code provider. Add the key once, in OpenCode: `/connect`, pick Command Code (or, under Other, provider id `commandcode`) and paste it. The key stays in OpenCode's own credential store; no profile or repository file holds it.

A profile launch runs a private server (`--standalone`) because the background service ignores per-launch config; plain `opencode` uses the base config. OpenCode also scans other tools' global skill folders; the installer reports any same-named copy there so it does not drift. Details: `docs/decisions/opencode-port.md`.

### Open WebUI

Import `open-webui/system-prompt.md` as a model's system prompt and the other files as prompts. Open WebUI has no shell or checkout, so it covers design, planning, review and handoff to a local harness (`flow-handoff.md`), not execution. See `docs/EXTERNAL-INTEROP.md`.

## Model routing

OMP profiles map Flow roles (`default`, `smol`, `execute`, `task`, `plan`, `slow`, `critical`, ...) to models:

- **anthropic:** Opus 5.5 for Main and acceptance, Sonnet 5.5 for execution, implementation and leaves, Haiku 5.5 for titles, Fable 5.1 for planning and critical escalation.
- **openai-codex:** GPT-6 Luna for Main, leaves and execution; GPT-6.1 Sol for implementation, planning and review.
- **commandcode:** DeepSeek V4.1 Flash for Main, planning, implementation, execution and leaves; GLM-5.3 for acceptance.

The Claude Code port sets `model` and `effort` in agent frontmatter (`opus`, `sonnet`, and `claude-fable-5-1` for the planner); OpenCode sets `model` and `variant` in its profile files, with the same role-to-model map as OMP's `anthropic` and `commandcode` profiles. Reasons, effort levels and the per-port table: `docs/MODEL-ROUTING.md`. Assumptions about OMP itself: `docs/OMP-COMPATIBILITY.md`.

## Versioning

The whole repository has one SemVer version, `MAJOR.MINOR.PATCH`, set in `VERSION`. Three places show it and must match: the Claude Code plugin (`claude-code/.claude-plugin/plugin.json`), the first line of `open-webui/system-prompt.md` (`Flow <version>`), and the first line of both `doctor` commands (`flow-skills <version>`, read from `VERSION`). `tests/validate.py` fails when any of them differ. The marketplace entry sets no version.

- **Major:** you must act (reinstall, relink or re-import) or the approval gates changed.
- **Minor:** a new or changed rule, skill or agent behavior.
- **Patch:** wording, docs or tests with no behavior change.

To release: bump `VERSION`, update `plugin.json` and the Open WebUI line to match, add the entry to `CHANGELOG.md`, commit, push `main`, tag `vX.Y.Z`, push the tag and publish the GitHub release with the changelog entry as its notes. The Claude Code plugin only updates when its `version` changes, so a release is what delivers a change to it.

## Maintaining

- **OMP is the source.** Change doctrine in `omp/` first, then carry the change into each port in the same commit. A port translates harness mechanics only; a rule that exists in one port but not in OMP is a bug. `docs/EXTERNAL-INTEROP.md` maps each OMP mechanic to its port equivalent.
- **Run the suite** before committing:

  ```sh
  sh tests/run.sh
  ```

  It checks skill, agent and rule frontmatter and role references; that each port contains no other harness's mechanics or model ids; that verbatim copies have not drifted; per-file byte caps (`tests/doctrine-budget.json`, raised only deliberately); both installers' safety; the OMP extensions (under Node and Bun); the bash approval patterns against OMP's matcher; and the `.flow/` exclude guard. CI runs the same suite on pull requests and pushes to `main`.
- **Decisions** are recorded in `docs/decisions/<slug>.md`: what was chosen, why, what was rejected. Field-trial results per skill are in `docs/FIELD-TRIALS.md`; how to run an audit is in `docs/FIELD-TRIAL-AUDIT.md`.
- **Writing doctrine:** `docs/PRINCIPLES.md`. **How the parts fit:** `docs/ARCHITECTURE.md`.

Commits follow Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`).
