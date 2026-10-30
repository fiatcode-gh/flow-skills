# GitHub operations for Flow PR review

Shared by the PR reviewer and author-feedback modes. Current GitHub metadata is the source of truth; never publish a verdict against a stale head.

## Tools

In a cloud session `gh` is not authenticated. Use the GitHub MCP tools; load them with `ToolSearch` when they are deferred.

- Metadata, diff, files, reviews, review threads, comments and check status → `mcp__github__pull_request_read`.
- Account → `mcp__github__get_me`. Authorship decides the mode: the account that opened the pull request is in author-feedback mode, any other account is a reviewer.
- A local checkout of the head → `git fetch origin pull/<number>/head`, then a worktree under `review_tmp`.

Never read, print, or copy a token into a command.

## Temporary workspace

When review scratch state spans commands, create one unique root and reuse its exact path for the whole round:

```sh
review_tmp=$(mktemp -d "${TMPDIR:-/tmp}/flow-review.XXXXXX")
printf '%s\n' "$review_tmp"
```

Put packets, payloads and disposable worktrees beneath it, for example `"$review_tmp/worktree"`. Never invent fixed paths such as `/tmp/pr620`. Remove a worktree under it with `git worktree remove` before deleting the root, then delete only that root:

```sh
rm -rf -- "${review_tmp:?review_tmp not set}"
```

## Publication

Immediately before publication, query the remote head again. If it moved, post nothing; rebuild the draft against the new head.

- Submit one batched review: `mcp__github__pull_request_review_write` with `method: create` (pending), then `mcp__github__add_comment_to_pending_review` per inline comment, then `pull_request_review_write` with `method: submit_pending`.
- Reply on a thread → `mcp__github__add_reply_to_pull_request_comment`. Resolve → `mcp__github__resolve_review_thread`. Reply first, then resolve.
- Validate inline anchors against the current diff before submission.
- If a call may have partially written anything, report exactly what is known to have posted and never retry blindly.
- The pull request author cannot approve or request changes on their own pull request; use a comment.
