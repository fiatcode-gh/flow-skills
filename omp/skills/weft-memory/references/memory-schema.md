# AI Memory — hub schema

Shared by the update, recall, and GC modes of `weft-memory`. The store is a
single weft page, `${WEFT_GRAPH}/pages/AI Memory.md`. This is
**agent-facing memory** — what an AI tool should recall to serve the user
better — kept separate from the human-facing journal/knowledge pages that
`weft-worklog` writes.

## Structure — four homes, chosen by retrieval

Agent-facing memory lives in four homes. The home is chosen by **how the memory
gets retrieved**, not by what it is about:

- **Doctrine** (`agent/AGENTS.md` or an always-apply Flow rule in omp-stack) — standing rules
  the user follows on every machine. Hand-authored, loaded natively by OMP, highest instruction authority. **Not written by this
  skill:** propose the exact text and let the user apply it.
- **The injected hub** (`${WEFT_GRAPH}/pages/AI Memory.md`) — only what the user
  would regret not knowing *before they thought to ask*. Small and slow-growing
  by design, because it is injected into every applicable OMP session and the injection channel
  has a size budget.
- **Project pages** (`${WEFT_GRAPH}/pages/<Project>.md`) — how to work in this
  project: conventions, tool shims, gotchas. Fetched on the doctrine rule that
  tells the agent to read a project's page before substantive work. Append under
  that page's `## Gotchas worth remembering` heading.
- **Graduated pages** (`pages/AI Memory___<slug>.md`) — a procedure grown past
  one line, reached from a hub pointer that names its trigger.

Inside the hub, the section a bullet lives under is its scope — there is no
per-bullet scope property:

- `## Global — workflow & preferences` — landmines that apply everywhere, every
  tool, every project.
- `## [[Project]]` — that project's landmines; the header is a wiki-link to the
  project's page. Small: one or two bullets, not a knowledge dump. The bulk of
  what is known about a project belongs on its page.
- `## Harness: [[Name]]` — memories true only inside one AI harness: a tool
  quirk, a plugin that only exists there, a setting in that tool's own config.
  The header is a wiki-link to that harness's page (`[[OMP]]`).
  Injected only when that harness is the one running.
- `## Other` — recall-only catch-all for orphans that are neither global nor tied
  to a project. It matches no project key, so injection never emits it; it's
  reachable only via `weft-memory` recall mode. Use sparingly.

Section headers are bare markdown headings (`## [[weft]]`), so weft renders and
backlink-indexes them. (Legacy Logseq bulleted headings, `- ## [[weft]]`, are
still accepted by the injector during migration.)

## Bullet shape

Each memory is one top-level bullet, one line, in the user's terse register (see
`references/voice.md`). It may end with a `(via [[source]])` provenance link:

```
## Global — workflow & preferences (apply everywhere, every tool)
- deuteranomalous — encode state by shape/position, never hue alone (via [[Site]])

## [[weft]]
- design line: weft is a navigator, not an outliner — no fold/unfold, no zoom
```

- **The bullet text is the memory.** One line. No block properties, no `::`.
- **`(via [[source]])`** — optional trailing provenance: where the memory was
  learned (a `[[Project]]`, a session-date `[[yyyy_MM_dd]]`, a context page). It's
  a real wiki-link, so it surfaces in that page's backlinks. Include it **only
  when it adds information** — omit it inside a `## [[Project]]` section when the
  source is that same project (redundant with the header). Global bullets keep it
  (it records which project taught the lesson).
- **Dates are not stored inline** — the graph is in git, so `git log -S'<text>'`
  or `git blame` recovers when any bullet was added.
- **Kind is not tagged** — the old `type::` (preference / feedback / project /
  reference) is gone; the section plus the wording carry it.

## Scope-sliced injection

OMP's session-start memory injection (omp-stack's `ai-memory` extension)
doesn't inject the whole hub — it slices it on **two flat, independent axes**:

- always the intro + the `## Global` section;
- plus the one `## [[Project]]` section matching the working directory
  (`$WEFT_PROJECT`, else the git repo directory name; normalised match, so
  `fruit-tracker` resolves `## [[Fruit Tracker]]`);
- plus the one `## Harness: [[Name]]` section matching the harness that is
  running.

The axes are flat, not crossed: there is no "in harness X, on project Y" scope.
A memory that would need one goes in the project section with an inline
qualifier.

The two axes cannot collide. `## Harness: [[Claude]]` normalises to
`harnessclaude`, which can never equal the normalised project key `claude`, so
a repository directory named `claude` pulls only its own project section.

Other projects' and other harnesses' sections load on demand via
`weft-memory` recall mode. Practical consequence for writing: **put a memory under the
right section, or it won't be injected where it's needed** — a project fact filed
under `## Global` bloats every session; a global preference filed under a project
never loads elsewhere; and a tool quirk filed under `## Global` is injected into
harnesses where it is false.

## Plaintext-first — the recall path never needs weft

Everything is literal text in the `.md` file. Any tool — `grep`, `cat`, `awk` —
reads it directly, no graph engine required. `{{query …}}` blocks are a
Logseq-era rendering affordance (weft doesn't evaluate them) and must **never** be
part of the agent's recall path.

## Promotion — earn your page

A memory stays a one-line bullet on the hub. It graduates to its own
`[[AI Memory/<slug>]]` namespaced page only when it grows past one line with
durable sub-detail worth its own node — same earned-promotion rule the journal
follows. On promotion, the hub bullet becomes a one-line pointer under its
section: `- <topic> → see [[AI Memory/<slug>]]`.

## Lifecycle — the hub is kept lean by GC, not by write-time restraint alone

`weft-memory` update mode dedupes at write time, but nothing at write time removes,
demotes, or merges — so the hub grows monotonically between `weft-memory` GC passes.
The injected-everywhere `## Global` section is the budget that matters; when it
bloats or carries stale facts, that's a GC trigger, not a reason to relax the
write-time substance bar.

## Substance bar — what is a memory

A memory must be **durable** (true beyond this session), **general** (applies to
future work, not a one-off), and **new** (not already on the hub — update in place
instead of duplicating). "use port 8081 here" is not a memory; "defaults services
to the 8080–8090 range" is.
