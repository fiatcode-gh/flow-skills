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

## Temporary workspace

When Flow itself needs review scratch state that spans commands, create one unique root and reuse the exact returned path for the whole review round:

```bash
review_tmp=$(mktemp -d "${TMPDIR:-/tmp}/flow-review.XXXXXX")
printf '%s\n' "$review_tmp"
```

Put Flow-created packets, payloads, generated context and disposable worktrees beneath that root, for example `"$review_tmp/packet"`, `"$review_tmp/review.json"` and `"$review_tmp/worktree"`. Never invent fixed paths such as `/tmp/pr620`, `/tmp/review-pr`, or another predictable top-level `/tmp/<name>` directory. A tool-owned GitHub operation may own its own managed checkout path; do not relocate or delete tool-owned state merely to fit this convention.

If a registered Git worktree lives under `review_tmp`, remove it with `git worktree remove` before deleting the root. At round completion or safe abort, delete only the exact Flow-created root after its owned worktrees are gone:

```bash
rm -rf -- "${review_tmp:?review_tmp not set}"
```

## Reads

Prefer `gh` read-only commands: `gh pr view <number>`, `gh pr diff <number>`, `gh pr checks <number>`, `gh api` GET requests for comments and review threads. When local execution against the PR head is required, use `gh pr checkout <number>` inside `review_tmp` (a disposable clone or worktree there), never the user's checkout. Verify the checked-out head still equals fresh GitHub metadata before relying on results.

After the user approves the exact review draft, use `gh api` to submit the batched review. Read access is not publication permission.

## Publication safety

Immediately before publication, query the remote head again. If it moved, post nothing; rebuild the draft against the new head.

Submit one review transaction:

```bash
gh api -X POST "repos/$base_repo/pulls/$number/reviews" --input "$payload_file"
```

Validate inline anchors against the current diff before submission. If a call may have partially written anything, report exactly what is known to have posted and never retry blindly.

The authenticated PR author cannot issue a formal approve/request-changes verdict on their own PR; use comment in that case.

## Approval prompts

The `permission.bash` ask rules in `opencode.json` prompt on `gh api` calls that carry a request-method or body flag as its own token (`-X`, `--method`, `-f`, `-F`, `--field`, `--raw-field`, `--input`), and on `gh pr create/merge/review/comment/edit/close`, `gh issue comment`, `gh release create`, and `git push`. Plain `gh api` reads do not prompt. Write exactly as the commands in these references do, with the flag as a separate token. The prompt is a runtime backstop for the approval rule in the Safety section of `AGENTS.md`, not a substitute for it.

Verified against GitHub CLI 2.92.0 on 2026-08-22.
