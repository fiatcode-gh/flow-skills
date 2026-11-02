# Flow on Windows

## Status

Windows support is CI-tested on `windows-latest` and not yet field-tested on a real machine. The CI job covers:

- the validator;
- the installer tests: install, verify, refusal of foreign links and real files, and the stop when Windows does not allow symlinks;
- with OMP and OpenCode installed on the runner, the checks that need no login: OpenCode `debug agents` and the skill list (every Flow agent and skill found once), and OMP loading its config and Flow skills;
- the Claude Code session-start hook run under Git Bash, printing the core text;
- `flow_approve`, `flow_check` and the `.flow/` exclude guard run under Git Bash.

CI does not cover the OMP extensions' Node and Bun tests, or interactive sessions with logins. The checks still open are listed at the end of this page.

## Prerequisites

- **Git for Windows.** It is the shell agents run commands in (see the shell rule below). It also gives you `sh`, `sha256sum`, `mktemp`, `awk` and `tar`.
- **PowerShell 7.2 or newer.** The launchers are `.ps1` scripts and need `pwsh`, not Windows PowerShell 5.1.
- **Developer Mode** (Settings > System > For developers), or an elevated shell. Flow links files with real symlinks, and Windows only allows that for administrators or in Developer Mode.
- **Execution policy.** Run once: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.
- **Each harness's own Windows install:**
  - OMP: `irm https://omp.sh/install.ps1 | iex`.
  - Claude Code: follow its documentation. It requires Git for Windows.
  - OpenCode: `npm install -g opencode-ai`, or scoop or choco.

## Install

Clone the repository, keep it where it is (the links point into it), then run the launchers from PowerShell:

```powershell
.\omp\bin\flow-omp.ps1 install
.\omp\bin\flow-omp.ps1 verify
.\omp\bin\flow-omp.ps1 doctor

.\opencode\bin\flow-opencode.ps1 install
opencode reload
.\opencode\bin\flow-opencode.ps1 doctor
.\opencode\bin\flow-opencode.ps1 run claude-agent
```

Claude Code installs the plugin with the same `claude plugin` commands as on Linux; see the README.

The launchers follow the same rules as the `sh` installers: they link only, replace a missing destination or a link they own, refuse anything else and name it, and never write credentials or touch a differing real `config.yml` or `opencode.json`.

Where the links go:

- OMP: `%USERPROFILE%\.omp\profiles\<profile>\agent`, and the shared `%USERPROFILE%\.omp\agent\keybindings.yml`. When `omp` is on `PATH` the launcher asks it (`omp --profile <p> config path`).
- OpenCode: `%USERPROFILE%\.config\opencode`, or `XDG_CONFIG_HOME` when set. When `opencode` is on `PATH` the launcher asks it (`opencode debug paths config`).

**When Windows refuses symlinks.** Before it changes anything, `install` tries to create a throwaway link in the temp folder. If Windows says the privilege is missing, it stops with `error: cannot create symlinks: enable Windows Developer Mode (Settings > System > For developers) or run this from an elevated PowerShell; nothing was changed`. Turn on Developer Mode, or open an elevated PowerShell, and run `install` again. Flow never falls back to copies or hard links, because both drift silently when the checkout changes.

**Launchers on `PATH`.** Link both `.ps1` files into a folder on `PATH` and add the `oc` shortcut to your profile:

```powershell
$bin = "$HOME\.local\bin"; New-Item -ItemType Directory -Force $bin | Out-Null
$repo = "$HOME\Development\Projects\fiatcode-gh\flow-skills"
[IO.File]::CreateSymbolicLink("$bin\flow-omp.ps1", "$repo\omp\bin\flow-omp.ps1")
[IO.File]::CreateSymbolicLink("$bin\flow-opencode.ps1", "$repo\opencode\bin\flow-opencode.ps1")
# add $bin to your user PATH, then put this in $PROFILE:
function oc { flow-opencode run @args }
```

## The shell rule

Flow's doctrine is POSIX `sh` and stays so: `mktemp -d`, `readlink -f`, `sha256sum`, the `.flow/` exclude guard and `flow_approve` / `flow_check` are all `sh`. On Windows the agent's shell must therefore be Git Bash, never PowerShell and never WSL's `bash.exe`. Each harness gets there differently:

- **Claude Code** runs its Bash tool and hooks in Git Bash when Git for Windows is installed. If it cannot find it, set `CLAUDE_CODE_GIT_BASH_PATH`. Do not enable its PowerShell tool.
- **OMP**: the `bash` tool is an embedded bash on every OS, so nothing needs configuring. OMP also picks Git Bash on its own for services and `!` commands. The `shellPath` setting only overrides that choice.
- **OpenCode** defaults to PowerShell on Windows. `flow-opencode.ps1 run` therefore sets `OPENCODE_CONFIG_CONTENT={"shell":"<Git Bash>"}` for that launch. Plain `opencode` (the background service, with the base config) uses PowerShell unless you set the same variable for your user:

  ```powershell
  [Environment]::SetEnvironmentVariable('OPENCODE_CONFIG_CONTENT','{"shell":"C:\\Program Files\\Git\\bin\\bash.exe"}','User')
  ```

  The launcher finds Git Bash from `OPENCODE_GIT_BASH_PATH`, then from `git` on `PATH`, then from the usual Git for Windows folders. It never picks WSL's `bash.exe`.

The shared `opencode.json` does not carry a `shell` key, because that would change Linux too: the interactive shell there would switch from fish to bash.

## Git Bash notes

- `mktemp -d` lands in `%LOCALAPPDATA%\Temp`.
- Paths print as `/c/Users/...` inside Git Bash and `C:\Users\...` outside it.
- `ln -s` in Git Bash copies the file unless `MSYS=winsymlinks:nativestrict` is set. Use the installers for links.
- `readlink -f`, `sha256sum`, `cmp`, `awk` and `tar` are present.
- `flow_approve`, `flow_check` and the `.flow/` exclude guard run unchanged; CI proves it.
- `.gitattributes` keeps line endings as LF, so the `sh` scripts work in a Windows checkout.

## Tests and CI

Run the whole suite from PowerShell with `pwsh tests/run.ps1`. It checks the PowerShell syntax, runs the validator, runs both launcher tests, then runs the `sh` tests (`approval-record`, `flow-exclude`, `session-start`) under Git Bash.

The `windows` CI job runs on `windows-latest`. It checks out the repository, installs uv, Node, OMP and OpenCode, runs `tests/run.ps1`, then runs `tests/windows-ci-tools.ps1` against the real OMP and OpenCode tools. Those need no login.

The no-symlink-permission scenarios are proven with a privilege drop. `tests/without-symlink-privilege.ps1` removes the symlink privilege from its own process token and runs the installer under it. With Developer Mode on, `install` still succeeds. With Developer Mode switched off in the registry, `install` stops with the message above and the scratch home is untouched. These scenarios need an elevated shell and are skipped otherwise.

Only Linux runs the `sh` installer tests, the OMP extension tests (Node and Bun) and the bash-pattern check against OMP's matcher. The PowerShell launcher tests also run on Linux under `pwsh`.

## Manual checks still open

To do on a real Windows machine:

1. Turn on Developer Mode. Install Git for Windows, PowerShell 7, OMP, OpenCode and Claude Code.
2. Clone the repository and run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.
3. Run `.\omp\bin\flow-omp.ps1 install`, `verify` and `doctor`. Log in with `omp --profile anthropic` and run one Flow turn that uses `mktemp -d` and `sha256sum` in the bash tool.
4. Run `.\opencode\bin\flow-opencode.ps1 install`, `opencode reload`, `doctor`, then `run claude-agent`. Connect with `/connect` and ask it to run `uname -s`; expect `MINGW64_NT...`.
5. Run `claude plugin marketplace add fiatcode-gh/flow-skills` and `claude plugin install fiatcode@flow-skills`. Start a session and confirm the Flow core prints and `flow_approve` / `flow_check` work in its Bash tool.
6. Put the launchers on `PATH` with the recipe above, add the `oc` function to `$PROFILE`, and run `oc claude-agent`.

Record the results on the Flow Skills page, and file upstream issues for anything on the OMP, OpenCode or Claude Code side.
