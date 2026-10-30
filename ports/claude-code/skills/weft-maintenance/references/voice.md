# The user's writing voice — weft graph register

Shared across the OMP Weft skills. It applies to journal entries and pages alike. Recent graph entries are ground truth — recalibrate against them every time. Where old entries and these rules disagree, these rules win.

## Purpose

The journal answers, at a glance, what happened and why it mattered. The archive is git, the PR, and the commit message — link to them, never duplicate them. Not journal content: verification evidence, measurements, per-finding lists, dead-ends, reversals, process notes.

## Plain voice

- Short sentences: subject, verb, object. Boring on purpose — if a sentence sounds quotable, rewrite it until it does not.
- Banned: aphorisms, inversions, dropped subjects, idioms, literary vocabulary ("moot", "vacuous", "earns its keep").
- Exact technical names stay exact. Jargon that names a real thing (`setState`, LFS) is fine; jargon that decorates is not.
- lowercase casual register, first person implied. One em-dash (`—`) per bullet for trailing context.
- No severity emoji. Order carries importance.

## Bullet anatomy

```
- DONE <what was done> in [[Project]] <optional PR/issue link>
```

Examples:

```
- DONE deploy [[OpenClaw]] in [[Server Stack]] at `ai.fiatcode.dev` — personal AI assistant with persistent memory + skills
- DONE [show status + leadership role symbols](https://app.clickup.com/t/868jdf270) in [[Fruit Tracker]] tree view
```

- The headline is one breath, about 30 words: what shipped, where, one link. Everything else goes below. No verification evidence in the headline either — the PR and the commit carry it.
- The headline names the thing that shipped, not its pieces. A feature roster goes in one sub-bullet or the PR.
- Verb rule: link text that is an action needs no verb; a noun needs one (`shipped`, `fix`, `deploy`). Keep the verb when unsure.
- Work that did not win leads with `attempt` / `investigate` / `try` — don't dress an attempt up as a win.

## Sub-bullets — the hard cap

- At most **3 sub-bullets per DONE**. No exceptions — not for multi-round reviews, not for epic closes. Pick by priority: the most important finding or fix, then why it mattered, then a lesson or TODO that clears the bar. A link carries whatever didn't fit.
- Each sub-bullet is 1–2 plain sentences, at most 2 rendered lines.
- Lead with a role when natural — `fix —`, `why:`, `symptom:`, `lesson:`. Don't force a tag.
- Follow-up `TODO`s are separate top-level bullets and do not count against the cap. `TODO` for new work, `DONE` for completed, `LATER` only when the user flags it.

## Human point of view — work facts only

The journal narrates what the user did, found, and decided. AI agents, lenses, verifier passes, severity labels, and their codenames are how a session produced a finding — never part of the finding.

- Cut process observations entirely, even true ones. If removing the tooling leaves nothing, it was process, not work.
- Keep the fact, lose the machinery: "three lenses converged on X" becomes "X".
- "The user said / flagged" is the same leak — write first person, or drop the actor.
- First person is for what the user did or approved. An offer, promise, or position a session took toward others is never "I" — pending, it becomes a top-level `TODO decide:`; once the user has chosen, journal the choice in the user's own verb — "went with X", never "offered X".
- Exception: an entry whose subject is the tooling itself may name its parts — there they are the work.

## Banned shapes — check the draft before showing it

Scan every drafted bullet. A hit is deleted, not reworded — verification or process content; the PR carries it:

- test counts and pass tallies (`1790 tests`, `762/530/498`, `N/N passed`, `suites green`)
- hashes beyond one commit/PR link (`SHA256`, checksums), `byte-identical`, `re-verified`, `re-run fresh`
- workspace housekeeping (`worktree`, branch cleanup) and `close-out` narration

Also at this gate: a headline roster moves to one sub-bullet; a `next:` / `left:` follow-up becomes a top-level TODO.

## The lesson bar

A `lesson:` must pass all three tests:

1. **Surprise** — a competent engineer would not say "yeah, obviously".
2. **Generalize** — it survives beyond this one bug or config. If fixing the root cause makes it evaporate, it was a bug report.
3. **Recognize** — it is phrased so an analogous case months later triggers it.

Phrase a lesson as a plain instruction ("build the reviewer's fix before trusting it"), never as an aphorism. One rule per lesson — split a "first X, second Y" into two candidates and apply the bar to each.

## Formatting

- `[[Page Name]]` wiki-link — match an existing page exactly. `[text](url)` for external links. Backticks for paths, commands, identifiers. `→` as a separator on pages.
- Group the day under `## [[Project]]` headings; project-less one-offs stay flat at the top. Placement rules live in `weft-worklog`'s SKILL.md; the heading house style in `conventions.md`.
- Indentation and the banned-phrase list: `conventions.md`.
