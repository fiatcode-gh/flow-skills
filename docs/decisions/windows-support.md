# Windows support

Work: `feat/windows-support`, 2026-11-02.

## Decisions

- **Windows gets two PowerShell launchers, `omp/bin/flow-omp.ps1` and `opencode/bin/flow-opencode.ps1`.** They have the same commands, messages and exit codes as the `sh` installers (`install`, `verify`, `doctor`, and `run <profile>` for OpenCode). Each is self-contained, like the `sh` pair, so the harness directories stay independent. They need PowerShell 7.2 and run in strict mode. The `sh` scripts and the config templates do not change, so Linux behavior is unchanged.
- **Links are real symlinks, created through .NET.** `[IO.Directory]::CreateSymbolicLink` and `[IO.File]::CreateSymbolicLink` pass the unprivileged-create flag on Windows 10 and later, so they work with Developer Mode and without elevation. `New-Item -ItemType SymbolicLink` is reported to still demand elevation in several PowerShell 7 versions, so it is not used. Replacing an owned link deletes the link object only, never its target. The ownership rules copy `link_owned` from the `sh` installers, including the refusal of `.` and `..` segments.
- **`install` stops before changing anything when symlinks are not allowed.** After resolving every destination and before touching any, it creates and deletes a probe link in the temp folder. If Windows reports the missing privilege, it exits 1 with a message that names Developer Mode and an elevated shell. Any other probe error is reported as it is. The probe is skipped on non-Windows `pwsh`.
- **OpenCode's agent shell is set by the launcher.** OpenCode defaults to PowerShell on Windows. `flow-opencode.ps1 run <profile>` sets `OPENCODE_CONFIG_CONTENT={"shell":"<Git Bash>"}` for that launch only, because `OPENCODE_CONFIG_CONTENT` ranks above the project and profile config. Git Bash comes from `OPENCODE_GIT_BASH_PATH`, then from `git` on `PATH` (OpenCode's own derivation), then from the usual install folders, and never from WSL's `bash.exe`. A user who wants plain `opencode` to use Git Bash sets the same variable for their user account.
- **The shared `opencode.json` and the profiles carry no `shell` key.** That would change Linux: the interactive shell there would switch from fish to bash, and the validator pin on those files would break.
- **OMP needs nothing.** Its `bash` tool always runs an embedded bash, and `shellPath` only selects the external shell for services, terminals and `!` commands. On Windows OMP finds Git Bash for those by itself. The profile `config.yml` templates stay shell-free. This comes from OMP's `docs/settings.md` and `packages/utils/src/procmgr.ts`.
- **Claude Code needs no change.** It runs shell-form hooks through Git Bash when Git for Windows is installed. A new `tests/session-start.test.sh` runs the hook with the mixed path form Claude passes and checks the core text, so the claim is tested.
- **The home directory is `USERPROFILE` on Windows and `HOME` elsewhere.** That is what OMP and OpenCode use (`os.homedir()`). Tests set both variables for child processes.
- **The OpenCode config root is discovered.** The launcher asks `opencode debug paths config` when `opencode` is on `PATH`, and otherwise uses `XDG_CONFIG_HOME` or `~\.config`, which is the verified default. The `sh` installer never asks; the contract asks for discovery where the tool can tell us. OMP's profile directory is discovered the same way with `omp --profile <p> config path`.
- **A `.gitattributes` file with `* text=auto eol=lf` keeps LF in Windows checkouts**, so the `sh` scripts, the hook and the exclude-guard snippet run under Git Bash.
- **The no-permission stop is proven by dropping a privilege, not by reading code.** On an elevated Windows runner, `tests/without-symlink-privilege.ps1` removes the symlink privilege from its own token and runs the installer. With Developer Mode on it must still link; with the registry value off it must stop and leave the scratch home untouched. The limits: it needs an elevated shell, it relies on Windows reading the registry value live, and it is skipped otherwise. If the second scenario does not hold on the runner, it is dropped and the stop path rests on the probe code plus the manual check.
- **Windows support is stated as CI-tested and not yet field-tested.** The README, `docs/WINDOWS.md` and the release notes carry the same sentence. `tests/validate.py` pins the markers.

## Rejected alternatives

- A `shell` key in the shared `opencode.json` or the profiles: it changes Linux, as above.
- A Windows-only profile set: it duplicates every profile.
- Copying files instead of linking on Windows: copies drift silently.
- `mklink` or `New-Item` for links: unreliable without elevation.
- Pester for the tests: plain scripts match the `sh` tests and need no module.
- Porting the `sh` installers to run under Git Bash: MSYS `ln -s` copies by default, and OMP prints Windows paths.
- Running the Node and Bun extension tests on Windows: outside the contract's CI list. They are recorded as not Windows-tested.

## Open questions

- How the launchers and the agents behave in real Windows sessions with logins: the support was accepted on CI and headless checks.
- Whether OpenCode's skill list reports the link path or the resolved checkout path on Windows. The doctor accepts either.
- Whether a Windows PowerShell 5.1 fallback is wanted. Today the launchers need PowerShell 7.2.
- Whether to run the OMP extension tests on Windows.
