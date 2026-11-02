---
name: weft-maintenance
description: "Use for deliberate historical maintenance of the Weft graph: promote recurring topics to pages, retrofit wiki refs, clean structural/voice drift, or distill repeated journal lessons. Proposal/dry-run first; modifies old content only after approval."
---

# Weft maintenance

Historical graph rewrites are the dangerous mode. Normal work logging is append-focused (`weft-worklog`); memory has its own placement contract (`weft-memory`).

## Guard

Validate `${WEFT_GRAPH}` first; never hardcode it, commit it or sync it. Read `references/conventions.md`, `voice.md` and `page-archetypes.md` before proposing edits.

## Operations

### Promote

Find a recurring noun/topic with enough durable substance to earn a page. Recon all mentions, propose page archetype/name/lead and which existing mentions should become refs. Do not create a page merely because a noun appears often.

### Retrofit refs

For an existing page, find plain-text mentions and propose batches. Case-sensitive by default; exclude code blocks, inline code, URLs and self-mentions. Near-misses/casing changes are questions, not automatic links.

### Cleanup

Detect structural/voice drift without rewriting history for taste: overlong AI-like prose, vague narration, missing state markers, wrong bullet anatomy, third-person developer self-reference, retired bulleted headings/section labels, tab indentation, project grouping drift and other rules documented in the references.

Show `original → rewrite` with rule tags. No silent broadening.

### Distill

Collect repeated journal lessons/facts about a topic and draft a durable page/update that adds value beyond the chronology. Cite source days. Distillation does not delete the historical journal entries.

## Process

1. Recon affected files/mentions and exclusions.
2. Define exact scope.
3. Propose changes (or dry-run) grouped by operation/file.
4. Wait for approval before modifying old content.
5. Apply exactly the approved set.
6. Audit touched files for broken links/structure/unintended edits and show the diff.
