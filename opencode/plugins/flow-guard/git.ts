/**
 * flow-skills — OpenCode flow-guard: git access, the `.flow/` exclude and the worktree identity.
 *
 * Invariant: the repository root is read from git on every call, never captured. The functions below are byte-for-byte
 * copies of omp/extensions/flow-governance-guard.ts, pinned by tests/validate.py, so an acceptance recorded by either
 * port binds the same fingerprint.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	appendFileSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

// Git output above this size fails closed instead of being truncated.
const GIT_OUTPUT_LIMIT = 256 * 1024 * 1024;

// Bounded so a stalled git (unreachable mount, remote GIT_DIR) cannot hold every file tool; callers treat a failure as
// "outside git" and fall back to the working directory.
function git(cwd: string, args: string[]): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		timeout: 10_000,
	}).trimEnd();
}

function repoRoot(cwd: string): string {
	return realpathSync(git(cwd, ["rev-parse", "--show-toplevel"]));
}

function ensureFlowExcluded(root: string): void {
	const commonDir = git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
	const exclude = resolve(commonDir, "info/exclude");
	const current = existsSync(exclude) ? readFileSync(exclude, "utf8") : "";
	if (current.split(/\r?\n/).includes("/.flow/")) return;
	mkdirSync(dirname(exclude), { recursive: true });
	const separator = current === "" || current.endsWith("\n") ? "" : "\n";
	appendFileSync(exclude, `${separator}/.flow/\n`, "utf8");
}

function gitBytes(root: string, args: string[], env?: NodeJS.ProcessEnv): Buffer {
	return execFileSync("git", args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"], maxBuffer: GIT_OUTPUT_LIMIT });
}

function headRevision(root: string): string {
	try {
		return git(root, ["rev-parse", "--verify", "--quiet", "HEAD"]);
	} catch (error) {
		// `--verify --quiet` exits 1 without output only when HEAD names no commit yet.
		if ((error as { status?: unknown }).status === 1) return "UNBORN";
		throw error;
	}
}

// The tree `git add -A` would write for the working tree: tracked and untracked files, ignore rules applied. It is
// built in a scratch index and a scratch object directory that reads the real one as an alternate, so nothing is
// written into the repository.
function worktreeTree(root: string): string {
	const index = git(root, ["rev-parse", "--path-format=absolute", "--git-path", "index"]);
	const objects = git(root, ["rev-parse", "--path-format=absolute", "--git-path", "objects"]);
	const scratch = mkdtempSync(join(tmpdir(), "flow-gate-tree-"));
	try {
		const scratchIndex = join(scratch, "index");
		if (existsSync(index)) {
			copyFileSync(index, scratchIndex);
			// Git's racy-entry check compares entry mtimes with the index's own mtime; keep it, or a same-size
			// rewrite in the second of the last index write looks clean and `add -A` keeps the stale blob.
			const { atime, mtime } = statSync(index);
			utimesSync(scratchIndex, atime, mtime);
		}
		const scratchObjects = join(scratch, "objects");
		mkdirSync(scratchObjects);
		const env = {
			...process.env,
			GIT_INDEX_FILE: scratchIndex,
			GIT_OBJECT_DIRECTORY: scratchObjects,
			// The variable is `:`-separated; a C-quoted entry keeps a path that holds `:` whole.
			GIT_ALTERNATE_OBJECT_DIRECTORIES: `"${objects.replace(/[\\"]/g, "\\$&")}"`,
		};
		gitBytes(root, ["add", "-A", "--", "."], env);
		return gitBytes(root, ["write-tree"], env).toString("utf8").trim();
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
}

// Index entries of the paths staged differently from `base` and edited again in the working tree: the tree above
// reads only the working tree, so a change staged and then reverted would otherwise leave no trace.
function mixedEntries(root: string, base: string): Buffer {
	const stagedPaths = gitBytes(root, ["diff", "--cached", "--name-only", "-z", "--no-ext-diff", base, "--", "."]);
	const editedPaths = gitBytes(root, ["diff", "--name-only", "-z", "--no-ext-diff", "--no-textconv", "--", "."]);
	const staged = new Set(stagedPaths.toString("utf8").split("\0").filter(Boolean));
	const edited = editedPaths.toString("utf8").split("\0").filter(Boolean);
	const mixed = edited.filter((path) => staged.has(path)).sort();
	if (mixed.length === 0) return Buffer.alloc(0);
	return gitBytes(root, ["--literal-pathspecs", "ls-files", "-s", "-z", "--", ...mixed]);
}

// `head` is for messages only: a commit of the accepted tree keeps the fingerprint.
function worktreeIdentity(root: string): { head: string; tree: string; fingerprint: string } {
	const head = headRevision(root);
	// An unborn repository compares its staged paths against the empty tree.
	const base = head === "UNBORN" ? git(root, ["hash-object", "-t", "tree", "/dev/null"]) : "HEAD";
	const tree = worktreeTree(root);
	const mixed = mixedEntries(root, base);
	const hash = createHash("sha256");
	hash.update(`tree\0${tree}`);
	if (mixed.length > 0) {
		hash.update("\0mixed\0");
		hash.update(mixed);
	}
	return { head, tree, fingerprint: hash.digest("hex") };
}

export { ensureFlowExcluded, git, repoRoot, worktreeIdentity };
