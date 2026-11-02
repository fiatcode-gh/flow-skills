# Page archetypes

Read before creating or extending a page. The graph itself is the template — open the exemplar page and mimic its shape. House style (bare `##` headings, lead prose above the first heading): `conventions.md`. Register: `voice.md`.

## File naming

- A page lives at `pages/<Page Name>.md` — spaces preserved, filename exactly matching the wiki-link target.
- Casing: Title Case by default (`Server Stack`, `Logseq Sync Using Git`). Lowercase, kebab, or PascalCase only when the thing has its own canonical name (`fiatcode`, `OpenClaw`, `py-faceblur`).
- Path-unsafe characters: check how an existing page handled it before inventing an encoding.

## Picking table

| Archetype | When | Lead line | Mimic |
|---|---|---|---|
| Project / Service | deployed, configured, hardened | `[[Service]] in [[Server Stack]] — <role>. Upstream: [repo](url)` or `[[Tool]] — <role>. Upstream: [repo](url)` | `Authelia.md` (tagged service); roots like `Server Stack.md` are untagged |
| How-to | a procedure to replay later | `[[How-to]] <verb> <topic>` | `Logseq Sync Using Git.md` |
| Evaluation | a tool tried and a verdict reached | identity line, then `Evaluated for [[X]] in <Month Year>, <accepted/declined> in favor of [[Y]]` | `Hermes Agent.md` |
| Glossary / stub | a link target whose substance lives elsewhere | `<one line>. See [[Canonical Page]].` — no headings | `Fedora Kinoite.md` |
| Capture / inbox | loose ideas, links, look-at-later | extend `Inbox.md` — don't create a page | `Inbox.md` |
| Person | a recurring teammate or reviewer | `<Role> on [[Project]] — <identity relative to the user's work>` | `Jimmy.md` |

## Tag prefix

Every new page opens its lead with a tag wiki-link so the index pages auto-populate via backlinks: `[[Tool]]`, `[[Service]]`, `[[Concept]]`, `[[Pattern]]` (lead: `[[Pattern]] — *when it bites:* <trigger>`), `[[How-to]]`.

Exceptions: top-level projects (`[[Fruit Tracker]]`, `[[Server Stack]]`) take no tag — they are roots. Sub-modules lead with `Module of [[Parent]] — <role>`. People and stubs stay untagged.

## Rules

- Identity is relative to the user's work — never invent facts to fill a section.
- "Gotchas worth remembering" entries are hard-won, one sentence each, with the underlying reason.
- Person pages: a "Review catches worth remembering" section is held to voice.md's lesson bar, with a `[[date]]` backlink per catch; drop the section rather than pad it.
- If nothing fits, don't force an archetype — write the journal bullet and decide next time the topic recurs.
