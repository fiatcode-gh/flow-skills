# Rename to flow-skills with one directory per harness

Work: `refactor: lay out one directory per harness` through `fix: close the rename review findings` on `main`, 2026-11-02; repository renamed from `fiatcode-gh/omp-stack`.

## Decisions

- **One directory per harness, each holding its doctrine or port and its setup.** `omp/` holds the canonical doctrine plus `profiles/`, `keybindings.yml`, `TITLE_SYSTEM.md`, `mcp.example.json` and `bin/`. `claude-code/`, `opencode/` and `open-webui/` moved up from `ports/`. A file one harness reads lives in that harness's directory; docs, tests, CI, the README and the Claude Code marketplace stay at the root.
- **Installers share one pattern**, `<harness>/bin/flow-<harness>` with `install`, `verify` and `doctor`. `scripts/omp-stack` became `omp/bin/flow-omp`; `scripts/flow-sessions` became `omp/bin/flow-sessions` because it reads only OMP transcripts.
- **The installers also own links into the previous checkout name.** `OLD_ROOT` is the sibling `omp-stack` path. After the folder rename `readlink -f` fails on those links (a middle component is missing), so the raw target is compared, and it matches `OLD_ROOT` exactly. Targets with `/../` or `/./` are refused before that match, so the widening stays bounded to the one old path.
- **The moves are a commit of pure renames**, separate from path and name edits, so `git log --follow` crosses them. The field-trial audit's baseline commands use `-M --diff-filter=ACDMT` over the old and new paths so the rename does not reset every skill's baseline.
- **Historical records keep the name they were written under**: `docs/decisions/*`, `docs/reports/*` and `docs/FIELD-TRIALS.md`.
- **The Claude Code plugin is named `fiatcode`**, so its parts are `fiatcode:<skill>` and `fiatcode:<agent>`, installed as `fiatcode@flow-skills`.
- **The live OMP session survived the move** through three untracked symlinks (`agent`, `profiles`, `ports/opencode`) created in the same command as each move and removed in the switch-over, which was: remove the symlinks, rename the folder, rerun both installers, restart OMP. Acceptance came before the switch-over because the symlinks counted in the accepted tree.

## Rejected alternatives

- Extracting the doctrine into a new `flow-skills` repository and keeping `omp-stack` for OMP setup: OMP would be the only harness with a separate setup repository, and the split needed cross-repository checks of the role vocabulary and the publication ask list.
- One repository per harness: the ports change together with the doctrine and the validator needs them in one checkout.
- Rewriting history to carry the new paths: the renames are followed with `--follow` and `-M`.

## Open questions

- `git log --follow` on the nine byte-identical Claude port mirrors (for example `claude-code/skills/flow-tdd/SKILL.md`) follows the OMP original's history, because git paired the identical blobs in the rename commit.
- (Resolved) Dangling links under the old name that end in `/..` or `/.` are refused like `/../` and `/./`.
- `main`'s ruleset asks for a pull request and the `test` check; the rename and its follow-ups landed by the owner's bypass.
