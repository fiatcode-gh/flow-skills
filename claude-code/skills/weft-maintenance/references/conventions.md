# weft skill set — shared conventions

Operational rules shared across the Weft skills. This reference is copied beside each grouped skill so each skill stays self-contained.

## Git and sync — `weft_publish` only

The graph at `${WEFT_GRAPH}` is in git. Never run `git commit`, `git push` or a sync yourself. `weft_publish` is the only commit path: it pushes in a cloud session and does nothing on a local graph, where commits and syncs are the user's. Reverts are always the user's.

## Graph path — `WEFT_GRAPH`

The graph root lives in the shell variable `${WEFT_GRAPH}` (commonly `~/Documents/fiat-codex`). Every skill runs `weft_guard` before touching the graph and stops on anything but `ok` — never a hardcoded default. A cloud environment also sets `WEFT_GRAPH_REPO` (for example `fiatcode-gh/fiat-codex`) in its environment settings. To persist the local variable, hand the user a command in their login shell's own syntax — check the shell first (`basename "$SHELL"`), never assume bash:

- fish: `set -Ux WEFT_GRAPH ~/Documents/fiat-codex`
- POSIX shells (bash, zsh): `export WEFT_GRAPH="$HOME/Documents/fiat-codex"` in the shell's rc file

Then have the user start a fresh session so the variable is present.

## Block indentation — 2 spaces per nesting level

Never a tab, never 4 spaces. A level-1 child is 2 spaces in, level-2 is 4. A rare block property (`alias::`) sits 2 more spaces in from its parent bullet's text. Code inside fenced blocks keeps its own indentation verbatim — only the structural prefix that positions the fence follows the rule. `weft-maintenance` cleanup treats stray tab/4-space nesting as a scan target.

```
- top-level bullet
  - child (2 spaces)
    - grandchild (4 spaces)
```

## Headings — `##` sections, bullets underneath

The graph is document-shaped, not a pure outline. This is the single home for the house style:

- A section is a bare `## Title` with its content as bullets underneath — never a bulleted heading (`- ## X`).
- `##` is the top level inside a file (the filename is the title, so `#` stays unused); sub-sections are `###`. Lead prose sits above the first heading as bare text, no `- ` bullet.
- Journals group by project: `## [[Project]]` headings, where the heading is the wiki-link. A heading that names an existing page is a wiki-link; a plain section name (`## Overview`, `## See also`) stays plain text.
- Under `## [[Project]]`, drop the now-redundant project link from bullets; secondary and cross-project links stay inline.
- Sectioning is positional — everything after a heading belongs to it until the next heading. Project-less one-offs go above the first heading (the day's inbox); never leave a bullet stranded after a project group.

## Scan exclusions

When scanning for drift, plain-text mentions, or markers, skip: `:LOGBOOK:` … `:END:` blocks, fenced code blocks and inline code, URLs, and the current page's own self-mentions.

## AI-stock phrases — never in the user's prose or in proposals

`comprehensive`, `robust`, `seamlessly`, `leveraged`, `streamlined`, `cutting-edge`.

## Backtick literal `[[links]]`

A bare `[[X]]` renders as a live link and indexes a backlink. When naming the syntax itself rather than linking the page, wrap it in backticks; reserve the bare form for an intended live link.

## Substance bar — page promotion

A new `[[Pattern]]` page needs 2+ sightings, or 1 sighting plus an obviously recurring shape. One sighting in one context is a lesson nested under its DONE bullet, not a page.
