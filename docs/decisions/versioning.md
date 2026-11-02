# Versioning

Work: `chore(release): 1.0.0` (`v1.0.0`), 2026-11-02.

## Decisions

- **One SemVer version for the whole repository.** Major means the user must act (reinstall, relink, re-import) or the approval gates changed; minor means a rule, skill or agent behavior changed; patch means wording, docs or tests only. 1.0.0 was the release after the rename to `flow-skills`.
- **`VERSION` is the source.** The Claude plugin's `plugin.json` version and the first line of the Open WebUI system prompt are hand-kept copies; `tests/validate.py` fails when either differs, when `VERSION` is not `MAJOR.MINOR.PATCH` with a plain newline, or when `marketplace.json` also sets a version (Claude Code silently prefers `plugin.json`).
- **The version shows only where it is otherwise invisible.** Claude Code shows it in `claude plugin list`; OMP and OpenCode run the checkout through symlinks, so `flow-omp doctor` and `flow-opencode doctor` print it. Open WebUI runs an imported copy, so its system prompt carries it. The always-on doctrine for Claude Code, OpenCode and OMP does not, because the model gains nothing from the release number.
- **Claude Code needs the bump to update.** With `version` set, `claude plugin update` keeps the cached copy until the version string changes.
- **A release** is: bump `VERSION` and its two copies, add the `CHANGELOG.md` entry, commit `chore(release): X.Y.Z`, push `main`, push an annotated tag `vX.Y.Z`, publish a GitHub release with the changelog entry as notes.

## Rejected alternatives

- CalVer: dates do not say whether a release needs action.
- No version (Claude following commits): no changelog and no way to tell what Open WebUI or a cloud session runs.
- The version in every always-on heading: text the model reads every session and never uses.

## Open questions

- A CI check that fails when a port changed since the last tag without a `VERSION` bump, if a missed bump happens.
