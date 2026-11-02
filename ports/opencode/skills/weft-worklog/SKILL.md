---
name: weft-worklog
description: 'Use the user''s `${WEFT_GRAPH}` human worklog: query scoped TODO/LATER/DOING work, maintain status for work the session actually owns, and log completed Flow work into today''s journal. Query is read-only unless the user/session owns the state change.'
---

# Weft worklog

## Graph guard

Before any operation:

```sh
[ -n "${WEFT_GRAPH:-}" ] && [ -d "${WEFT_GRAPH}" ] && echo "ok: ${WEFT_GRAPH}" || echo "MISSING"
```

Never fall back to a hardcoded path. The graph is versioned independently: never commit/sync it from this skill.

Read `references/conventions.md`; read `references/voice.md` before writing; use `references/page-archetypes.md` when creating/extending pages.

## Mode A — query open work

Search journals/pages for open `TODO` / `LATER` (surface stray `DOING` as open too), scoped to the user's explicit topic or the current session's project/context. Preserve original markdown/wiki-links/code. Group by source and sort recent-first; stale markers are triage signals, not deletion recommendations.

Default stale hints: TODO 60 days, LATER 180 days.

Query mode is read-only: mutate only when the user asks or for Mode C's owned items. Never mutate merely similar search results.

Follow-ons:

- mark done → flip marker and add the result context appropriate to the source;
- pull into today → append a fresh TODO to today's journal, leaving historical source intact unless explicitly moving;
- promote to page-level TODO → confirm the destination page first.

## Mode B — log completed work

Pin today's date to Asia/Jakarta at write time (re-run before edit):

```sh
TZ='Asia/Jakarta' date '+%Y_%m_%d'
TZ='Asia/Jakarta' date '+%a, %d.%m.%Y'
```

Recon today's journal, a recent non-empty day and existing page names; for page authoring sample more relevant pages/days.

Distill human work facts, not the AI/session process: one headline accomplishment and at most three useful result/why sub-bullets.

Follow-ups are never written unasked. After the entry, list candidates in chat; write only what the user confirms:

- `TODO`, the user's agenda: only the user can do it, nothing else tracks it (ClickUp, PR, issue, plan, contract), and it is lost without the entry;
- `- [ ]` on `<Project> Backlog`: parked findings and ideas, off the agenda.

Never a candidate: a check the session could not run (sub-bullet `not checked: X`), work tracked elsewhere (link it), someone else's work. `LATER` only on request.

Project-owned entries go under `## [[Project]]`, dropping a redundant primary project link from the bullet. Project-less one-offs stay flat above project headings. No `## Misc`.

Create/extend pages only when earned by durable substance; near-match existing page names rather than forking casing/plurals. Show touched lines/pages and ask for tweaks after writing. Never reformat unrelated history.

## Mode C — Flow lifecycle

When `${WEFT_GRAPH}` exists, substantive Flow work invokes this mode automatically; do not ask for a separate logging approval.

**Before work**

1. Query scoped `TODO` / `LATER` / stray `DOING`, and open `- [ ]` on the project's Backlog page.
2. Record exact source items that genuinely match the requested work. Similar results are context only.
3. If the session takes ownership of an existing `TODO` / `LATER`, flip that exact item to `DOING` when action begins. Recon, discussion or someone else's implementation responsibility is not ownership.

**After work**

1. Re-query the same project/topic scope before mutating the graph.
2. For exact items this session owned: completed → `DONE` (backlog `- [x]`) plus brief result context; still active → keep `DOING`; incomplete and no longer active → restore the prior marker.
3. Log substantive completed work using Mode B automatically.
4. Propose follow-ups per Mode B.

**PR reviewer ownership exception**

In `flow-review` PR reviewer mode for someone else's PR, follow the PR-review rule in `AGENTS.md` (Weft graph section). Author-feedback mode on the user's own PR follows the normal ownership rules above.
