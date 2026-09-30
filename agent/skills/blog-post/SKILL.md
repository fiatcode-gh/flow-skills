---
name: blog-post
description: Write or revise an Astro-format fiatcode.dev post in the user's engineer-direct voice. Trigger on explicit blog/write-up requests; after substantive work, only offer when there is a real thesis/lesson and clean narrative arc. Publishing remains the user's decision. Not for Weft worklog entries.
---

# Blog Post — fiatcode.dev

> **Sibling skill** — `weft-worklog` is for the user's weft graph (terse, lowercase bullets). This skill is for *publishable* writing on `fiatcode.dev`. If the user says "log this" or "update weft", that's the other skill. If they say "write a post" or "blog this", you're in the right place.

The user runs a personal blog at `fiatcode.dev`. It's an Astro site; posts live at `~/Development/Projects/fiatcode/site/src/content/blog/` as Markdown files with YAML frontmatter. Each post is a piece of *finished* writing — opinionated, technical, narrative — distinct from weft journal bullets which are just receipts of work.

## Who the author is (background anchor)

From the site's intro page (`site/src/components/Intro.astro`) — keep this in mind so the voice has a consistent identity, not just a consistent rhythm:

- **fiatcode** — cross-platform developer, Linux native, "Craftsman at heart".
- Works at a small software house / local startup. Day-to-day stack: **Flutter, Spring, React Router** — sometimes all three in the same day.
- Believes in Clean Architecture, TDD, and DDD as *load-bearing* (the user's own framing in `vibe-coding-still-needs-a-craftsman.md`) — not as ceremony.
- Self-hoster: Netcup VPS, Traefik v3, Navidrome, LibreChat, DeepInfra — the "own your stack" instinct runs through a lot of the posts.
- Self-described as someone who *"figures things out in public"*. The blog is the output of that.

Posts can lean into any of these — *"working at a small software house, I"*, *"my Flutter project at work"*, *"on my VPS"* — without sounding name-droppy, because they're load-bearing context. Just don't invent biographical detail you can't verify from the intro or from the post corpus.

Your job, when this skill triggers, is to:

1. Figure out which mode you're in: **session-end** (the conversation already contains the substance) or **intentional** (the user wants to write something we haven't done yet).
2. Calibrate to the user's voice by reading 2 recent posts (read a third when the voice/structure is still ambiguous) before drafting a single line.
3. Draft the post, show it to the user, and iterate until they say it's good.
4. Save it to the right path with correct frontmatter. Don't commit — that's the user's call.

---

## Two modes

### Mode A — session-end write-up

The conversation already contains the work: a tool was built, a bug rooted-caused, a service deployed, a research thread followed to a conclusion. The user is asking you to turn what just happened into a post.

What to do:

- Skim the conversation back for: the concrete situation that started it, the decisions made, the surprises, the things that didn't work, the eventual landing. These are the bones of the post.
- Pull real names, real numbers, real commands, real file paths from the session. The user's posts are anchored in specifics — never abstracted "an API" when you can say "the `/api/orders` endpoint on the Netcup VPS".
- Ask the user *one* targeted question if there's an obvious gap (e.g. "Want the closing to point readers at the repo, or keep it as an internal reference?"). Don't run a long Q&A — most of what you need is already in the transcript.
- Then go to **Drafting**.

### Mode B — intentional start

The user opens a session by saying "I want to write a post about X." There may be no prior work in context.

What to do:

- Brainstorm with them briefly. The user's posts have a *thesis* — a position, a lesson, a contrarian take — not just a topic. "Self-hosting LibreChat" is a topic; "I stopped renting intelligence and built my own" is a thesis. Tease out which one of these they have. If they only have a topic, ask what their angle is.
- Confirm the narrative arc in two or three lines before drafting: opening situation → middle section(s) → closing point. The user will redirect you if the arc is wrong, and it's much cheaper to fix at this stage than after a full draft.
- Then go to **Drafting**.

---

## Voice calibration (do this every time)

Before writing, read **2 recent posts (read a third when the voice/structure is still ambiguous)** from `~/Development/Projects/fiatcode/site/src/content/blog/`. Pick ones whose subject is closest to what you're about to write — a technical-setup post if you're writing setup, an opinion post if you're writing opinion. The bullets below are the steady-state pattern, not a substitute for re-reading.

**Tone.** First-person but understated. Confident, takes positions, but never preachy. Self-aware humor lands when it's quiet — "I'm not sure what that says about anything, but I find it genuinely funny" — never wink-wink performative. Honest about failures: posts often have a *"the bugs we caught"* section or *"the irony"* section that admits what didn't go clean. No corporate hedging. No "leveraging" or "delve into" or "this article will explore". No emoji in body prose (occasional emoji in code-block-rendered CLI output is fine if that's literally what the tool prints).

**Em-dashes carry the rhythm.** Used heavily for parentheticals and trailing reasons — like this — and at the end of clauses to add the *why*. Don't overuse them to the point of self-parody, but don't avoid them either. They're load-bearing punctuation in this voice.

**Sentence length varies on purpose.** Short declarative sentences for emphasis. Then a longer one that unpacks the consequence. Then a one-line paragraph that lands the point.

Like that.

**Concreteness over abstraction.** Real numbers ($0.20/M tokens, 295% surge, 812 lines). Real dates (*"In late February 2026..."*). Real names (DeepInfra, Navidrome, Traefik v3, LibreChat, Claude Sonnet 4.6). Real commands (`git worktree add ../pr-42`). If a sentence could survive being said about any tool in its category, rewrite it until it can only be said about *this one*.

**Take a position.** The posts are opinionated. "FLAC for archival, Opus for everyday listening." "The craftsman isn't replaced. The craftsman gets leverage." "Code you understand is code you can trust." Don't write a balanced-pros-and-cons table when the user clearly has a preference. Their voice is *"here's what I do and why"*, not *"here are some options to consider"*.

---

## Structural patterns

**Frontmatter.** Always exactly this shape:

```yaml
---
title: "Title Case With Optional Subtitle After Colon"
description: "One-line hook with personality, not a summary"
date: 2026-05-25T14:30:00+07:00
draft: false
tags:
  - tag-one
  - tag-two
---
```

Notes:
- `date` is ISO 8601 with the user's WIB offset (`+07:00`). Ask the system for the current local time when drafting; don't guess.
- `description` is a *hook*, not a TL;DR. Compare: ❌ *"A guide to using git worktree"* vs ✅ *"Switching branches to review a PR shouldn't cost you your mental context. It doesn't have to."*
- `tags` are lowercase, kebab-case if multi-word (`self-hosting`, `dev-setup`, `ai`, `linux`). Look at existing posts to reuse tags; don't invent a new tag if a close one already exists. Two or three tags is normal; one is fine.
- `draft: false` — yes, even on first save. The user reviews in-place; they don't use the draft flag.

**The optional h2 subtitle.** Some posts have an `## ...` line right after the frontmatter that mirrors and expands the description. Use it for opinion/argument posts where there's a thesis to plant up front (`## AI agents can write code faster than you ever will. That doesn't mean you can stop thinking.`). Skip it for setup/how-to posts where the description is enough and you want to dive straight into the situation.

**Opening.** Never open cold with *"In this post I'll cover..."* or *"This is a guide to..."*. Always ground the reader in a concrete situation, frustration, or moment. Patterns the user uses:

- *Frustration-named*: "There's a specific kind of frustration that comes with streaming services. The music is there, the app is polished, but none of it is really yours."
- *Workflow-tax-named*: "There's a workflow tax that most developers pay without thinking about it. A PR comes in that needs review. You're mid-feature..."
- *Date-anchored*: "In late February 2026, OpenAI signed a contract with the Pentagon..."
- *Situation-anchored*: "Plug in an Android device on Linux, run `adb devices`, and sometimes you get this:" (then immediately the CLI output)
- *Confession-anchored*: "My office has been deep in AI-assisted coding for a while now. ... And yet, some of the code that comes out of it is quietly terrifying."

Pick the one that fits the post's center of gravity. Three or four sentences in the opening, then a `---`, then the first section.

**Section dividers and headings.** Major sections separated by `---` on its own line, surrounded by blank lines. Section titles are `### Title Case` (h3). The user uses `##` (h2) only for the optional subtitle below the frontmatter — never for body sections. Don't over-section: a 200-line post wants maybe 4–6 sections, not 12.

**Body rhythm.** Short paragraphs. Two to four sentences each. One-sentence paragraphs are allowed and effective for landing a point. Lists use `-` (hyphen), never `*`. Numbered lists for sequences (1, 2, 3) and for command pipelines. Tables when comparing multiple options on multiple axes (see the model lineup in the LibreChat post). Inline code with backticks for commands, paths, env vars, package names.

**Code blocks.** Always specify the language fence (` ```bash `, ` ```python `, ` ```go `, ` ```fish `, ` ```yaml `). Keep them readable — if a block is more than ~30 lines, ask whether to elide the middle or link to the full source on Codeberg/GitHub instead. The user's posts often link to a `Full source: [path](url)` line right after a representative excerpt.

**Closing.** The last line lands the point and often ties back to the opening. Patterns:

- *Restate the thesis sharper*: "The craftsman isn't replaced. The craftsman gets leverage. // Use it carefully."
- *Tie back to the opening frustration*: "No subscriptions, no tracking, no algorithm deciding what comes next. // That's the whole point."
- *Quiet sign-off*: "Add it to your workflow. You won't miss the stash."
- *Self-aware ending*: "I built this in an afternoon. The frustrating part wasn't the work — it was realizing I should have done it sooner."

Never end with *"Happy hacking!"* or *"Let me know in the comments!"* or *"Stay tuned for part 2."* The user's posts end with the point landed, not with audience-engagement boilerplate.

---

## Slug and file path

The filename is a kebab-case slug derived from the title — not the *full* title, but a tight 4–7 word version that captures the topic. Examples:

| Title | Slug |
| --- | --- |
| "Self-Hosting LibreChat: Own Your AI Stack" | `self-hosting-librechat-own-your-ai-stack.md` |
| "Stop Stashing. Use Git Worktree." | `stop-stashing-use-git-worktree.md` |
| "Fix ADB Insufficient Permission" | `fix-adb-unsufficient-permission-linux.md` |
| "Building a Load Testing Script with Claude" | `building-load-testing-script-with-claude.md` |

Lowercase, no punctuation, hyphens for spaces. Before writing, `ls` the blog directory and check the slug isn't already taken. If you're not sure between two slugs, ask.

Full path:

```
~/Development/Projects/fiatcode/site/src/content/blog/<slug>.md
```

---

## The iteration loop

1. **Write a complete first draft.** Not an outline, not a partial — a full post the user could publish as-is if they wanted to. Include frontmatter, opening, sections, closing.
2. **Save it to the actual file path** in `site/src/content/blog/`. The user reviews in-place — they open the file in their editor, not in a chat preview. Saving the real file means they can see how it'd render against the rest of the site if they spin up the Astro dev server.
3. **Show the user a short summary** of what you wrote: the title you picked, the rough arc, anything you weren't sure about. Don't paste the whole post back into the conversation — they'll read the file. Two or three lines is enough.
4. **Wait for feedback.** Apply revisions as targeted edits, not full rewrites — the user wants to see exactly what changed. If they ask for a structural rewrite (new opening, different thesis), that's a full-file rewrite and worth flagging: *"this is a substantial rewrite, want me to overwrite or save as a sibling draft?"*
5. **Repeat until the user calls it good.** When they do, the skill is done. Do not commit. Do not push. Do not announce on Mastodon. The user owns publishing.

A note on revision energy: the user is *direct* in feedback ("nope", "this section is flabby", "the opening doesn't land"). Don't apologize, don't recap what you got wrong, don't promise to be more careful next time. Just make the change and show it.

---

## Common failure modes to watch for

- **Generic AI-ese opening.** *"In today's fast-paced world of software development, choosing the right tool is more important than ever."* Hard reset and re-read the opening patterns above.
- **Hedged conclusions.** *"Ultimately, the right choice depends on your specific needs and use case."* The user takes positions. If you're hedging, you don't understand the position yet — go back and ask.
- **Over-sectioning.** Twelve h3 headings on a 150-line post means each section is one paragraph and nothing builds. Merge until each section has weight.
- **Listy structure where prose would carry it.** Not everything is a bulleted list. Sometimes a paragraph that flows from cause to effect is what the rhythm needs.
- **Code-block tourism.** Long code blocks the reader will skim past without understanding. Either trim to the load-bearing few lines and link to the full source, or annotate what each section is doing in prose before the block.
- **Tag sprawl.** Don't invent `ai-pair-programming-with-one-model-version` as a tag. Look at what tags already exist and pick from those.
- **Forgotten subtitle pattern.** For opinion posts, the optional `##` subtitle right under the frontmatter is part of the voice — check whether the post needs one before finishing.
- **Mismatched date.** If you write a post on 2026-05-25 and the timestamp says 2026-03-18 because you copy-pasted frontmatter from an existing post, the user will notice. Always set a fresh timestamp.

---

## When in doubt

Re-read the user's recent posts. The voice is consistent across them and the patterns are visible if you let yourself absorb three or four before writing. Calibration beats instruction every time — these notes are scaffolding, the actual model is the corpus.
