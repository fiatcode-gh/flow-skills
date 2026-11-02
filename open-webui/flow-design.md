---
name: flow-design
description: Settle what to build and why with the user, checked against the repository, before any plan.
---

# Flow design

Resolve and record the **what/why** before planning.

This skill does not plan HOW, write files or approve anything. It reads the repository only through GitHub MCP read tools.

## When to Use

- Use this skill before substantial work enters planning. The start can be a new request, an existing project, a brainstorm or an earlier handoff.
- Tiny or mechanical work may skip a separate contract artifact when its WHAT/WHY and acceptance boundary are already explicit. Examples: a typo, dependency bump, obvious one-file bug after root cause.
- Trigger phrases: "design", "should we", "how should <feature> work", or a change with open decisions.

## Prerequisites

- GitHub MCP read access to the repository (file contents, commits, code search, pull requests).
- When no repository exists yet: facts come only from the user and cited web sources, and the contract says so.

## Procedure

0. Pin the source.
   - Name the repository as `owner/name`.
   - Read the latest commit SHA of the branch you work from.
   - Read every file at that full 40-character SHA.
   - Put the SHA in the contract header.
1. Explore the relevant project reality first.
   - Read the instructions (README, AGENTS.md, CONTRIBUTING and similar), the current implementation, tests, recent commits and the `docs/decisions/` records for the area.
   - Check each record against current code. Never trust a record you have not checked.
   - When the code contradicts a record, list the correction under `## Proposed decision-record corrections`. Local OMP checks and applies it.
2. State your reading of the user's intended outcome, important constraints, acceptance boundary and any material forks.
   - Separate facts from assumptions.
   - Do this step even when the input is a detailed brainstorm or earlier handoff. Imported detail is evidence, not a substitute for the user's check.
3. Clarify the intention with the user.
   - Ask only questions whose answers materially change behavior, boundaries, architecture, acceptance criteria or scope.
   - Do not manufacture questions when the intended answer is already explicit.
4. Offer alternatives only when genuinely viable alternatives exist. Name your recommendation and trade-offs.
5. Converge on the smallest design that satisfies the requirement. Cover only relevant surfaces: components/boundaries, data/control flow, errors, compatibility and test strategy.
6. Consolidate the settled result into the completed contract, in the shape given under `## Output`.
   - It must state, as applicable: intended outcome; in-scope/out-of-scope behavior; material boundaries/interfaces; constraints and invariants; acceptance criteria/proof expectations; settled decisions; intentionally deferred non-goals.
   - Keep consequential implementation HOW out of the contract.
7. Present the completed contract and ask the user to agree its WHAT/WHY boundary.
   - Answers to clarification questions do not themselves approve the resulting completed or materially amended contract.
   - Agreement here is a proposal. Local OMP runs its own approval.
8. After agreement, offer `flow-planning` when consequential HOW decisions remain, or `flow-handoff` to package the contract.
   - A material change to WHAT, boundary or acceptance reopens agreement.

## Earlier decisions

- Applies when the user pastes an earlier contract or handoff.
- Keep still-valid settled decisions. Do not re-run brainstorming by ritual.
- Reconcile them with the repository at the pinned SHA.
- Reopen only decisions that are stale, contradicted, incomplete or not agreed by the user.

## Multi-unit work

- Propose a split into units when the scope has parts that could ship separately. Example: a search rework whose indexer, API and UI can each be released alone. The user decides the split.
- After the user agrees, write one parent contract that lists the units and the decisions they share. Then write one contract per unit that names the parent.
- A material change to the parent reopens agreement of every unit contract.
- In the bundle the parent is `CONTRACT.md`, each unit is `proposed-units/<unit-slug>.md`, and the handoff slug is the parent slug.

## Output

The contract, as a Markdown skeleton. `flow-handoff` turns this content into the bundle's `CONTRACT.md`.

````text
# Contract: <title>
Source: `owner/name` at `<full SHA>` (or: no repository read)
Status: proposal from Open WebUI; local OMP approves.
## Intended outcome
## Facts this contract rests on      (each cites path:line at the SHA, or a URL)
## Assumptions
## In scope
## Out of scope
## Boundaries and interfaces
## Constraints and invariants
## Acceptance
## Settled decisions                  (each with rejected alternatives and why)
## Deferred non-goals
## Open questions                     (empty when the design is settled)
## Proposed decision-record corrections   (only when step 1 found one)
````

## Pitfalls

- Write no files and nothing to GitHub.
- Never say the contract is approved.
- Keep implementation HOW out of the contract.
- Do not manufacture questions.
- Do not trust an unchecked record.
- The local checkout's uncommitted state is not visible: say so rather than assume it.

## Verification

Self-check before presenting:

- Every fact cites `path:line` at the SHA, or a URL.
- Every unobserved claim is marked `[INFERENCE]`.
- Every question would change behavior, scope, architecture or acceptance.
- No HOW in the contract.
- The Status line says proposal.
