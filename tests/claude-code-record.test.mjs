// Behavioral tests for the Claude Code port's approval record (guard/record.ts) and its worktree fingerprint
// (guard/tree.ts), driven through the host model against real temporary repositories, plus the digest, record-format,
// path and fingerprint parity with the OpenCode implementation the port mirrors (opencode/plugins/flow-guard/record.ts
// and git.ts). Dependency-free: Node's type stripping and Bun both load the modules.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hostOf } from "../claude-code/hooks/guard/host.ts";
import { ancestors, exceedsPathLimit, join as guardJoin } from "../claude-code/hooks/guard/paths.ts";
import {
	RECORD_RELATIVE_PATH,
	artifactDigest,
	artifactIdentity,
	latestRecord,
	readRecord,
	recordedArtifactPath,
	rootRelativePath,
	writeRecord,
} from "../claude-code/hooks/guard/record.ts";
import { canonicalPath, repoRoot, worktreeIdentity } from "../claude-code/hooks/guard/tree.ts";
import {
	artifactDigest as opencodeDigest,
	readRecord as opencodeReadRecord,
	rootRelativePath as opencodeRootRelativePath,
} from "../opencode/plugins/flow-guard/record.ts";
import { worktreeIdentity as opencodeWorktreeIdentity } from "../opencode/plugins/flow-guard/git.ts";
import { createModHost } from "./claude-code-mod-host.mjs";

// The engine answers `$.env.get` from the process environment. The fixture carries every variable the guard reads, so
// the scratch directory and git's config discovery behave as they do in a real session on either platform.
const ENGINE_ENV = Object.fromEntries(
	["PATH", "HOME", "USERPROFILE", "SystemRoot", "TMPDIR", "TEMP", "TMP", "XDG_CONFIG_HOME", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM"]
		.flatMap((name) => (process.env[name] === undefined ? [] : [[name, process.env[name]]])),
);
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const temporary = [];

// The root in the long form git and the engine answer: on Windows the JavaScript `realpathSync` keeps an 8.3 name such
// as `RUNNER~1` from `tmpdir()`, while the native one expands it.
function temporaryRepo(prefix) {
	const root = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
	temporary.push(root);
	return root;
}

function git(cwd, args, env = GIT_ENV) {
	return execFileSync("git", args, { cwd, encoding: "utf8", env });
}

function initRepo(prefix) {
	const root = temporaryRepo(prefix);
	git(root, ["init", "-q"]);
	return root;
}

function commit(cwd, message) {
	git(cwd, ["add", "-A"]);
	git(cwd, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", message]);
}

function hostFor(root) {
	return hostOf(createModHost({ cwd: root, env: ENGINE_ENV }).$);
}

// A host whose `stat` answers no `realPath` even with `{ resolve: true }`: `realpath` is then the only canonical
// source, and `realpath: false` is a host with neither, which every canonical check must refuse.
function engineHost(root, { realpath = true } = {}) {
	const host = hostFor(root);
	return {
		...host,
		stat: async (path) => {
			const { kind, size } = await host.stat(path);
			return { kind, size };
		},
		run: async (argv, options) => {
			if (argv[0] === "realpath" && !realpath) {
				return { exitCode: 1, stdout: "", stderr: "realpath: command not found", isTruncated: false };
			}
			return await host.run(argv, options);
		},
	};
}

function sha256(text) {
	return createHash("sha256").update(text).digest("hex");
}

function status(cwd) {
	return git(cwd, ["status", "--short"]);
}

let cases = 0;

// --- the approval record ------------------------------------------------------------------------------------------

const root = initRepo("flow-record-");
const host = hostFor(root);
const flowRoot = join(root, ".flow");
const recordFile = join(root, RECORD_RELATIVE_PATH);
mkdirSync(flowRoot, { recursive: true });

// The record's two readers: `approve` is the smallest writer the port's later gate needs, `check` the status rule
// every gate decides on (latest line for the scope and kind, path matched, digest compared).
async function approve(scope, kind, inputPath) {
	const identity = await artifactIdentity(host, root, inputPath, kind);
	assert.equal(identity.sha256, opencodeDigest(kind, readFileSync(identity.path)), `${inputPath}: digest parity with the OpenCode port`);
	const relative = await rootRelativePath(host, root, identity.path);
	assert.equal(relative, opencodeRootRelativePath(root, identity.path), `${inputPath}: record path parity with the OpenCode port`);
	await writeRecord(host, root, [...(await readRecord(host, root)), { scope, kind, digest: identity.sha256, path: relative }]);
	return identity;
}

async function check(scope, kind, inputPath) {
	const line = latestRecord(await readRecord(host, root), scope, kind);
	if (line === undefined) return "missing";
	try {
		const identity = await artifactIdentity(host, root, inputPath, kind);
		return line.digest === identity.sha256 && recordedArtifactPath(line.path) === (await rootRelativePath(host, root, identity.path)) ? "ok" : "stale";
	} catch {
		return "missing";
	}
}

// R1: a missing artifact is never approved, so no line and no record file exist.
{
	await assert.rejects(artifactIdentity(host, root, "missing.md", "contract"), {
		message: `Flow gate artifact does not exist: ${join(flowRoot, "missing.md")}`,
	});
	assert.equal(existsSync(recordFile), false, "a refused artifact must not create the record");
	cases += 1;
}

// R2: a present artifact is approved with the OpenCode digest and path, the record holds exactly one line, the
// OpenCode reader reads it back unchanged, and scope and kind match exactly rather than as patterns.
{
	writeFileSync(join(flowRoot, "c.md"), "v1\n");
	const identity = await approve("aXb", "contract", "c.md");
	assert.equal(identity.path, join(flowRoot, "c.md"));
	assert.equal(identity.sha256, await artifactDigest(host, "contract", "v1\n"));
	assert.equal(identity.amendments, 0);
	assert.equal(readFileSync(recordFile, "utf8"), `aXb contract ${identity.sha256} .flow/c.md\n`);
	assert.deepEqual(opencodeReadRecord(root), await readRecord(host, root), "the OpenCode port must read the line this port wrote");
	assert.equal(await check("aXb", "contract", "c.md"), "ok");
	assert.equal(await check("a.b", "contract", "c.md"), "missing", "scope a.b must not match an approval for aXb");
	assert.equal(await check("aXb", "contr.*", "c.md"), "missing", "a kind must not match as a pattern");
	assert.equal(recordedArtifactPath(join(flowRoot, "c.md")), ".flow/c.md", "an older absolute record reads from its last /.flow/ segment");
	cases += 1;
}

// R3: an edited artifact is stale, a deleted one missing.
{
	writeFileSync(join(flowRoot, "c.md"), "v2\n");
	assert.equal(await check("aXb", "contract", "c.md"), "stale");
	rmSync(join(flowRoot, "c.md"));
	assert.equal(await check("aXb", "contract", "c.md"), "missing");
	cases += 1;
}

// R4: a plan is hashed through its last amendments line, so a line under the heading stays current while an edit
// above it is stale.
{
	const plan = join(flowRoot, "p.md");
	writeFileSync(plan, "# Plan\ntask 03: run tests\n## In-scope amendments\n");
	await approve("s", "plan", "p.md");
	assert.equal(await check("s", "plan", "p.md"), "ok");
	writeFileSync(plan, "# Plan\ntask 03: run tests\n## In-scope amendments\n- task 03: fix the test command\n");
	assert.equal(await check("s", "plan", "p.md"), "ok", "a line under the amendments heading must not stale the plan");
	writeFileSync(plan, "# Plan\ntask 03: run lint\n## In-scope amendments\n- task 03: fix the test command\n");
	assert.equal(await check("s", "plan", "p.md"), "stale", "an edit above the amendments heading must stale the plan");
	cases += 1;
}

// R5: a heading added after the approval stales the plan, and only kind plan uses the rule.
{
	writeFileSync(join(flowRoot, "q.md"), "# Plan\ntask 01\n");
	await approve("q", "plan", "q.md");
	writeFileSync(join(flowRoot, "q.md"), "# Plan\ntask 01\n## In-scope amendments\n- a line\n");
	assert.equal(await check("q", "plan", "q.md"), "stale", "a heading added later must stale the plan");

	writeFileSync(join(flowRoot, "k.md"), "# Contract\n## In-scope amendments\n");
	await approve("s", "contract", "k.md");
	writeFileSync(join(flowRoot, "k.md"), "# Contract\n## In-scope amendments\n- a line\n");
	assert.equal(await check("s", "contract", "k.md"), "stale", "a contract must hash whole, heading or not");
	cases += 1;
}

// R6: a `\r\n` heading line does not count, so the plan hashes whole and a later line stales it.
{
	const text = "# Plan\r\n## In-scope amendments\r\n";
	writeFileSync(join(flowRoot, "cr.md"), text);
	assert.equal(await artifactDigest(host, "plan", text), sha256(text), "a \\r\\n heading must not move the digest");
	assert.equal(await artifactDigest(host, "plan", text), opencodeDigest("plan", Buffer.from(text, "utf8")));
	await approve("cr", "plan", "cr.md");
	writeFileSync(join(flowRoot, "cr.md"), `${text}- a line\r\n`);
	assert.equal(await check("cr", "plan", "cr.md"), "stale");
	cases += 1;
}

// R7: the last heading binds: an earlier heading quoted in a fence stays inside the digest, and a second heading under
// the first moves the boundary.
{
	const fenced = join(flowRoot, "f.md");
	writeFileSync(fenced, "# Plan\n\n```text\n## In-scope amendments\n```\n\n- L1: polling\n\n## In-scope amendments\n");
	await approve("f", "plan", "f.md");
	writeFileSync(fenced, "# Plan\n\n```text\n## In-scope amendments\n```\n\n- L1: push\n\n## In-scope amendments\n");
	assert.equal(await check("f", "plan", "f.md"), "stale", "a line between a fenced heading and the real one is inside the digest");
	await approve("f", "plan", "f.md");
	writeFileSync(fenced, "# Plan\n\n```text\n## In-scope amendments\n```\n\n- L1: push\n\n## In-scope amendments\n- task 03: fix the test command\n");
	assert.equal(await check("f", "plan", "f.md"), "ok", "a line under the last heading is outside the digest");

	writeFileSync(join(flowRoot, "t.md"), "# Plan\ntask 01\n## In-scope amendments\n");
	await approve("t", "plan", "t.md");
	writeFileSync(join(flowRoot, "t.md"), "# Plan\ntask 01\n## In-scope amendments\n## In-scope amendments\n- L1: push\n");
	assert.equal(await check("t", "plan", "t.md"), "stale", "a second heading under the first moves the boundary");
	cases += 1;
}

// R8: a bare heading with no final newline hashes as the whole file, so a record logged before the rule (a whole-file
// digest) stays current while nothing is written under the heading.
{
	const bare = "# Plan\n## In-scope amendments";
	assert.equal(await artifactDigest(host, "plan", bare), sha256(bare));
	assert.equal(await artifactDigest(host, "plan", bare), opencodeDigest("plan", Buffer.from(bare, "utf8")));

	const whole = "# Plan\ntask 01\n## In-scope amendments\n";
	writeFileSync(join(flowRoot, "r.md"), whole);
	await writeRecord(host, root, [
		...(await readRecord(host, root)),
		{ scope: "old", kind: "plan", digest: sha256(whole), path: ".flow/r.md" },
	]);
	assert.equal(await check("old", "plan", "r.md"), "ok", "a whole-file record of a bare-heading plan stays current");
	cases += 1;
}

// R9: an unreadable line makes the whole record unreadable, naming the line; a non-hex digest does too.
{
	const lines = await readRecord(host, root);
	await writeRecord(host, root, [...lines, { scope: "bad", kind: "plan", digest: "not-a-digest", path: ".flow/x.md" }]);
	await assert.rejects(readRecord(host, root), {
		message: `Unreadable Flow approval record at ${RECORD_RELATIVE_PATH}: line ${lines.length + 1}`,
	});
	await writeRecord(host, root, [...lines, { scope: "bad", path: "short line" }]);
	await assert.rejects(readRecord(host, root), /Unreadable Flow approval record at \.flow\/runtime\/approvals\.log: line \d+/);
	await writeRecord(host, root, lines);
	cases += 1;
}

// R10: an artifact whose bytes are not exactly UTF-8 is refused rather than hashed lossily, so no digest it cannot
// reproduce can enter the record. A truncated 4-byte sequence (`F0 90 80`) decodes to one U+FFFD, which is also three
// bytes, so only a byte comparison tells it from a file that really holds U+FFFD. A BOM is text and is kept.
{
	const bad = join(flowRoot, "bad.md");
	writeFileSync(bad, Buffer.from([0xff, 0xfe, 0x00, 0x61]));
	await assert.rejects(artifactIdentity(host, root, "bad.md", "contract"), { message: `Flow gate artifact is not UTF-8 text: ${bad}` });
	mkdirSync(join(flowRoot, "contracts"), { recursive: true });
	const truncated = join(flowRoot, "contracts/a.md");
	writeFileSync(truncated, Buffer.from([0x23, 0x20, 0xf0, 0x90, 0x80, 0x41, 0x0a]));
	await assert.rejects(artifactIdentity(host, root, ".flow/contracts/a.md", "contract"), {
		message: `Flow gate artifact is not UTF-8 text: ${truncated}`,
	});
	const bom = join(flowRoot, "contracts/bom.md");
	writeFileSync(bom, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("# Contract\n", "utf8")]));
	const identity = await artifactIdentity(host, root, ".flow/contracts/bom.md", "contract");
	assert.equal(identity.sha256, opencodeDigest("contract", readFileSync(bom)), "a BOM file carries the OpenCode digest");
	cases += 1;
}

// R11: an artifact path is read before it is normalized, so a `.flow/..` path stays a repository path and is refused.
{
	writeFileSync(join(root, "outside.md"), "x\n");
	await assert.rejects(artifactIdentity(host, root, ".flow/../outside.md", "contract"), {
		message: `Flow gate artifacts must live below ${flowRoot}: write the path as .flow/contracts/<slug>.md or contracts/<slug>.md`,
	});
	await assert.rejects(artifactIdentity(host, root, "../outside.md", "contract"), /^Error: Flow gate artifacts must live below /);
	cases += 1;
}

// R12: writeRecord keeps the repository's exclude file honest once, through ensureFlowExcluded.
{
	const exclude = readFileSync(join(root, ".git/info/exclude"), "utf8");
	assert.equal(exclude.split(/\r?\n/).filter((line) => line === "/.flow/").length, 1);
	assert.equal(status(root).includes(".flow"), false, "the record and its directory must not appear in git status");
	cases += 1;
}

// R14: the writer refuses a line holding a control character before it writes anything, the exclude file included:
// a line break in a path would make one approval answer write a second line it never named.
{
	const repo = initRepo("flow-record-control-");
	const excludeFile = join(repo, ".git/info/exclude");
	const excludeBefore = existsSync(excludeFile) ? readFileSync(excludeFile) : undefined;
	const digest = "a".repeat(64);
	const refusal = { message: "Flow approval record line holds a control character; nothing was written." };
	for (const line of [
		{ scope: "a", kind: "contract", digest, path: ".flow/contracts/a\nb contract " + digest + " .flow/contracts/b.md" },
		{ scope: "a\rb", kind: "contract", digest, path: ".flow/contracts/a.md" },
		{ scope: "a", kind: "contract\u0000", digest, path: ".flow/contracts/a.md" },
		{ scope: "a", kind: "contract", digest: `${digest}\u001b`, path: ".flow/contracts/a.md" },
	]) {
		await assert.rejects(writeRecord(hostFor(repo), repo, [line]), refusal);
	}
	assert.equal(existsSync(join(repo, RECORD_RELATIVE_PATH)), false, "a refused line writes no record");
	assert.deepEqual(existsSync(excludeFile) ? readFileSync(excludeFile) : undefined, excludeBefore, "a refused line leaves the exclude file as it was");
	cases += 1;
}

// --- the worktree fingerprint ------------------------------------------------------------------------------------

let fixtures = 0;
let fixtureMs = 0;
let slowestFixtureMs = 0;
const treeTriples = [];

// Both implementations answer the same tree, head and fingerprint for one repository.
async function identityBoth(cwd) {
	const started = Date.now();
	const mine = await worktreeIdentity(hostFor(cwd), cwd);
	const elapsed = Date.now() - started;
	fixtureMs += elapsed;
	slowestFixtureMs = Math.max(slowestFixtureMs, elapsed);
	const theirs = opencodeWorktreeIdentity(cwd);
	assert.equal(mine.tree, theirs.tree, `tree differs at ${cwd}: ${status(cwd)}`);
	assert.equal(mine.fingerprint, theirs.fingerprint, `fingerprint differs at ${cwd}: ${status(cwd)}`);
	assert.equal(mine.head, theirs.head, `head differs at ${cwd}`);
	fixtures += 1;
	return { ...mine, opencodeTree: theirs.tree };
}

// A clean fixture's tree in all three spellings — the port's, OpenCode's and `HEAD^{tree}` — printed with the result.
function recordTriple(label, cwd, identity) {
	const headTree = git(cwd, ["rev-parse", "HEAD^{tree}"]).trim();
	treeTriples.push(`${label}: port ${identity.tree}, opencode ${identity.opencodeTree}, HEAD^{tree} ${headTree}`);
	return headTree;
}

// T1: a committed tree. A clean tree's fingerprint is exactly sha256("tree\0" + HEAD^{tree}), the fast form the plan
// allows only when the recipe cannot afford itself.
{
	const repo = temporaryRepo("flow-tree-committed-");
	git(repo, ["init", "-q"]);
	writeFileSync(join(repo, "a.txt"), "a\n");
	commit(repo, "init");
	const identity = await identityBoth(repo);
	assert.equal(identity.fingerprint, sha256(`tree\0${git(repo, ["rev-parse", "HEAD^{tree}"]).trim()}`));
	assert.equal(status(repo), "");
}

// T2: a modified file plus an untracked one.
{
	const repo = temporaryRepo("flow-tree-modified-");
	git(repo, ["init", "-q"]);
	writeFileSync(join(repo, "a.txt"), "a\n");
	commit(repo, "init");
	writeFileSync(join(repo, "a.txt"), "a edited\n");
	writeFileSync(join(repo, "b.txt"), "b\n");
	assert.equal(status(repo), " M a.txt\n?? b.txt\n");
	await identityBoth(repo);
}

// T3: a staged-then-reverted file (`MM`): the working tree content is the committed one again, but the index holds a
// third version, so only the mixed entries keep the change visible in the fingerprint.
{
	const repo = temporaryRepo("flow-tree-mixed-");
	git(repo, ["init", "-q"]);
	writeFileSync(join(repo, "a.txt"), "a\n");
	writeFileSync(join(repo, "b.txt"), "b\n");
	commit(repo, "init");
	writeFileSync(join(repo, "b.txt"), "b staged\n");
	git(repo, ["add", "b.txt"]);
	writeFileSync(join(repo, "b.txt"), "b reverted\n");
	assert.equal(status(repo), "MM b.txt\n");
	const mixed = await identityBoth(repo);
	git(repo, ["reset", "-q", "b.txt"]);
	assert.equal(status(repo), " M b.txt\n");
	const unstaged = await identityBoth(repo);
	assert.equal(unstaged.tree, mixed.tree, "the working tree is the same in both states");
	assert.notEqual(unstaged.fingerprint, mixed.fingerprint, "a staged-and-reverted entry must change the fingerprint");
}

// T4: committing the tracked content keeps the fingerprint: an acceptance stays current across a commit of that tree.
{
	const repo = temporaryRepo("flow-tree-commit-");
	git(repo, ["init", "-q"]);
	writeFileSync(join(repo, "a.txt"), "a\n");
	commit(repo, "init");
	writeFileSync(join(repo, "c.txt"), "c\n");
	const before = await identityBoth(repo);
	commit(repo, "c");
	const after = await identityBoth(repo);
	assert.equal(after.fingerprint, before.fingerprint, "a commit of the accepted tree must keep the fingerprint");
	assert.notEqual(after.head, before.head);
}

// T5: a folder move.
{
	const repo = temporaryRepo("flow-tree-move-");
	git(repo, ["init", "-q"]);
	mkdirSync(join(repo, "dir"));
	writeFileSync(join(repo, "dir/x.txt"), "x\n");
	commit(repo, "dir");
	renameSync(join(repo, "dir"), join(repo, "moved"));
	await identityBoth(repo);
}

// T6: an unborn repository: HEAD names no commit, so the staged paths are compared against the empty tree.
{
	const repo = temporaryRepo("flow-tree-unborn-");
	git(repo, ["init", "-q"]);
	writeFileSync(join(repo, "u.txt"), "u\n");
	git(repo, ["add", "u.txt"]);
	const identity = await identityBoth(repo);
	assert.equal(identity.head, "UNBORN");
}

// T7: an ignored file changes nothing, in either implementation.
{
	const repo = temporaryRepo("flow-tree-ignored-");
	git(repo, ["init", "-q"]);
	writeFileSync(join(repo, ".gitignore"), "ignored.txt\n");
	commit(repo, "ignore");
	const before = await identityBoth(repo);
	writeFileSync(join(repo, "ignored.txt"), "noise\n");
	const after = await identityBoth(repo);
	assert.equal(after.fingerprint, before.fingerprint, "an ignored file must not change the fingerprint");
}

// T8: a `.flow/` file appearing does change the fingerprint, in either implementation.
{
	const repo = temporaryRepo("flow-tree-flow-");
	git(repo, ["init", "-q"]);
	writeFileSync(join(repo, "a.txt"), "a\n");
	commit(repo, "init");
	const before = await identityBoth(repo);
	mkdirSync(join(repo, ".flow/runtime"), { recursive: true });
	writeFileSync(join(repo, ".flow/runtime/approvals.log"), "s plan aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa .flow/p.md\n");
	const after = await identityBoth(repo);
	assert.notEqual(after.fingerprint, before.fingerprint);
}

// T9: repoRoot answers the canonical top level, and the port's git answers the same head as git itself.
{
	const repo = temporaryRepo("flow-tree-root-");
	git(repo, ["init", "-q"]);
	mkdirSync(join(repo, "deep/nested"), { recursive: true });
	assert.equal(await repoRoot(hostFor(repo), join(repo, "deep/nested")), repo);
}

// T10: the fingerprint's git child reads the engine's own environment. A global `core.excludesFile` and
// `core.autocrlf` must shape the tree exactly as they shape the OpenCode port's, which inherits `HOME` from the
// process. A child handed PATH alone sees neither the ignored file nor CRLF normalisation, so the two ports would
// record different fingerprints for one working tree.
{
	const home = temporaryRepo("flow-tree-home-");
	const excludes = join(home, "global-excludes");
	writeFileSync(excludes, "globally-ignored.txt\n");
	// Git reads `\` in a config value as an escape, so a Windows path is written in the `/` form git also accepts.
	writeFileSync(join(home, ".gitconfig"), `[core]\n\texcludesFile = ${excludes.replaceAll("\\", "/")}\n\tautocrlf = true\n`);
	const repo = temporaryRepo("flow-tree-config-");
	git(repo, ["init", "-q"]);
	writeFileSync(join(repo, "crlf.txt"), "a\r\nb\r\n");
	writeFileSync(join(repo, "globally-ignored.txt"), "noise\r\n");
	const engine = hostOf(createModHost({ cwd: repo, env: { ...ENGINE_ENV, HOME: home } }).$);
	const mine = await worktreeIdentity(engine, repo);
	// The OpenCode implementation reads the environment it runs in, so the same config has to be in both.
	const savedHome = process.env.HOME;
	process.env.HOME = home;
	let theirs;
	try {
		theirs = opencodeWorktreeIdentity(repo);
	} finally {
		if (savedHome === undefined) delete process.env.HOME;
		else process.env.HOME = savedHome;
	}
	assert.equal(mine.tree, theirs.tree, `tree differs with the engine's global git config: ${status(repo)}`);
	assert.equal(mine.fingerprint, theirs.fingerprint, "fingerprint parity with the OpenCode port under a global git config");
	fixtures += 1;
}

// T11: the XDG config base carries a global config of its own. With `HOME` holding no `.gitconfig` and
// `$XDG_CONFIG_HOME/git/config` setting `core.excludesFile`, the tree and fingerprint must still match the OpenCode
// port's, which inherits `XDG_CONFIG_HOME` from the process. A child whose environment lacks it includes the
// ignored file.
{
	const home = temporaryRepo("flow-tree-xdg-home-");
	const xdg = temporaryRepo("flow-tree-xdg-base-");
	mkdirSync(join(xdg, "git"), { recursive: true });
	const excludes = join(xdg, "xdg-excludes");
	writeFileSync(excludes, "xdg-ignored.txt\n");
	writeFileSync(join(xdg, "git/config"), `[core]\n\texcludesFile = ${excludes.replaceAll("\\", "/")}\n`);
	const repo = temporaryRepo("flow-tree-xdg-config-");
	git(repo, ["init", "-q"]);
	writeFileSync(join(repo, "xdg-ignored.txt"), "noise\n");
	writeFileSync(join(repo, "tracked.txt"), "x\n");
	const engine = hostOf(createModHost({ cwd: repo, env: { ...ENGINE_ENV, HOME: home, XDG_CONFIG_HOME: xdg } }).$);
	const mine = await worktreeIdentity(engine, repo);
	// The OpenCode implementation reads the environment it runs in, so the same config has to be in both.
	const savedHome = process.env.HOME;
	const savedXdg = process.env.XDG_CONFIG_HOME;
	process.env.HOME = home;
	process.env.XDG_CONFIG_HOME = xdg;
	let theirs;
	try {
		theirs = opencodeWorktreeIdentity(repo);
	} finally {
		if (savedHome === undefined) delete process.env.HOME;
		else process.env.HOME = savedHome;
		if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
		else process.env.XDG_CONFIG_HOME = savedXdg;
	}
	assert.equal(mine.tree, theirs.tree, `tree differs with the engine's XDG git config: ${status(repo)}`);
	assert.equal(mine.fingerprint, theirs.fingerprint, "fingerprint parity with the OpenCode port under an XDG git config");
	fixtures += 1;
}

// T12: a tracked file that matches an ignore rule. It stays in the tree, and an edit to it changes the fingerprint,
// exactly as in the OpenCode port, which loads the real index: a recipe from an empty index never re-adds it.
{
	const repo = initRepo("flow-tree-tracked-ignored-");
	writeFileSync(join(repo, ".gitignore"), "*.lock\n");
	writeFileSync(join(repo, "app.txt"), "a\n");
	writeFileSync(join(repo, "deps.lock"), "v1\n");
	git(repo, ["add", ".gitignore", "app.txt"]);
	git(repo, ["add", "-f", "deps.lock"]);
	git(repo, ["commit", "-qm", "init"]);
	const clean = await identityBoth(repo);
	assert.equal(clean.tree, recordTriple("T12 tracked-and-ignored", repo, clean), "a clean tree is HEAD's tree");
	writeFileSync(join(repo, "deps.lock"), "v2\n");
	const edited = await identityBoth(repo);
	assert.notEqual(edited.fingerprint, clean.fingerprint, "an edit to a tracked-and-ignored file must change the fingerprint");
}

// T13: `core.filemode=false` with an executable committed: the mode comes from the index, not the working tree.
{
	const repo = initRepo("flow-tree-filemode-");
	writeFileSync(join(repo, "run.sh"), "echo run\n", { mode: 0o644 });
	git(repo, ["add", "--chmod=+x", "run.sh"]);
	git(repo, ["commit", "-qm", "init"]);
	git(repo, ["config", "core.filemode", "false"]);
	const identity = await identityBoth(repo);
	assert.equal(identity.tree, recordTriple("T13 core.filemode=false", repo, identity), "the executable bit survives core.filemode=false");
}

// T14: `core.symlinks=false` with a committed symlink checked out as a plain file: the mode stays 120000.
{
	const repo = initRepo("flow-tree-symlinks-");
	git(repo, ["config", "core.symlinks", "false"]);
	writeFileSync(join(repo, "link"), "target");
	assert.equal(git(repo, ["hash-object", "-w", "link"]).trim(), "1de565933b05f74c75ff9a6520af5f9f8a5a2f1d");
	git(repo, ["update-index", "--add", "--cacheinfo", "120000,1de565933b05f74c75ff9a6520af5f9f8a5a2f1d,link"]);
	git(repo, ["commit", "-qm", "init"]);
	const identity = await identityBoth(repo);
	assert.equal(identity.tree, recordTriple("T14 core.symlinks=false", repo, identity), "the symlink mode survives core.symlinks=false");
}

// T15: the other index shapes the scratch index must carry over: an unmerged path, an intent-to-add entry, and an
// assume-unchanged file edited on disk (which `add -A` skips only when the flag is loaded too).
{
	const unmerged = initRepo("flow-tree-unmerged-");
	writeFileSync(join(unmerged, "a.txt"), "base\n");
	commit(unmerged, "base");
	git(unmerged, ["checkout", "-q", "-b", "other"]);
	writeFileSync(join(unmerged, "a.txt"), "theirs\n");
	commit(unmerged, "theirs");
	git(unmerged, ["checkout", "-q", "-"]);
	writeFileSync(join(unmerged, "a.txt"), "ours\n");
	commit(unmerged, "ours");
	assert.throws(() => git(unmerged, ["merge", "-q", "other"]), "the merge must conflict");
	assert.match(git(unmerged, ["ls-files", "-u"]), /\ta\.txt\n/);
	await identityBoth(unmerged);

	const intent = initRepo("flow-tree-intent-");
	writeFileSync(join(intent, "a.txt"), "a\n");
	commit(intent, "init");
	writeFileSync(join(intent, "new.txt"), "new\n");
	git(intent, ["add", "-N", "new.txt"]);
	await identityBoth(intent);

	const assumed = initRepo("flow-tree-assumed-");
	writeFileSync(join(assumed, "a.txt"), "a\n");
	commit(assumed, "init");
	git(assumed, ["update-index", "--assume-unchanged", "a.txt"]);
	writeFileSync(join(assumed, "a.txt"), "a edited on disk\n");
	await identityBoth(assumed);
}

// T16: a build whose process call ignores `stdin` loads nothing into the scratch index; the load is verified against
// the real index, so the fingerprint refuses instead of hashing a tree built from an empty index.
{
	const repo = initRepo("flow-tree-no-stdin-");
	writeFileSync(join(repo, "a.txt"), "a\n");
	commit(repo, "init");
	const deaf = hostOf(createModHost({ cwd: repo, env: ENGINE_ENV, ignoreStdin: true }).$);
	await assert.rejects(worktreeIdentity(deaf, repo), {
		message: "Flow gate cannot reproduce the git index in a scratch index; nothing was recorded.",
	});
	cases += 1;
}

// --- canonical paths ----------------------------------------------------------------------------------------------

// C0: the host asks the engine to resolve the path. `$.fs.stat` answers `realPath` only for `{ resolve: true }`, so a
// host that drops the option would fall back to a process call — or, with no fallback, answer unknown.
{
	const repo = temporaryRepo("flow-record-resolve-");
	mkdirSync(join(repo, "dir"), { recursive: true });
	writeFileSync(join(repo, "dir/file.txt"), "x\n");
	const file = join(repo, "dir/file.txt");
	const engine = createModHost({ cwd: repo, env: ENGINE_ENV }).$;
	const asked = [];
	const inner = engine.fs.stat;
	engine.fs.stat = async (path, options) => {
		asked.push(options);
		return await inner(path, options);
	};
	const stats = await hostOf(engine).stat(file);
	assert.deepEqual(asked, [{ resolve: true }], "the host asks the engine to resolve the path");
	assert.equal(stats.realPath, realpathSync(file));
	cases += 1;
}

// C1: a repository reached through a symlinked parent directory. The root git answers is canonicalised, the artifact
// resolves through its real path, and the record still holds the path relative to the root, so `status` finds it again.
{
	const base = temporaryRepo("flow-record-symlink-parent-");
	const repo = join(base, "repo");
	mkdirSync(join(repo, ".flow/contracts"), { recursive: true });
	git(repo, ["init", "-q"]);
	writeFileSync(join(repo, ".flow/contracts/demo.md"), "contract\n");
	const holder = temporaryRepo("flow-record-symlink-holder-");
	const linkedParent = join(holder, "parent");
	symlinkSync(base, linkedParent, "dir");
	const viaLink = join(linkedParent, "repo");

	for (const [label, engine] of [["realpath fallback", engineHost(viaLink)], ["stat realPath", hostFor(viaLink)]]) {
		assert.equal(await repoRoot(engine, join(viaLink, ".flow")), repo, "the root read through a symlinked parent is canonical");
		let identity;
		try {
			identity = await artifactIdentity(engine, viaLink, "contracts/demo.md", "contract");
		} catch (error) {
			// Name the host and the canonical answers it compared, so a platform-only failure says where it came from.
			const answers = {
				root: await canonicalPath(engine, viaLink),
				flowRoot: await canonicalPath(engine, join(viaLink, ".flow")),
				realpath: (await engine.run(["realpath", viaLink])).stdout.trim(),
			};
			throw new Error(`C1 (${label}): ${error.message}; canonical answers ${JSON.stringify(answers)}`);
		}
		assert.equal(identity.path, join(repo, ".flow/contracts/demo.md"));
		const stored = await rootRelativePath(engine, viaLink, identity.path);
		assert.equal(stored, ".flow/contracts/demo.md", "the record path is root-relative, not an absolute path through the link");
		await writeRecord(engine, viaLink, [{ scope: "linked-parent", kind: "contract", digest: identity.sha256, path: stored }]);
		const line = latestRecord(await readRecord(engine, viaLink), "linked-parent", "contract");
		assert.equal(readFileSync(join(viaLink, RECORD_RELATIVE_PATH), "utf8").trim().split(" ").slice(3).join(" "), ".flow/contracts/demo.md");
		assert.equal((await artifactIdentity(engine, viaLink, recordedArtifactPath(line.path), "contract")).sha256, line.digest);
	}
	cases += 1;
}

// C2: `.flow` itself is a symlink to a directory inside the repository: the artifact resolves through it and is
// accepted, and the path the record holds re-resolves to the same artifact.
{
	const repo = temporaryRepo("flow-record-flow-inside-");
	git(repo, ["init", "-q"]);
	mkdirSync(join(repo, "flow-store/contracts"), { recursive: true });
	symlinkSync("flow-store", join(repo, ".flow"), "dir");
	writeFileSync(join(repo, "flow-store/contracts/demo.md"), "contract\n");
	const engine = engineHost(repo);
	const identity = await artifactIdentity(engine, repo, ".flow/contracts/demo.md", "contract");
	assert.equal(identity.path, join(repo, "flow-store/contracts/demo.md"), "the artifact resolves through the link");
	const stored = await rootRelativePath(engine, repo, identity.path);
	assert.equal(stored, "flow-store/contracts/demo.md");
	assert.equal((await artifactIdentity(engine, repo, stored, "contract")).sha256, identity.sha256, "the recorded path must re-resolve");
	cases += 1;
}

// C3: a `.flow` symlink to a directory outside the repository is refused, whichever host answers.
{
	const outside = temporaryRepo("flow-record-flow-outside-target-");
	mkdirSync(join(outside, "contracts"), { recursive: true });
	writeFileSync(join(outside, "contracts/demo.md"), "contract\n");
	const repo = temporaryRepo("flow-record-flow-outside-");
	git(repo, ["init", "-q"]);
	symlinkSync(outside, join(repo, ".flow"), "dir");
	const message = `Flow gate artifact escapes ${repo}: ${join(repo, ".flow/contracts/demo.md")}`;
	for (const engine of [engineHost(repo), hostFor(repo)]) {
		await assert.rejects(artifactIdentity(engine, repo, ".flow/contracts/demo.md", "contract"), { message });
	}
	cases += 1;
}

// C4: a host that answers neither `stat().realPath` nor `realpath` cannot prove where the artifact lives, so it is
// refused rather than taken as written; either canonical source alone is enough.
{
	const repo = temporaryRepo("flow-record-blind-");
	git(repo, ["init", "-q"]);
	const flowRoot = join(repo, ".flow");
	mkdirSync(join(flowRoot, "contracts"), { recursive: true });
	writeFileSync(join(flowRoot, "contracts/demo.md"), "contract\n");
	await assert.rejects(artifactIdentity(engineHost(repo, { realpath: false }), repo, "contracts/demo.md", "contract"), {
		message: `Flow gate artifact escapes ${flowRoot}: ${join(flowRoot, "contracts/demo.md")}`,
	});
	for (const engine of [engineHost(repo), hostFor(repo)]) {
		assert.equal((await artifactIdentity(engine, repo, "contracts/demo.md", "contract")).path, join(flowRoot, "contracts/demo.md"));
	}
	cases += 1;
}

// C5: the canonical answer is rewritten only toward `\`. The engine may print `C:/Users/...` on Windows while every
// root, artifact and record path the guard builds speaks `C:\Users\...`, and an answer taken as printed makes the
// artifact identity disagree with the flow root it is compared against. A POSIX path is the identity key and keeps the
// answer byte for byte: a `\` in a POSIX file name is a legal character, so rewriting it to `/` would spell one
// directory as another. The missing tail is re-appended in the answer's form.
{
	const windows = "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\flow-record-separator\\.flow\\c.md";
	const posix = "/tmp/flow-record-separator/.flow/c.md";
	const answering = (realPath) => ({
		stat: async () => ({ kind: "file", size: 2, realPath }),
		run: async () => ({ exitCode: 1, stdout: "", stderr: "", isTruncated: false }),
	});
	assert.equal(await canonicalPath(answering(windows.replaceAll("\\", "/")), windows), windows, "a Windows input keeps `\\`");
	const answered = posix.replaceAll("/", "\\");
	assert.equal(await canonicalPath(answering(answered), posix), answered, "a POSIX answer is kept byte for byte");

	const ancestor = "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\flow-record-separator\\.flow";
	const answeringAncestor = {
		stat: async (path) => {
			if (path !== ancestor) throw new Error(`no stat for ${path}`);
			return { kind: "dir", size: 0, realPath: "D:/real/flow" };
		},
		run: async () => ({ exitCode: 1, stdout: "", stderr: "", isTruncated: false }),
	};
	assert.equal(await canonicalPath(answeringAncestor, `${ancestor}\\c.md`), "D:\\real\\flow\\c.md");
	cases += 1;
}

// C10: on Windows the `realpath` on PATH is usually Git's MSYS build, which prints `/c/Users/...`. For a Windows-form
// path the fallback reads `/x/...` as drive `X:`, keeps a `//host/share` UNC answer, and treats any other `/...` answer
// (a path inside the MSYS root) as no answer, which fails closed. A POSIX path keeps the answer as printed.
{
	const realpathAnswering = (stdout) => ({
		stat: async () => ({ kind: "dir", size: 0 }),
		run: async (argv) => {
			assert.equal(argv[0], "realpath");
			return { exitCode: 0, stdout: `${stdout}\n`, stderr: "", isTruncated: false };
		},
	});
	const windows = "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\flow-record-msys";
	assert.equal(
		await canonicalPath(realpathAnswering("/c/Users/runneradmin/AppData/Local/Temp/flow-record-msys"), windows),
		"C:\\Users\\runneradmin\\AppData\\Local\\Temp\\flow-record-msys",
	);
	assert.equal(await canonicalPath(realpathAnswering("/d"), "D:\\"), "D:\\");
	assert.equal(await canonicalPath(realpathAnswering("C:/Users/x"), "C:\\Users\\x"), "C:\\Users\\x");
	assert.equal(await canonicalPath(realpathAnswering("//srv/share/dir"), "\\\\srv\\share\\dir"), "\\\\srv\\share\\dir");
	const uncWithTail = {
		stat: async (path) => {
			if (path !== "\\\\srv\\share\\dir") throw new Error(`no stat for ${path}`);
			return { kind: "dir", size: 0 };
		},
		run: async () => ({ exitCode: 0, stdout: "//srv/share/dir\n", stderr: "", isTruncated: false }),
	};
	assert.equal(await canonicalPath(uncWithTail, "\\\\srv\\share\\dir\\missing.md"), "\\\\srv\\share\\dir\\missing.md", "a UNC answer keeps its share root under a missing tail");
	assert.equal(await canonicalPath(realpathAnswering("/tmp/x"), windows), undefined, "an MSYS-root answer is no answer");
	assert.equal(await canonicalPath(realpathAnswering("/c/x"), "/c/x"), "/c/x", "a POSIX path keeps the answer as printed");
	cases += 1;
}

// C6: the chain the Windows job walks — the flow root the guard builds, the canonical artifact identity compared
// against it, and the root-relative record path — keeps one form when the engine answers `C:/...` for a `C:\...` path.
{
	const windowsRoot = "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\flow-record-separator";
	const candidate = `${windowsRoot}\\.flow\\c.md`;
	const answering = {
		exists: async () => true,
		read: async () => "v1\n",
		readBytes: async () => new TextEncoder().encode("v1\n"),
		stat: async (path) => ({ kind: "file", size: 3, realPath: path.replaceAll("\\", "/") }),
		run: async () => ({ exitCode: 1, stdout: "", stderr: "", isTruncated: false }),
		sha256: async (text) => sha256(text),
	};
	const identity = await artifactIdentity(answering, windowsRoot, ".flow/c.md", "contract");
	assert.equal(identity.path, candidate, "the artifact identity speaks the flow root's separator");
	assert.equal(await rootRelativePath(answering, windowsRoot, identity.path), ".flow/c.md", "the record path stays `/`-separated");
	cases += 1;
}

// C7: the scratch directory the fingerprint builds under `%TEMP%` is joined in steps (base, scratch, objects, file).
// A rooted first part keeps its root once: a drive or UNC root re-added at every step makes `C:\C:\...`, which no
// filesystem opens, so the Windows fingerprint failed before git ever ran.
{
	const temp = "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp";
	assert.equal(guardJoin(guardJoin(guardJoin(temp, "flow-gate-tree-1"), "objects"), "keep.txt"), `${temp}\\flow-gate-tree-1\\objects\\keep.txt`);
	assert.equal(guardJoin("C:/Users/me", "x"), "C:\\Users\\me\\x", "a `/`-form drive path still speaks `\\`");
	assert.equal(guardJoin("C:\\", "x"), "C:\\x");
	assert.equal(guardJoin(guardJoin("\\\\server\\share\\dir", "a"), "b"), "\\\\server\\share\\dir\\a\\b");
	assert.equal(guardJoin(guardJoin("/tmp", "flow-gate-tree-1"), "objects"), "/tmp/flow-gate-tree-1/objects");
	assert.equal(guardJoin("a", "b"), "a/b");
	cases += 1;
}

// C8: on POSIX a backslash is a file-name character, so an artifact named `a\b.md` records as that one name — the
// string the OpenCode port records — never as `a/b.md`.
if (process.platform !== "win32") {
	const repo = temporaryRepo("flow-record-backslash-");
	git(repo, ["init", "-q"]);
	mkdirSync(join(repo, ".flow/contracts"), { recursive: true });
	const file = join(repo, ".flow/contracts/a\\b.md");
	writeFileSync(file, "contract\n");
	const engine = hostFor(repo);
	const identity = await artifactIdentity(engine, repo, ".flow/contracts/a\\b.md", "contract");
	assert.equal(identity.path, file);
	const stored = await rootRelativePath(engine, repo, identity.path);
	assert.equal(stored, opencodeRootRelativePath(repo, identity.path), "record path parity with the OpenCode port");
	assert.equal(stored, ".flow/contracts/a\\b.md");
	cases += 1;
}

// C9: `canonicalPath` walks a path's ancestors from one scan, deepest first, and does not stat one past the platform's
// path limit, since none can exist: a 1 MiB path with 131 072 separators costs 512 `stat` calls, not one per separator.
// Each ancestor carries the tail that re-appends the rest of the path; a trailing separator run belongs to the last
// name, and a run touching the root belongs to the root.
let canonicalLimitMs = 0;
{
	const table = [
		["/", [["/", ""]]],
		["/a", [["/a", ""], ["/", "a"]]],
		["/a/b/", [["/a/b/", ""], ["/a", "b/"], ["/", "a/b/"]]],
		["/a//b", [["/a//b", ""], ["/a", "b"], ["/", "a//b"]]],
		["//a", [["//a", ""], ["/", "a"]]],
		["a/b", [["a/b", ""], ["a", "b"], [".", "a/b"]]],
		["C:\\x\\y", [["C:\\x\\y", ""], ["C:\\x", "y"], ["C:\\", "x\\y"]]],
		["C:/x", [["C:/x", ""], ["C:\\", "x"]]],
		["\\\\srv\\share\\d\\f", [["\\\\srv\\share\\d\\f", ""], ["\\\\srv\\share\\d", "f"], ["\\\\srv\\share\\", "d\\f"]]],
		["C:\\", [["C:\\", ""]]],
	];
	for (const [path, expected] of table) {
		assert.deepEqual(ancestors(path), expected.map(([dir, tail]) => ({ dir, tail })), `the ancestors of ${path}`);
	}

	assert.equal(exceedsPathLimit(`/${"a".repeat(4095)}`), false);
	assert.equal(exceedsPathLimit(`/${"a".repeat(4096)}`), true);
	assert.equal(exceedsPathLimit(`C:\\${"a".repeat(32764)}`), false);
	assert.equal(exceedsPathLimit(`C:\\${"a".repeat(32765)}`), true);

	let stats = 0;
	let longest = 0;
	const stub = {
		stat: async (path) => {
			stats += 1;
			longest = Math.max(longest, path.length);
			if (path !== "/r") throw new Error(`no stat for ${path}`);
			return { kind: "dir", size: 0, realPath: "/real" };
		},
		run: async () => ({ exitCode: 1, stdout: "", stderr: "", isTruncated: false }),
	};
	const middle = "aaaaaaa/".repeat(131072);
	const started = Date.now();
	assert.equal(await canonicalPath(stub, `/r/${middle}x`), `/real/${middle}x`);
	canonicalLimitMs = Date.now() - started;
	assert.equal(stats, 512, "only the ancestors within the path limit are stat-ed");
	assert.ok(longest <= 4096, `no stat past the path limit, longest ${longest}`);
	assert.ok(canonicalLimitMs < 2000, `a 1 MiB path took ${canonicalLimitMs} ms`);
	cases += 1;
}

// R13: no fingerprint comes near its limit. The hook's own budget does not count time spent inside a mods API call, so
// what bounds a fingerprint is each git child's 30 s process timeout; the slowest fixture fingerprint must stay below
// it. The totals are printed below, with this repository's own measurement, as a report of the margin.
assert.ok(slowestFixtureMs < 30_000, `the slowest fixture fingerprint took ${slowestFixtureMs} ms, over the 30 s process timeout`);
cases += 1;

// The cost on this repository: the hook computes one fingerprint per acceptance and per verifier dispatch.
const repository = realpathSync(fileURLToPath(new URL("..", import.meta.url)));
const tracked = git(repository, ["ls-files"]).split("\n").filter(Boolean).length;
const repositoryStarted = Date.now();
const repositoryIdentity = await worktreeIdentity(hostFor(repository), repository);
const repositoryMs = Date.now() - repositoryStarted;
assert.match(repositoryIdentity.tree, /^[0-9a-f]{40,64}$/);
assert.equal(repositoryIdentity.head, git(repository, ["rev-parse", "HEAD"]).trim());
assert.ok(repositoryMs < 30_000, `this repository's fingerprint took ${repositoryMs} ms, over the 30 s process timeout`);

for (const path of temporary) rmSync(path, { recursive: true, force: true });

for (const triple of treeTriples) console.log(triple);
console.log(
	`ok: ${cases} approval record cases, ${fixtures} fingerprint fixtures, port fixtures ${fixtureMs} ms (slowest ${slowestFixtureMs} ms), this repository (${tracked} tracked files) ${repositoryMs} ms, a 1 MiB canonical path ${canonicalLimitMs} ms`,
);
