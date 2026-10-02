---
name: flow-handoff
description: Package an agreed design or plan as a bundle local OMP can validate, and say where to save it.
---

# Flow handoff

Write a schema v2 handoff bundle in the chat reply and tell the user where to save it.
`FLOW-HANDOFF.json` is the entry point; `HANDOFF.md` holds the human context.
This skill writes no files, validates nothing and carries no authorization. The bundle is a proposal that local OMP checks before use.

## When to Use

- At the end of `flow-design` or `flow-planning`.
- When the user says "hand this to local OMP", "resume this locally" or similar.
- For an explicit continuation, a standalone Markdown design or plan is not a complete handoff. Emit the manifest plus every declared artifact.

## Prerequisites

- The agreed contract and/or plan from this chat.
- The `owner/name` and full commit SHA read, when a repository was read.

## Procedure

1. Repository and revision.
   - `repository` is the `owner/name` read through GitHub MCP.
   - `observed_ref` is the full 40-character SHA of the commit the files were read at. Never shorten it.
   - When more than one commit was read, use the one the design or plan rests on, and list the others under source facts in `HANDOFF.md`.
   - When the work spans repositories, ask the user which one the bundle targets: one bundle per repository.
   - When no repository was read: `repository` is the `owner/name` the user names for the planned repository, else `unknown`, and `observed_ref` is `unknown`.
   - Use `unknown` only when no revision was truly observable.
2. Slug.
   - Propose one slug: lowercase words joined by hyphens, matching `^[a-z0-9]+(-[a-z0-9]+)*$`, usually two to five words.
   - Multi-unit work uses the parent slug.
   - Say that local OMP keeps this slug as the Flow scope.
3. Statuses, honest: pick one value per field from `## Allowed values`.
4. Artifacts.
   - `HANDOFF.md` always.
   - `CONTRACT.md` when `flow-design` ran.
   - `IMPLEMENTATION-PLAN.md` when `flow-planning` ran.
   - `plan-tasks/NN-<task>.md` for each task brief.
   - `proposed-units/<unit-slug>.md` for each unit contract.
   - Every path is relative, has no `..`, appears once and is declared in `artifacts`. Nothing else is printed as a bundle file.
   - No copy/paste kickoff prompt goes inside the bundle.
5. Write the reply in the order given in `## Output`.

## Manifest

```json
{
  "flow_handoff": 2,
  "source": "open-webui",
  "repository": "owner/name",
  "observed_ref": "<full 40-character commit SHA, or unknown>",
  "design_status": "<one design_status value>",
  "implementation_strategy": "<one implementation_strategy value>",
  "authorization": "not-carried",
  "artifacts": ["HANDOFF.md", "CONTRACT.md", "IMPLEMENTATION-PLAN.md", "plan-tasks/01-<task>.md"]
}
```

List only the artifacts you print. Never add a field.
`settled` for `implementation_strategy` is this chat's own judgment, not proof that the plan is execution-grade.

## Allowed values

- `design_status`: `settled`, `partial`, `unresolved`, `not_applicable`
  - `settled`: the user agreed the contract in this chat and no material question is open.
  - `partial`: some decisions are agreed; the open ones are listed in `HANDOFF.md`.
  - `unresolved`: material design questions are open or not agreed.
  - `not_applicable`: the work needs no WHAT/WHY decision.
- `implementation_strategy`: `settled`, `partial`, `unresolved`, `not_needed`
  - `settled`: `flow-planning` ran and its plan quality gate passed in this chat.
  - `partial`: a plan exists with open decisions, listed in `HANDOFF.md`.
  - `unresolved`: no plan was made, or planning stopped on a question.
  - `not_needed`: the change is small and obvious enough to need no plan.
- `flow_handoff` is exactly `2`; `authorization` is exactly `not-carried`.

## HANDOFF.md

Use this skeleton. The save location is chat text only: it goes into no bundle file except as the `Next local step` hint.

````text
# Handoff: <title>
Slug: `<slug>`. Local OMP keeps it as the Flow scope.
Repository: `owner/name` at `<full SHA>` (or: no repository read)
This bundle is a proposal. It carries no approval or authorization.
## Goal and scope
## Source facts            (path:line at the SHA or URL; then what was not observable: the local checkout, test runs, unread files)
## Agreed decisions
## Assumptions
## Implementation strategy (when one was developed; else "none")
## Verification strategy and risks   (expected test results are predictions)
## Open questions
## Local revalidation checklist
## Next local step         (plain words, for example: run planning-handoff intake on .flow/handoffs/<slug>/)
````

## Save location

Pick exactly one case. Compare the owner with `fiatcode-gh` case-insensitively. Fill the placeholders.

Case A, repository owner is `fiatcode-gh`:

```text
Save these files in `~/Development/Projects/fiatcode-gh/<repo>/.flow/handoffs/<slug>/`, each at the path on its label.
If that checkout is a fresh clone, first hide `.flow/` from git: run the exclude command below in fish from `~/Development/Projects/fiatcode-gh/<repo>`.
Then validate the bundle with the validate command below, with `<bundle-dir>` set to `~/Development/Projects/fiatcode-gh/<repo>/.flow/handoffs/<slug>/`. This chat has not validated it.
```

Case B, any other owner:

```text
Save these files in your local checkout of `owner/name`, at `.flow/handoffs/<slug>/` inside the repository, each at the path on its label.
If that checkout is a fresh clone, first hide `.flow/` from git: run the exclude command below in fish from the checkout root.
Then validate the bundle with the validate command below, run from the checkout root, with `<bundle-dir>` set to `.flow/handoffs/<slug>/`. This chat has not validated it.
```

Case C, no GitHub repository read:

```text
No GitHub repository was read, so there is no repository path. Save these files anywhere, in one directory, each at the path on its label.
Once the repository exists, move that directory to `.flow/handoffs/<slug>/` in its checkout.
Validate the bundle with the validate command below, with `<bundle-dir>` set to that directory. This chat has not validated it.
```

Cases A and B print the exclude command after their text. Case C does not. All three print the validate command.

## Exclude command

```fish
set -l ex (git rev-parse --path-format=absolute --git-common-dir)/info/exclude; and begin; grep -qxF /.flow/ $ex 2>/dev/null; or begin; test -s $ex; and test -n "$(tail -c 1 $ex)"; and echo >>$ex; mkdir -p (path dirname $ex); and printf '/.flow/\n' >>$ex; end; end
```

It adds `/.flow/` to the checkout's git exclude file only when missing, adds a newline first when the file lacks one, and needs fish 3.5 or later.

## Validate command

```fish
uv run python ~/Development/Projects/fiatcode-gh/omp-stack/agent/skills/flow-external-session/scripts/validate-planning-handoff.py <bundle-dir>
```

A pass prints `ok: planning handoff v2`. A failure is a stop to fix in the chat, not something to repair by hand.

## Output

1. `Slug: \`<slug>\``.
2. The save-location case text, then the exclude command (cases A and B), then the validate command, each with placeholders filled.
3. Each bundle file in this order: `FLOW-HANDOFF.json`, `HANDOFF.md`, then the remaining artifacts in `artifacts` order.
   - Put a label line `File: \`<path in bundle>\`` before each file's fence.
   - Use a ```json fence for the manifest.
   - Use a four-backtick ````markdown fence for every Markdown file, because plans and task briefs contain triple-backtick blocks.
4. Closing line: `Not validated here. Run the validate command before local OMP uses the bundle.`

## Pitfalls

- Never claim the bundle is valid, validated, approved or ready to execute.
- Never print a file that is not declared, or declare one that is not printed.
- Never shorten the SHA.
- Never invent a repository path for an owner other than `fiatcode-gh`.
- Never put the save location in `FLOW-HANDOFF.json`.

## Verification

Self-check before replying.

- Every required field is present once.
- The values come from `## Allowed values`.
- `artifacts` equals the printed files.
- Exactly one save-location case is used.
- The closing line is present.
