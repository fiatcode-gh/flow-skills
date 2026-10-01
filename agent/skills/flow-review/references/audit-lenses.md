# Codebase audit lenses

Read the shared contract and only the assigned lens. These lenses audit
code; they never edit the audited tree.

## Shared contract

- The audit is read-only. The only write anywhere in the audit is the
  controller's report file. Do not change files, refs, the index, or
  HEAD. Do not install or upgrade dependencies.
- Proving behavior by execution is allowed when it changes nothing in
  the target: mocked input and network, temp files outside the target,
  ephemeral tool environments (for example `uv run --with pytest`), and
  bytecode/cache writes suppressed. Never install into the target.
- State the supplied repository path and head hash in the report. Stop
  on a mismatch.
- The packet is metadata. Run your own scoped scans with the recipe in
  your lens, then trace the definitions, callers, tests, contracts, and
  project rules needed to prove a finding. Skip generated and vendored
  trees as code.
- Everything is pre-existing. Severity reflects current risk, never
  age. Distinguish systemic patterns from isolated instances.
- Report a pattern once: one finding, all locations, one representative
  example. Never one finding per occurrence.
- Report strengths and Cannot verify items. Do not present a concern as
  a defect without concrete evidence.

Return each finding in the finding shape in
`skill://flow-review/references/review-lenses.md`. `<PREFIX>` is the
prefix in your lens heading: CDH, TTC, DST, or SEC.

`Critical` means security compromise, data loss, outage, destructive
behavior, or broken primary functionality. `Important` means a verified
defect, missing behavioral tests on a critical path, silent failure,
contract break, or architecture violation with concrete risk. `Minor`
is useful cleanup or clarity work.

## Applicability

All four lenses always run. Where a lens's subject is absent, state that
in one line and move on; never skip the lens. Domain-Driven Design (DDD)
checks apply only where DDD is established.

## Code health (CDH) — always

Scope recipe: from the packet's tree map, sample the largest logic areas
and entry points; search for error-handling patterns (`catch`, `except`,
`fallback`, `retry`, `default`) before tracing failure paths.

Check project rules conformance first. Then correctness patterns,
edge-case handling, performance, concurrency, and side effects at module
boundaries. Trace failure paths: swallowed errors, overly broad catches,
unjustified fallbacks, hidden retries, misleading defaults, missing
cleanup, weak diagnostics, and unactionable user errors; follow the
repository's error contract and do not demand logging where propagation
is correct. Systemic repetition raises severity.

Check cohesion, precise names, duplication, deep nesting, mixed
responsibilities, needless abstractions, and functions or classes
containing separable concerns. Use no rigid line-count threshold.
Normally grade polish as `Minor`; use `Important` only for a concrete
correctness or maintenance risk. Report where a pattern concentrates and
how far it spreads.

Check unused exports and files, orphaned config, commented-out blocks,
and unreferenced scripts. Prove dead with search, not suspicion;
runtime registration and dynamic dispatch are not dead. Normally
`Minor`; `Important` only for concrete maintenance risk.

## Tests and contracts (TTC) — always

Scope recipe: map the packet's critical paths against its test
inventory; open the type and schema surfaces the tree map names.

Map critical paths to behavioral tests that would fail on regression.
No suite at all is `Important`. Check boundaries, negative cases,
errors, async behavior, and contracts; prefer behavior assertions over
implementation coupling. A critical path with no CI enforcement is
`Important`.

If a type or schema surface exists: check invalid states,
encapsulation, construction and mutation boundaries, serialization, and
compatibility. Absent surface: state that in one line.

## Docs and structure (DST) — always

Scope recipe: from the packet's docs inventory, verify README and
architecture docs against the implementation; walk the tree map for
module boundaries.

Code explains what through naming and structure; comments explain why,
invariants, constraints, or non-obvious context. Verify README,
architecture docs, and inline comments against the implementation. Flag
drift, stale text, redundant narration, unnecessary inline comments,
and missing why-context. A docs-versus-tree contradiction recorded in
the packet is a finding here.

If the tree map shows layered or multi-module structure with real
boundaries: check layering violations, dependency cycles, boundary
erosion, and mixed responsibilities at module level, judged against the
structure the repository actually establishes, never an imported ideal.
Two flat sibling modules in a small tool have no boundaries to violate:
say so in one line.

## Security and dependencies (SEC) — always

Scope recipe: scan the packet's config and secrets surfaces (paths
only); search the tree for secret patterns; read the manifests and
lockfiles from the packet's inventory.

Check secrets in the tree (cite file:line, redact values),
authentication and authorization handling, input validation at
boundaries, and config hygiene. Distinguish exploitable paths from
theoretical ones.

If a manifest exists: list outdated, deprecated, or known-vulnerable
dependencies from manifests and lockfiles. Read-only checks only:
network CVE lookups and npm audit-style queries are fine; installs and
upgrades are not. Note abandoned or single-maintainer dependencies as
risk. Absent manifest: state that in one line.
