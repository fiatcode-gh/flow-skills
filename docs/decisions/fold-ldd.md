# Fold LDD into the normal Flow

Work: `f6b464e` (`docs(flow): fold LDD into the normal Flow`), 2026-09-30.

## Decisions

- **The `flow-ldd` skill is removed.** Most of its loop restated `flow-design`, `flow-planning` and `flow-execution`. The ceremony it added cost more than it returned: mode bootstrap, a second artifact tree, `<epic>/<unit>` scopes, and a second copy of the intake rules.
- **Decision records replace the ledger.** At integration, the governing contract is distilled into a tracked `docs/decisions/<slug>.md`. The record keeps only what the code and tests cannot show. The contract and plan are still deleted, because once the work ships their wording is stale intent, and recon would read stale intent as truth.
- **Records are tracked in the repository.** They survive a fresh clone, teammates can see them, and normal recon finds them. Weft keeps backlog and human-level notes.
- **The commit or PR carries a short note** (what the change is for, what it leaves out) instead of the full contract. Session transcripts keep the approved text as evidence.
- **Recon checks records against code.** A record that current code contradicts is corrected or deleted in the same unit.
- **Multi-unit work uses one parent contract.** It is approved like any contract, and no unit starts before it is approved. A material change to it reopens approval of every unit not yet integrated. The last unit to integrate distills it; its scope and contract are removed only after that unit's integration is confirmed.
- **Main may make tiny cohesive edits in all work, multi-unit included.** The existing Main-direct lane already keeps Main off substantial or semantic work.
- **`Plan: NONE` with a `kind=implementation` approval is general.** It covers any approved contract whose work needs no separate plan, for example a debugged fix sent to `flow-implementer`.

## Rejected alternatives

- Keep `flow-ldd` until the active epics end: two doctrines in parallel for weeks.
- Migrate every ledger now: speculative, judgment-heavy work in three repositories, most of which may never be touched again.
- Keep full contracts as history: they go stale and mislead recon.
- Keep records in `.flow/decisions/` (lost on a fresh clone) or on the Weft page (only one person sees it, and recon must be told to look there).
- Distill the parent contract a little with each unit: more writes for little gain.
- Ban all Main edits in multi-unit work, or everywhere: the cost falls on tiny corrections.

## Traps

- Removing `kind=implementation` / `Plan: NONE` looks like LDD cleanup, but it is the only way to dispatch a writer without a plan. The guard requires Scope, Contract and Plan for every `flow-plan-executor` and `flow-implementer` dispatch.
- Parent cleanup belongs after confirmed integration (`flow-integrating` section 5), not in the record step. Otherwise a kept or rejected integration leaves units without their parent.
- Frozen ledgers (`.flow/ldd/<epic>/`) are read-only. In-flight units there finish with their old `<epic>/<unit>` scope and write no decision record.
- Planning-handoff bundles are schema v2 now. A v1 bundle with `kind`/`epic` is rejected; external generators must be updated.

## Open questions

- The rule that a parent change reopens its units is doctrine only. `flow_gate` unit approvals do not bind the parent's digest.
- "Last unit" means the last to be confirmed integrated. The text does not say so explicitly.
