// Behavioral tests for the Claude Code flow-guard hooks module, driven through `register` on the host model.
// Dependency-free: the module is an ES module, so Node's type stripping and Bun both load it.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { credentialsRefusal, secretRefusal } from "../claude-code/hooks/guard/credentials.ts";
import { createGateState, flowGateSpec, gateAction } from "../claude-code/hooks/guard/gate.ts";
import { hostOf } from "../claude-code/hooks/guard/host.ts";
import { runtimeWriteRefusal } from "../claude-code/hooks/guard/runtime-writes.ts";
import { foreignToolRefusal } from "../claude-code/hooks/guard/tool-inputs.ts";
import { GIT_ENVIRONMENT_NAMES, worktreeIdentity } from "../claude-code/hooks/guard/tree.ts";
import { CLOUD_SESSION_ENV } from "../claude-code/hooks/guard/publication.ts";
import { register } from "../claude-code/hooks/guard.ts";
import { createModHost } from "./claude-code-mod-host.mjs";

const CWD = "/work/app";
const GATE_TOOL = "mcp__fiatcode__flow_gate";

const TOOL_CALL_REASON =
	"Flow guard failed closed: the tool.call hook could not decide. Retry; if it keeps failing, report it instead of working around it.";
const AGENT_SPAWN_REASON =
	"Flow guard failed closed: the agent.spawn hook could not decide. Retry; if it keeps failing, report it instead of working around it.";
const TOOL_CHECK_REASON = "Flow guard failed closed: the tool.check hook could not decide. Approve only the command you meant to run.";
const FLOW_GATE_REASON =
	"Flow gate failed closed: the flow_gate hook could not decide. Retry; if it keeps failing, report it instead of working around it.";

function plugin(options = {}) {
	const host = createModHost({ cwd: CWD, ...options });
	register(host.on);
	return host;
}

const READ = { tool: "Read", file_path: "README.md" };
const SPAWN = { prompt: "count the files", subagentType: "general-purpose", cwd: CWD };

// S1 (S0): the model takes only the answer shapes the engine takes, per event, so no test below can
// assert what the engine cannot do. A wrong shape is a failure handled like a throw: the hook is skipped and the hooks
// beneath decide.
{
	const host = createModHost({ cwd: CWD });
	const ran = [];
	host.on("session.start", async () => ({ deny: "no" }));
	host.on("session.start", async ($, event, next) => {
		ran.push("later");
		return await next(event);
	});
	const outcome = await host.call("session.start", { cwd: CWD });
	assert.equal(outcome.refused, undefined, "a deny is the wrong shape at session.start");
	assert.deepEqual(ran, ["later"], "the hook beneath the wrong-shape one runs");
	assert.deepEqual(outcome.returned, { cwd: CWD }, "core echoes the cwd");
	assert.equal(outcome.proceeded, true);
}
{
	const host = createModHost({ cwd: CWD });
	host.on("tool.call", async () => ({ decision: "ask" }));
	const outcome = await host.call("tool.call", READ);
	assert.equal(outcome.decision, undefined, "a decision is the wrong shape at tool.call");
	assert.equal(outcome.proceeded, true);
}
{
	const host = createModHost({ cwd: CWD });
	host.on("tool.call", async () => ({ result: { content: [] } }));
	const outcome = await host.call("tool.call", READ);
	assert.equal(outcome.result, undefined, "a tool.call result is a string or a content-block array, never an object");
	assert.equal(outcome.proceeded, true);
}
{
	const host = createModHost({ cwd: CWD });
	host.on("tool.call", async () => undefined).catch(() => ({ deny: "caught" }));
	const outcome = await host.call("tool.call", READ);
	assert.equal(outcome.refused, "caught", "undefined without next is a failure, so the catch answers in its place");
}
{
	const host = createModHost({ cwd: CWD });
	host
		.on("tool.call", async () => {
			throw new Error("guard broke");
		})
		.catch(() => new Promise((resolve) => setTimeout(() => resolve({ deny: "late" }), 1_500)));
	const outcome = await host.call("tool.call", READ);
	assert.equal(outcome.refused, undefined, "a catch past its 1 s grace is skipped");
	assert.equal(outcome.proceeded, true);
}
{
	const host = createModHost({ cwd: CWD });
	host.on("tool.call", async ($, event, next) => await next({ ...event, marker: 1 }));
	host.on("tool.call", async ($, event) => ({ deny: `marker ${event.marker}` }));
	const outcome = await host.call("tool.call", READ);
	assert.equal(outcome.refused, "marker 1", "next(e') hands e' to the hooks beneath");
}
{
	const host = createModHost({ cwd: CWD });
	host.on("tool.call", { tool: /^mcp__fiatcode__/ }, async () => ({ deny: "matched" }));
	const outcome = await host.call("tool.call", { tool: GATE_TOOL, action: "status" });
	assert.equal(outcome.refused, "matched", "a RegExp matcher value tests the event's string value");
	assert.equal((await host.call("tool.call", READ)).refused, undefined);
}

// S1: the module registers one behaviour per event, each with the one `.catch` that answers when the hook cannot. The
// `flow_gate` call is served by its own `tool.call` registration, matched on the engine's plugin-scoped name.
{
	const host = plugin();
	assert.deepEqual(
		host.registrations.map((registration) => [registration.event, registration.matcher]),
		[
			["session.start", undefined],
			["tool.call", undefined],
			["tool.call", { tool: GATE_TOOL }],
			["agent.spawn", undefined],
			["tool.check", undefined],
		],
	);
	for (const registration of host.registrations) {
		assert.equal(typeof registration.catchHook, "function", `${registration.event} must carry a .catch`);
	}
	const started = await host.call("session.start", { cwd: CWD, surface: null, isInteractive: false });
	assert.deepEqual(started.returned, { cwd: CWD }, "session.start ends in core's echo of the cwd");
	assert.equal(started.proceeded, true);
	assert.deepEqual(
		host.registeredTools.map(({ name, tool }) => ({ name, tool })),
		[{ name: "flow_gate", tool: GATE_TOOL }],
		"session.start registers flow_gate under the engine's plugin-scoped name",
	);
	assert.equal(host.registeredTools[0].description, flowGateSpec().description);
	assert.deepEqual(host.registeredTools[0].inputSchema, flowGateSpec().inputSchema);
	const again = await host.call("session.start", { cwd: CWD });
	assert.equal(again.refused, undefined, "a second session.start registers nothing new");
	assert.equal(host.registeredTools.length, 1, "one registration per process");
}

// S1: the pass-through registrations let the call through.
{
	const host = plugin();
	assert.equal((await host.call("tool.call", READ)).proceeded, true);
	assert.equal((await host.spawn(SPAWN)).proceeded, true);
	assert.equal((await host.check({ tool: "Bash", input: { command: "ls" } })).proceeded, true);
}

// S1: the host boundary is the one reader of the engine's own object; it maps the calls the guard needs and reads a
// dialog answer through the gate's exact-label test, so an answer naming neither label — or both — refuses instead of
// approving.
{
	const host = createModHost({
		cwd: CWD,
		answers: ["Approve", { selected: ["Approve"] }, { label: "Refuse" }, "Approve and Refuse", { isAnswered: false }],
	});
	const mapped = hostOf(host.$);
	assert.equal(mapped.pluginName, "fiatcode");
	assert.equal(await mapped.sha256("tree\0"), "4c91b08843fdda8593f1552b5a6f10075310e7773fed804c20e24813c963f26f");
	assert.deepEqual(await mapped.run([process.execPath, "-e", "process.stdout.write('hi')"]), {
		exitCode: 0,
		stdout: "hi",
		stderr: "",
		isTruncated: false,
	});
	const dialog = [{ label: "Approve" }, { label: "Refuse" }];
	assert.equal(await mapped.ask("Approve the change?", dialog), true, "a plain Approve answer approves");
	assert.equal(await mapped.ask("Approve the change?", dialog), true, "an answer holding the label one level down approves");
	assert.equal(await mapped.ask("Approve the change?", dialog), false, "Refuse does not approve");
	assert.equal(await mapped.ask("Approve the change?", dialog), false, "an answer naming both labels does not approve");
	await assert.rejects(
		async () => await mapped.ask("Approve the change?", dialog),
		(error) => error.name === "HooksError",
	);
}

// S1: the engine's fail-open, which is why every gating registration needs a working `.catch`: a hook that throws
// before it answers is skipped and the call proceeds.
{
	const host = createModHost({ cwd: CWD });
	host.on("tool.call", async () => {
		throw new Error("guard broke");
	});
	const outcome = await host.call("tool.call", READ);
	assert.equal(outcome.refused, undefined, "a throwing hook refuses nothing on its own");
	assert.equal(outcome.proceeded, true, "a throwing hook is skipped and the call proceeds");
}

// S1: one that runs past its budget is skipped the same way.
{
	const host = createModHost({ cwd: CWD, timeout: 5 });
	host.on("tool.call", () => new Promise(() => {}));
	const outcome = await host.call("tool.call", READ);
	assert.equal(outcome.proceeded, true, "a timed-out hook is skipped and the call proceeds");
}

// S1: a catch that also breaks leaves the hook skipped and the call proceeding.
{
	const host = createModHost({ cwd: CWD });
	host
		.on("tool.call", async () => {
			throw new Error("guard broke");
		})
		.catch(async () => {
			throw new Error("the catch broke too");
		});
	const outcome = await host.call("tool.call", READ);
	assert.equal(outcome.proceeded, true);
}

// S1: a hook that carried the call on with `next` before throwing is not refused in its place — the catch reads
// `next.called`, which is why every catch starts with `next.called ? next(e) : …`.
{
	const host = createModHost({ cwd: CWD });
	let calledInCatch;
	host
		.on("tool.call", async ($, event, next) => {
			await next(event);
			throw new Error("guard broke after next");
		})
		.catch(async ($, event, next) => {
			calledInCatch = next.called;
			return next.called ? next(event) : { deny: "refused in its place" };
		});
	const outcome = await host.call("tool.call", READ);
	assert.equal(calledInCatch, true);
	assert.equal(outcome.proceeded, true);
}

// S1: the real guard's catch refuses a tool.call whose hook throws.
{
	const host = plugin({
		wrapHook({ event, run }) {
			if (event === "tool.call") throw new Error("guard broke");
			return run();
		},
	});
	const outcome = await host.call("tool.call", READ);
	assert.equal(outcome.refused, TOOL_CALL_REASON);
	assert.equal(outcome.proceeded, false);
}

// S1: and one that times out.
{
	const host = plugin({
		timeout: 5,
		wrapHook({ event, run }) {
			if (event === "tool.call") return new Promise(() => {});
			return run();
		},
	});
	const outcome = await host.call("tool.call", READ);
	assert.equal(outcome.refused, TOOL_CALL_REASON);
	assert.equal(outcome.proceeded, false);
}

// S1: the same for a spawn.
{
	const host = plugin({
		timeout: 5,
		wrapHook({ event, run }) {
			if (event === "agent.spawn") return new Promise(() => {});
			return run();
		},
	});
	const outcome = await host.spawn(SPAWN);
	assert.equal(outcome.refused, AGENT_SPAWN_REASON);
	assert.equal(outcome.proceeded, false);
}

// S1: a broken tool.check asks instead of refusing, so a publication whose guard broke still reaches the user.
{
	const host = plugin({
		wrapHook({ event, run }) {
			if (event === "tool.check") throw new Error("guard broke");
			return run();
		},
	});
	const outcome = await host.check({ tool: "Bash", input: { command: "git push" } });
	assert.equal(outcome.decision, "ask");
	assert.equal(outcome.reason, TOOL_CHECK_REASON);
	assert.equal(outcome.refused, undefined, "tool.check never denies");
	assert.equal(outcome.proceeded, true);
}

// S1: the `flow_gate` registration's own catch refuses a call whose hook throws, instead of letting it reach core.
{
	const host = plugin({
		wrapHook({ event, matcher, run }) {
			if (event === "tool.call" && matcher?.tool === GATE_TOOL) throw new Error("flow_gate hook broke");
			return run();
		},
	});
	const outcome = await host.call("tool.call", { tool: GATE_TOOL, action: "status", scope: "demo" });
	assert.equal(outcome.refused, FLOW_GATE_REASON);
	assert.equal(outcome.proceeded, false);
}

// S1: the guard's `session.start` carries the event on with `next`, so another plugin's hook beneath it runs and the
// session starts on core's echo of the cwd.
{
	const fresh = await import("../claude-code/hooks/guard.ts?session-start-next");
	const host = createModHost({ cwd: CWD });
	fresh.register(host.on);
	const ran = [];
	host.on("session.start", async ($, event, next) => {
		ran.push(event.cwd);
		return await next(event);
	});
	const started = await host.call("session.start", { cwd: CWD });
	assert.deepEqual(ran, [CWD], "the hook beneath the guard's runs");
	assert.deepEqual(started.returned, { cwd: CWD });
	assert.equal(host.registeredTools.length, 1);
}

// S1 (review CRF-15): the mods loader needs a literal name at every `$.env.get` call site, so `hostOf` switches over
// the names it reads; every name the guard asks the host for must be a case there, or it silently reads as unset.
{
	const host = createModHost({ cwd: CWD });
	host.$.env.get = async () => "sentinel";
	const mapped = hostOf(host.$);
	for (const name of [...GIT_ENVIRONMENT_NAMES, ...CLOUD_SESSION_ENV, "HOME", "USERPROFILE", "TMPDIR", "TEMP", "TMP"]) {
		assert.equal(await mapped.env(name), "sentinel", `hostOf reads ${name}`);
	}
}

// S1: a cloud `session.start` records the session root and the branch git names there, once, in this module's memory,
// so a following exempt push needs no decision; a local `session.start` runs no git child for them.
{
	const repo = realpathSync.native(mkdtempSync(join(tmpdir(), "flow-guard-session-start-")));
	const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
	git("init", "-q", "-b", "claude/session-abc");
	git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init");
	git("remote", "add", "origin", "https://example.invalid/session.git");
	git("update-ref", "refs/remotes/origin/main", "HEAD");
	git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
	const started = async (env) => {
		const fresh = await import(`../claude-code/hooks/guard.ts?session-start-facts-${Object.keys(env).length}`);
		const host = createModHost({ cwd: repo, env });
		fresh.register(host.on);
		const run = host.$.process.run;
		const gitChildren = [];
		host.$.process.run = async (argv, options) => {
			if (argv[0] === "git") gitChildren.push(argv.join(" "));
			return await run(argv, options);
		};
		const outcome = await host.call("session.start", { cwd: repo });
		assert.deepEqual(outcome.returned, { cwd: repo });
		return { host, gitChildren };
	};
	const cloud = await started({ CLAUDE_CODE_REMOTE: "1" });
	assert.deepEqual(cloud.gitChildren, ["git rev-parse --abbrev-ref HEAD"], "the start branch is read once at session.start");
	const pushed = await cloud.host.check({ tool: "Bash", input: { command: "git push" } });
	assert.equal(pushed.decision, undefined, "the start facts exempt the bare push");
	assert.equal(pushed.proceeded, true);
	assert.equal((await cloud.host.check({ tool: "Bash", input: { command: "git push --force" } })).decision, "ask");
	const local = await started({});
	assert.deepEqual(local.gitChildren, [], "a local session.start reads no git");
	assert.equal((await local.host.check({ tool: "Bash", input: { command: "git push" } })).decision, "ask");
	rmSync(repo, { recursive: true, force: true });
}

// S3: only `flow_gate` writes `.flow/runtime/` — OMP's sentence, over the tools this port has: `Write`, `Edit` and
// `NotebookEdit` targets, judged as written and with symlinks followed, and shell text after quote and escape removal,
// with the session directory counted.
const RUNTIME_WRITE_REASON =
	"Only flow_gate writes .flow/runtime/; a hand-written record is not an approval. Use flow_gate present/approve, accept or clear instead.";

const temporaryRoots = [];

function temporaryDir(prefix) {
	const root = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
	temporaryRoots.push(root);
	return root;
}

// A file's `file:///` URI as a URL library writes it: `file:///tmp/x` on POSIX, `file:///C:/Users/x` on Windows, where
// pasting a `C:\` path after `file://` would put the drive in the authority. `form` picks the spelling under test.
function fileUri(path, form = "slashes") {
	const href = pathToFileURL(path).href;
	if (form === "single") return href.replace("file:///", "file:/");
	if (form === "localhost") return href.replace("file://", "file://localhost");
	return href;
}

function runtimeRoot(prefix) {
	const root = temporaryDir(prefix);
	mkdirSync(join(root, ".flow/runtime"), { recursive: true });
	return root;
}

// The session's cwd reaches `tool.call` through the engine's session, which the host reads: a tool.call event carries
// the tool's arguments, `tool` and `tool_use_id`, and never a cwd.
function runtimePlugin(cwd) {
	return plugin({ cwd });
}

// A host whose `stat` answers no `realPath` even with `{ resolve: true }`: `realpath` is then the only canonical
// source, and `realpath: false` is a host with neither.
function canonicalEngineHost(cwd, { realpath = true } = {}) {
	const host = hostOf(createModHost({ cwd }).$);
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

async function callTool(host, tool, input) {
	return await host.call("tool.call", { ...input, tool });
}

async function refusedTool(host, tool, input, reason = RUNTIME_WRITE_REASON) {
	const outcome = await callTool(host, tool, input);
	assert.equal(outcome.refused, reason, `${tool} ${JSON.stringify(input)} must be refused`);
	assert.equal(outcome.proceeded, false, `${tool} ${JSON.stringify(input)} must not proceed`);
}

async function allowedTool(host, tool, input) {
	const outcome = await callTool(host, tool, input);
	assert.equal(outcome.refused, undefined, `${tool} ${JSON.stringify(input)} must pass`);
	assert.equal(outcome.proceeded, true, `${tool} ${JSON.stringify(input)} must proceed`);
}

// S3: every write-tool target that names the directory is refused — relative, absolute, after `..` is resolved, and
// in the notebook field — while other Flow artifacts, look-alike names and a targetless call stay writable.
{
	const root = runtimeRoot("flow-guard-runtime-write-");
	const host = runtimePlugin(root);
	await refusedTool(host, "Write", { file_path: ".flow/runtime/approvals.log", content: "x" });
	await refusedTool(host, "Edit", { file_path: ".flow/runtime/gates.json", old_string: "a", new_string: "b" });
	await refusedTool(host, "NotebookEdit", { notebook_path: ".flow/runtime/state.ipynb", new_source: "x" });
	await refusedTool(host, "Write", { file_path: join(root, ".flow/runtime/new.json"), content: "x" });
	await refusedTool(host, "Write", { file_path: ".flow/../.flow/runtime/x", content: "x" });
	await refusedTool(host, "Write", { file_path: ".flow/runtime", content: "x" });
	await allowedTool(host, "Write", { file_path: ".flow/contracts/demo.md", content: "x" });
	await allowedTool(host, "Edit", { file_path: ".flow/plans/demo/PLAN.md", old_string: "a", new_string: "b" });
	await allowedTool(host, "Write", { file_path: "docs/.flow-runtime.md", content: "x" });
	await allowedTool(host, "Write", { file_path: ".flow/runtime-notes.md", content: "x" });
	await allowedTool(host, "Write", { content: "x" });
	assert.equal(host.asks.length, 0, "the runtime-write guard refuses; it never asks");

	// The repository root is an anchor of its own: a symlinked `.flow` is caught from a subdirectory even though the
	// written path names neither `.flow` nor `runtime`.
	const repo = runtimeRoot("flow-guard-runtime-link-");
	rmSync(join(repo, ".flow"), { recursive: true, force: true });
	mkdirSync(join(repo, "store/runtime"), { recursive: true });
	symlinkSync("store", join(repo, ".flow"));
	mkdirSync(join(repo, "sub"));
	execFileSync("git", ["init", "-q"], { cwd: repo, stdio: "ignore" });
	const linked = runtimePlugin(join(repo, "sub"));
	await refusedTool(linked, "Write", { file_path: join(repo, "store/runtime/approvals.log"), content: "x" });
	await refusedTool(linked, "Write", { file_path: "../store/runtime/new.json", content: "x" });
	await allowedTool(linked, "Write", { file_path: "../store/notes.md", content: "x" });

	// Before any gate state exists the link alone anchors the real location, or a forged first record would pass.
	const unbuilt = temporaryDir("flow-guard-runtime-unbuilt-");
	mkdirSync(join(unbuilt, "store"));
	symlinkSync("store", join(unbuilt, ".flow"));
	const linkedToo = runtimePlugin(unbuilt);
	await refusedTool(linkedToo, "Write", { file_path: "store/runtime/gates.json", content: "{}" });
	await allowedTool(linkedToo, "Write", { file_path: "store/notes.md", content: "x" });
}

// S3: the symlinked `.flow` is caught on a host whose `stat` answers no `realPath` even with `{ resolve: true }`:
// `realpath` is then the only canonical source, and a host that answers neither refuses instead of trusting the path
// as written.
{
	const repo = runtimeRoot("flow-guard-runtime-link-engine-");
	rmSync(join(repo, ".flow"), { recursive: true, force: true });
	mkdirSync(join(repo, "store/runtime"), { recursive: true });
	symlinkSync("store", join(repo, ".flow"));
	execFileSync("git", ["init", "-q"], { cwd: repo, stdio: "ignore" });

	const engine = canonicalEngineHost(repo);
	assert.equal(
		await runtimeWriteRefusal(engine, repo, "Write", { file_path: join(repo, "store/runtime/approvals.log") }),
		RUNTIME_WRITE_REASON,
	);
	assert.equal(await runtimeWriteRefusal(engine, repo, "Write", { file_path: join(repo, "store/notes.md") }), undefined);
	assert.equal(await runtimeWriteRefusal(engine, repo, "Write", { file_path: join(repo, ".flow/contracts/demo.md") }), undefined);

	const blind = canonicalEngineHost(repo, { realpath: false });
	assert.equal(
		await runtimeWriteRefusal(blind, repo, "Write", { file_path: join(repo, "store/runtime/approvals.log") }),
		RUNTIME_WRITE_REASON,
		"a host that cannot resolve the link must refuse rather than trust the written path",
	);
	assert.equal(await runtimeWriteRefusal(blind, repo, "Write", { file_path: join(repo, "docs/notes.md") }), RUNTIME_WRITE_REASON);
	assert.equal(await runtimeWriteRefusal(blind, repo, "Bash", { command: "ls", cwd: join(repo, "store") }), undefined, "a shell input has no workdir");
}

// S3: shell text naming the directory is refused in every spelling the shell would read it in; `.flow/contracts` and
// other `.flow` writes are not this guard's.
{
	const root = runtimeRoot("flow-guard-runtime-shell-");
	const host = runtimePlugin(root);
	for (const command of [
		"echo x > .flow/runtime/approvals.log",
		"cp x .flow/runtime/gates.json",
		"tee .flow/runtime/approvals.log",
		"cd /repo && echo x > .flow/runtime/x",
		"rm -rf .flow/runtime",
		// Reading names the directory too: the shell rule is text-only and cannot tell a reader from a writer.
		"cat .flow/runtime/approvals.log",
	]) {
		await refusedTool(host, "Bash", { command });
	}
	await refusedTool(host, "PowerShell", { command: "Set-Content .flow/runtime/approvals.log x" });
	await allowedTool(host, "Bash", { command: "echo hi > .flow/contracts/port-parity.md" });
	await allowedTool(host, "Bash", { command: "ls .flow" });
	await allowedTool(host, "Bash", { command: "git status" });
	assert.equal(host.asks.length, 0, "the shell check refuses; it never asks");
}

// S3 (review P2): the spellings a shell collapses back into `.flow/runtime` — a `cd`/`-C` into `.flow` with `runtime`
// named after it, `.` and repeated separators, and quotes or escapes inside the path — are refused.
{
	const root = runtimeRoot("flow-guard-runtime-spelling-");
	const host = runtimePlugin(root);
	for (const command of [
		"cd .flow && mkdir -p runtime && printf 'x' > runtime/approvals.log",
		"printf x > .flow/./runtime/a",
		"printf x > .flow//runtime/a",
		"printf x > .flow/'runtime'/a",
		'printf x > ".flow"/runtime/a',
		"printf x > \\.flow/runtime/a",
		"git -C .flow add runtime",
		"pushd .flow; printf x > runtime/a",
		"printf x > .flow/sub/../runtime/a",
		// A substitution runs a command of its own: the lexer splits on a backtick and on `$(` inside double quotes.
		"echo `cd .flow` && printf x > runtime/a",
		'echo "$(cd .flow && printf x > runtime/a)"',
	]) {
		await refusedTool(host, "Bash", { command });
	}
	for (const command of ["Set-Location .flow; New-Item runtime/x", 'Set-Content ".flow/run`time/x" y', "Set-Content .flow\\runtime\\x y"]) {
		await refusedTool(host, "PowerShell", { command });
	}
	for (const command of ["cd .flow && ls", "echo runtime", "cat .flow/contracts/runtime.md", "ls .flow/plans"]) {
		await allowedTool(host, "Bash", { command });
	}
	if (process.platform !== "win32") {
		// On POSIX a backslash is a file-name character: this names a file `.flow\runtime` beside `.flow`.
		await allowedTool(host, "Bash", { command: 'printf x > ".flow\\runtime"' });
	}
}

// S3: a redirect glued to the `cd`/`pushd` target (`.flow>/dev/null`) leaves no whitespace word that is the target
// alone, so the move into `.flow` is read from the words split into pieces.
{
	const host = runtimePlugin(runtimeRoot("flow-guard-runtime-enter-glued-"));
	await refusedTool(host, "Bash", { command: "cd .flow>/dev/null&&printf x>runtime/a" });
	await refusedTool(host, "Bash", { command: "pushd .flow>x&&printf x>runtime/a" });
}

// S3: a path glued to a redirect, an option or an assignment, or written inside a quoted program, has no word part
// equal to `.flow`, so the text itself is searched for the directory; `cd .flow;…runtime…` is split on the characters
// a path cannot hold. Other `.flow` writes and a bare `runtime` word stay allowed.
{
	const root = runtimeRoot("flow-guard-runtime-glued-");
	const host = runtimePlugin(root);
	for (const command of [
		"printf x >.flow/runtime/a",
		">>.flow/runtime/approvals.log",
		"2>.flow/runtime/a",
		"dd of=.flow/runtime/approvals.log",
		"python3 -c \"open('.flow/runtime/approvals.log','w')\"",
		"node -e \"require('fs').writeFileSync('.flow/runtime/approvals.log','x')\"",
		"curl -o.flow/runtime/a https://example.invalid",
		"cp x --target-directory=.flow/runtime",
		"cd .flow;printf x>runtime/a",
		"curl -o.flow/'runtime'/a https://example.invalid",
		"printf x >.FLOW/Runtime/a",
		"printf x >.flow./runtime /a",
	]) {
		await refusedTool(host, "Bash", { command });
	}
	await refusedTool(host, "Monitor", { description: "m", timeout_ms: 1000, command: "printf x >.flow/runtime/a" });
	await refusedTool(host, "PowerShell", { command: "Set-Content -Path:.flow\\runtime\\x y" });
	// Being a substring search, the text clause also refuses a mere mention of the directory, glued to other characters
	// or with a longer last part; PowerShell's `\` separates there, so its text is searched in that form.
	for (const command of ["echo x.flow/runtime", "echo .flow/runtimes"]) await refusedTool(host, "Bash", { command });
	for (const command of ["Write-Output x.flow\\runtime", "Write-Output .flow\\runtimes"]) await refusedTool(host, "PowerShell", { command });
	for (const command of ["printf x >.flow/contracts/a", "echo runtime > notes.txt", "cd .flow && ls contracts"]) {
		await allowedTool(host, "Bash", { command });
	}
}

// S3: the session directory counts — a shell inside `.flow` that names `runtime`, and any shell inside `.flow/runtime`,
// is refused.
{
	const root = runtimeRoot("flow-guard-runtime-session-");
	await refusedTool(runtimePlugin(join(root, ".flow")), "Bash", { command: "printf x > runtime/a" });
	await allowedTool(runtimePlugin(join(root, ".flow")), "Bash", { command: "ls contracts" });
	await refusedTool(runtimePlugin(join(root, ".flow/runtime")), "Bash", { command: "printf x > approvals.log" });
}

// S3 (review P3, p4): the file-tool rule folds case and a part's trailing dots and spaces, so a write that lands in the
// runtime directory on a case-insensitive or Windows disk is refused before the directory exists; on POSIX a backslash
// is a name character, so `x\..\..\..\notes.md` is one file inside `.flow/runtime`.
{
	const root = temporaryDir("flow-guard-runtime-fold-");
	mkdirSync(join(root, ".flow"));
	const host = runtimePlugin(root);
	for (const file_path of [".flow/Runtime/approvals.log", ".FLOW/runtime/x", ".flow./runtime./x", ".flow/runtime /x"]) {
		await refusedTool(host, "Write", { file_path, content: "x" });
	}
	await allowedTool(host, "Write", { file_path: ".flow/runtimes/x", content: "x" });
	if (process.platform !== "win32") {
		await refusedTool(runtimePlugin(runtimeRoot("flow-guard-runtime-backslash-")), "Write", {
			file_path: ".flow/runtime/x\\..\\..\\..\\notes.md",
			content: "x",
		});
	}
}

// S3 (review M55): a symlink into `.flow/runtime` is judged by where it lands, not by the path as written.
{
	const root = runtimeRoot("flow-guard-runtime-symlink-");
	symlinkSync(join(root, ".flow/runtime"), join(root, "rt"), "dir");
	await refusedTool(runtimePlugin(root), "Write", { file_path: "rt/approvals.log", content: "x" });
}

// S3: the host reads the session's own directory, and a target that cannot be resolved to an absolute path refuses
// rather than passing: with no session directory an absolute path is still judged and a relative one fails closed.
{
	const bare = hostOf(createModHost({ cwd: CWD }).$);
	assert.equal(await bare.sessionCwd(), CWD, "the host answers the engine's session cwd");
	assert.equal(await runtimeWriteRefusal(bare, "", "Write", { file_path: "notes.md" }), RUNTIME_WRITE_REASON);
	assert.equal(
		await runtimeWriteRefusal(bare, "", "Write", { file_path: `${CWD}/.flow/runtime/approvals.log` }),
		RUNTIME_WRITE_REASON,
	);
	assert.equal(await runtimeWriteRefusal(bare, "", "Write", { file_path: `${CWD}/notes.md` }), undefined);
	assert.equal(await runtimeWriteRefusal(bare, "", "Bash", { command: "printf x > runtime/a" }), undefined, "no session directory, nothing named");
}

// S3: this is a write guard, so reading the directory is allowed.
{
	const root = runtimeRoot("flow-guard-runtime-read-");
	const host = runtimePlugin(root);
	await allowedTool(host, "Read", { file_path: ".flow/runtime/approvals.log" });
}

// S4: no `Read`, `Grep`, `Bash` or `PowerShell` call prints a known credentials file — OMP's sentence with the tool
// named in lowercase, the same file list and the same loader shapes. The shared table's secret cases are
// mirrored here, so the table's Claude Code adapter runs against shapes this suite already proves.
const SECRET_HOME = temporaryDir("flow-guard-secret-home-");
mkdirSync(join(SECRET_HOME, ".config/opencode"), { recursive: true });

function secretPlugin(options = {}) {
	return plugin({ env: { HOME: SECRET_HOME }, ...options });
}

async function refusedSecret(host, tool, input, name) {
	const outcome = await callTool(host, tool, input);
	assert.equal(outcome.refused, credentialsRefusal(tool, name), `${tool} ${JSON.stringify(input)} must be refused for ${name}`);
	assert.equal(outcome.proceeded, false, `${tool} ${JSON.stringify(input)} must not proceed`);
}

// S4: the sentence is OMP's, word for word, and `.env` is refused on every tool that prints a file; `PowerShell` is
// shell text, not an extra name list.
{
	const host = secretPlugin();
	assert.equal(
		credentialsRefusal("Read", ".env"),
		"Flow credentials guard: this read call would print a credentials file (.env). " +
			"Cite its path instead; take key names from a committed example file or from the user. " +
			"Loading it stays allowed: a program's own loader (--env-file), or ( set -a; . <file> >/dev/null 2>&1; set +a; exec <command> ).",
	);
	await refusedSecret(host, "Read", { file_path: ".env" }, ".env");
	await refusedSecret(host, "Grep", { pattern: "TOKEN", path: "config/.env" }, ".env");
	await refusedSecret(host, "Bash", { command: "cat .env" }, ".env");
	await refusedSecret(host, "PowerShell", { command: "Get-Content .env" }, ".env");
	await allowedTool(host, "PowerShell", { command: "Get-Content notes.txt" });
}

// S4: a symlink is judged by its target as well as by its own name, from either canonical source: `stat().realPath`
// when the host's `stat` answers one (the guard passes `{ resolve: true }`), and `realpath` when it answers none.
{
	const dir = temporaryDir("flow-guard-secret-link-");
	writeFileSync(join(dir, ".env"), "DUMMY=1\n");
	symlinkSync(join(dir, ".env"), join(dir, "link.txt"));
	const host = secretPlugin({ cwd: dir });
	await refusedSecret(host, "Read", { file_path: "link.txt" }, ".env");
	await allowedTool(host, "Read", { file_path: "notes.txt" });

	const engine = canonicalEngineHost(dir);
	assert.equal(await secretRefusal(engine, dir, "Read", { file_path: "link.txt" }), credentialsRefusal("read", ".env"));
	assert.equal(await secretRefusal(engine, dir, "Read", { file_path: "notes.txt" }), undefined);
}

// S4: `~` expands the way the harness expands it; `service.json` counts only under an `opencode` directory; the
// credentials-name rule needs one of the listed extensions.
{
	const host = secretPlugin();
	await refusedSecret(host, "Read", { file_path: "~/.config/opencode/service.json" }, "service.json");
	await refusedSecret(host, "Read", { file_path: "~/.aws/credentials" }, "credentials");
	await allowedTool(host, "Read", { file_path: "service.json" });
	await allowedTool(host, "Read", { file_path: "src/auth/credentials.ts" });
	const atOpencode = secretPlugin({ cwd: join(SECRET_HOME, ".config/opencode") });
	await refusedSecret(atOpencode, "Read", { file_path: "service.json" }, "service.json");
	await allowedTool(atOpencode, "Read", { file_path: "mcp.example.json" });
}

// S4: `Grep` is judged by its path first, then by `path/glob` with a last-segment glob also tested without its
// wildcards, the way the OpenCode port reads an `include`.
{
	const host = secretPlugin();
	await refusedSecret(host, "Grep", { pattern: "TOKEN", path: "src", glob: ".env*" }, ".env*");
	await refusedSecret(host, "Grep", { pattern: "TOKEN", path: "keys", glob: "id_rsa*" }, "id_rsa");
	await refusedSecret(host, "Grep", { pattern: "TOKEN", glob: "*credentials*.json" }, "*credentials*.json");
	await refusedSecret(host, "Grep", { pattern: "TOKEN", path: "certs", glob: "*.pem" }, "*.pem");
	await refusedSecret(host, "Grep", { pattern: "TOKEN", path: "config/.env", glob: "*.ts" }, ".env");
	await allowedTool(host, "Grep", { pattern: "TOKEN", path: "src", glob: "*.ts" });
	await allowedTool(host, "Grep", { pattern: "TOKEN", glob: ".env.example" });
	await allowedTool(host, "Grep", { pattern: "TOKEN", path: "docs" });
	await allowedTool(host, "Grep", { pattern: "TOKEN", path: "", glob: "" });
}

// S4: shell text that would print a file is refused by the ordered rules; loading it into a program stays allowed.
{
	const host = secretPlugin();
	for (const [command, name] of [
		["grep -r TOKEN .env", ".env"],
		[". ./.env", ".env"],
		["source .env && env", ".env"],
		["head -n 5 config/credentials.yml", "credentials.yml"],
		["python -c \"print(open('.env').read())\"", ".env"],
		["git diff -- .env", ".env"],
		["cat ~/.config/opencode/service.json", "service.json"],
		["cat < .env", ".env"],
		["tr -d x < .env", ".env"],
		["base64 keys/id_rsa", "id_rsa"],
		["jq . mcp.json", "mcp.json"],
		["sed -n 1p app/.env.local", ".env.local"],
	]) {
		await refusedSecret(host, "Bash", { command }, name);
	}
	for (const command of [
		"cat .env.example",
		"grep .env README.md",
		"( set -a; . ./.env >/dev/null 2>&1; set +a; exec ./run )",
		"docker run --env-file .env app",
		"echo hi > .env",
		"cat notes.txt > .env",
		"cp .env .env.bak",
		"ls -la .env",
		"cat keys/id_rsa.pub",
		"test -f .env && echo yes",
		"ssh -i keys/id_rsa",
		"cat service.json",
		"cat README.md",
	]) {
		await allowedTool(host, "Bash", { command });
	}
}

// S4 (review SEC-11): PowerShell's own readers — `Select-String`, `Format-Hex`, the `[IO.File]::Read*` calls and the
// `${path}` variable — are spelled as the bash reader before rule 3 runs, and a cmdlet matches in any case. The loader
// shape stays allowed, and the pipe form, which names no file to its reader, stays a listed miss.
{
	assert.match(credentialsRefusal("PowerShell", ".env"), /^Flow credentials guard: this powershell call /);
	const host = secretPlugin();
	for (const command of [
		"Select-String -Path .env -Pattern .",
		"sls . .env",
		"Format-Hex .env",
		"fhx .env",
		"[IO.File]::ReadAllText('.env')",
		'[System.IO.File]::ReadAllLines(".env")',
		"${C:\\repo\\.env}",
		"GET-CONTENT .env",
	]) {
		await refusedSecret(host, "PowerShell", { command }, ".env");
	}
	await allowedTool(host, "PowerShell", { command: "docker run --env-file .env app" });
	await allowedTool(host, "PowerShell", { command: "Get-Item .env | Get-Content" });
}

// S4: malformed inputs and tools this guard does not cover pass untouched; the guard refuses and never asks.
{
	const host = secretPlugin();
	await allowedTool(host, "Read", { file_path: 42 });
	await allowedTool(host, "Read", {});
	await allowedTool(host, "Read", { file_path: "" });
	await allowedTool(host, "Grep", { pattern: "TOKEN", path: 1, glob: [".env"] });
	await allowedTool(host, "Grep", { pattern: "TOKEN", glob: 7 });
	await allowedTool(host, "Bash", { command: ["cat", ".env"] });
	await allowedTool(host, "Write", { file_path: ".env", content: "x" });
	await allowedTool(host, "WebFetch", { url: ".env" });
	assert.equal(host.asks.length, 0, "the credentials guard never asks");
}

// S4: a target that cannot be resolved refuses rather than passing, and the credentials check answers before the
// runtime-write check, as OMP orders them: a call that both prints a secret and writes `.flow/runtime` names the secret.
{
	const bare = plugin({ cwd: "" });
	const outcome = await callTool(bare, "Read", { file_path: "notes.md" });
	assert.equal(outcome.refused, TOOL_CALL_REASON, "a relative target without a session directory fails closed");
	await refusedSecret(secretPlugin(), "Bash", { command: "cat .env > .flow/runtime/approvals.log" }, ".env");
}

// S5: `flow_gate` — the OpenCode tool's port over this host: `present` pins one artifact and writes nothing; one
// `approve` dialog covers every named scope and kind; one `accept` dialog names each scope, its source and the head
// read before it; only an affirmative answer writes. Presentations live in this process's memory, so every
// scenario gets its own repository and host.
const CONTRACT = ".flow/contracts/demo.md";
const OTHER = ".flow/contracts/other.md";
const PLAN = ".flow/plans/demo/PLAN.md";
const GATE_LOG = ".flow/runtime/approvals.log";
// Every variable the guard reads, as the engine would answer it: the scratch directory and git's config discovery
// must behave on Windows as on Linux.
const GATE_ENV = Object.fromEntries(
	["PATH", "HOME", "USERPROFILE", "SystemRoot", "TMPDIR", "TEMP", "TMP", "XDG_CONFIG_HOME", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM"]
		.flatMap((name) => (process.env[name] === undefined ? [] : [[name, process.env[name]]])),
);
const SUMMARY_ERROR = /^Flow gate summary must be one line of at most 80 characters/;
const UNANSWERED = "Flow gate: the approval dialog was not answered; nothing was recorded.";

const digestOf = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const recordOf = (root) => (existsSync(join(root, GATE_LOG)) ? readFileSync(join(root, GATE_LOG), "utf8") : undefined);
const recordLines = (root) => (recordOf(root) ?? "").split("\n").filter((line) => line !== "");
const kindsOf = (root, scope) =>
	recordLines(root)
		.filter((line) => line.startsWith(`${scope} `))
		.map((line) => line.split(" ")[1]);

function gitIn(cwd, ...args) {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
	}).trim();
}

// A committed repository holding a demo contract and a plan with an empty amendments section, plus an empty scratch
// directory handed to the host as TMPDIR so the test can see whether a fingerprint was computed.
async function withGateRepository(body) {
	const root = temporaryDir("flow-guard-gate-");
	const scratch = temporaryDir("flow-guard-gate-tmp-");
	try {
		gitIn(root, "init", "-q");
		writeFileSync(join(root, "app.txt"), "v1\n");
		gitIn(root, "add", "app.txt");
		gitIn(root, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "base");
		mkdirSync(join(root, ".flow/contracts"), { recursive: true });
		mkdirSync(join(root, ".flow/plans/demo"), { recursive: true });
		writeFileSync(join(root, CONTRACT), "# Contract\n\nDemo.\n");
		writeFileSync(join(root, OTHER), "# Contract\n\nOther.\n");
		writeFileSync(join(root, PLAN), "# Plan\n\nTask 1.\n\n## In-scope amendments\n");
		await body(root, plugin({ cwd: root, env: { ...GATE_ENV, TMPDIR: scratch } }), scratch);
	} finally {
		rmSync(root, { recursive: true, force: true });
		rmSync(scratch, { recursive: true, force: true });
	}
}

// The dialogs S5 raises, by action: the invariant is one at most per call.
const S5_DIALOGS = { approve: 0, accept: 0 };

async function gateCall(host, input) {
	const before = host.asks.length;
	const outcome = await host.call("tool.call", { ...input, tool: GATE_TOOL });
	const raised = host.asks.length - before;
	assert.ok(raised <= 1, `flow_gate ${input.action} raised ${raised} dialogs; at most one is allowed`);
	if (raised === 1 && input.action === "approve") S5_DIALOGS.approve += 1;
	if (raised === 1 && input.action === "accept") S5_DIALOGS.accept += 1;
	return outcome;
}

// A flow_gate call the gate answers with its result text, as the model sees it.
async function gateText(host, input) {
	const outcome = await gateCall(host, input);
	assert.equal(outcome.refused, undefined, `flow_gate ${JSON.stringify(input)} must be answered, not refused: ${outcome.refused}`);
	assert.ok(Array.isArray(outcome.result), `flow_gate ${JSON.stringify(input)} must answer { result: [...] }, got ${JSON.stringify(outcome)}`);
	return outcome.result.map((block) => block.text).join("\n");
}

// A flow_gate call the gate refuses; its sentence.
async function gateRefusal(host, input) {
	const outcome = await gateCall(host, input);
	assert.equal(typeof outcome.refused, "string", `flow_gate ${JSON.stringify(input)} must be refused, got ${JSON.stringify(outcome)}`);
	assert.equal(outcome.result, undefined, `a refused flow_gate ${JSON.stringify(input)} must answer with no result`);
	return outcome.refused;
}

const present = (host, kind, path, scope = "demo", summary = `${kind} for ${scope}`) =>
	gateText(host, { action: "present", scope, kind, path, summary });

// S5: `present` names the artifact and its digest and writes nothing; a bad summary, a path outside `.flow/`, a missing
// file, an unknown action and a malformed scope are refused before anything is read of the record.
await withGateRepository(async (root, host) => {
	const text = await present(host, "contract", CONTRACT, "demo", "Demo contract");
	assert.equal(
		text,
		["Presented contract for scope demo: .flow/contracts/demo.md", "Demo contract", "", `sha256 ${digestOf(join(root, CONTRACT))}`].join("\n"),
	);
	assert.equal(recordOf(root), undefined, "present writes no record");
	assert.equal(host.asks.length, 0, "present asks nothing");
	await present(host, "contract", "contracts/demo.md", "demo", "x".repeat(80));
	assert.match(await gateRefusal(host, { action: "present", scope: "demo", kind: "contract", path: CONTRACT, summary: "one\ntwo" }), SUMMARY_ERROR);
	assert.match(
		await gateRefusal(host, { action: "present", scope: "demo", kind: "contract", path: CONTRACT, summary: "x".repeat(81) }),
		SUMMARY_ERROR,
	);
	assert.equal(
		await gateRefusal(host, { action: "present", scope: "demo", kind: "contract", path: CONTRACT }),
		"Flow gate present requires kind, path, and summary",
	);
	assert.match(
		await gateRefusal(host, { action: "present", scope: "demo", kind: "contract", path: join(root, "app.txt"), summary: "s" }),
		/^Flow gate artifacts must live below /,
	);
	assert.match(
		await gateRefusal(host, { action: "present", scope: "demo", kind: "contract", path: ".flow/contracts/none.md", summary: "s" }),
		/^Flow gate artifact does not exist: /,
	);
	assert.equal(await gateRefusal(host, { action: "publish", scope: "demo" }), "Flow gate action must be present, approve, accept, status, or clear");
	assert.equal(await gateRefusal(host, { action: "status", scope: " " }), "Flow gate scope is required");
	assert.equal(
		await gateRefusal(host, { action: "present", scope: "a,b", kind: "contract", path: CONTRACT, summary: "s" }),
		"Flow gate present takes one scope.",
	);
	assert.equal(
		await gateRefusal(host, { action: "present", scope: "a b", kind: "contract", path: CONTRACT, summary: "s" }),
		"Flow gate scope must not contain whitespace: a b",
	);
	assert.equal(await gateRefusal(host, { action: "approve", scope: "demo,a b", kind: "contract" }), "Flow gate scope must not contain whitespace: a b");
	assert.equal(recordOf(root), undefined);
	assert.equal(host.asks.length, 0);
});

// S5: one `approve` naming two scopes and two kinds raises exactly one dialog, and its question names every pair with
// its root-relative path and its summary; the record write happens only after the answer.
await withGateRepository(async (root, host) => {
	for (const scope of ["demo", "other"]) {
		const path = scope === "demo" ? CONTRACT : OTHER;
		await present(host, "contract", path, scope, `${scope} contract`);
		await present(host, "implementation", path, scope, `${scope} implementation`);
	}
	const ask = host.$.ui.ask;
	let recordAtAsk;
	host.$.ui.ask = async (question, options) => {
		recordAtAsk = recordOf(root);
		return await ask(question, options);
	};
	host.answer("Approve");
	const text = await gateText(host, { action: "approve", scope: "demo,other", kind: "implementation,contract" });
	host.$.ui.ask = ask;
	assert.equal(host.asks.length, 1, "one approve raises exactly one dialog");
	const [asked] = host.asks;
	assert.equal(
		asked.question,
		[
			"Flow gate: approve 4 Flow artifacts?",
			"",
			"- contract demo — .flow/contracts/demo.md — demo contract",
			"- implementation demo — .flow/contracts/demo.md — demo implementation",
			"- contract other — .flow/contracts/other.md — other contract",
			"- implementation other — .flow/contracts/other.md — other implementation",
		].join("\n"),
	);
	assert.deepEqual(asked.options, ["Approve", "Refuse"], "the engine receives option labels, not option objects");
	assert.equal(recordAtAsk, undefined, "nothing is recorded while the dialog is open");
	assert.equal(text, "Approved 4 Flow artifact revisions: contract demo, implementation demo, contract other, implementation other.");
	assert.deepEqual(
		recordLines(root).map((line) => line.split(" ").slice(0, 2).join(" ")),
		["demo contract", "demo implementation", "other contract", "other implementation"],
	);
	assert.deepEqual(recordLines(root).map((line) => line.split(" ")[2]), [
		digestOf(join(root, CONTRACT)),
		digestOf(join(root, CONTRACT)),
		digestOf(join(root, OTHER)),
		digestOf(join(root, OTHER)),
	]);
	assert.deepEqual(recordLines(root).map((line) => line.split(" ").slice(3).join(" ")), [CONTRACT, CONTRACT, OTHER, OTHER]);
	assert.match(await gateRefusal(host, { action: "approve", scope: "demo", kind: "contract" }), /^No current Flow gate presentation for: demo\/contract\. /);
});

// S5: no answer shape records: no queued answer, `{ isAnswered: false }`, an answer naming the Refuse label and a
// thrown `HooksError` all refuse, and the presentation survives for the retry that is answered.
await withGateRepository(async (root, host) => {
	await present(host, "contract", CONTRACT);
	assert.equal(await gateRefusal(host, { action: "approve", scope: "demo", kind: "contract" }), UNANSWERED);
	host.answer({ isAnswered: false });
	assert.equal(await gateRefusal(host, { action: "approve", scope: "demo", kind: "contract" }), UNANSWERED);
	host.answer({ selected: ["Refuse"] });
	assert.equal(await gateRefusal(host, { action: "approve", scope: "demo", kind: "contract" }), UNANSWERED);
	const ask = host.$.ui.ask;
	host.$.ui.ask = async () => {
		const error = new Error("no answer (the dialog was dismissed)");
		error.name = "HooksError";
		throw error;
	};
	assert.equal(await gateRefusal(host, { action: "approve", scope: "demo", kind: "contract" }), UNANSWERED);
	host.$.ui.ask = ask;
	assert.equal(recordOf(root), undefined, "no unanswered approve may record");
	assert.equal(host.asks.length, 3, "three dialogs reached the engine's own ask; the fourth came from a patched ask");
	host.answer("Approve");
	assert.equal(await gateText(host, { action: "approve", scope: "demo", kind: "contract" }), "Approved Flow contract revision for scope demo.");
	assert.equal(
		host.asks.at(-1).question,
		["Flow gate: approve the contract for scope demo?", "", "- contract demo — .flow/contracts/demo.md — contract for demo"].join("\n"),
	);
	assert.deepEqual(recordLines(root), [`demo contract ${digestOf(join(root, CONTRACT))} ${CONTRACT}`]);
});

// S5: an answer that only echoes the question, or carries the label inside other text, is not an answer. A value
// must trim to exactly the first option's label and never to the second's; a candidate equal to the question is
// ignored. Nothing is recorded for approve or accept unless a real label names the answer. The summary and source
// below put the label in the question itself, so an echo would match a substring test and must still be refused.
await withGateRepository(async (root, host) => {
	await present(host, "contract", CONTRACT, "demo", "Approve the contract");
	const ask = host.$.ui.ask;
	host.$.ui.ask = async (question) => question;
	assert.equal(await gateRefusal(host, { action: "approve", scope: "demo", kind: "contract" }), UNANSWERED, "a question echo is not an answer");
	host.$.ui.ask = async (question) => ({ dismissed: true, question });
	assert.equal(await gateRefusal(host, { action: "approve", scope: "demo", kind: "contract" }), UNANSWERED, "a dismissal holding the question records nothing");
	host.$.ui.ask = async () => "Approve the contract";
	assert.equal(await gateRefusal(host, { action: "approve", scope: "demo", kind: "contract" }), UNANSWERED, "a label inside other text is not an answer");
	assert.equal(recordOf(root), undefined, "no echoing approve may record");
	host.$.ui.ask = async () => ({ label: "Approve" });
	assert.equal(await gateText(host, { action: "approve", scope: "demo", kind: "contract" }), "Approved Flow contract revision for scope demo.");
	assert.deepEqual(recordLines(root), [`demo contract ${digestOf(join(root, CONTRACT))} ${CONTRACT}`]);

	const source = "Record closure";
	host.$.ui.ask = async (question) => question;
	assert.equal(await gateRefusal(host, { action: "accept", scope: "demo", source }), UNANSWERED, "a question echo is not an answer");
	host.$.ui.ask = async (question) => ({ dismissed: true, question });
	assert.equal(await gateRefusal(host, { action: "accept", scope: "demo", source }), UNANSWERED, "a dismissal holding the question records nothing");
	host.$.ui.ask = async () => "Record it";
	assert.equal(await gateRefusal(host, { action: "accept", scope: "demo", source }), UNANSWERED, "a label inside other text is not an answer");
	assert.deepEqual(kindsOf(root, "demo"), ["contract"], "no echoing accept may record");
	host.$.ui.ask = async () => ({ selected: ["Record"] });
	assert.match(await gateText(host, { action: "accept", scope: "demo", source }), /^Recorded Flow acceptance/);
	host.$.ui.ask = ask;
	assert.deepEqual(kindsOf(root, "demo"), ["contract", "accept"]);
});

// S5: an approve without a presentation is refused; an artifact edited after its presentation is refused with the
// "changed before approval" sentence, including when it changes while the dialog is open; a fresh present approves.
await withGateRepository(async (root, host) => {
	assert.match(
		await gateRefusal(host, { action: "approve", scope: "demo", kind: "contract" }),
		/^No current Flow gate presentation for: demo\/contract\. Present each first\.$/,
	);
	assert.equal(await gateRefusal(host, { action: "approve", scope: "demo" }), "Flow approval requires scope and kind.");
	assert.equal(await gateRefusal(host, { action: "approve", scope: "demo", kind: "contract,draft" }), "Flow approval requires scope and kind.");
	assert.equal(host.asks.length, 0, "an approve without a presentation asks nothing");
	assert.equal(recordOf(root), undefined);
	await present(host, "contract", CONTRACT);
	appendFileSync(join(root, CONTRACT), "edit\n");
	assert.equal(
		await gateRefusal(host, { action: "approve", scope: "demo", kind: "contract" }),
		"The presented Flow artifact changed before approval: demo/contract. Present the current revision again.",
	);
	assert.equal(host.asks.length, 0, "a changed artifact is refused before the dialog");
	await present(host, "contract", CONTRACT);
	const ask = host.$.ui.ask;
	host.$.ui.ask = async (question, options) => {
		appendFileSync(join(root, CONTRACT), "changed while the dialog was open\n");
		return await ask(question, options);
	};
	host.answer("Approve");
	assert.equal(
		await gateRefusal(host, { action: "approve", scope: "demo", kind: "contract" }),
		"The presented Flow artifact changed before approval: demo/contract. Present the current revision again.",
	);
	host.$.ui.ask = ask;
	assert.equal(recordOf(root), undefined);
	// A re-present while the dialog is open changes what the answer covers, so it is refused as well.
	await present(host, "contract", CONTRACT);
	host.$.ui.ask = async (question, options) => {
		await present(host, "contract", OTHER);
		return await ask(question, options);
	};
	host.answer("Approve");
	assert.equal(
		await gateRefusal(host, { action: "approve", scope: "demo", kind: "contract" }),
		"The Flow presentation changed while the prompt was open: demo/contract. Approve again.",
	);
	host.$.ui.ask = ask;
	assert.equal(recordOf(root), undefined);
	await present(host, "plan", PLAN);
	rmSync(join(root, PLAN));
	assert.equal(await gateRefusal(host, { action: "approve", scope: "demo", kind: "plan" }), "The presented Flow artifact is no longer readable: demo/plan.");
	await present(host, "contract", CONTRACT);
	host.answer("Approve");
	assert.equal(await gateText(host, { action: "approve", scope: "demo", kind: "contract" }), "Approved Flow contract revision for scope demo.");
	assert.deepEqual(recordLines(root).map((line) => line.split(" ")[2]), [digestOf(join(root, CONTRACT))]);
});

// S5: a new contract drops the scope's older plan, implementation and acceptance; a new plan or implementation drops
// the acceptance; a record this instance wrote after the contract was presented survives that contract's approval.
await withGateRepository(async (root, host) => {
	const approveWith = async (kind) => {
		host.answer("Approve");
		return await gateText(host, { action: "approve", scope: "demo", kind });
	};
	const acceptNow = async () => {
		host.answer("Record");
		return await gateText(host, { action: "accept", scope: "demo", source: "closure-1" });
	};
	await present(host, "contract", CONTRACT);
	await present(host, "plan", PLAN);
	await present(host, "implementation", CONTRACT);
	assert.equal(await approveWith("contract,plan,implementation"), "Approved 3 Flow artifact revisions: contract demo, plan demo, implementation demo.");
	await acceptNow();
	assert.deepEqual(kindsOf(root, "demo"), ["contract", "plan", "implementation", "accept"]);
	assert.equal(
		host.asks.at(-1).question,
		["Flow gate: record acceptance for scope demo?", "", `- demo — closure-1 — head ${gitIn(root, "rev-parse", "HEAD")}`].join("\n"),
	);
	await present(host, "contract", CONTRACT);
	await approveWith("contract");
	assert.deepEqual(kindsOf(root, "demo"), ["contract"], "a new contract drops the older plan, implementation and acceptance");
	await present(host, "plan", PLAN);
	await approveWith("plan");
	await acceptNow();
	await present(host, "plan", PLAN);
	await approveWith("plan");
	assert.deepEqual(kindsOf(root, "demo"), ["contract", "plan"], "a new plan drops the acceptance");
	await present(host, "contract", CONTRACT);
	await present(host, "plan", PLAN);
	await approveWith("plan");
	await approveWith("contract");
	assert.deepEqual(kindsOf(root, "demo").sort(), ["contract", "plan"], "the plan recorded after the contract presentation survives");
});

// S5: only the parent conversation presents, approves, accepts and clears; `status` passes anywhere. The same refusal
// lives in `gateAction` for a caller that says it is not the parent.
await withGateRepository(async (root, host) => {
	await present(host, "contract", CONTRACT);
	const child = { agentId: "agent-child" };
	for (const [input, sentence] of [
		[{ action: "present", scope: "demo", kind: "contract", path: CONTRACT, summary: "s" }, "Flow artifacts are presented by the parent session"],
		[{ action: "approve", scope: "demo", kind: "contract" }, "Flow approval must be confirmed in the parent session"],
		[{ action: "accept", scope: "demo", source: "closure-1" }, "Flow acceptance state must be recorded by the parent session"],
		[{ action: "clear", scope: "demo" }, "Flow gate state is cleared by the parent session"],
	]) {
		assert.equal(await gateRefusal(host, { ...input, ...child }), sentence);
	}
	assert.equal(host.asks.length, 0, "a subagent's writing action is refused before any dialog");
	assert.equal(recordOf(root), undefined);
	assert.match(await gateText(host, { action: "status", scope: "demo", ...child }), /^Flow gate status\nScope: demo\n/);
	const direct = hostOf(host.$);
	await assert.rejects(
		async () => await gateAction(direct, createGateState(), { action: "clear", scope: "demo" }, { isParent: false }),
		{ message: "Flow gate state is cleared by the parent session" },
	);
	assert.match(await gateAction(direct, createGateState(), { action: "status", scope: "demo" }, { isParent: false }), /^Flow gate status/);
});

// S5: one `accept` names each scope, the source and the current head in exactly one dialog, and records the working
// tree's fingerprint only after the answer; a dismissed dialog, a Refuse answer and a thrown `HooksError` write
// nothing, and `.flow/` is excluded once before the identity so the working tree stays clean.
await withGateRepository(async (root, host, scratch) => {
	assert.equal(await gateRefusal(host, { action: "accept", scope: "demo" }), "Flow gate accept requires a source receipt identifier");
	assert.match(await gateRefusal(host, { action: "accept", scope: "demo", source: "c", summary: "x".repeat(81) }), SUMMARY_ERROR);
	assert.equal(await gateRefusal(host, { action: "accept", scope: ",", source: "closure-1" }), "Flow gate scope is required");
	assert.equal(host.asks.length, 0, "a refused accept asks nothing");
	assert.equal(recordOf(root), undefined);
	assert.equal(await gateRefusal(host, { action: "accept", scope: "demo", source: "closure-1" }), UNANSWERED);
	host.answer("Refuse");
	assert.equal(await gateRefusal(host, { action: "accept", scope: "demo", source: "closure-1" }), UNANSWERED);
	const ask = host.$.ui.ask;
	host.$.ui.ask = async () => {
		const error = new Error("no answer (the dialog was dismissed)");
		error.name = "HooksError";
		throw error;
	};
	assert.equal(await gateRefusal(host, { action: "accept", scope: "demo", source: "closure-1" }), UNANSWERED);
	host.$.ui.ask = ask;
	assert.equal(recordOf(root), undefined, "no unanswered accept may record");
	assert.deepEqual(readdirSync(scratch), [], "a refused accept computes no fingerprint");
	const head = gitIn(root, "rev-parse", "HEAD");
	let atAnswer;
	host.$.ui.ask = async (question, options) => {
		atAnswer = { record: recordOf(root), scratch: readdirSync(scratch) };
		return await ask(question, options);
	};
	host.answer("Record");
	const text = await gateText(host, { action: "accept", scope: "demo,other", source: "closure-1" });
	host.$.ui.ask = ask;
	const [asked] = host.asks.slice(-1);
	assert.equal(
		asked.question,
		["Flow gate: record acceptance for scopes demo, other?", "", `- demo — closure-1 — head ${head}`, `- other — closure-1 — head ${head}`].join("\n"),
	);
	assert.deepEqual(asked.options, ["Record", "Refuse"], "the engine receives option labels, not option objects");
	assert.deepEqual(atAnswer, { record: undefined, scratch: [] }, "the record and the fingerprint both wait for the answer");
	assert.equal(
		readdirSync(scratch).filter((name) => name.startsWith("flow-gate-tree-")).length,
		1,
		"the accept computed one fingerprint after the answer",
	);
	const identity = await worktreeIdentity(hostOf(host.$), root);
	assert.equal(identity.head, head, "the head the dialog named is the head the record stores");
	assert.deepEqual(recordLines(root), [`demo accept ${identity.fingerprint} ${head}`, `other accept ${identity.fingerprint} ${head}`]);
	assert.equal(text, `Recorded Flow acceptance/closure for scopes demo, other: tree ${identity.tree} at ${head}.`);
	const exclude = readFileSync(join(root, ".git/info/exclude"), "utf8").split("\n");
	assert.equal(exclude.filter((line) => line === "/.flow/").length, 1, ".flow is excluded once, before the identity");
	assert.equal(gitIn(root, "status", "--porcelain"), "", "the excluded .flow state leaves the working tree clean");
	assert.match(await gateText(host, { action: "status", scope: "demo" }), new RegExp(`\\nacceptance: current \\(${head}\\)$`));
	gitIn(root, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "--allow-empty", "-qm", "accepted");
	assert.match(await gateText(host, { action: "status", scope: "demo" }), new RegExp(`\\nacceptance: current \\(${head}\\)$`), "a commit of the accepted tree keeps the acceptance");
	writeFileSync(join(root, "app.txt"), "v2\n");
	assert.match(await gateText(host, { action: "status", scope: "demo" }), new RegExp(`\\nacceptance: stale \\(${head}\\)$`));
});

// S5: `status` prints the exact shape `parseStatus` reads, through current, amended, stale and missing, and `clear`
// removes one scope's lines, presentations and stamps while another scope stays intact.
await withGateRepository(async (root, host) => {
	const status = () => gateText(host, { action: "status", scope: "demo" });
	assert.equal(
		await status(),
		["Flow gate status", "Scope: demo", "contract: missing", "plan: missing", "implementation: missing", "acceptance: missing"].join("\n"),
	);
	await present(host, "contract", CONTRACT);
	await present(host, "plan", PLAN);
	host.answer("Approve");
	await gateText(host, { action: "approve", scope: "demo", kind: "contract,plan" });
	host.answer("Record");
	await gateText(host, { action: "accept", scope: "demo", source: "closure-1", summary: "closure verified" });
	assert.match(host.asks.at(-1).question, /\n- summary — closure verified$/);
	const head = gitIn(root, "rev-parse", "HEAD");
	assert.equal(
		await status(),
		[
			"Flow gate status",
			"Scope: demo",
			"contract: current (.flow/contracts/demo.md)",
			"plan: current (.flow/plans/demo/PLAN.md)",
			"implementation: missing",
			`acceptance: current (${head})`,
		].join("\n"),
	);
	appendFileSync(join(root, PLAN), "- task 1: amended\n");
	assert.match(await status(), /\nplan: current \(\.flow\/plans\/demo\/PLAN\.md, in-scope amendments: 1\)\n/);
	appendFileSync(join(root, CONTRACT), "edit\n");
	assert.match(await status(), /\ncontract: stale \(\.flow\/contracts\/demo\.md\)\n/);
	rmSync(join(root, CONTRACT));
	assert.match(await status(), /\ncontract: missing \(\.flow\/contracts\/demo\.md\)\n/);
	writeFileSync(join(root, "app.txt"), "v2\n");
	assert.match(await status(), new RegExp(`\\nacceptance: stale \\(${head}\\)$`));
	await present(host, "contract", OTHER, "other");
	host.answer("Approve");
	await gateText(host, { action: "approve", scope: "other", kind: "contract" });
	assert.equal(await gateText(host, { action: "clear", scope: "demo" }), "Cleared Flow gate state for scope demo.");
	assert.deepEqual(recordLines(root).map((line) => line.split(" ")[0]), ["other"]);
	assert.equal(
		await status(),
		"Flow gate status\nScope: demo\ncontract: missing\nplan: missing\nimplementation: missing\nacceptance: missing",
	);
	assert.match(await gateRefusal(host, { action: "approve", scope: "demo", kind: "plan" }), /^No current Flow gate presentation for: demo\/plan/);
	assert.equal(await gateRefusal(host, { action: "clear", scope: "demo,other" }), "Flow gate clear takes one scope.");
	assert.match(await gateText(host, { action: "status", scope: "other" }), /\ncontract: current \(\.flow\/contracts\/other\.md\)\n/);
});

// S5: a record line this port cannot read refuses approve, accept, status and clear before any dialog; `present`
// reads no record, so it still pins an artifact and nothing else records.
await withGateRepository(async (root, host) => {
	mkdirSync(join(root, ".flow/runtime"), { recursive: true });
	writeFileSync(join(root, GATE_LOG), "a b c\n");
	const unreadable = "Unreadable Flow approval record at .flow/runtime/approvals.log: line 1";
	await present(host, "contract", CONTRACT);
	assert.equal(await gateRefusal(host, { action: "approve", scope: "demo", kind: "contract" }), unreadable);
	assert.equal(await gateRefusal(host, { action: "accept", scope: "demo", source: "c" }), unreadable);
	assert.equal(await gateRefusal(host, { action: "status", scope: "demo" }), unreadable);
	assert.equal(await gateRefusal(host, { action: "clear", scope: "demo" }), unreadable);
	assert.equal(host.asks.length, 0, "no gate action decides on a record it only partly understood");
	assert.equal(readFileSync(join(root, GATE_LOG), "utf8"), "a b c\n");
	writeFileSync(join(root, GATE_LOG), `demo contract ${"0".repeat(63)}g .flow/contracts/demo.md\n`);
	assert.equal(await gateRefusal(host, { action: "status", scope: "demo" }), unreadable);
});

// S5: outside a git repository every action refuses.
{
	const dir = temporaryDir("flow-guard-gate-nogit-");
	assert.equal(await gateRefusal(plugin({ cwd: dir }), { action: "status", scope: "demo" }), "Flow gate requires a git repository.");
}

// S5: registration happens once per process from `session.start`; a second module instance that meets the server it
// already registered logs and continues. Any other registration failure logs and starts the session without
// `flow_gate` — a refusal is not a shape `session.start` takes — so nothing new can be approved, and a gated dispatch
// is still refused on the records.
{
	const fresh = await import("../claude-code/hooks/guard.ts?second-instance");
	const host = createModHost({ cwd: CWD });
	fresh.register(host.on);
	host.$.tool.register = async () => {
		throw new Error("this session already has an MCP server named fiatcode");
	};
	const started = await host.call("session.start", { cwd: CWD });
	assert.deepEqual(started.returned, { cwd: CWD }, "an already-registered server is tolerated");
	assert.match(host.logs.join("\n"), /already has an MCP server named fiatcode/);
	const again = await host.call("session.start", { cwd: CWD });
	assert.equal(again.refused, undefined, "the second session.start attempts no registration");
}
{
	const fresh = await import("../claude-code/hooks/guard.ts?broken-registration");
	const root = temporaryDir("flow-guard-broken-registration-");
	const scratch = temporaryDir("flow-guard-broken-registration-tmp-");
	gitIn(root, "init", "-q");
	writeFileSync(join(root, "app.txt"), "v1\n");
	gitIn(root, "add", "app.txt");
	gitIn(root, "commit", "-qm", "base");
	mkdirSync(join(root, ".flow/contracts"), { recursive: true });
	writeFileSync(join(root, CONTRACT), "# Contract\n\nDemo.\n");
	const host = createModHost({ cwd: root, env: { ...GATE_ENV, TMPDIR: scratch } });
	fresh.register(host.on);
	const ran = [];
	host.on("session.start", async ($, event, next) => {
		ran.push("later");
		return await next(event);
	});
	host.$.tool.register = async () => {
		throw new Error("the engine refused the tool");
	};
	const started = await host.call("session.start", { cwd: root });
	assert.equal(started.refused, undefined, "session.start takes no refusal");
	assert.deepEqual(started.returned, { cwd: root });
	assert.deepEqual(host.registeredTools, [], "the session has no flow_gate");
	assert.ok(
		host.logs.includes("Flow guard: session.start failed; flow_gate is not registered in this session."),
		`the failure is logged: ${JSON.stringify(host.logs)}`,
	);
	assert.deepEqual(ran, ["later"], "the hook beneath the guard's still runs");
	const dispatch = await host.call("tool.call", {
		tool: "Agent",
		subagent_type: "flow-planner",
		description: "plan",
		prompt: ["Flow gate:", "- Scope: demo", `- Contract: ${CONTRACT}`].join("\n"),
	});
	assert.equal(
		dispatch.refused,
		"Flow governance preflight failed: task: scope demo: no recorded contract approval. Use flow_gate to present/approve the current artifact revision or record acceptance/closure, then retry with the Flow gate manifest.",
	);
}

// S5: a control character is refused in every field a dialog shows or a record line holds, before anything is looked
// up, so one answer can never write a line it did not name (review probe P4). The decoy directory spells a second
// record line — `b contract <digest of x.md> .flow/contracts/x.md` — after a line break; a name holding a line break
// cannot exist on Windows, so the decoy is created only elsewhere, and the refusal must not depend on it.
await withGateRepository(async (root, host) => {
	const decoyTarget = ".flow/contracts/x.md";
	writeFileSync(join(root, decoyTarget), "# Contract\n\nDecoy.\n");
	const decoyPath = `.flow/contracts/a\nb contract ${digestOf(join(root, decoyTarget))} .flow/contracts/x.md`;
	if (process.platform !== "win32") {
		mkdirSync(join(root, decoyPath, ".."), { recursive: true });
		writeFileSync(join(root, decoyPath), "# Contract\n\nDecoy.\n");
	}
	// `flow_gate` is left to its own handler, so through the registration `present` itself refuses the path, as it does
	// for a caller that reaches it directly.
	assert.equal(
		await gateRefusal(host, { action: "present", scope: "demo", kind: "contract", path: decoyPath, summary: "decoy" }),
		"Flow gate path must not contain control characters.",
	);
	await assert.rejects(
		async () =>
			await gateAction(
				hostOf(host.$),
				createGateState(),
				{ action: "present", scope: "demo", kind: "contract", path: decoyPath, summary: "decoy" },
				{ isParent: true },
			),
		{ message: "Flow gate path must not contain control characters." },
	);
	host.answer("Approve");
	assert.match(await gateRefusal(host, { action: "approve", scope: "demo", kind: "contract" }), /^No current Flow gate presentation for: demo\/contract/);
	assert.equal(recordOf(root), undefined, "nothing was presented, so nothing can be approved");
	const planner = await callTool(host, "Agent", {
		subagent_type: "flow-planner",
		description: "plan",
		prompt: ["Flow gate:", "- Scope: b", `- Contract: ${decoyTarget}`].join("\n"),
	});
	assert.match(planner.refused ?? "", /scope b: no recorded contract approval/, "the decoy's scope has no approval");

	assert.equal(
		await gateRefusal(host, { action: "present", scope: "demo", kind: "contract", path: CONTRACT, summary: "colour \u001b[31mred" }),
		"Flow gate summary must not contain control characters.",
	);
	assert.equal(
		await gateRefusal(host, { action: "present", scope: "de\u0000mo", kind: "contract", path: CONTRACT, summary: "s" }),
		"Flow gate scope must not contain control characters.",
	);
	assert.equal(
		await gateRefusal(host, { action: "present", scope: "demo", kind: "contract\u0000", path: CONTRACT, summary: "s" }),
		"Flow gate kind must not contain control characters.",
	);
	assert.equal(
		await gateRefusal(host, { action: "accept", scope: "demo", source: "closure-1\n- other — forged — head 0" }),
		"Flow gate source must not contain control characters.",
	);
	assert.equal(
		await gateRefusal(host, { action: "accept", scope: "demo", source: "closure-1", summary: "tab\there" }),
		"Flow gate summary must not contain control characters.",
	);
	assert.equal(host.asks.length, 0, "no control-character call and no unpresented approve raises a dialog");
	assert.equal(recordOf(root), undefined);
});

// S5: a head that moves while the acceptance dialog is open refuses: the record would otherwise bind a head the
// dialog never named (review SEC-9).
await withGateRepository(async (root, host) => {
	const head = gitIn(root, "rev-parse", "HEAD");
	let moved;
	host.answer(() => {
		gitIn(root, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "--allow-empty", "-qm", "moved");
		moved = gitIn(root, "rev-parse", "HEAD");
		return "Record";
	});
	assert.equal(
		await gateRefusal(host, { action: "accept", scope: "demo", source: "closure-1" }),
		`Flow gate: HEAD moved from ${head} to ${moved} while the acceptance dialog was open; nothing was recorded. Run accept again.`,
	);
	assert.notEqual(moved, head);
	assert.equal(recordOf(root), undefined, "a moved head records nothing");
});

assert.ok(S5_DIALOGS.approve > 0 && S5_DIALOGS.accept > 0, "S5 must exercise both dialogs");
const S5_DIALOG_COUNTS = { ...S5_DIALOGS };

// S6: the dispatch and resume gate — `opencode/plugins/flow-guard/dispatch.ts` over this host, with Claude Code's
// agent names. `Agent`'s `tool.call` and `agent.spawn` run the same check, so one spawn is refused by
// both with the same sentence; a follow-up to a finished child is checked from its own block first and from the brief
// it was spawned with otherwise; a message to a running child is never blocked. The gate reads the record and the
// capsule, never the chat.
const DISPATCH_PREFIX = "Flow governance preflight failed: task: ";
const DISPATCH_TAIL =
	"Use flow_gate to present/approve the current artifact revision or record acceptance/closure, then retry with the Flow gate manifest.";
const FOLLOW_UP_TAIL =
	"A follow-up to a finished session is checked like a dispatch: approve the current artifact first, or start a fresh subagent.";
const PLANNER_BLOCK_ERROR = "flow-planner task must include Flow gate with Scope and Contract (put the block in the subagent prompt)";
const WRITER_BLOCK_ERROR =
	"production writer task must include Flow gate with Scope, Contract, and Plan (put the block in the subagent prompt)";
const DISPATCH_ORDER_HINT =
	"flow_gate accept must complete before the dependent flow-evidence-verifier dispatch; do not issue both in the same parallel tool batch";
const NO_REPOSITORY = "Flow governance gate requires subagent dispatch from a git repository.";
const STATE_REFUSAL = (agentId) => `Flow governance preflight failed closed: cannot read the state of agent ${agentId}. Start a fresh subagent.`;
const BRIEF_REFUSAL = (agentId) =>
	`Flow governance preflight failed closed: cannot read the brief of resumed agent ${agentId}; put the Flow gate block in the message or start a fresh agent.`;
const CAPSULE_REFUSAL = (missing) =>
	`Flow evidence-capsule preflight failed: task: missing ${missing}. Each flow-evidence-verifier task must declare one bounded capsule before dispatch.`;
const taskError = (error) => `${DISPATCH_PREFIX}${error}. ${DISPATCH_TAIL}`;
const followUpError = (label, error) => `Flow governance preflight failed: ${label}: ${error}. ${FOLLOW_UP_TAIL}`;
const gateBlock = (scope = "demo", contract = CONTRACT, plan) =>
	["Flow gate:", `- Scope: ${scope}`, `- Contract: ${contract}`, ...(plan === undefined ? [] : [`- Plan: ${plan}`])].join("\n");

const S6 = { ungated: 0, planner: 0, writer: 0, verifier: 0, resume: 0 };

// A gated repository for S6: the same demo artifacts as S5, a committed production file for the fingerprint, and
// whatever agents and transcripts the resume scenarios need (the host model reads them live).
async function withDispatchRepository(options, body) {
	const root = temporaryDir("flow-guard-dispatch-");
	const scratch = temporaryDir("flow-guard-dispatch-tmp-");
	try {
		gitIn(root, "init", "-q");
		writeFileSync(join(root, "app.txt"), "v1\n");
		gitIn(root, "add", "app.txt");
		gitIn(root, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "base");
		mkdirSync(join(root, ".flow/contracts"), { recursive: true });
		mkdirSync(join(root, ".flow/plans/demo"), { recursive: true });
		writeFileSync(join(root, CONTRACT), "# Contract\n\nDemo.\n");
		writeFileSync(join(root, OTHER), "# Contract\n\nOther.\n");
		writeFileSync(join(root, PLAN), "# Plan\n\nTask 1.\n\n## In-scope amendments\n");
		await body(root, plugin({ cwd: root, env: { ...GATE_ENV, TMPDIR: scratch }, ...options }), scratch);
	} finally {
		rmSync(root, { recursive: true, force: true });
		rmSync(scratch, { recursive: true, force: true });
	}
}

// One `Agent` tool call: the gate's refusal, or a pass. `category` counts the case for the suite's `ok:` line.
async function expectDispatch(host, category, agent, prompt, expected) {
	S6[category] += 1;
	const outcome = await callTool(host, "Agent", { subagent_type: agent, prompt });
	if (expected === undefined) {
		assert.equal(outcome.refused, undefined, `Agent ${agent} must pass: ${outcome.refused}`);
		assert.equal(outcome.proceeded, true);
	} else {
		assert.equal(outcome.refused, expected, `Agent ${agent} must be refused`);
		assert.equal(outcome.proceeded, false);
	}
	return outcome;
}

// One `agent.spawn`, the same way.
async function expectSpawn(host, category, event, expected) {
	S6[category] += 1;
	const outcome = await host.spawn(event);
	if (expected === undefined) {
		assert.equal(outcome.refused, undefined, `agent.spawn ${JSON.stringify(event)} must pass: ${outcome.refused}`);
		assert.equal(outcome.proceeded, true);
	} else {
		assert.equal(outcome.refused, expected, `agent.spawn ${JSON.stringify(event)} must be refused`);
		assert.equal(outcome.proceeded, false);
	}
	return outcome;
}

const approvedContract = async (host) => {
	host.answer("Approve");
	return await gateText(host, { action: "approve", scope: "demo", kind: "contract" });
};

// S6: Claude Code's ungated agents pass — its own read-only agents, every reviewer, and a `general-purpose` brief
// without a Flow gate block — and none of them reads a record.
await withDispatchRepository({}, async (root, host) => {
	for (const agent of ["Explore", "Plan", "flow-acceptance-reviewer", "flow-ttc-reviewer"]) {
		await expectDispatch(host, "ungated", agent, "map the call sites", undefined);
	}
	await expectDispatch(host, "ungated", "general-purpose", "count the files", undefined);
	assert.equal(recordOf(root), undefined, "an ungated dispatch writes nothing");
	assert.equal(host.asks.length, 0);
});

// S6: the planner needs a current contract. A missing or malformed block names what the brief must carry; a scope with
// no record names the missing approval; a presentation that was not approved yet says so; a changed artifact and a
// record naming another artifact are refused with their own sentences.
await withDispatchRepository({}, async (root, host) => {
	await expectDispatch(host, "planner", "flow-planner", "review the contract", taskError(PLANNER_BLOCK_ERROR));
	await expectDispatch(
		host,
		"planner",
		"flow-planner",
		"Flow gate:\n- Contract: .flow/contracts/demo.md",
		taskError(PLANNER_BLOCK_ERROR),
	);
	await expectDispatch(host, "planner", "flow-planner", gateBlock(), taskError("scope demo: no recorded contract approval"));
	await present(host, "contract", CONTRACT);
	await expectDispatch(
		host,
		"planner",
		"flow-planner",
		gateBlock(),
		taskError(
			"scope demo: contract approval is presented but not recorded yet; flow_gate approve must finish before this dispatch, so do not issue both in the same tool batch",
		),
	);
	await approvedContract(host);
	await expectDispatch(host, "planner", "flow-planner", gateBlock(), undefined);
	appendFileSync(join(root, CONTRACT), "edit\n");
	await expectDispatch(host, "planner", "flow-planner", gateBlock(), taskError("scope demo: contract artifact changed after approval"));
	await present(host, "contract", OTHER);
	await approvedContract(host);
	await expectDispatch(host, "planner", "flow-planner", gateBlock(), taskError("scope demo: contract path is not the approved artifact"));
});

// S6: a production writer needs the contract and the plan, or the contract and the implementation approval for
// `Plan: NONE`; both Claude Code writer names and a blocked `general-purpose` are checked the same way.
await withDispatchRepository({}, async (root, host) => {
	await present(host, "contract", CONTRACT);
	await approvedContract(host);
	for (const agent of ["flow-plan-executor", "flow-implementer"]) {
		await expectDispatch(host, "writer", agent, gateBlock(), taskError(WRITER_BLOCK_ERROR));
		await expectDispatch(
			host,
			"writer",
			agent,
			gateBlock("demo", CONTRACT, "NONE"),
			taskError("scope demo: no recorded implementation approval"),
		);
	}
	await present(host, "implementation", CONTRACT);
	host.answer("Approve");
	await gateText(host, { action: "approve", scope: "demo", kind: "implementation" });
	for (const agent of ["flow-plan-executor", "flow-implementer", "general-purpose"]) {
		await expectDispatch(host, "writer", agent, gateBlock("demo", CONTRACT, "NONE"), undefined);
	}
	await present(host, "plan", PLAN);
	host.answer("Approve");
	await gateText(host, { action: "approve", scope: "demo", kind: "plan" });
	for (const agent of ["flow-plan-executor", "flow-implementer"]) {
		await expectDispatch(host, "writer", agent, gateBlock("demo", CONTRACT, PLAN), undefined);
	}
});

// S6: the evidence verifier needs a current acceptance fingerprint and one complete capsule. Acceptance is recorded
// through the real gate (the test answers its dialog with `Record`); a production edit stales it; a capsule marker is
// counted only at the start of a line, so `grid:` or `valid:` does not satisfy `id:` or `owns:`.
const CAPSULE = [
	"Evidence capsule:",
	"- id: dispatch-gate",
	"- owns: the dispatch gate's refusal",
	"- independent split check: none",
	"- excludes: the chat transcript",
	"- restore obligation: restore the edited production file",
].join("\n");
const capsuleBrief = () => `${gateBlock()}\n\n${CAPSULE}`;

await withDispatchRepository({}, async (root, host) => {
	await expectDispatch(
		host,
		"verifier",
		"flow-evidence-verifier",
		capsuleBrief(),
		taskError(`scope demo: no acceptance/closure recorded for the current repository state; ${DISPATCH_ORDER_HINT}`),
	);
	const head = gitIn(root, "rev-parse", "HEAD");
	host.answer("Record");
	await gateText(host, { action: "accept", scope: "demo", source: "closure-1" });
	await expectDispatch(host, "verifier", "flow-evidence-verifier", capsuleBrief(), undefined);
	writeFileSync(join(root, "app.txt"), "v2\n");
	await expectDispatch(
		host,
		"verifier",
		"flow-evidence-verifier",
		capsuleBrief(),
		taskError(
			`scope demo: repository state changed after acceptance/closure (accepted at ${head}, now at ${head}); ${DISPATCH_ORDER_HINT}`,
		),
	);
	host.answer("Record");
	await gateText(host, { action: "accept", scope: "demo", source: "closure-2" });
	await expectDispatch(
		host,
		"verifier",
		"flow-evidence-verifier",
		capsuleBrief().replace("- restore obligation: restore the edited production file", "- note: nothing to restore"),
		CAPSULE_REFUSAL("restore obligation:"),
	);
	const embedded = [
		"Flow gate:",
		"- Scope: demo",
		"- Contract: .flow/contracts/demo.md",
		"",
		"Evidence capsule:",
		"grid: id: dispatch-gate",
		"  valid: owns: the dispatch gate",
		"- independent split check: none",
		"- excludes: the chat transcript",
		"- restore obligation: restore the edited production file",
	].join("\n");
	await expectDispatch(host, "verifier", "flow-evidence-verifier", embedded, CAPSULE_REFUSAL("id:, owns:"));
});

// S5/S6: an edit to a tracked file that matches an ignore rule stales the acceptance, end to end (review probe p7):
// the verifier dispatch, its `agent.spawn` and `status` all see it, as OMP and OpenCode do.
await withDispatchRepository({}, async (root, host) => {
	writeFileSync(join(root, ".gitignore"), "*.lock\n");
	writeFileSync(join(root, "deps.lock"), "v1\n");
	gitIn(root, "add", ".gitignore");
	gitIn(root, "add", "-f", "deps.lock");
	gitIn(root, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "lock");
	const head = gitIn(root, "rev-parse", "HEAD");
	host.answer("Record");
	await gateText(host, { action: "accept", scope: "demo", source: "closure-1" });
	await expectDispatch(host, "verifier", "flow-evidence-verifier", capsuleBrief(), undefined);
	writeFileSync(join(root, "deps.lock"), "v2\n");
	const stale = taskError(
		`scope demo: repository state changed after acceptance/closure (accepted at ${head}, now at ${head}); ${DISPATCH_ORDER_HINT}`,
	);
	await expectDispatch(host, "verifier", "flow-evidence-verifier", capsuleBrief(), stale);
	await expectSpawn(host, "verifier", { prompt: capsuleBrief(), subagentType: "flow-evidence-verifier", cwd: root }, stale);
	assert.match(await gateText(host, { action: "status", scope: "demo" }), new RegExp(`\\nacceptance: stale \\(${head}\\)$`));
});

// S6: Claude Code lists this plugin's agents under the plugin scope (`fiatcode:flow-planner`), while a built-in stays
// bare. One helper strips exactly this plugin's `pluginName:` prefix, so a scoped name and its bare form gate
// identically — the same sentence at every stage — and another plugin's `other:flow-planner` is not read as a planner.
await withDispatchRepository({}, async (root, host) => {
	const scopedPlanner = "fiatcode:flow-planner";
	const bare = await expectDispatch(
		host,
		"planner",
		"flow-planner",
		gateBlock(),
		taskError("scope demo: no recorded contract approval"),
	);
	const scoped = await expectDispatch(
		host,
		"planner",
		scopedPlanner,
		gateBlock(),
		taskError("scope demo: no recorded contract approval"),
	);
	assert.equal(scoped.refused, bare.refused, "a scoped planner is refused with the bare name's sentence");

	// A plugin-scoped built-in and another plugin's agents are not this plugin's gated agents.
	await expectDispatch(host, "ungated", "fiatcode:Explore", "map the call sites", undefined);
	await expectDispatch(host, "ungated", "fiatcode:some-other-agent", "look around", undefined);
	await expectDispatch(host, "ungated", "other:flow-planner", gateBlock(), undefined);
	await expectDispatch(host, "ungated", "other:flow-evidence-verifier", capsuleBrief(), undefined);

	await expectDispatch(host, "writer", "fiatcode:flow-plan-executor", gateBlock(), taskError(WRITER_BLOCK_ERROR));
	await present(host, "contract", CONTRACT);
	await approvedContract(host);
	await expectDispatch(host, "planner", scopedPlanner, gateBlock(), undefined);
	// The spawn path reads `subagentType` and strips the same prefix.
	await expectSpawn(host, "planner", { prompt: gateBlock(), subagentType: scopedPlanner, cwd: root }, undefined);

	await expectDispatch(
		host,
		"writer",
		"fiatcode:flow-plan-executor",
		gateBlock("demo", CONTRACT, PLAN),
		taskError("scope demo: no recorded plan approval"),
	);
	await present(host, "plan", PLAN);
	host.answer("Approve");
	await gateText(host, { action: "approve", scope: "demo", kind: "plan" });
	await expectDispatch(host, "writer", "fiatcode:flow-plan-executor", gateBlock("demo", CONTRACT, PLAN), undefined);

	await expectDispatch(
		host,
		"verifier",
		"fiatcode:flow-evidence-verifier",
		capsuleBrief(),
		taskError(`scope demo: no acceptance/closure recorded for the current repository state; ${DISPATCH_ORDER_HINT}`),
	);
	host.answer("Record");
	await gateText(host, { action: "accept", scope: "demo", source: "closure-scoped" });
	await expectDispatch(host, "verifier", "fiatcode:flow-evidence-verifier", capsuleBrief(), undefined);
	await expectDispatch(
		host,
		"verifier",
		"fiatcode:flow-evidence-verifier",
		capsuleBrief().replace("- restore obligation: restore the edited production file", "- note: nothing to restore"),
		CAPSULE_REFUSAL("restore obligation:"),
	);
});

// S6: the prefix stripped is this host's plugin name, not the literal `fiatcode`: under another plugin name the same
// scoped string belongs to another plugin and stays ungated.
await withDispatchRepository({ pluginName: "another" }, async (root, host) => {
	await expectDispatch(host, "ungated", "fiatcode:flow-planner", gateBlock(), undefined);
	await expectDispatch(
		host,
		"planner",
		"another:flow-planner",
		gateBlock(),
		taskError("scope demo: no recorded contract approval"),
	);
});

// S6: resume. A finished child is checked from the follow-up's own block first, then from the brief it was spawned
// with; a running child passes unless the call switches it to a gated agent; unreadable state or an unreadable
// transcript refuses. The transcript fixtures have the shape the engine answers on a resume.
{
	const agents = [];
	const messages = {};
	await withDispatchRepository({ agents, messages }, async (root, host) => {
		await present(host, "contract", CONTRACT);
		await approvedContract(host);
		const plannerBrief = gateBlock();
		messages["a-planner"] = [
			{ role: "user", text: plannerBrief },
			{ role: "assistant", text: "reviewed", toolUses: [] },
		];
		agents.push({ id: "a-planner", type: "flow-planner", status: "completed", taskStatus: "completed" });
		const followUp = { resume: { agentId: "a-planner" }, prompt: "continue please", subagentType: "flow-planner", cwd: root };
		await expectSpawn(host, "resume", followUp, undefined);
		appendFileSync(join(root, CONTRACT), "edit\n");
		await expectSpawn(
			host,
			"resume",
			followUp,
			followUpError("finished planner a-planner", "scope demo: contract artifact changed after approval"),
		);

		// A `general-purpose` child whose spawn brief carried a block was gated work, so its follow-up is checked too.
		agents.push({ id: "a-general", type: "general-purpose", status: "completed" });
		messages["a-general"] = [{ role: "user", text: gateBlock("demo", CONTRACT, "NONE") }];
		await expectSpawn(
			host,
			"resume",
			{ resume: { agentId: "a-general" }, prompt: "continue", subagentType: "general-purpose", cwd: root },
			followUpError("finished writer a-general", "scope demo: contract artifact changed after approval"),
		);

		// A child the engine lists under the plugin scope, and a follow-up naming the same scope, is the same gated
		// agent: checked from the stale contract exactly as its bare-name sibling above.
		agents.push({ id: "a-scoped", type: "fiatcode:flow-planner", status: "completed", taskStatus: "completed" });
		messages["a-scoped"] = [{ role: "user", text: plannerBrief }];
		await expectSpawn(
			host,
			"resume",
			{ resume: { agentId: "a-scoped" }, prompt: "continue", subagentType: "fiatcode:flow-planner", cwd: root },
			followUpError("finished planner a-scoped", "scope demo: contract artifact changed after approval"),
		);
		// The listed `type` alone gates, when the follow-up names no agent.
		await expectSpawn(
			host,
			"resume",
			{ resume: { agentId: "a-scoped" }, prompt: "continue", cwd: root },
			followUpError("finished planner a-scoped", "scope demo: contract artifact changed after approval"),
		);
		// A running scoped child is not "switched" by a follow-up that keeps the same scoped type, so the stop message
		// reaches it: only a change of agent is checked.
		agents.push({ id: "a-scoped-running", type: "fiatcode:flow-planner", status: "running", taskStatus: "running" });
		messages["a-scoped-running"] = [{ role: "user", text: plannerBrief }];
		await expectSpawn(
			host,
			"resume",
			{ resume: { agentId: "a-scoped-running" }, prompt: "stop now", subagentType: "fiatcode:flow-planner", cwd: root },
			undefined,
		);
		// Another plugin's scoped agent in the list is not this plugin's planner.
		agents.push({ id: "a-foreign", type: "other:flow-planner", status: "completed" });
		messages["a-foreign"] = [{ role: "user", text: plannerBrief }];
		await expectSpawn(
			host,
			"resume",
			{ resume: { agentId: "a-foreign" }, prompt: "continue", subagentType: "other:flow-planner", cwd: root },
			undefined,
		);

		// A running child's message is never blocked, even when its spawn brief names a stale contract.
		agents.push({ id: "a-running", type: "flow-planner", status: "running", taskStatus: "running" });
		messages["a-running"] = [{ role: "user", text: plannerBrief }];
		await expectSpawn(
			host,
			"resume",
			{ resume: { agentId: "a-running" }, prompt: "stop now", subagentType: "flow-planner", cwd: root },
			undefined,
		);

		// A follow-up that switches a running child to a gated agent is checked from the follow-up's block.
		agents.push({ id: "a-switch", type: "general-purpose", status: "running", taskStatus: "running" });
		await expectSpawn(
			host,
			"resume",
			{ resume: { agentId: "a-switch" }, prompt: plannerBrief, subagentType: "flow-planner", cwd: root },
			followUpError("agent a-switch switched to flow-planner", "scope demo: contract artifact changed after approval"),
		);

		// An entry with no recognizable status and an unreadable transcript each fail closed; a child missing from the
		// list is finished, so with no transcript it refuses on its brief.
		await expectSpawn(
			host,
			"resume",
			{ resume: { agentId: "a-ghost" }, prompt: "hello", subagentType: "flow-planner", cwd: root },
			BRIEF_REFUSAL("a-ghost"),
		);
		agents.push({ id: "a-paused", type: "flow-planner", status: "paused" });
		await expectSpawn(
			host,
			"resume",
			{ resume: { agentId: "a-paused" }, prompt: "hello", subagentType: "flow-planner", cwd: root },
			STATE_REFUSAL("a-paused"),
		);
		agents.push({ id: "a-noread", type: "flow-planner", status: "completed" });
		await expectSpawn(
			host,
			"resume",
			{ resume: { agentId: "a-noread" }, prompt: "hello", subagentType: "flow-planner", cwd: root },
			BRIEF_REFUSAL("a-noread"),
		);

		// Both the `Agent` call and the spawn check a fresh spawn, and both refuse with the same sentence.
		const stale = taskError("scope demo: contract artifact changed after approval");
		const viaTool = await expectDispatch(host, "resume", "flow-planner", gateBlock(), stale);
		const viaSpawn = await expectSpawn(host, "resume", { prompt: gateBlock(), subagentType: "flow-planner", cwd: root }, stale);
		assert.equal(viaSpawn.refused, viaTool.refused, "the Agent call and the spawn answer the same refusal");
	});
}

// S6 (review probe p2, M80): gated-ness is decided before state. The engine's seven statuses split into live
// (`pending`, `running`, `waiting`) and finished (`idle`, `completed`, `failed`, `killed`); only an unlisted status is
// unknown, and a missing entry is finished. An ungated child passes whatever its state; a gated one passes when live,
// is checked like a dispatch when finished, and refuses when unknown.
const LIVE_STATUSES = ["pending", "running", "waiting"];
const FINISHED_STATUSES = ["idle", "completed", "failed", "killed"];
{
	const agents = [];
	const messages = {};
	await withDispatchRepository({ agents, messages }, async (root, host) => {
		await present(host, "contract", CONTRACT);
		await approvedContract(host);
		for (const status of [...LIVE_STATUSES, ...FINISHED_STATUSES, "paused"]) {
			const agentId = `explore-${status}`;
			agents.push({ id: agentId, type: "Explore", status });
			await expectSpawn(host, "resume", { resume: { agentId }, prompt: "continue", cwd: root }, undefined);
		}
		await expectSpawn(
			host,
			"resume",
			{ resume: { agentId: "explore-missing" }, prompt: "continue", subagentType: "Explore", cwd: root },
			undefined,
		);

		const planner = (status) => `planner-${status}`;
		for (const status of [...LIVE_STATUSES, ...FINISHED_STATUSES, "paused", "missing"]) {
			if (status !== "missing") agents.push({ id: planner(status), type: "flow-planner", status });
			messages[planner(status)] = [{ role: "user", text: gateBlock() }];
		}
		const resumePlanner = (status) => ({
			resume: { agentId: planner(status) },
			prompt: "continue",
			subagentType: "flow-planner",
			cwd: root,
		});
		for (const status of [...LIVE_STATUSES, ...FINISHED_STATUSES, "missing"]) {
			await expectSpawn(host, "resume", resumePlanner(status), undefined);
		}
		appendFileSync(join(root, CONTRACT), "edit\n");
		for (const status of LIVE_STATUSES) await expectSpawn(host, "resume", resumePlanner(status), undefined);
		for (const status of [...FINISHED_STATUSES, "missing"]) {
			await expectSpawn(
				host,
				"resume",
				resumePlanner(status),
				followUpError(`finished planner ${planner(status)}`, "scope demo: contract artifact changed after approval"),
			);
		}
		await expectSpawn(host, "resume", resumePlanner("paused"), STATE_REFUSAL(planner("paused")));
	});
}

// S6: a follow-up that switches a running ungated child to a gated agent is checked like a dispatch.
{
	const agents = [{ id: "explore-switch", type: "Explore", status: "running" }];
	await withDispatchRepository({ agents }, async (root, host) => {
		await expectSpawn(
			host,
			"resume",
			{ resume: { agentId: "explore-switch" }, prompt: gateBlock(), subagentType: "flow-planner", cwd: root },
			followUpError("agent explore-switch switched to flow-planner", "scope demo: no recorded contract approval"),
		);
	});
}

// S6 (review TTC-1, M86): a finished writer is checked against its plan, not the contract alone — an edit to the plan
// above its amendments heading refuses its follow-up while the contract is still current.
{
	const agents = [{ id: "w-executor", type: "flow-plan-executor", status: "completed" }];
	const messages = { "w-executor": [{ role: "user", text: gateBlock("demo", CONTRACT, PLAN) }] };
	await withDispatchRepository({ agents, messages }, async (root, host) => {
		await present(host, "contract", CONTRACT);
		await approvedContract(host);
		await present(host, "plan", PLAN);
		host.answer("Approve");
		await gateText(host, { action: "approve", scope: "demo", kind: "plan" });
		const followUp = { resume: { agentId: "w-executor" }, prompt: "continue", cwd: root };
		await expectSpawn(host, "resume", followUp, undefined);
		writeFileSync(join(root, PLAN), "# Plan\n\nTask 1, edited.\n\n## In-scope amendments\n");
		await expectSpawn(
			host,
			"resume",
			followUp,
			followUpError("finished writer w-executor", "scope demo: plan artifact changed after approval"),
		);
	});
}

// S6: the engine raises a resume only for a child that finished or stopped, and a finished foreground child has left
// the agent list, so a child missing from a list that was read is finished and checked like a dispatch. An unlisted
// status still refuses, and a missing child the call does not name refuses before its brief is read.
{
	const agents = [];
	const brief = [{ role: "user", text: gateBlock("demo", CONTRACT, PLAN) }];
	const messages = { "w-gone": brief, "w-paused": brief };
	await withDispatchRepository({ agents, messages }, async (root, host) => {
		await present(host, "contract", CONTRACT);
		await approvedContract(host);
		await present(host, "plan", PLAN);
		host.answer("Approve");
		await gateText(host, { action: "approve", scope: "demo", kind: "plan" });
		const followUp = (agentId) => ({
			resume: { agentId },
			prompt: "continue",
			subagentType: "fiatcode:flow-plan-executor",
			cwd: root,
		});
		await expectSpawn(host, "resume", followUp("w-gone"), undefined);
		agents.push({ id: "w-paused", type: "fiatcode:flow-plan-executor", status: "paused" });
		await expectSpawn(host, "resume", followUp("w-paused"), STATE_REFUSAL("w-paused"));
		await expectSpawn(
			host,
			"resume",
			{ resume: { agentId: "w-gone" }, prompt: "continue", cwd: root },
			STATE_REFUSAL("w-gone"),
		);
		writeFileSync(join(root, PLAN), "# Plan\n\nTask 1, edited.\n\n## In-scope amendments\n");
		await expectSpawn(
			host,
			"resume",
			followUp("w-gone"),
			followUpError("finished writer w-gone", "scope demo: plan artifact changed after approval"),
		);
	});
}

// S6: an agent list the engine does not answer as an array is unreadable, so a gated follow-up refuses on its state
// even with a readable brief and current approvals.
{
	const messages = { "w-unread": [{ role: "user", text: gateBlock("demo", CONTRACT, PLAN) }] };
	await withDispatchRepository({ agents: { unreadable: true }, messages }, async (root, host) => {
		await present(host, "contract", CONTRACT);
		await approvedContract(host);
		await present(host, "plan", PLAN);
		host.answer("Approve");
		await gateText(host, { action: "approve", scope: "demo", kind: "plan" });
		await expectSpawn(
			host,
			"resume",
			{ resume: { agentId: "w-unread" }, prompt: "continue", subagentType: "fiatcode:flow-plan-executor", cwd: root },
			STATE_REFUSAL("w-unread"),
		);
	});
}

// S6 (M86, `Plan: NONE`): a finished writer whose brief names no plan needs a current implementation approval — none
// recorded refuses, and one dropped by a newer contract approval refuses again while the contract itself is current.
{
	const agents = [{ id: "w-implementer", type: "flow-implementer", status: "completed" }];
	const messages = { "w-implementer": [{ role: "user", text: gateBlock("demo", CONTRACT, "NONE") }] };
	await withDispatchRepository({ agents, messages }, async (root, host) => {
		await present(host, "contract", CONTRACT);
		await approvedContract(host);
		const followUp = { resume: { agentId: "w-implementer" }, prompt: "continue", cwd: root };
		const noImplementation = followUpError("finished writer w-implementer", "scope demo: no recorded implementation approval");
		await expectSpawn(host, "resume", followUp, noImplementation);
		await present(host, "implementation", CONTRACT);
		host.answer("Approve");
		await gateText(host, { action: "approve", scope: "demo", kind: "implementation" });
		await expectSpawn(host, "resume", followUp, undefined);
		appendFileSync(join(root, CONTRACT), "edit\n");
		await present(host, "contract", CONTRACT);
		await approvedContract(host);
		await expectSpawn(host, "resume", followUp, noImplementation);
	});
}

// S6 (A4 bullet 3): below Claude Code 2.1.299 a resumed subagent raises no `agent.spawn`, so the guard refuses every
// gated dispatch and every `SendMessage` there, naming the floor; an unreadable version refuses the same calls. An
// ungated dispatch never reads the version.
const BELOW_FLOOR = (version) =>
	`Flow governance preflight failed closed: Claude Code ${version} is older than 2.1.299, where a resumed subagent is not checked; gated dispatch and SendMessage are refused. Update Claude Code.`;
const UNREADABLE_VERSION =
	"Flow governance preflight failed closed: cannot read the Claude Code version; gated dispatch and SendMessage are refused.";
const floorRoster = () => ({
	agents: [
		{ id: "p-done", type: "flow-planner", status: "completed" },
		{ id: "e-done", type: "Explore", status: "completed" },
	],
	messages: { "p-done": [{ role: "user", text: gateBlock() }] },
});
for (const [version, refusal] of [
	[{ version: "2.1.298", base: "2.1.298" }, BELOW_FLOOR("2.1.298")],
	[{ version: "2.0.400" }, BELOW_FLOOR("2.0.400")],
	[null, UNREADABLE_VERSION],
	[{ version: "nightly" }, UNREADABLE_VERSION],
]) {
	await withDispatchRepository({ ...floorRoster(), version }, async (root, host) => {
		await present(host, "contract", CONTRACT);
		await approvedContract(host);
		await expectDispatch(host, "planner", "flow-planner", gateBlock(), refusal);
		await expectDispatch(host, "writer", "general-purpose", gateBlock("demo", CONTRACT, "NONE"), refusal);
		await expectSpawn(host, "planner", { prompt: gateBlock(), subagentType: "flow-planner", cwd: root }, refusal);
		await expectSpawn(host, "resume", { resume: { agentId: "p-done" }, prompt: "continue", cwd: root }, refusal);
		const message = await callTool(host, "SendMessage", { to: "e-done", message: "continue" });
		assert.equal(message.refused, refusal, `SendMessage under ${JSON.stringify(version)} must be refused`);
		assert.equal(message.proceeded, false);
		await expectDispatch(host, "ungated", "Explore", "map the call sites", undefined);
		await expectDispatch(host, "ungated", "general-purpose", "count the files", undefined);
		await expectSpawn(host, "ungated", { prompt: "look around", subagentType: "Explore", cwd: root }, undefined);
		await expectSpawn(host, "ungated", { resume: { agentId: "e-done" }, prompt: "continue", cwd: root }, undefined);
	});
}

// S6: 2.1.299, a `-dev` build of it and a later major meet the floor; the call then follows the record.
for (const version of [
	{ version: "2.1.299", base: "2.1.299" },
	{ version: "2.1.299-dev.20261127.t1.sha0", base: "2.1.299-dev" },
	{ version: "3.0.0" },
]) {
	await withDispatchRepository({ ...floorRoster(), version }, async (root, host) => {
		await expectDispatch(host, "planner", "flow-planner", gateBlock(), taskError("scope demo: no recorded contract approval"));
		const message = await callTool(host, "SendMessage", { to: "p-done", message: "continue" });
		assert.equal(message.refused, undefined, `SendMessage under ${JSON.stringify(version)} must pass: ${message.refused}`);
		await present(host, "contract", CONTRACT);
		await approvedContract(host);
		await expectDispatch(host, "planner", "flow-planner", gateBlock(), undefined);
		await expectSpawn(host, "planner", { prompt: gateBlock(), subagentType: "flow-planner", cwd: root }, undefined);
		await expectSpawn(host, "resume", { resume: { agentId: "p-done" }, prompt: "continue", cwd: root }, undefined);
	});
}

// S6: outside a git repository a gated dispatch refuses with OMP's sentence, from both paths, and an ungated one
// still passes.
{
	const dir = temporaryDir("flow-guard-dispatch-nogit-");
	const host = plugin({ cwd: dir });
	await expectDispatch(host, "planner", "flow-planner", gateBlock(), NO_REPOSITORY);
	await expectSpawn(host, "planner", { prompt: gateBlock(), subagentType: "flow-plan-executor", cwd: dir }, NO_REPOSITORY);
	await expectDispatch(host, "ungated", "Explore", "look around", undefined);
}

// S6: a record line this port cannot read makes every gated dispatch refuse before any artifact is judged, naming the
// line; an ungated dispatch never reads it.
await withDispatchRepository({}, async (root, host) => {
	mkdirSync(join(root, ".flow/runtime"), { recursive: true });
	writeFileSync(join(root, GATE_LOG), "a b c\n");
	const unreadable = "Flow governance preflight failed closed: Unreadable Flow approval record at .flow/runtime/approvals.log: line 1";
	await expectDispatch(host, "planner", "flow-planner", gateBlock(), unreadable);
	await expectDispatch(host, "writer", "flow-implementer", gateBlock("demo", CONTRACT, PLAN), unreadable);
	await expectDispatch(host, "verifier", "flow-evidence-verifier", capsuleBrief(), unreadable);
	await expectSpawn(
		host,
		"planner",
		{ prompt: gateBlock("demo", CONTRACT, PLAN), subagentType: "flow-plan-executor", cwd: root },
		unreadable,
	);
	assert.equal(readFileSync(join(root, GATE_LOG), "utf8"), "a b c\n", "a refusal never repairs the record");
});


// S7: tool coverage. `Monitor` runs shell text, so the secret, runtime and publication rules read its `command`; a
// `Monitor` with only `ws` runs no shell. `Workflow` is refused by name. Every other tool outside the unjudged list has
// a code key refuse it, and each single-line string in its input, under any key, judged as a path: the secret rule on
// a string that names an existing file, then the runtime rule on every string.
const FOREIGN_DEPTH = (tool) => `Flow guard failed closed: the ${tool} input is nested deeper than 16 levels; nothing ran.`;
const FOREIGN_CODE = (tool, key) =>
	`Flow guard: ${tool} runs code the guard cannot inspect (${key}), so it is refused. Run it through Bash, where the secret-file, .flow/runtime and publication checks apply.`;
const WORKFLOW_REFUSAL =
	"Flow guard: Workflow runs scripts and starts subagents the guard cannot inspect, so it is refused. Run the steps through Bash and Agent, where the secret-file, .flow/runtime, publication and dispatch checks apply.";

// An input `levels` objects deep, the input itself counted, with one harmless path at the bottom.
function nested(levels) {
	let value = { path: "README.md" };
	for (let level = 1; level < levels; level += 1) value = { inner: value };
	return value;
}

// A session directory holding the dummy secrets the S7 cases name, a harmless file and a link to `.env`; the
// secret rule judges a string only when it names an existing file, so each case's file has to be there.
function foreignRoot(prefix) {
	const root = runtimeRoot(prefix);
	mkdirSync(join(root, "config"));
	mkdirSync(join(root, "secrets"));
	for (const file of [".env", "config/.env", "secrets/.env", "id_rsa"]) writeFileSync(join(root, file), "DUMMY=1\n");
	writeFileSync(join(root, "notes.md"), "notes\n");
	symlinkSync(join(root, ".env"), join(root, "link-env"));
	writeFileSync(join(SECRET_HOME, ".config/opencode/service.json"), "DUMMY=1\n");
	return root;
}

function foreignHost(cwd) {
	return hostOf(createModHost({ cwd, env: { HOME: SECRET_HOME } }).$);
}

// S7 (review P1): `Monitor` with a `command` meets all three shell rules; with only `ws` it passes.
{
	const root = runtimeRoot("flow-guard-monitor-");
	const host = secretPlugin({ cwd: root });
	await refusedSecret(host, "Monitor", { description: "m", timeout_ms: 1000, command: "cat .env" }, ".env");
	assert.match(credentialsRefusal("Monitor", ".env"), /this monitor call .*\(\.env\)/);
	await refusedTool(host, "Monitor", { description: "m", timeout_ms: 1000, command: "printf x > .flow/runtime/approvals.log" });
	await allowedTool(host, "Monitor", { description: "m", timeout_ms: 1000, ws: { url: "wss://example.invalid" } });
	await allowedTool(host, "Monitor", { description: "m", timeout_ms: 1000, command: "tail -f app.log" });
	const asked = await host.check({ tool: "Monitor", input: { command: "git push --force origin main" } });
	assert.equal(asked.decision, "ask", "a Monitor publication asks");
	assert.match(asked.reason, /^Flow publication guard: this command publishes: git push --force origin main$/);
	const silent = await host.check({ tool: "Monitor", input: { ws: { url: "wss://example.invalid" } } });
	assert.equal(silent.decision, undefined, "a Monitor with no command is not a publication");
}

// S7: a tool that runs code the guard cannot read is refused, wherever the code key sits and however it is cased; a
// value that is not code (a number, an empty string) is not.
{
	const host = secretPlugin({ cwd: runtimeRoot("flow-guard-code-tools-") });
	await refusedTool(host, "AppifactRepl", { code: "x" }, FOREIGN_CODE("AppifactRepl", "code"));
	await refusedTool(host, "mcp__x__run", { options: { command: "ls" } }, FOREIGN_CODE("mcp__x__run", "command"));
	await refusedTool(host, "mcp__x__run", { Command: "ls" }, FOREIGN_CODE("mcp__x__run", "Command"));
	await refusedTool(host, "mcp__x__run", { steps: [{ code: ["ls"] }] }, FOREIGN_CODE("mcp__x__run", "code"));
	await allowedTool(host, "mcp__x__run", { code: 7 });
	await allowedTool(host, "mcp__x__run", { code: "" });
}

// S7: `Workflow` runs an inline script, a script file or a saved workflow, and starts subagents the dispatch gate
// cannot see, so it is refused by name whatever its input.
{
	const host = secretPlugin({ cwd: runtimeRoot("flow-guard-workflow-") });
	for (const input of [{ scriptPath: "w.js" }, { name: "deploy" }, {}, { script: "run()" }]) {
		await refusedTool(host, "Workflow", input, WORKFLOW_REFUSAL);
	}
}

// S7: each string meets the credentials rule — directly, in a list, in a nested object's field or as a record's value,
// under any key — and the sentence names the tool in lowercase.
{
	const root = foreignRoot("flow-guard-path-secret-");
	const host = secretPlugin({ cwd: root });
	await refusedSecret(host, "SendFile", { to: "peer", files: [".env"] }, ".env");
	assert.match(credentialsRefusal("SendFile", ".env"), /this sendfile call/);
	await refusedSecret(host, "SendUserFile", { files: ["config/.env"], status: "normal" }, ".env");
	await refusedSecret(host, "Artifact", { file_path: ".env" }, ".env");
	await refusedSecret(host, "Artifact", { files: [{ path: ".env" }] }, ".env");
	await refusedSecret(host, "Artifact", { files: { "a.html": "secrets/.env" } }, ".env");
	await refusedSecret(host, "LSP", { operation: "hover", filePath: "id_rsa", line: 1, character: 1 }, "id_rsa");
	await refusedSecret(host, "mcp__fs__read", { path: "~/.config/opencode/service.json" }, "service.json");
	// The secret answers first, as on the known tools.
	await refusedSecret(host, "mcp__fs__copy", { paths: [".flow/runtime/approvals.log", ".env"] }, ".env");
	// MCP tools name files under keys no list foresees.
	await refusedSecret(host, "mcp__fs__move_file", { source: ".env", destination: "x" }, ".env");
	await refusedSecret(host, "mcp__x__read", { relative_path: ".env" }, ".env");
	await refusedSecret(host, "mcp__x__read", { target_file: ".env" }, ".env");
	// A `file://` URI is judged by its percent-decoded path, with or without the `localhost` authority.
	await refusedSecret(host, "ReadMcpResourceTool", { server: "fs", uri: fileUri(join(root, ".env")) }, ".env");
	await refusedSecret(host, "ReadMcpResourceTool", { server: "fs", uri: fileUri(join(root, ".env"), "localhost").replace(/\.env$/, "%2Eenv") }, ".env");
	// A link is judged by where it lands.
	await refusedSecret(host, "mcp__x__read", { path: "link-env" }, ".env");
	// A string is judged whatever its key means: an existing secret named in a report is refused too.
	await refusedSecret(host, "ReportFindings", { file: ".env" }, ".env");
}

// S7: a credentials name that is not an existing file cannot be printed, and a multi-line string is content, not a
// path; neither is judged by the secret rule.
{
	const host = secretPlugin({ cwd: foreignRoot("flow-guard-path-prose-") });
	await allowedTool(host, "mcp__x__read", { path: "missing/.env" });
	await allowedTool(host, "mcp__x__y", { path: "a\nb" });
	await allowedTool(host, "mcp__x__note", { text: "rotate the credentials" });
	await allowedTool(host, "mcp__x__note", { body: "line one\n.env" });
	await allowedTool(host, "mcp__x__y", { path: "" });
}

// S7: the engine's own top-level keys are not the tool's input; the same key nested inside the input is.
{
	const root = foreignRoot("flow-guard-path-engine-keys-");
	const host = foreignHost(root);
	assert.equal(await foreignToolRefusal(host, root, "mcp__x__y", { tool: ".env", tool_use_id: ".env", agentId: ".env" }), undefined);
	assert.equal(await foreignToolRefusal(host, root, "mcp__x__y", { nested: { agentId: ".env" } }), credentialsRefusal("mcp__x__y", ".env"));
}

// S7: every string meets the `.flow/runtime` rule, folded as the file tools are, under any key; a note that only
// spells the directory is refused too.
{
	const host = secretPlugin({ cwd: foreignRoot("flow-guard-path-runtime-") });
	await refusedTool(host, "ArtifactData", {
		action: "set",
		writes: [{ op: "set", collection: "c", doc_id: "d", file_path: ".flow/runtime/approvals.log" }],
	});
	await refusedTool(host, "mcp__fs__write_file", { path: ".flow/Runtime/approvals.log", content: "x" });
	await refusedTool(host, "mcp__fs__write_file", { "file-path": ".flow/runtime/x" });
	await refusedTool(host, "mcp__fs__move_file", { source: "notes.md", destination: ".flow/runtime/approvals.log" });
	await refusedTool(host, "mcp__jetbrains__create_new_file_with_text", { pathInProject: ".flow/runtime/approvals.log", text: "x" });
	await refusedTool(host, "mcp__x__note", { text: ".flow/runtime/approvals.log" });
}

// S7: keys are judged like values, at any depth and whatever the value is, because a tool may name a file as a key;
// the engine's own top-level keys stay skipped.
{
	const root = foreignRoot("flow-guard-path-keys-");
	const host = secretPlugin({ cwd: root });
	await refusedTool(host, "mcp__fs__write_multiple_files", { files: { ".flow/runtime/approvals.log": "forged" } });
	await refusedSecret(host, "mcp__fs__write_multiple_files", { files: { [`${root}/.env`]: "x" } }, ".env");
	await refusedSecret(host, "mcp__x__y", { ".env": 1 }, ".env");
	await refusedSecret(host, "mcp__x__y", { nested: { ".env": true } }, ".env");
	assert.equal(await foreignToolRefusal(foreignHost(root), root, "mcp__x__y", { tool: ".env", tool_use_id: ".env", agentId: ".env" }), undefined);
}

// S7: a `file:` URI without `//` is judged by its decoded path; `file:` followed by no `/` is no URI and names a file
// only if one by that name exists.
{
	const root = foreignRoot("flow-guard-path-file-uri-");
	const host = secretPlugin({ cwd: root });
	await refusedSecret(host, "ReadMcpResourceTool", { server: "fs", uri: fileUri(join(root, ".env"), "single") }, ".env");
	await refusedSecret(host, "ReadMcpResourceTool", { server: "fs", uri: fileUri(join(root, ".env"), "single").replace(/^file:/, "FILE:").replace(/\.env$/, "%2Eenv") }, ".env");
	await allowedTool(host, "mcp__x__read", { path: "file:notes.md" });
	// A URI's query and fragment are not part of its path, as `fileURLToPath` and `urlparse` read it; an encoded `%23`
	// stays in the name.
	await refusedSecret(host, "ReadMcpResourceTool", { server: "fs", uri: `${fileUri(join(root, ".env"))}#x` }, ".env");
	await refusedSecret(host, "ReadMcpResourceTool", { server: "fs", uri: `${fileUri(join(root, ".env"))}?x=1` }, ".env");
	await refusedSecret(host, "ReadMcpResourceTool", { server: "fs", uri: `${fileUri(join(root, ".env"), "single")}#x` }, ".env");
	await allowedTool(host, "mcp__x__read", { uri: `${fileUri(join(root, ".env"))}%23x` });
}

// S7: a long run of dots or spaces is folded in time proportional to its length; a quadratic trailing-dot strip let a
// 128 KiB run stall the hook past its budget.
{
	const root = foreignRoot("flow-guard-dot-run-");
	for (const filler of [".", " "]) {
		const started = Date.now();
		assert.equal(await foreignToolRefusal(foreignHost(root), root, "mcp__x__y", { note: `${filler.repeat(128 * 1024)}x` }), undefined);
		const elapsed = Date.now() - started;
		assert.ok(elapsed < 2000, `a 128 KiB run of ${JSON.stringify(filler)} took ${elapsed} ms`);
	}
}

// S7: a relative string is looked up from the repository root as well as the session directory, because MCP and IDE
// servers resolve relative paths against the project root. Outside a repository no parent is consulted.
{
	const repo = temporaryDir("flow-guard-path-repo-root-");
	gitIn(repo, "init", "-q");
	writeFileSync(join(repo, ".env"), "DUMMY=1\n");
	writeFileSync(join(repo, "notes.md"), "notes\n");
	mkdirSync(join(repo, "sub"));
	const host = secretPlugin({ cwd: join(repo, "sub") });
	await refusedSecret(host, "mcp__fs__read_text_file", { path: ".env" }, ".env");
	await refusedSecret(host, "mcp__jetbrains__get_file_text_by_path", { pathInProject: ".env" }, ".env");
	await allowedTool(host, "mcp__fs__read_text_file", { path: "notes.md" });
	await allowedTool(host, "mcp__fs__read_text_file", { path: ".env.missing" });
	// The session directory is still looked in: a credentials file only under `sub/` refuses too.
	writeFileSync(join(repo, "sub", "id_rsa"), "DUMMY=1\n");
	await refusedSecret(host, "mcp__fs__read_text_file", { path: "id_rsa" }, "id_rsa");

	const parent = temporaryDir("flow-guard-path-no-repo-");
	writeFileSync(join(parent, ".env"), "DUMMY=1\n");
	mkdirSync(join(parent, "child"));
	await allowedTool(secretPlugin({ cwd: join(parent, "child") }), "mcp__fs__read_text_file", { path: ".env" });
}

// S7: a string that is one line once its surrounding whitespace is trimmed is judged trimmed too, as a value or a key;
// one that still holds a line break once trimmed is content and passes.
{
	const host = secretPlugin({ cwd: foreignRoot("flow-guard-path-trimmed-") });
	await refusedTool(host, "mcp__fs__write_file", { path: ".flow/runtime/approvals.log\n" });
	await refusedSecret(host, "mcp__x__read", { path: ".env\n" }, ".env");
	await refusedSecret(host, "mcp__x__read", { path: "\r\n.env\r\n" }, ".env");
	await refusedSecret(host, "mcp__x__read", { path: " .env " }, ".env");
	await refusedSecret(host, "mcp__x__y", { files: { ".env\n": "x" } }, ".env");
	await allowedTool(host, "mcp__x__y", { body: ".flow/runtime/x\nmore" });
	await allowedTool(host, "mcp__x__y", { body: ".flow/runtime/x\rmore" });
}

// A host that records the longest path `stat` was asked for and the longest argument a process was started with.
function measuredHost(host) {
	const seen = { stat: 0, run: 0 };
	return {
		seen,
		host: {
			...host,
			stat: async (path) => {
				seen.stat = Math.max(seen.stat, path.length);
				return await host.stat(path);
			},
			run: async (argv, options) => {
				seen.run = Math.max(seen.run, ...argv.map((arg) => arg.length));
				return await host.run(argv, options);
			},
		},
	};
}

const S7_MEASURED = { longStringMs: 0, costRuns: 0 };

// S7: no system opens a path longer than 4 096 characters on POSIX, so a longer string, once resolved, is never looked
// up or canonicalised: a 64 KiB string with 8 192 separators costs no `stat` or process call on it. It is still judged
// on its text, so a spelled `.flow/runtime` refuses at any length, and the limit applies to the resolved path, so
// `<5 000 characters>/../.env` is `.env`.
{
	const root = foreignRoot("flow-guard-path-limit-");
	const long = "aaaaaaa/".repeat(8192);
	const measured = measuredHost(foreignHost(root));
	const started = Date.now();
	assert.equal(await foreignToolRefusal(measured.host, root, "mcp__x__y", { blob: long }), undefined);
	S7_MEASURED.longStringMs = Date.now() - started;
	assert.ok(measured.seen.stat <= 4096, `no stat past the path limit, longest ${measured.seen.stat}`);
	assert.ok(measured.seen.run <= 4096, `no process argument past the path limit, longest ${measured.seen.run}`);
	assert.ok(S7_MEASURED.longStringMs < 2000, `a 64 KiB string took ${S7_MEASURED.longStringMs} ms`);
	// On a host that can canonicalise nothing every short string refuses as unresolvable, so the long key stands alone.
	const blindRoot = runtimeRoot("flow-guard-path-limit-blind-");
	assert.equal(await foreignToolRefusal(canonicalEngineHost(blindRoot, { realpath: false }), blindRoot, "mcp__x__y", { [long]: 1 }), undefined);
	const host = foreignHost(root);
	assert.equal(await foreignToolRefusal(host, root, "mcp__x__y", { path: `.flow/runtime/${"a/".repeat(3000)}` }), RUNTIME_WRITE_REASON);
	assert.equal(await foreignToolRefusal(host, root, "mcp__x__y", { path: `${"x".repeat(5000)}/../.env` }), credentialsRefusal("mcp__x__y", ".env"));
}

// S7: an input deeper than 16 levels is not read and is refused; 16 levels are read. A relative string with no
// session directory cannot be resolved, so it refuses.
{
	const host = secretPlugin({ cwd: runtimeRoot("flow-guard-path-depth-") });
	await refusedTool(host, "mcp__x__y", nested(17), FOREIGN_DEPTH("mcp__x__y"));
	await allowedTool(host, "mcp__x__y", nested(16));
	assert.equal(await foreignToolRefusal(foreignHost(CWD), "", "mcp__x__y", { path: "relative.txt" }), RUNTIME_WRITE_REASON);
}

// S7: the tools that open no file the model names, or have a check of their own, are left to it: their briefs, notes,
// queries and URLs are not judged as paths, though `.env` exists here.
{
	const root = foreignRoot("flow-guard-unjudged-");
	const host = foreignHost(root);
	for (const [tool, input] of [
		["Agent", { subagent_type: "Explore", description: "credentials", prompt: ".flow/runtime/approvals.log" }],
		["SendMessage", { to: "a", message: ".env" }],
		["TodoWrite", { todos: [{ content: ".flow/runtime/approvals.log", status: "pending", activeForm: ".env" }] }],
		["AskUserQuestion", { questions: [{ question: ".flow/runtime/approvals.log" }] }],
		["ExitPlanMode", { plan: ".env" }],
		["Skill", { skill: "x", args: ".flow/runtime/approvals.log" }],
		["WebSearch", { query: ".env" }],
		["WebFetch", { url: "https://example.invalid/.flow/runtime/a", prompt: "x" }],
	]) {
		assert.equal(await foreignToolRefusal(host, root, tool, input), undefined, `${tool} is left to its own checks`);
	}
}

// S7: each distinct string is resolved once, the runtime directories and the repository root once per call, so a long
// input costs one `realpath` per distinct string plus a bounded few. The 30 values and the key `items` are 31 distinct
// strings: at most 31 `realpath` runs, at most six for the runtime directories, and one `git` call for the secret
// rule's repository root, which on this root outside any repository answers none: 38 in all.
{
	const root = runtimeRoot("flow-guard-foreign-cost-");
	const engine = canonicalEngineHost(root);
	let runs = 0;
	const counted = {
		...engine,
		run: async (argv, options) => {
			runs += 1;
			return await engine.run(argv, options);
		},
	};
	const distinct = Array.from({ length: 30 }, (_, index) => `item ${index}`);
	assert.equal(await foreignToolRefusal(counted, root, "mcp__x__y", { items: [...distinct, ...distinct] }), undefined);
	assert.ok(runs <= 38, `31 distinct strings must cost at most 38 host runs, cost ${runs}`);
	S7_MEASURED.costRuns = runs;
}

// S7: a harmless path, a tool with neither kind of key, an ungated `Agent` and `flow_gate` itself all pass, and
// `present` of an artifact whose name says "credentials" is the gate's own business.
await withDispatchRepository({}, async (root, host) => {
	writeFileSync(join(root, "README.md"), "readme\n");
	writeFileSync(join(root, ".flow/contracts/credentials-rotation.md"), "# Contract\n\nRotate.\n");
	await allowedTool(host, "mcp__fs__read", { path: "README.md" });
	await allowedTool(host, "mcp__fs__read", { path: CONTRACT });
	await allowedTool(host, "TodoWrite", { todos: [] });
	await allowedTool(host, "WebFetch", { url: "https://example.invalid", prompt: "summarise" });
	await allowedTool(host, "Agent", { subagent_type: "Explore", description: "look", prompt: "look around" });
	assert.match(await gateText(host, { action: "status", scope: "demo" }), /^Flow gate status/);
	assert.match(await present(host, "contract", CONTRACT), /^Presented contract for scope demo: /);
	assert.match(await present(host, "contract", ".flow/contracts/credentials-rotation.md"), /^Presented contract for scope demo: /);
});

for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });

console.log(
	`ok: claude-code flow-guard (S1, S3, S4, S5, S6, S7) — S5 dialogs: ${S5_DIALOG_COUNTS.approve} approve, ${S5_DIALOG_COUNTS.accept} accept, at most one per call; ` +
		`S6 cases: ${S6.ungated} ungated, ${S6.planner} planner, ${S6.writer} writer, ${S6.verifier} verifier, ${S6.resume} resume; ` +
		`S7: a 64 KiB string in ${S7_MEASURED.longStringMs} ms, 31 distinct strings in ${S7_MEASURED.costRuns} host runs`,
);
