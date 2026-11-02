# Codebase audit mode

Audit a repository/area at rest. Code and git state stay read-only; the controller may write the requested report.

## Packet

Record repository/scope, exact HEAD (or not-Git), full working-tree status, project instructions, tree/entry points, manifests/lockfiles, test/CI inventory, docs inventory and config/secrets surfaces by path only. Dirty/untracked source is part of the target. Keep the packet metadata-only and scope large repositories honestly.

## Lenses

All four audit lenses always run:

- CDH → `flow-audit-code-health`
- TTC → `flow-audit-tests`
- DST → `flow-audit-docs`
- SEC → built-in `security-reviewer`, or native `security_scan` for a dedicated security engagement when enabled/warranted

Run independent lenses in parallel. Read `audit-lenses.md` for the detailed contract.

## Synthesis/report

Verify Critical/Important claims independently; sample Minor claims and label unverified leftovers. Merge systemic duplicate causes; redact secrets.

Rating from verified findings only: any Critical → **At risk**; else any Important → **Needs attention**; else **Healthy**. Partial coverage is named explicitly.

Default report path: `docs/reports/YYYY-MM-DD-audit-<slug>.md`, unless the user chose another destination. Include provenance/scope, rating, coverage summary, verified findings by lens, strengths, verification notes, follow-ups and coverage gaps. Every Important/Minor finding should end with an explicit disposition path (fix, backlog, watch/accept, or cannot act yet) rather than becoming an orphaned observation. Persisting follow-ups to Weft is optional and user-owned. The report is the audit's only target-tree write.
