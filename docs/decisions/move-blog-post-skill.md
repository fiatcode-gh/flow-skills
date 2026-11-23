# Move `blog-post` into the site repository

Work: branch `chore/move-blog-post-skill` (flow-skills) and `feat/blog-post-skill` (site), 2026-11-23.

## Decisions

- **The skill lives with the checkout it writes into.** `blog-post` drafts posts into `src/content/blog/` of the `site` repository and reads that repository's intro and corpus. It now sits at `site/.omp/skills/blog-post/SKILL.md`, an OMP project skill, so it loads only in sessions started inside `site` instead of in every session.
- **OMP-native folder, not `.claude/skills/`.** It keeps the reach it had (OMP only). A `.claude/skills/` copy would also reach Claude Code; that is a port, not a move.
- **Paths are repository-relative.** The old skill hard-coded `~/Development/Projects/fiatcode/site/...` and `src/components/Intro.astro`, both stale. The intro is in `src/pages/index.astro`.
- **The PRINCIPLES and ARCHITECTURE ledger rows stay** and point at the new home: the validator requires every old ai-stack skill to be accounted for.

## Open questions

- `site/AGENTS.md` has its own "Blog Post Style" section that overlaps the skill's voice rules; merging them is a separate change in `site`.
