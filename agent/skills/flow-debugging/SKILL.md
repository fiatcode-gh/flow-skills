---
name: flow-debugging
description: Use for bugs, test failures or unexpected behavior before proposing a permanent fix; reproduce, trace root cause, test one hypothesis at a time, then fix under TDD.
---

# Flow debugging

A symptom patch is not a root-cause fix.

## 1. Reproduce and localize

Read the full error/trace. Reproduce reliably; if you cannot, gather observability instead of guessing. Inspect current diff/history/dependency/config changes. In multi-component systems, trace data/control across boundaries until you know **which layer first becomes wrong**.

Use parallel read-only scouts when independent traces (client/server, caller/callee, old/new implementation) reduce search time. The main/debugging agent owns the hypothesis.

For caller/callee, data-flow or cross-package tracing in an indexed repository, `trace_path`/`search_graph` is usually cheaper than a scout fan-out. Read the cited lines before treating a hop as real; edges are name-derived where the graph has no type resolution.

## 2. Compare

Find similar working behavior in the same codebase/version. List meaningful differences rather than dismissing them prematurely. For regressions, use history/bisect when it materially narrows the search rather than as ritual.

## 3. Hypothesize and test

State one falsifiable hypothesis: `X is the root cause because Y`. Test with the smallest diagnostic/change that can distinguish it. One variable at a time. If false, record what it ruled out and form a new hypothesis.

## 4. Fix

Once root cause is supported:

1. create the failing regression proof (`flow-tdd`);
2. implement the root-cause fix only;
3. re-run the original symptom plus focused and broader relevant checks;
4. inspect the diff for accidental scope growth.

Urgent containment may be done first only when the user explicitly wants mitigation; label it as mitigation and continue root-cause work separately.

As Main, route the fix by `flow-execution` section 2: a tiny cohesive edit → the Main-direct lane under `flow-tdd`; an exact correction with one obvious result and existing proof → `sonic`; anything else → `flow-implementer` under an approved contract (`Plan: NONE`, `flow-execution` section 1).

## Stop/escalate

- If you catch yourself stacking speculative fixes, return to reproduction/localization.
- Three failed permanent-fix attempts means assumptions/design need reconsideration. Stop attempt four; summarize evidence and escalate deliberately (design discussion / stronger reasoning) instead.
