---
name: flow-evidence
description: Always-on evidence discipline for completion, delegated work and destructive decisions, with proof scoped to the layer that owns the claim.
alwaysApply: true
---

# Flow evidence

No material completion/correctness claim without fresh evidence appropriate to that claim.

- Run the proving command now when a command is the proof; read its whole relevant output and exit status.
- `tests pass` requires the stated test scope with zero relevant failures. `build works` requires a successful build. `bug fixed` requires the original symptom/reproduction to be gone.
- Writers verify their own work before returning it. Independent controller verification is **additive**, not a reason to make workers blind or forbid focused tests/builds/formatting. A task brief that suppresses focused self-verification solely because Main will verify later is invalid Flow orchestration and should be corrected before work proceeds.
- Scope proof by ownership: a leaf worker proves its leaf, the unit owner proves the integrated unit, Main proves consequential cross-unit/integration claims, and the final gate proves the final tree. Do not rerun the same expensive full suite at every layer merely as ceremony.
- Agent/subagent reports are claims, not proof. Inspect the actual patch/files and independently verify consequential claims before accepting them. Delegation never transfers verification responsibility: each parent owns acceptance of its children's work, and Main owns acceptance of the resulting integration.
- Reuse recent proof by **claim relevance**, not ritual tree identity. A later edit makes only affected evidence stale: production changes stale proofs that traverse the changed behavior; a docs-only ledger/checkpoint edit does not stale unchanged app behavior proof; a test-only edit requires proof for the changed tests/contracts but does not by itself erase unrelated runtime/device evidence. Repository policy may still require a final broad gate. When carrying proof across a changed head/tree, state why the intervening diff cannot affect the reused claim and rerun any proof whose dependency surface is uncertain.
- Acceptance is a stability barrier for the dependency surface it reviewed. Any later production-, asset-, or build-affecting mutation reopens the stability barrier before integration: run scoped independent acceptance/closure for the changed final tree, classify earlier device/manual/external evidence by its owned dependency surface, rerun only affected evidence, and explicitly justify reuse of unaffected capsules. A downstream evidence failure that causes such a correction is a concrete acceptance risk and may require an additional scoped closure even when the normal closure ceiling was already reached.
- For a temporary mutation/probe against a file that may already be dirty, capture the exact **pre-edit bytes** (and preferably a hash) before the probe, restore those bytes afterward, then compare the restored file to that captured snapshot. `git diff --exit-code <file>` against `HEAD` is not restoration proof when the file was already modified before the probe.
- Structured evidence receipts must be internally self-consistent. `MATCH` is itself an evidence claim: the literal rendered `before` and `after` identities/hashes must use the same comparison scheme, agree, and be supported by the observed comparison. A contradictory or transcription-damaged receipt is not MATCH evidence; correct it before handoff or downgrade the result to `UNKNOWN`. An unchanged `MATCH` receipt is reusable under the same claim-relevance rule until a later mutation or contrary evidence makes it stale.
- Old output from a different tree/head is historical evidence, not fresh evidence for the current state.
- A successful edit/tool call proves only that the tool reported success, not that behavior is correct.
- If full proof is unavailable, state exactly what was verified, what was not, and why. Never upgrade partial evidence into a stronger claim.
- Before a destructive or irreversible action based on a registry/version/API/remote-state claim, re-check the literal current source yourself.
