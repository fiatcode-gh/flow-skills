---
name: weft-memory
description: Read, write or garbage-collect the user's agent-facing Weft memory (`pages/AI Memory.md` and graduated AI Memory pages). Recall is read-only; durable writes require exact proposal/approval; GC is proposal-first and per-item by default.
---

# Weft AI memory

One skill, three modes: **recall**, **update**, **GC**. This is agent-facing durable memory, distinct from `weft-worklog` human work history.

## Graph guard

```sh
[ -n "${WEFT_GRAPH:-}" ] && [ -d "${WEFT_GRAPH}" ] && echo "ok: ${WEFT_GRAPH}" || echo "MISSING"
```

Hub: `${WEFT_GRAPH}/pages/AI Memory.md`. Never commit/sync the graph from this skill. Read `references/memory-schema.md` before update/GC and `references/conventions.md`/`voice.md` for writes.

## Recall — read-only

Use when the injected baseline is insufficient: another project's/harness's memory, a project page's working constraints, a graduated detail page, or explicit request to inspect memory.

Read the hub, filter by scope and relevance, follow only relevant `[[AI Memory/<slug>]]` pointers/project pages, and report only what bears on the task. Do not dump the hub or rewrite anything.

## Update — durable/general/new + exact approval

A candidate must be **durable, general enough to matter again, and new**. Dedupe/update-in-place before adding.

Route by retrieval trigger, not topic:

- must be known before the user thinks to ask → hub (`Global`, matching Harness, or Project section);
- standing OMP-wide practice → propose `AGENTS.md`/a Flow rule rather than duplicating memory;
- project working constraint that is naturally discovered when working there → project page (`Gotchas worth remembering`);
- long procedure/detail → graduated `AI Memory/<slug>` page + one-line hub trigger pointer.

If the action always passes through a skill/rule that can deliver the warning exactly at trigger time, prefer that chokepoint over always-injected hub memory.

Show the exact new bullet or before/after edit and ask approval **before writing**. Proactive candidates are offered first; never silently write them.

## GC — placement before staleness

Run only on explicit request or after the user accepts an offered contradiction/size cleanup. Read the full hub plus relevant graduated/project evidence. The first question is whether a bullet belongs in always-injected memory at all; age alone does not make a still-true preference stale.

Use the original five verdicts:

- **DELETE** — retired, superseded, contradicted by authoritative current state, or a one-off that never generalized;
- **DEMOTE** — useful but project/situational rather than injection-worthy; move to the matching project/detail home;
- **MERGE** — duplicate rules carrying the same meaning; compose from the surviving source wording;
- **GRADUATE** — one-line budget is hiding real procedure/detail; move detail to `AI Memory/<slug>` and leave a trigger pointer;
- **UPDATE** — meaning still true but a renamed/moved referent must be refreshed.

Keep/ambiguous is always valid. Default to per-item approval; `apply all` is the user's choice. Preserve surviving wording unless a verdict requires change. Never collapse a deliberate rule/counter-rule tension without asking. Show resulting diff and before/after hub/global size. A Global section creeping past roughly 25 bullets is a useful maintenance signal, not an automatic deletion threshold.
