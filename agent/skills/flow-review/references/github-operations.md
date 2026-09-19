# GitHub operations for Flow PR review

Shared by the PR reviewer and author-feedback modes. Run every command from the
base repository. Current GitHub metadata is the source of truth; never publish a
verdict against a stale head.

## Remote detection and authentication

```bash
remote_url=$(git remote get-url origin)
```

- `github.com` uses `gh`. Run `gh auth status` and obtain the account with
  `gh api user --jq .login`.
- A missing, unsupported, or ambiguous remote stops the workflow. This stack
  supports GitHub only.

`gh` uses stored credentials. Never read, print, or copy a token into a command.

## Reads on OMP

Prefer OMP-native reads:

- `pr://<number>` / repo-qualified PR URLs for metadata, comments, and review context;
- `pr://<number>/diff`, `/diff/<i>`, or `/diff/all` for changed files/diff;
- OMP's `github` tool for repo/file/search/checkouts when enabled;
- the bundled `reviewer` can inspect `gh pr diff <number>` read-only when `gh` is available.

When local execution against the PR head is required, prefer OMP's GitHub `pr_checkout` operation rather than hand-rolling a user worktree. Verify the checked-out head still equals fresh GitHub metadata before relying on results.

OMP's current GitHub tool does not expose a submit-review operation. After the user approves the exact review draft, use `gh api` to submit the batched review. Do not confuse native read/check-out support with publication permission.

## Publication safety

Immediately before publication, query the remote head again. If it moved, post nothing; rebuild the draft against the new head.

Submit one review transaction:

```bash
gh api -X POST "repos/$base_repo/pulls/$number/reviews" --input "$payload_file"
```

Validate inline anchors against the current diff before submission. If a call may have partially written anything, report exactly what is known to have posted and never retry blindly.

The authenticated PR author cannot issue a formal approve/request-changes verdict on their own PR; use comment in that case.

## Approval prompts

The profile `bash.patterns` prompt on `gh api` calls that carry a request-method or body flag as its own token (`-X`, `--method`, `-f`, `-F`, `--field`, `--raw-field`, `--input`), and on `gh pr create/merge/review/comment/edit/close`, `gh issue comment`, `gh release create`, and `git push`. Plain `gh api` reads do not prompt. Write exactly as the commands in these references do, with the flag as a separate token. The prompt is a runtime backstop for the approval rule in `flow-safety`, not a substitute for it.

Verified against GitHub CLI 2.92.0 on 2026-08-22.
