# External worktree validation

Given a user-supplied path:

```sh
wt=$(cd -- "<path>" && pwd)
git -C "${wt:?}" rev-parse --path-format=absolute --git-dir
git -C "${wt:?}" rev-parse --path-format=absolute --git-common-dir
git -C "${wt:?}" status --porcelain
git -C "${wt:?}" rev-parse --abbrev-ref HEAD
git -C "${wt:?}" rev-parse HEAD
```

Compare the common-dir to the intended repository's absolute common-dir. Equal git-dir/common-dir means a main checkout, not a linked worktree. Empty `status --porcelain` is clean. `HEAD` from `--abbrev-ref` means detached.

Stop and report on:

- dirty state;
- another repository/common-dir;
- branch already checked out in a sibling worktree;
- main/master without explicit user consent;
- detached/unexpected base when the handoff expected a branch.

Never use `--ignore-other-worktrees`, stash/discard user changes, or silently switch an existing user workspace to make it fit.
