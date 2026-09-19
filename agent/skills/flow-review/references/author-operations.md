# Author operations for pull request review rounds

Every command is read-only until the approved reply. Run them from the base
repository. Read [`github-operations.md`](github-operations.md) first for remote detection
and authentication.

Set `pr` to the user-supplied pull request URL or number. Set `number` from the
resolved metadata, never by parsing free text. Keep collected metadata under one
temporary packet directory:

```bash
packet_dir=$(mktemp -d "${TMPDIR:-/tmp}/flow-pr-feedback.XXXXXX")
```

## Confirm authorship and branch state

The authenticated account must be the pull request author. If it is not, this is
reviewer work: stop and use `flow-review` PR-reviewer mode.

Fetch and compare. Never reset, force-push, or discard local work to resolve a
difference — the author's uncommitted changes exist nowhere else.

```bash
git fetch --prune origin
local_head=$(git rev-parse HEAD)
```

A `local_head` that differs from the GitHub-reported head stops the workflow and
goes to the user.

## GitHub feedback packet

```bash
base_repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
account=$(gh api user --jq .login)
gh pr view "$pr" --json \
  number,url,title,body,author,baseRefName,baseRefOid,headRefName,headRefOid,\
reviewDecision > "$packet_dir/pr.json"
number=$(jq -r .number "$packet_dir/pr.json")
head_oid=$(jq -r .headRefOid "$packet_dir/pr.json")
test "$(jq -r .author.login "$packet_dir/pr.json")" = "$account"
for resource in reviews comments; do
  gh api --paginate --slurp \
    "repos/$base_repo/pulls/$number/$resource?per_page=100" | jq '[.[][]]' \
    > "$packet_dir/pull-$resource.json"
done
gh api --paginate --slurp \
  "repos/$base_repo/issues/$number/comments?per_page=100" | jq '[.[][]]' \
  > "$packet_dir/issue-comments.json"
gh pr checks "$pr" --json name,state,bucket,description,link,workflow \
  > "$packet_dir/checks.json" || true
gh api graphql --paginate --slurp \
  -F owner="${base_repo%/*}" -F name="${base_repo#*/}" -F number="$number" \
  -f query='query($owner:String!,$name:String!,$number:Int!,$endCursor:String) {
    repository(owner:$owner,name:$name) { pullRequest(number:$number) {
      reviewThreads(first:100,after:$endCursor) {
        nodes { id isResolved isOutdated path line
          comments(first:100) { nodes { databaseId body author { login } } } }
        pageInfo { hasNextPage endCursor }
      }
    } }
  }' > "$packet_dir/thread-pages.json"
jq '[.[] | .data.repository.pullRequest.reviewThreads.nodes[]]' \
  "$packet_dir/thread-pages.json" > "$packet_dir/threads.json"
```

`gh pr checks` exits 8 while checks are pending, which is why the call tolerates
a nonzero status; read the state from the file rather than the exit code. Unlike
the reviewing workflow, collect all checks, not only required ones. Each thread
carries the `id` needed to reply and to resolve.

## Re-anchor each finding to the current head

A finding is judged against `head_oid`, never against the commit its review was
written on.

```bash
git diff --find-renames "$review_commit".."$head_oid" -- "$finding_path"
```

An empty diff means the cited code is unchanged and the finding still applies. A
diff that answers the concern makes the finding already addressed. A path absent
at `head_oid` with no successor makes it obsolete. The last two still need a
reply.

## Replying

GitHub has a per-thread reply and a resolution mutation. Reply first, then
resolve only threads that were fixed, accepted as disproved, already addressed,
or obsolete — never a clarification or deferred thread.

```bash
gh api graphql -f threadId="$thread_id" -f body="$reply_body" \
  -f query='mutation($threadId:ID!,$body:String!) {
    addPullRequestReviewThreadReply(
      input:{pullRequestReviewThreadId:$threadId, body:$body}
    ) { comment { url } }
  }'
gh api graphql -f threadId="$thread_id" \
  -f query='mutation($threadId:ID!) {
    resolveReviewThread(input:{threadId:$threadId}) {
      thread { id isResolved }
    }
  }'
reviewer_login=$(jq -r --arg me "$account" \
  '[.[] | select(.user.login != $me)] | last | .user.login' \
  "$packet_dir/pull-reviews.json")
gh pr edit "$number" --add-reviewer "$reviewer_login"
```

## Before and after posting

Perform the second head check immediately before the first write: re-read the
head from GitHub and compare it with `head_oid`. A mismatch posts nothing and
rebuilds the packet at the new head.

If any write partially succeeds, report exactly what was posted, stop, and never
retry blindly. Remove the packet directory once the round is reported:

```bash
rm -rf -- "${packet_dir:?packet directory not set}"
```

Verified against GitHub CLI 2.92.0 with live GraphQL schema introspection on
2026-08-22.
