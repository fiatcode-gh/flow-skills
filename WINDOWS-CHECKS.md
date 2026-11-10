# Flow 1.2.0 Windows checks on a real machine

Windows support shipped in `1.2.0` (2026-11-03) on CI proof only. Run these on a real Windows machine.

- [ ] 1. Turn on Developer Mode (Settings > System > For developers). Install Git for Windows, PowerShell 7, OMP (`irm https://omp.sh/install.ps1 | iex`), OpenCode (`npm i -g @opencode/cli`) and Claude Code.
- [ ] 2. `git clone` flow-skills; `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.
- [ ] 3. `.\omp\bin\flow-omp.ps1 install`, `verify`, `doctor`. Log in with `omp --profile anthropic` and run one Flow turn that runs `mktemp -d` and `sha256sum` in the bash tool.
- [ ] 4. `.\opencode\bin\flow-opencode.ps1 install`, `opencode reload`, `doctor`, then `run claude-agent` with `/connect`. Ask it to run `uname -s`; expect `MINGW64_NT...`.
- [ ] 5. `claude plugin marketplace add fiatcode-gh/flow-skills`, `claude plugin install fiatcode@flow-skills`. Start a session and confirm the Flow core prints and `flow_approve` / `flow_check` work in its Bash tool.
- [ ] 6. Launcher on PATH: `[IO.File]::CreateSymbolicLink("$HOME\.local\bin\flow-opencode.ps1", "<checkout>\opencode\bin\flow-opencode.ps1")`, add the PATH entry and the `oc` function to `$PROFILE`, then run `oc claude-agent`.

Record the results on the Flow Skills page, and file upstream issues for anything on the OMP, OpenCode or Claude Code side.
