/**
 * flow-skills — Claude Code flow-guard: git access, the `.flow/` exclude, the worktree identity and the one canonical
 * path answer every other module resolves a path through.
 *
 * Invariant: the repository root is read from git on every call, never captured, and canonicalised like every other
 * path this guard judges. `ensureFlowExcluded` and the fingerprint recipe are from
 * omp/extensions/flow-governance-guard.ts and opencode/plugins/flow-guard/git.ts, over the Host boundary: a scratch
 * index loaded from the real index's entries and a pre-created scratch object directory that reads the real one as an
 * alternate, so an acceptance recorded here binds the same fingerprint as the other two ports and nothing is written
 * inside the repository.
 */
import type { Host } from "./host.ts";
import { ancestors, exceedsPathLimit, expandHome, inSeparatorForm, isAbsolute, join, resolve, sepOf } from "./paths.ts";

// One counter per process, so two fingerprints in the same millisecond cannot share a scratch directory.
let scratchCounter = 0;

// Git output that does not fit the host's buffer is a failure, never a prefix to hash. `stdin` is written to the child.
async function git(host: Host, cwd: string, args: string[], env?: Record<string, string>, stdin?: string): Promise<string> {
	const result = await host.run(["git", ...args], stdin === undefined ? { cwd, env } : { cwd, env, stdin });
	if (result.isTruncated) throw new Error(`git ${args[0]} output was truncated`);
	if (result.exitCode !== 0) {
		throw new Error(result.stderr.trim() || `git ${args[0]} exited ${result.exitCode}`);
	}
	return result.stdout;
}

export async function repoRoot(host: Host, cwd: string): Promise<string> {
	const answer = (await git(host, cwd, ["rev-parse", "--show-toplevel"])).trim();
	if (answer === "") throw new Error("git rev-parse --show-toplevel answered nothing");
	// The raw answer stands only when the host can canonicalise nothing: every caller resolves paths against this root.
	return (await canonicalPath(host, answer)) ?? answer;
}

// `realpath` answers where `stat` gave no `realPath`; a shell that cannot run it or exits non-zero has no answer. On
// Windows it is usually Git's MSYS build, which prints `/c/Users/...`: for a Windows-form `path` that answer is read
// as drive `C:`, a `//host/share` UNC answer is taken in its `\` form (so a missing tail joins below the share), and
// any other `/...` answer (a path inside the MSYS root) is no answer. A POSIX `path` keeps the answer as printed.
async function realpathOf(host: Pick<Host, "run">, path: string): Promise<string | undefined> {
	let answer: string;
	try {
		const result = await host.run(["realpath", path]);
		if (result.exitCode !== 0 || result.isTruncated) return undefined;
		answer = result.stdout.trim();
	} catch {
		return undefined;
	}
	if (answer === "") return undefined;
	if (sepOf(path) !== "\\" || sepOf(answer) === "\\") return answer;
	if (answer.startsWith("//")) return answer.replaceAll("/", "\\");
	const drive = /^\/([A-Za-z])(\/.*)?$/.exec(answer);
	return drive === null ? undefined : `${drive[1].toUpperCase()}:${drive[2] ?? "/"}`;
}

// Where a path really is: the deepest existing ancestor, canonicalised, with the missing tail re-appended; `undefined`
// when the host can canonicalise nothing on the way up. `stat().realPath` is the engine's own answer, requested with
// `{ resolve: true }`; `realpath` is the fallback for an engine that answers none. Every caller treats `undefined` as
// unknown and fails closed, so a link is never silently trusted and a host with neither source is never assumed. A
// Windows answer is rewritten into `path`'s `\` form, because the engine may print `C:/…` where
// every root and record path this guard builds speaks `\`; a POSIX answer stays byte-identical, because `\` is a legal
// file-name character there and the string is the identity key. The ancestors come from one scan and one past the path
// limit is not stat-ed, since it cannot exist, so the walk is linear in the path's length.
export async function canonicalPath(host: Pick<Host, "stat" | "run">, path: string): Promise<string | undefined> {
	const sep = sepOf(path);
	for (const { dir, tail } of ancestors(path)) {
		if (exceedsPathLimit(dir)) continue;
		const stats = await host.stat(dir).catch(() => undefined);
		if (stats === undefined) continue;
		const real = stats.realPath ?? (await realpathOf(host, dir));
		if (real === undefined) return undefined;
		return inSeparatorForm(tail === "" ? real : resolve(real, tail), sep);
	}
	return undefined;
}

// The absolute path a tool target names, with `~` expanded as the harness expands it (`HOME`, then `USERPROFILE`; with
// neither, `~` stays as written). A relative target without a session working directory cannot be resolved, which
// fails closed: the guard judges the path the tool will touch, or refuses.
export async function absoluteTarget(host: Pick<Host, "env">, cwd: string, raw: string): Promise<string> {
	const home = (await host.env("HOME")) ?? (await host.env("USERPROFILE"));
	const expanded = expandHome(raw, home, sepOf(cwd === "" ? raw : cwd) === "\\" ? "win32" : "linux");
	if (cwd === "" && !isAbsolute(expanded)) throw new Error("cannot resolve a relative target without a working directory");
	return resolve(cwd, expanded);
}

export async function ensureFlowExcluded(host: Host, root: string): Promise<void> {
	const commonDir = (await git(host, root, ["rev-parse", "--path-format=absolute", "--git-common-dir"])).trim();
	const exclude = resolve(commonDir, "info/exclude");
	const current = (await host.exists(exclude)) ? await host.read(exclude) : "";
	if (current.split(/\r?\n/).includes("/.flow/")) return;
	// The file API creates the missing parents, so no directory has to be prepared first.
	const separator = current === "" || current.endsWith("\n") ? "" : "\n";
	await host.write(exclude, `${current}${separator}/.flow/\n`);
}

// The one reader of the head: the commit HEAD names, or `UNBORN` before the first commit.
export async function headRevision(host: Host, root: string): Promise<string> {
	const result = await host.run(["git", "rev-parse", "--verify", "--quiet", "HEAD"], { cwd: root });
	// `--verify --quiet` exits 1 without output only when HEAD names no commit yet.
	if (result.exitCode === 1 && result.stdout === "") return "UNBORN";
	if (result.exitCode !== 0) throw new Error(result.stderr.trim() || `git rev-parse exited ${result.exitCode}`);
	return result.stdout.trim();
}

// The environment variables git needs from the engine: the executable path, the user's home and profile, Windows'
// system root, the scratch base, the two config-file overrides, the XDG config base and the switch that drops the
// system config. A global `.gitconfig` reached through `HOME`, or `git/config` under `XDG_CONFIG_HOME`, is what keeps
// this port's tree identical to the OpenCode one.
export const GIT_ENVIRONMENT_NAMES = [
	"PATH",
	"HOME",
	"USERPROFILE",
	"SystemRoot",
	"TMPDIR",
	"TEMP",
	"TMP",
	"GIT_CONFIG_GLOBAL",
	"GIT_CONFIG_SYSTEM",
	"XDG_CONFIG_HOME",
	"GIT_CONFIG_NOSYSTEM",
] as const;

// The replacement environment for the fingerprint's git child: every named variable the host answers, then the
// caller's own overrides. Variables the host does not answer are omitted, not blanked.
async function gitEnvironment(host: Host, overrides: Record<string, string> = {}): Promise<Record<string, string>> {
	const environment: Record<string, string> = {};
	for (const name of GIT_ENVIRONMENT_NAMES) {
		const value = await host.env(name);
		if (value !== undefined) environment[name] = value;
	}
	return { ...environment, ...overrides };
}

const INDEX_NOT_UTF8 = "Flow gate cannot reproduce the git index in a scratch index: a path is not UTF-8.";
const INDEX_NOT_REPRODUCED = "Flow gate cannot reproduce the git index in a scratch index; nothing was recorded.";

// The paths of a `ls-files -v -z` listing whose tag passes `wanted`, `\0`-terminated for `update-index -z --stdin`.
// An entry is `<tag> <path>`.
function taggedPaths(flags: string, wanted: (tag: string) => boolean): string {
	return flags
		.split("\0")
		.filter((entry) => entry.length > 2 && wanted(entry[0]))
		.map((entry) => `${entry.slice(2)}\0`)
		.join("");
}

// The tree `git add -A` would write for the working tree: tracked and untracked files, ignore rules applied, each
// tracked entry starting from the real index's mode and flags. It is built in a scratch index and a scratch object
// directory, so nothing is written into the repository. The scratch index is loaded from the real index's entries
// because the engine's file API writes text only, so the index file cannot be copied; an empty index would lose a
// tracked file that matches an ignore rule, and the executable bit and symlink mode where `core.filemode` or
// `core.symlinks` is off. The load is verified against the real listing because a build whose process call ignores
// `stdin` would load nothing and still answer a tree. The loaded entries carry no stat data, so `add -A` hashes every
// tracked file again: slower on a large tree, and no racy-entry case can arise.
async function worktreeTree(host: Host, root: string, objects: string, environment: Record<string, string>): Promise<string> {
	const base = (await host.env("TMPDIR")) || (await host.env("TEMP")) || (await host.env("TMP")) || "/tmp";
	scratchCounter += 1;
	const scratch = join(base, `flow-gate-tree-${Date.now()}-${scratchCounter}`);
	const objectsDirectory = join(scratch, "objects");
	// `GIT_OBJECT_DIRECTORY` must exist before git will see the repository at all.
	await host.write(join(objectsDirectory, "keep.txt"), "");
	const entries = await git(host, root, ["ls-files", "-s", "-z"], environment);
	const flags = await git(host, root, ["ls-files", "-v", "-z"], environment);
	// The process API answers text, so a path that is not UTF-8 would load under another name.
	if (entries.includes("\uFFFD") || flags.includes("\uFFFD")) throw new Error(INDEX_NOT_UTF8);
	const scratchEnvironment = {
		...environment,
		GIT_INDEX_FILE: join(scratch, "index"),
		GIT_OBJECT_DIRECTORY: objectsDirectory,
		// The variable is `:`-separated; a C-quoted entry keeps a path that holds `:` whole.
		GIT_ALTERNATE_OBJECT_DIRECTORIES: `"${objects.replace(/[\\"]/g, "\\$&")}"`,
	};
	if (entries !== "") await git(host, root, ["update-index", "-z", "--index-info"], scratchEnvironment, entries);
	const skipWorktree = taggedPaths(flags, (tag) => tag === "S" || tag === "s");
	if (skipWorktree !== "") await git(host, root, ["update-index", "-z", "--skip-worktree", "--stdin"], scratchEnvironment, skipWorktree);
	const assumeUnchanged = taggedPaths(flags, (tag) => tag !== tag.toUpperCase());
	if (assumeUnchanged !== "") {
		await git(host, root, ["update-index", "-z", "--assume-unchanged", "--stdin"], scratchEnvironment, assumeUnchanged);
	}
	const loadedEntries = await git(host, root, ["ls-files", "-s", "-z"], scratchEnvironment);
	const loadedFlags = await git(host, root, ["ls-files", "-v", "-z"], scratchEnvironment);
	if (loadedEntries !== entries || loadedFlags !== flags) throw new Error(INDEX_NOT_REPRODUCED);
	await git(host, root, ["add", "-A", "--", "."], scratchEnvironment);
	return (await git(host, root, ["write-tree"], scratchEnvironment)).trim();
}

// Index entries of the paths staged differently from `base` and edited again in the working tree: the tree above
// reads only the working tree, so a change staged and then reverted would otherwise leave no trace.
async function mixedEntries(
	host: Host,
	root: string,
	base: string,
	environment: Record<string, string>,
): Promise<string> {
	const stagedOutput = await git(host, root, ["diff", "--cached", "--name-only", "-z", "--no-ext-diff", base, "--", "."], environment);
	const editedOutput = await git(host, root, ["diff", "--name-only", "-z", "--no-ext-diff", "--no-textconv", "--", "."], environment);
	const staged = new Set(stagedOutput.split("\0").filter((entry) => entry !== ""));
	const edited = editedOutput.split("\0").filter((entry) => entry !== "");
	const mixed = edited.filter((path) => staged.has(path)).sort();
	if (mixed.length === 0) return "";
	return git(host, root, ["--literal-pathspecs", "ls-files", "-s", "-z", "--", ...mixed]);
}

// `head` is for messages only: a commit of the accepted tree keeps the fingerprint.
export async function worktreeIdentity(host: Host, root: string): Promise<{ head: string; tree: string; fingerprint: string }> {
	const head = await headRevision(host, root);
	// An unborn repository compares its staged paths against the empty tree.
	const base =
		head === "UNBORN"
			? (await git(host, root, ["hash-object", "-t", "tree", "/dev/null"])).trim()
			: "HEAD";
	const objects = (await git(host, root, ["rev-parse", "--path-format=absolute", "--git-path", "objects"])).trim();
	const environment = await gitEnvironment(host);
	const tree = await worktreeTree(host, root, objects, environment);
	const mixed = await mixedEntries(host, root, base, environment);
	return {
		head,
		tree,
		fingerprint: await host.sha256(`tree\0${tree}${mixed === "" ? "" : `\0mixed\0${mixed}`}`),
	};
}
