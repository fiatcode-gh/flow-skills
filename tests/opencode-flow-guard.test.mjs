// Behavioral tests for the OpenCode flow-guard plugin, driven through `setup` on the host model.
// Dependency-free: Node native TypeScript stripping and Bun both load the plugin modules directly.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { credentialsRefusal } from "../opencode/plugins/flow-guard/credentials.ts";
import { setup } from "../opencode/plugins/flow-guard/setup.ts";
import { createHost } from "./opencode-plugin-host.mjs";

const CWD = "/work/app";

async function plugin(directory = CWD) {
	const host = createHost({ directory });
	await setup(host.ctx);
	return host;
}

async function refused(host, tool, input) {
	const outcome = await host.call(tool, input);
	assert.equal(typeof outcome.refused, "string", `${tool} ${JSON.stringify(input)} must be refused, got ${JSON.stringify(outcome)}`);
	return outcome.refused;
}

async function allowed(host, tool, input) {
	const outcome = await host.call(tool, input);
	assert.deepEqual(outcome, {}, `${tool} ${JSON.stringify(input)} must be allowed, got ${JSON.stringify(outcome)}`);
}

// S1: one `execute.before` hook; an ordinary read passes.
{
	const host = await plugin();
	assert.equal(host.toolHooks.get("execute.before")?.length, 1, "setup must register one execute.before hook");
	await allowed(host, "read", { path: "README.md" });
}

// S2: the refusal is OMP's sentence, word for word.
{
	const host = await plugin();
	assert.equal(await refused(host, "read", { path: ".env" }), credentialsRefusal("read", ".env"));
	assert.match(credentialsRefusal("read", ".env"), /^Flow credentials guard: this read call would print a credentials file \(\.env\)\. /);
}

// S3: a symlink is judged by its target too.
{
	const dir = mkdtempSync(join(tmpdir(), "flow-guard-link-"));
	try {
		writeFileSync(join(dir, ".env"), "DUMMY=1\n");
		symlinkSync(join(dir, ".env"), join(dir, "link.txt"));
		const host = await plugin(dir);
		assert.equal(await refused(host, "read", { path: "link.txt" }), credentialsRefusal("read", ".env"));
		await allowed(host, "read", { path: "notes.txt" });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// S4: `~` expands the way OpenCode expands it; `service.json` counts only under an `opencode` directory.
{
	const host = await plugin();
	assert.equal(await refused(host, "read", { path: "~/.config/opencode/service.json" }), credentialsRefusal("read", "service.json"));
	await allowed(host, "read", { path: "service.json" });
	// The directory is read on every call, never captured at setup.
	host.ctx.location.directory = join(homedir(), ".config/opencode");
	assert.equal(await refused(host, "read", { path: "service.json" }), credentialsRefusal("read", "service.json"));
}

// S5: grep takes one path plus an `include` glob. The glob is tested as written (`.env*` already names a `.env`
// file), then with its wildcards removed (`id_rsa*` only matches as `id_rsa`).
{
	const host = await plugin();
	assert.equal(await refused(host, "grep", { pattern: "x", include: ".env*" }), credentialsRefusal("grep", ".env*"));
	assert.equal(await refused(host, "grep", { pattern: "x", path: "config/.env" }), credentialsRefusal("grep", ".env"));
	assert.equal(await refused(host, "grep", { pattern: "x", path: "keys", include: "id_rsa*" }), credentialsRefusal("grep", "id_rsa"));
	await allowed(host, "grep", { pattern: "x", path: "src", include: "*.ts" });
	await allowed(host, "grep", { pattern: "x", path: "", include: "" });
	await allowed(host, "grep", { pattern: "x", include: ".env.example" });
}

// S6: shell text, with `workdir` as the directory its paths resolve against; loading a file stays allowed.
{
	const host = await plugin();
	assert.equal(await refused(host, "shell", { command: "cat .env" }), credentialsRefusal("shell", ".env"));
	await allowed(host, "shell", { command: "cat service.json" });
	assert.equal(
		await refused(host, "shell", { command: "cat service.json", workdir: "~/.config/opencode" }),
		credentialsRefusal("shell", "service.json"),
	);
	await allowed(host, "shell", { command: "docker run --env-file .env app" });
	await allowed(host, "shell", { command: "( set -a; . ./.env >/dev/null 2>&1; set +a; exec ./run )" });
	await allowed(host, "shell", { command: "echo hi > .env" });
	await allowed(host, "shell", { command: "cat service.json", workdir: 7 });
}

// S6b: OpenCode's input repair renames `bash` to `shell`, but its order against this hook is unproven: a `bash`
// call is refused exactly like the `shell` call with the same input.
{
	const host = await plugin();
	for (const input of [{ command: "cat .env" }, { command: "cat service.json", workdir: "~/.config/opencode" }]) {
		assert.equal(await refused(host, "bash", input), await refused(host, "shell", input));
	}
	await allowed(host, "bash", { command: "docker run --env-file .env app" });
}

// S7: other tools and malformed inputs pass untouched; the guard never asks.
{
	const host = await plugin();
	await allowed(host, "glob", { pattern: ".env*" });
	await allowed(host, "write", { path: "notes.md", content: "x" });
	await allowed(host, "opencode_models", { path: ".env" });
	await allowed(host, "read", { path: 42 });
	await allowed(host, "read", null);
	await allowed(host, "grep", { pattern: "x", path: 1, include: [".env"] });
	await allowed(host, "shell", { command: ["cat", ".env"] });
	assert.equal(host.asked.length, 0, "the credentials guard never asks");
}

// --- ask: the reminders stored once per switch, as OpenCode's own plan ones --------------------------------------

const ASK_ENTER = `<system-reminder>
You are in the ask agent. Nothing changes without the user's approval: every edit, shell command and subagent dispatch asks the user first. To change files, ask the user to switch to the build agent.
</system-reminder>`;
const ASK_LEAVE = `<system-reminder>
You are no longer in the ask agent; its limits no longer apply.
</system-reminder>`;
const asUser = (text) => ({ role: "user", content: [{ type: "text", text }] });
const PROMPT = { type: "user", text: "Why does the build fail?" };
const TOOL_TURN = [PROMPT, { type: "assistant", text: "Reading the log." }, { type: "tool", id: "call_1", name: "read", text: "error: missing semicolon" }];
const SUMMARY = { type: "user", text: "Summary of the conversation so far: the build fails on a missing semicolon." };

// What OpenCode sends for the session's stored messages, as the agent it runs as, with no plugin loaded.
async function unhooked(host, sessionID = "ses_main") {
	const bare = createHost({ directory: CWD });
	bare.contexts.set("ses_main", structuredClone(host.contexts.get(sessionID) ?? []));
	return bare.request({ agent: host.sessions.get(sessionID).agent });
}

const stored = (host) => host.synthetics.map(({ text }) => text);

// K1: a switch to `ask` stores the enter reminder once, not resuming the session; the next request carries it,
// before the prompt, and adds nothing of its own. A session created as `ask` gets it too; one created as `build` not.
{
	const host = await plugin();
	assert.equal(host.sessionHooks.get("context")?.length, 1, "setup must register one context hook");
	assert.deepEqual(
		[...host.subscribers].map(({ types }) => types),
		[["session.created", "session.agent.selected"]],
		"setup must subscribe to session.created and session.agent.selected",
	);
	await host.selectAgent({ agent: "ask" });
	assert.deepEqual(host.synthetics, [{ sessionID: "ses_main", text: ASK_ENTER, resume: false }]);
	host.prompt(PROMPT.text);
	const sent = await host.request();
	assert.deepEqual(sent, await unhooked(host));
	assert.deepEqual(sent.messages, [asUser(ASK_ENTER), asUser(PROMPT.text)]);
	assert.equal(host.synthetics.length, 1);

	await host.createSession({ sessionID: "ses_asked", agent: "ask" });
	await host.createSession({ sessionID: "ses_built", agent: "build" });
	assert.deepEqual(host.synthetics.slice(1), [{ sessionID: "ses_asked", text: ASK_ENTER, resume: false }]);
}

// K2: a switch from `ask` to `build` stores the leave reminder once; the `build` request carries it and adds nothing.
{
	const host = await plugin();
	await host.selectAgent({ agent: "ask" });
	host.prompt(PROMPT.text);
	await host.request();
	await host.selectAgent({ agent: "build" });
	assert.deepEqual(host.synthetics.at(-1), { sessionID: "ses_main", text: ASK_LEAVE, resume: false });
	assert.deepEqual(stored(host), [ASK_ENTER, ASK_LEAVE]);
	host.prompt("Now fix it.");
	const sent = await host.request();
	assert.deepEqual(sent, await unhooked(host));
	assert.deepEqual(sent.messages.slice(-2), [asUser(ASK_LEAVE), asUser("Now fix it.")]);
	assert.equal(host.synthetics.length, 2);
}

// K3: `ask` -> `build` -> `ask` stores enter, leave, enter, each once.
{
	const host = await plugin();
	for (const agent of ["ask", "build", "ask"]) {
		await host.selectAgent({ agent });
		host.prompt(`Step as ${agent}.`);
		assert.deepEqual(await host.request(), await unhooked(host));
	}
	assert.deepEqual(stored(host), [ASK_ENTER, ASK_LEAVE, ASK_ENTER]);
}

// K4: ordinary steps store and add nothing: tool turns in `ask`, a switch to the agent the session already runs,
// and switches between agents other than `ask`.
{
	const host = await plugin();
	await host.selectAgent({ agent: "ask" });
	for (const message of TOOL_TURN) {
		host.contexts.get("ses_main").push(message);
		assert.deepEqual(await host.request(), await unhooked(host));
	}
	await host.selectAgent({ agent: "ask" });
	assert.deepEqual(await host.request(), await unhooked(host));
	assert.deepEqual(stored(host), [ASK_ENTER]);

	const other = await plugin();
	for (const agent of ["general", "explore", "build"]) await other.selectAgent({ agent });
	assert.deepEqual(other.synthetics, []);
}

// K5: when compaction dropped the enter reminder, the `ask` request gets it back where OpenCode places its plan
// one (before the prompt, else last) and it is stored once, so the next request adds nothing.
{
	const host = await plugin();
	await host.selectAgent({ agent: "ask" });
	host.prompt(PROMPT.text);
	host.contexts.set("ses_main", [SUMMARY, PROMPT]);
	const sent = await host.request();
	assert.deepEqual(sent.messages, [asUser(SUMMARY.text), asUser(ASK_ENTER), asUser(PROMPT.text)]);
	assert.deepEqual(host.synthetics.at(-1), { sessionID: "ses_main", text: ASK_ENTER, resume: false });
	assert.equal(host.synthetics.length, 2);
	assert.deepEqual(await host.request(), await unhooked(host));
	assert.equal(host.synthetics.length, 2);

	host.contexts.set("ses_main", [SUMMARY, ...TOOL_TURN]);
	const compacted = (await unhooked(host)).messages;
	assert.deepEqual((await host.request()).messages, [...compacted, asUser(ASK_ENTER)]);
}

// K6: when compaction dropped the leave reminder after a switch to `build`, the stale enter gets a leave the same way.
{
	const host = await plugin();
	await host.selectAgent({ agent: "ask" });
	await host.selectAgent({ agent: "build" });
	host.contexts.set("ses_main", [SUMMARY, { type: "synthetic", text: ASK_ENTER }, PROMPT]);
	const sent = await host.request();
	assert.deepEqual(sent.messages, [asUser(SUMMARY.text), asUser(ASK_ENTER), asUser(ASK_LEAVE), asUser(PROMPT.text)]);
	assert.deepEqual(stored(host), [ASK_ENTER, ASK_LEAVE, ASK_LEAVE]);
	assert.deepEqual(await host.request(), await unhooked(host));
}

// K7: a session that never ran as `ask` gets nothing, whatever agent its requests run as.
{
	const host = await plugin();
	host.contexts.set("ses_main", structuredClone(TOOL_TURN));
	for (const agent of ["build", "plan", "general", "explore", "flow-implementer", "asker"]) {
		host.sessions.get("ses_main").agent = agent;
		assert.deepEqual(await host.request(), await unhooked(host), `${agent} must get no reminder`);
	}
	assert.deepEqual(host.synthetics, []);
}

// K8: a restored reminder leaves the system prompt, the tools, the model and the options alone: the cached prefix holds.
{
	const host = await plugin();
	host.sessions.get("ses_main").agent = "ask";
	host.contexts.set("ses_main", structuredClone(TOOL_TURN));
	const { messages: _, ...expected } = await unhooked(host);
	const { messages, ...rest } = await host.request();
	assert.deepEqual(messages.at(-1), asUser(ASK_ENTER));
	assert.deepEqual(rest, expected);
}

// K9: a reminder that fails to store is dropped, as OpenCode drops its plan one: the request still carries it, and
// later switches are still handled.
{
	const host = await plugin();
	const synthetic = host.ctx.session.synthetic;
	host.ctx.session.synthetic = async () => {
		throw new Error("database is locked");
	};
	await host.selectAgent({ agent: "ask" });
	host.prompt(PROMPT.text);
	assert.deepEqual((await host.request()).messages, [asUser(ASK_ENTER), asUser(PROMPT.text)]);
	host.ctx.session.synthetic = synthetic;
	await host.selectAgent({ agent: "build" });
	assert.deepEqual(stored(host), [ASK_LEAVE]);
}

// K10: only the reminder's own one-part user message counts. The enter text quoted in an assistant message, or sent
// by the user alongside another part, is not the reminder: the `ask` request gets it restored and stored.
for (const quoted of [
	{ type: "assistant", text: ASK_ENTER },
	{ type: "user", texts: [ASK_ENTER, "And what does this file do?"] },
]) {
	const host = await plugin();
	host.sessions.get("ses_main").agent = "ask";
	host.contexts.set("ses_main", [quoted, PROMPT]);
	const [copy] = (await unhooked(host)).messages;
	assert.deepEqual((await host.request()).messages, [copy, asUser(ASK_ENTER), asUser(PROMPT.text)], `${quoted.type} quote`);
	assert.deepEqual(stored(host), [ASK_ENTER]);
}

// --- Record protection: writes to `.flow/runtime` --------------------------------------------------------------

const RUNTIME_WRITE_REASON =
	"Only flow_gate writes .flow/runtime/; a hand-written record is not an approval. Use flow_gate present/approve, accept or clear instead.";
const SHELL_WORKDIR_REASON = "This shell workdir is inside .flow/runtime/. Only flow_gate writes that directory.";

function tempDir(prefix) {
	return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

async function withRepository(body) {
	const root = tempDir("flow-guard-runtime-");
	try {
		execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
		await body(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

async function refusedWrite(host, tool, input, reason = RUNTIME_WRITE_REASON) {
	assert.equal(await refused(host, tool, input), reason);
}

function patchText(...lines) {
	return ["*** Begin Patch", ...lines, "*** End Patch"].join("\n");
}

// W1: `write` and `edit` on the record are refused before and after `.flow/runtime` exists, through an absolute path
// and a path that only reaches it after `..` is resolved.
await withRepository(async (root) => {
	const host = await plugin(root);
	for (const exists of [false, true]) {
		if (exists) mkdirSync(join(root, ".flow/runtime"), { recursive: true });
		await refusedWrite(host, "write", { path: ".flow/runtime/approvals.log", content: "x" });
		await refusedWrite(host, "edit", { path: ".flow/runtime/approvals.log", oldString: "a", newString: "b" });
		await refusedWrite(host, "write", { path: join(root, ".flow/runtime/approvals.log"), content: "x" });
		await refusedWrite(host, "write", { path: "./.flow/../.flow/runtime/x", content: "x" });
	}
});

// W2: every `patch` header that names a file is a target; a header-shaped line inside added content is not.
await withRepository(async (root) => {
	const host = await plugin(root);
	const record = ".flow/runtime/approvals.log";
	await refusedWrite(host, "patch", { patchText: patchText(`*** Add File: ${record}`, "+x") });
	await refusedWrite(host, "patch", { patchText: patchText(`*** Update File: ${record}`, "@@", "-a", "+b") });
	await refusedWrite(host, "patch", { patchText: patchText(`*** Delete File: ${record}`) });
	await refusedWrite(host, "patch", { patchText: patchText("*** Update File: notes.md", `*** Move to: ${record}`, "@@", "-a", "+b") });
	await allowed(host, "patch", { patchText: patchText("*** Add File: notes.md", "+*** Add File: .flow/runtime/x") });
	await allowed(host, "patch", {});
});

// W3: symlinks are followed: a link to `.flow`, and a `.flow/runtime` that points outside the repository.
await withRepository(async (root) => {
	mkdirSync(join(root, ".flow"));
	symlinkSync(join(root, ".flow"), join(root, "alias"));
	const host = await plugin(root);
	await refusedWrite(host, "write", { path: "alias/runtime/x", content: "x" });
});
await withRepository(async (root) => {
	const outside = tempDir("flow-guard-outside-");
	try {
		mkdirSync(join(root, ".flow"));
		symlinkSync(outside, join(root, ".flow/runtime"));
		const host = await plugin(root);
		await refusedWrite(host, "write", { path: join(outside, "approvals.log"), content: "x" });
		await refusedWrite(host, "edit", { path: join(outside, "nested/x"), oldString: "a", newString: "b" });
	} finally {
		rmSync(outside, { recursive: true, force: true });
	}
});

// W4: other Flow artifacts and look-alike names stay writable; a call with no target is OpenCode's to reject.
await withRepository(async (root) => {
	mkdirSync(join(root, ".flow/runtime"), { recursive: true });
	const host = await plugin(root);
	await allowed(host, "write", { path: ".flow/contracts/demo.md", content: "x" });
	await allowed(host, "write", { path: ".flow/plans/demo/PLAN.md", content: "x" });
	await allowed(host, "edit", { path: "src/runtime/x.ts", oldString: "a", newString: "b" });
	await allowed(host, "write", { path: "docs/.flow-runtime.md", content: "x" });
	await allowed(host, "write", { path: ".flow/runtime-notes.md", content: "x" });
	await allowed(host, "write", { path: "", content: "x" });
	await allowed(host, "write", { content: "x" });
});

// W5: shell text naming `.flow/runtime` (either separator) is refused, and so is a workdir inside it.
await withRepository(async (root) => {
	mkdirSync(join(root, ".flow/runtime"), { recursive: true });
	const host = await plugin(root);
	await refusedWrite(host, "shell", { command: "echo x >>.flow/runtime/approvals.log" });
	await refusedWrite(host, "shell", { command: "cat .flow/runtime/approvals.log" });
	await refusedWrite(host, "shell", { command: "type .flow\\runtime\\approvals.log" });
	await refusedWrite(host, "shell", { command: "ls", workdir: ".flow/runtime" }, SHELL_WORKDIR_REASON);
	await refusedWrite(host, "shell", { command: "ls", workdir: join(root, ".flow/runtime/sub") }, SHELL_WORKDIR_REASON);
	await allowed(host, "shell", { command: "ls .flow" });
	await allowed(host, "shell", { command: "ls", workdir: ".flow" });
});

// W5b: a `bash` call is refused exactly like the `shell` call with the same input.
await withRepository(async (root) => {
	mkdirSync(join(root, ".flow/runtime"), { recursive: true });
	const host = await plugin(root);
	for (const input of [{ command: "cat .flow/runtime/approvals.log" }, { command: "ls", workdir: ".flow/runtime" }]) {
		assert.equal(await refused(host, "bash", input), await refused(host, "shell", input));
	}
	await allowed(host, "bash", { command: "ls", workdir: ".flow" });
});

// W6: the repository root anchors the check from a subdirectory; outside git the session directory does.
await withRepository(async (root) => {
	mkdirSync(join(root, "sub"));
	const host = await plugin(join(root, "sub"));
	await refusedWrite(host, "write", { path: "../.flow/runtime/x", content: "x" });
});
{
	const dir = tempDir("flow-guard-nogit-");
	try {
		const host = await plugin(dir);
		await refusedWrite(host, "write", { path: ".flow/runtime/x", content: "x" });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// --- flow_gate: present, approve, accept, status, clear --------------------------------------------------------

const CONTRACT = ".flow/contracts/demo.md";
const OTHER = ".flow/contracts/other.md";
const PLAN = ".flow/plans/demo/PLAN.md";
const LOG = ".flow/runtime/approvals.log";
const SUMMARY_ERROR = /^Flow gate summary must be one line of at most 80 characters/;

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const logOf = (root) => (existsSync(join(root, LOG)) ? readFileSync(join(root, LOG), "utf8") : undefined);
const logLines = (root) => (logOf(root) ?? "").split("\n").filter((line) => line !== "");
const kindsOf = (root, scope) => logLines(root).filter((line) => line.startsWith(`${scope} `)).map((line) => line.split(" ")[1]);
const gitOut = (root, ...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

// A committed repository holding a demo contract and a plan with an empty amendments section.
async function withGateRepository(body) {
	const root = tempDir("flow-guard-gate-");
	try {
		gitOut(root, "init", "-q");
		gitOut(root, "config", "user.email", "flow-test@example.invalid");
		gitOut(root, "config", "user.name", "Flow Test");
		writeFileSync(join(root, "app.txt"), "v1\n");
		gitOut(root, "add", "app.txt");
		gitOut(root, "commit", "-qm", "base");
		mkdirSync(join(root, ".flow/contracts"), { recursive: true });
		mkdirSync(join(root, ".flow/plans/demo"), { recursive: true });
		writeFileSync(join(root, CONTRACT), "# Contract\n\nDemo.\n");
		writeFileSync(join(root, OTHER), "# Contract\n\nOther.\n");
		writeFileSync(join(root, PLAN), "# Plan\n\nTask 1.\n\n## In-scope amendments\n");
		await body(root, await plugin(root));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

const errorText = (outcome) => outcome.error?.message ?? JSON.stringify(outcome);

// A flow_gate call that succeeds without a prompt; its text.
async function gateText(host, input, options) {
	const before = host.asked.length;
	const outcome = await host.call("flow_gate", input, options);
	assert.equal(typeof outcome.result?.content, "string", `flow_gate ${JSON.stringify(input)} must succeed, got ${errorText(outcome)}`);
	assert.equal(host.asked.length, before, `flow_gate ${JSON.stringify(input)} must not prompt`);
	return outcome.result.content;
}

// A flow_gate call refused before any prompt; its error message.
async function gateError(host, input, options) {
	const before = host.asked.length;
	const outcome = await host.call("flow_gate", input, options);
	assert.ok(outcome.error instanceof Error, `flow_gate ${JSON.stringify(input)} must fail, got ${JSON.stringify(outcome)}`);
	assert.equal(host.asked.length, before, `refused flow_gate ${JSON.stringify(input)} must not prompt`);
	return outcome.error.message;
}

// A flow_gate call that publishes exactly one permission request, answered with `decision`. `beforeReply` runs while
// the request is open.
async function prompted(host, input, decision = "once", { feedback, beforeReply } = {}) {
	const before = host.asked.length;
	const call = host.call("flow_gate", input);
	const first = await Promise.race([host.nextRequest().then((request) => ({ request })), call.then((outcome) => ({ outcome }))]);
	assert.ok(first.request, `flow_gate ${JSON.stringify(input)} must prompt, got ${first.outcome && errorText(first.outcome)}`);
	await beforeReply?.(first.request);
	host.reply(first.request.id, decision, feedback);
	const outcome = await call;
	assert.equal(host.asked.length, before + 1, `flow_gate ${JSON.stringify(input)} must prompt once`);
	return { request: first.request, outcome };
}

async function approved(host, input, decision = "once") {
	const { request, outcome } = await prompted(host, { action: "approve", ...input }, decision);
	assert.equal(typeof outcome.result?.content, "string", `approve ${JSON.stringify(input)} must succeed, got ${errorText(outcome)}`);
	return { request, text: outcome.result.content };
}

async function accepted(host, scope, decision = "once") {
	const { request, outcome } = await prompted(host, { action: "accept", scope, source: "closure-1" }, decision);
	assert.equal(typeof outcome.result?.content, "string", `accept ${scope} must succeed, got ${errorText(outcome)}`);
	return { request, text: outcome.result.content };
}

const present = (host, kind, path, scope = "demo", summary = `${kind} for ${scope}`) =>
	gateText(host, { action: "present", scope, kind, path, summary });

// Present each `[kind, path]` for `scope`, then approve them in one call.
async function presentAndApprove(host, scope, ...items) {
	for (const [kind, path] of items) await present(host, kind, path, scope);
	return approved(host, { scope, kind: items.map(([kind]) => kind).join(",") });
}

// A1: present names the artifact and its digest; bad summaries, paths outside .flow and missing files are refused.
await withGateRepository(async (root, host) => {
	const text = await present(host, "contract", CONTRACT, "demo", "Demo contract");
	assert.equal(text, ["Presented contract for scope demo: .flow/contracts/demo.md", "Demo contract", "", `sha256 ${sha256(join(root, CONTRACT))}`].join("\n"));
	await present(host, "contract", "contracts/demo.md", "demo", "x".repeat(80));
	assert.match(await gateError(host, { action: "present", scope: "demo", kind: "contract", path: CONTRACT, summary: "one\ntwo" }), SUMMARY_ERROR);
	assert.match(await gateError(host, { action: "present", scope: "demo", kind: "contract", path: CONTRACT, summary: "x".repeat(81) }), SUMMARY_ERROR);
	assert.match(
		await gateError(host, { action: "present", scope: "demo", kind: "contract", path: join(root, "app.txt"), summary: "s" }),
		/^Flow gate artifacts must live below /,
	);
	assert.match(
		await gateError(host, { action: "present", scope: "demo", kind: "contract", path: ".flow/contracts/none.md", summary: "s" }),
		/^Flow gate artifact does not exist: /,
	);
	assert.equal(await gateError(host, { action: "present", scope: "demo", kind: "contract", path: CONTRACT }), "Flow gate present requires kind, path, and summary");
	assert.equal(await gateError(host, { action: "publish", scope: "demo" }), "Flow gate action must be present, approve, accept, status, or clear");
	assert.equal(await gateError(host, { action: "status", scope: " " }), "Flow gate scope is required");
});

// A2: approve with no presentation is refused before any prompt and writes nothing.
await withGateRepository(async (root, host) => {
	assert.match(await gateError(host, { action: "approve", scope: "demo", kind: "contract" }), /^No current Flow gate presentation for: demo\/contract\. /);
	assert.equal(await gateError(host, { action: "approve", scope: "demo" }), "Flow approval requires scope and kind.");
	assert.equal(await gateError(host, { action: "approve", scope: "demo", kind: "contract,draft" }), "Flow approval requires scope and kind.");
	assert.equal(host.asked.length, 0);
	assert.equal(logOf(root), undefined);
});

// A3: one pair, one request with no `save`; nothing is written until the answer.
await withGateRepository(async (root, host) => {
	await present(host, "contract", CONTRACT, "demo", "Demo contract");
	const { request, outcome } = await prompted(host, { action: "approve", scope: "demo", kind: "contract" }, "once", {
		beforeReply: () => assert.equal(logOf(root), undefined, "nothing is recorded before the answer"),
	});
	assert.equal(request.action, "flow_gate approve contract demo (.flow/contracts/demo.md)");
	assert.deepEqual(request.resources, ["contract demo"]);
	assert.equal("save" in request, false, "the request must offer no saved rule");
	assert.equal(request.message, "Approve contract for Flow scope demo.");
	assert.deepEqual(request.metadata.summaries, { "contract demo": "Demo contract" });
	assert.equal(request.source?.type, "tool");
	assert.equal(outcome.result?.content, "Approved Flow contract revision for scope demo.");
	assert.equal(logOf(root), `demo contract ${sha256(join(root, CONTRACT))} .flow/contracts/demo.md\n`);
	// The presentation is spent.
	assert.match(await gateError(host, { action: "approve", scope: "demo", kind: "contract" }), /^No current Flow gate presentation for: demo\/contract/);
});

// A4: several pairs share one request and land together.
await withGateRepository(async (root, host) => {
	for (const scope of ["demo", "other"]) {
		const path = scope === "demo" ? CONTRACT : OTHER;
		await present(host, "contract", path, scope);
		await present(host, "implementation", path, scope);
	}
	const { request, text } = await approved(host, { scope: "demo,other", kind: "implementation,contract" });
	assert.equal(
		request.action,
		"flow_gate approve contract demo (.flow/contracts/demo.md), implementation demo (.flow/contracts/demo.md), " +
			"contract other (.flow/contracts/other.md), implementation other (.flow/contracts/other.md)",
	);
	assert.equal(request.message, "Approve 4 Flow artifacts: contract demo, implementation demo, contract other, implementation other.");
	assert.equal(text, "Approved 4 Flow artifact revisions: contract demo, implementation demo, contract other, implementation other.");
	assert.deepEqual(
		logLines(root).map((line) => line.split(" ").slice(0, 2).join(" ")),
		["demo contract", "demo implementation", "other contract", "other implementation"],
	);
});

// A4b: the prompt names each pair's artifact, so a different file under the same scope and kind reads differently.
await withGateRepository(async (root, host) => {
	await present(host, "contract", OTHER, "demo");
	const { request } = await approved(host, { scope: "demo", kind: "contract" });
	assert.equal(request.action, "flow_gate approve contract demo (.flow/contracts/other.md)");
});

// A5: all or none.
await withGateRepository(async (root, host) => {
	await present(host, "contract", CONTRACT);
	assert.match(await gateError(host, { action: "approve", scope: "demo", kind: "contract,plan" }), /^No current Flow gate presentation for: demo\/plan\./);
	await present(host, "plan", PLAN);
	appendFileSync(join(root, CONTRACT), "edit\n");
	assert.match(
		await gateError(host, { action: "approve", scope: "demo", kind: "contract,plan" }),
		/^The presented Flow artifact changed before approval: demo\/contract\./,
	);
	await present(host, "contract", CONTRACT);
	const declined = await prompted(host, { action: "approve", scope: "demo", kind: "contract,plan" }, "reject");
	assert.equal(declined.outcome.error?.name, "Permission.DeclinedError");
	const feedback = await prompted(host, { action: "approve", scope: "demo", kind: "contract,plan" }, "reject", { feedback: "not this plan" });
	assert.equal(feedback.outcome.error?.message, "not this plan");
	const raced = await prompted(host, { action: "approve", scope: "demo", kind: "contract,plan" }, "once", {
		beforeReply: () => writeFileSync(join(root, PLAN), "# Plan\n\nTask 1 changed.\n\n## In-scope amendments\n"),
	});
	assert.match(errorText(raced.outcome), /changed before approval: demo\/plan/);
	assert.equal(logOf(root), undefined, "no refused or declined approve may record");
	await present(host, "contract", CONTRACT);
	const swapped = await prompted(host, { action: "approve", scope: "demo", kind: "contract" }, "once", {
		beforeReply: () => present(host, "contract", OTHER, "demo"),
	});
	assert.match(errorText(swapped.outcome), /changed while the prompt was open: demo\/contract/);
	assert.equal(logOf(root), undefined, "a re-presented file must not be recorded under the old prompt");
});

// A6: the prompt comes from the hook, not from rules: an allow rule for flow_gate does not skip it.
await withGateRepository(async (root, host) => {
	for (const allowRule of [false, true]) {
		if (allowRule) host.rules.push({ action: "flow_gate*", resource: "*", effect: "allow" });
		await presentAndApprove(host, "demo", ["contract", CONTRACT]);
		await accepted(host, "demo");
	}
	const before = host.asked.length;
	await host.ctx.permission.assert({ sessionID: "ses_main", agent: "build", action: "read", resources: ["README.md"] });
	assert.equal(host.asked.length, before, "the evaluate hook must leave other actions alone");
});

// A7: "always" saves nothing; the next approve prompts again, even with a saved allow rule.
await withGateRepository(async (root, host) => {
	await present(host, "contract", CONTRACT);
	await approved(host, { scope: "demo", kind: "contract" }, "always");
	assert.deepEqual(host.saved, []);
	assert.deepEqual(kindsOf(root, "demo"), ["contract"]);
	await presentAndApprove(host, "demo", ["contract", CONTRACT]);
	host.saved.push({ action: "flow_gate*", resource: "*", effect: "allow" });
	await presentAndApprove(host, "demo", ["contract", CONTRACT]);
	await accepted(host, "demo");
});

// A8: a configured deny rule refuses approve outright.
await withGateRepository(async (root, host) => {
	host.rules.push({ action: "flow_gate*", resource: "*", effect: "deny" });
	await present(host, "contract", CONTRACT);
	assert.match(await gateError(host, { action: "approve", scope: "demo", kind: "contract" }), /Permission denied/);
	assert.equal(logOf(root), undefined);
});

// A9: a child session cannot present, approve, accept or clear; it can read status. An unknown session fails closed.
await withGateRepository(async (root, host) => {
	host.sessions.set("ses_child", { id: "ses_child", agent: "general", parentID: "ses_main", time: {} });
	const child = { sessionID: "ses_child", agent: "general" };
	await present(host, "contract", CONTRACT);
	assert.equal(
		await gateError(host, { action: "present", scope: "demo", kind: "contract", path: CONTRACT, summary: "s" }, child),
		"Flow artifacts are presented by the parent session",
	);
	assert.equal(await gateError(host, { action: "approve", scope: "demo", kind: "contract" }, child), "Flow approval must be confirmed in the parent session");
	assert.equal(
		await gateError(host, { action: "accept", scope: "demo", source: "closure-1" }, child),
		"Flow acceptance state must be recorded by the parent session",
	);
	assert.equal(await gateError(host, { action: "clear", scope: "demo" }, child), "Flow gate state is cleared by the parent session");
	assert.match(await gateText(host, { action: "status", scope: "demo" }, child), /^Flow gate status\nScope: demo\n/);
	assert.match(
		await gateError(host, { action: "approve", scope: "demo", kind: "contract" }, { sessionID: "ses_unknown" }),
		/^Flow gate cannot read session ses_unknown: /,
	);
	assert.equal(logOf(root), undefined);
});

// A10: accept for several scopes: one request, one line per scope bound to the worktree fingerprint.
await withGateRepository(async (root, host) => {
	const { worktreeIdentity } = await import("../opencode/plugins/flow-guard/git.ts");
	assert.equal(await gateError(host, { action: "accept", scope: "demo" }), "Flow gate accept requires a source receipt identifier");
	assert.match(await gateError(host, { action: "accept", scope: "demo", source: "c", summary: "x".repeat(81) }), SUMMARY_ERROR);
	const declined = await prompted(host, { action: "accept", scope: "demo", source: "closure-1" }, "reject");
	assert.equal(declined.outcome.error?.name, "Permission.DeclinedError");
	assert.equal(logOf(root), undefined);
	const { request, text } = await accepted(host, "demo,other");
	assert.equal(request.action, "flow_gate accept demo, other (working tree)");
	assert.deepEqual(request.resources, ["demo", "other"]);
	assert.equal(request.message, "Record acceptance for Flow scopes demo, other.");
	assert.equal(request.metadata.source, "closure-1");
	const identity = worktreeIdentity(root);
	const head = gitOut(root, "rev-parse", "HEAD");
	assert.equal(identity.head, head);
	assert.deepEqual(logLines(root), [`demo accept ${identity.fingerprint} ${head}`, `other accept ${identity.fingerprint} ${head}`]);
	assert.equal(text, `Recorded Flow acceptance/closure for scopes demo, other: tree ${identity.tree} at ${head}.`);
	const single = await accepted(host, "demo");
	assert.equal(single.request.message, "Record acceptance for Flow scope demo.");
	assert.match(single.text, /^Recorded Flow acceptance\/closure for scope demo: tree /);
	assert.deepEqual(kindsOf(root, "demo"), ["accept"]);
});

// A10b: accept with no scope left after splitting is refused before any prompt and writes nothing.
await withGateRepository(async (root, host) => {
	assert.equal(await gateError(host, { action: "accept", scope: ",", source: "closure-1" }), "Flow gate scope is required");
	assert.equal(host.asked.length, 0);
	assert.equal(logOf(root), undefined);
});

// A10c: flow_gate stays out of Code Mode, where OpenCode settles the forced `ask` by rule with no prompt.
{
	const host = await plugin();
	assert.equal(host.tools.get("flow_gate")?.options?.codemode, false);
}

// A11: approving a contract clears the scope's older records; a plan or implementation clears the acceptance.
await withGateRepository(async (root, host) => {
	await presentAndApprove(host, "demo", ["contract", CONTRACT], ["plan", PLAN]);
	await accepted(host, "demo");
	assert.deepEqual(kindsOf(root, "demo"), ["contract", "plan", "accept"]);
	await presentAndApprove(host, "demo", ["contract", CONTRACT]);
	assert.deepEqual(kindsOf(root, "demo"), ["contract"]);

	await presentAndApprove(host, "demo", ["plan", PLAN]);
	await accepted(host, "demo");
	await presentAndApprove(host, "demo", ["plan", PLAN]);
	assert.deepEqual(kindsOf(root, "demo"), ["contract", "plan"]);

	await present(host, "contract", CONTRACT);
	await presentAndApprove(host, "demo", ["plan", PLAN]);
	await approved(host, { scope: "demo", kind: "contract" });
	assert.deepEqual(kindsOf(root, "demo").sort(), ["contract", "plan"]);
});

// A12: clear drops one scope's records and presentations, nothing else.
await withGateRepository(async (root, host) => {
	await presentAndApprove(host, "demo", ["contract", CONTRACT]);
	await presentAndApprove(host, "other", ["contract", OTHER]);
	await accepted(host, "demo");
	await present(host, "plan", PLAN);
	assert.equal(await gateText(host, { action: "clear", scope: "demo" }), "Cleared Flow gate state for scope demo.");
	assert.deepEqual(logLines(root).map((line) => line.split(" ")[0]), ["other"]);
	assert.equal(
		await gateText(host, { action: "status", scope: "demo" }),
		"Flow gate status\nScope: demo\ncontract: missing\nplan: missing\nimplementation: missing\nacceptance: missing",
	);
	assert.match(await gateError(host, { action: "approve", scope: "demo", kind: "plan" }), /^No current Flow gate presentation for: demo\/plan/);
	assert.equal(await gateError(host, { action: "clear", scope: "demo,other" }), "Flow gate clear takes one scope.");
});

// A13: status reads current, stale and missing, and counts plan amendments.
await withGateRepository(async (root, host) => {
	const status = () => gateText(host, { action: "status", scope: "demo" });
	await presentAndApprove(host, "demo", ["contract", CONTRACT], ["plan", PLAN]);
	await accepted(host, "demo");
	const head = gitOut(root, "rev-parse", "HEAD");
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
});

// A14: lines the plugin does not own survive byte for byte; an unreadable line refuses before any prompt.
await withGateRepository(async (root, host) => {
	mkdirSync(join(root, ".flow/runtime"), { recursive: true });
	const foreign = `x weird ${"0".repeat(64)} some path with spaces\nold plan ${sha256(join(root, PLAN))} .flow/plans/demo/PLAN.md\n`;
	writeFileSync(join(root, LOG), foreign);
	await presentAndApprove(host, "demo", ["contract", CONTRACT]);
	assert.equal(logOf(root), `${foreign}demo contract ${sha256(join(root, CONTRACT))} .flow/contracts/demo.md\n`);

	writeFileSync(join(root, LOG), "a b c\n");
	await present(host, "contract", CONTRACT);
	const unreadable = "Unreadable Flow approval record at .flow/runtime/approvals.log: line 1";
	assert.equal(await gateError(host, { action: "approve", scope: "demo", kind: "contract" }), unreadable);
	assert.equal(await gateError(host, { action: "status", scope: "demo" }), unreadable);
	assert.equal(await gateError(host, { action: "accept", scope: "demo", source: "c" }), unreadable);
	writeFileSync(join(root, LOG), `demo contract ${"0".repeat(63)}g .flow/contracts/demo.md\n`);
	assert.equal(await gateError(host, { action: "status", scope: "demo" }), unreadable);
	assert.equal(logOf(root), `demo contract ${"0".repeat(63)}g .flow/contracts/demo.md\n`);
});

// A15: scope names hold no whitespace, and single-scope actions take one scope.
await withGateRepository(async (root, host) => {
	assert.equal(
		await gateError(host, { action: "present", scope: "a b", kind: "contract", path: CONTRACT, summary: "s" }),
		"Flow gate scope must not contain whitespace: a b",
	);
	assert.equal(await gateError(host, { action: "present", scope: "a,b", kind: "contract", path: CONTRACT, summary: "s" }), "Flow gate present takes one scope.");
	assert.equal(await gateError(host, { action: "approve", scope: "demo,a b", kind: "contract" }), "Flow gate scope must not contain whitespace: a b");
});

// A16: the first record excludes .flow/ from git.
await withGateRepository(async (root, host) => {
	const exclude = () => readFileSync(join(root, ".git/info/exclude"), "utf8").split("\n");
	assert.ok(!exclude().includes("/.flow/"));
	await presentAndApprove(host, "demo", ["contract", CONTRACT]);
	assert.ok(exclude().includes("/.flow/"));
});

// A17: outside git, flow_gate refuses.
{
	const dir = tempDir("flow-guard-gate-nogit-");
	try {
		const host = await plugin(dir);
		assert.equal(await gateError(host, { action: "status", scope: "demo" }), "Flow gate requires a git repository.");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// R1: the Claude Code port's flow_check reads the plugin's lines, and the plugin reads flow_approve's.
await withGateRepository(async (root, host) => {
	const repository = fileURLToPath(new URL("..", import.meta.url));
	const functions = join(root, "functions.sh");
	writeFileSync(
		functions,
		execFileSync("sed", ["-n", "/^flow_digest() {/,/^}/p;/^flow_approve() {/,/^}/p;/^flow_check() {/,/^}/p", join(repository, "claude-code/hooks/flow-context.md")]),
	);
	const shell = (script) => spawnSync("sh", ["-c", `. "$1" && ${script}`, "sh", functions], { cwd: root, encoding: "utf8" }).stdout.trim();
	await presentAndApprove(host, "demo", ["contract", CONTRACT], ["plan", PLAN]);
	assert.equal(shell(`flow_check demo contract ${CONTRACT}`), "ok");
	appendFileSync(join(root, PLAN), "- task 1: amended\n");
	assert.equal(shell(`flow_check demo plan ${PLAN}`), "ok");
	appendFileSync(join(root, CONTRACT), "edit\n");
	assert.equal(shell(`flow_check demo contract ${CONTRACT}`), "stale");
	shell(`flow_approve other contract ${OTHER}`);
	assert.match(await gateText(host, { action: "status", scope: "other" }), /\ncontract: current \(\.flow\/contracts\/other\.md\)\n/);
	await accepted(host, "demo");
	assert.equal(shell("flow_check demo accept app.txt"), "stale");
});

// --- subagent: dispatch and follow-up gate ---------------------------------------------------------------------

const SPAWN = "You are a subagent spawned by another session.\n";
const CAPSULE = ["Evidence capsule:", "- ID: cap-a", "- Owns: app state", "- Independent split check: none", "- Excludes: none", "- Restore obligation: NONE"];

// A brief with a Flow gate block naming `scope`, its contract and, when given, a plan; then `extra` lines.
function brief(scope, { contract = CONTRACT, plan, extra = [] } = {}) {
	const block = ["Flow gate:", `- Scope: ${scope}`];
	if (contract !== null) block.push(`- Contract: ${contract}`);
	if (plan !== undefined) block.push(`- Plan: ${plan}`);
	return [...block, "", ...extra, ...(extra.length > 0 ? [""] : []), "Do it."].join("\n");
}

const subagent = (host, agent, prompt, extra = {}, options) => host.call("subagent", { agent, description: "probe", prompt, ...extra }, options);

async function dispatchRefused(host, agent, prompt, extra, options) {
	const outcome = await subagent(host, agent, prompt, extra, options);
	assert.equal(typeof outcome.refused, "string", `subagent ${agent} ${JSON.stringify({ prompt, ...extra })} must be refused, got ${JSON.stringify(outcome)}`);
	return outcome.refused;
}

async function dispatchAllowed(host, agent, prompt, extra, options) {
	const outcome = await subagent(host, agent, prompt, extra, options);
	assert.deepEqual(outcome, {}, `subagent ${agent} ${JSON.stringify({ prompt, ...extra })} must be allowed, got ${JSON.stringify(outcome)}`);
}

// A child session in the host, with its first prompt when one is given.
function child(host, id, agent, time, firstPrompt) {
	host.sessions.set(id, { id, agent, parentID: "ses_main", time });
	if (firstPrompt !== undefined) host.contexts.set(id, [{ type: "user", text: SPAWN + firstPrompt }]);
}

// Replaces the host's context read with one that throws; the count says how often the plugin asked.
function forbidContext(host) {
	const reads = { count: 0 };
	host.ctx.session.context = async () => {
		reads.count += 1;
		throw new Error("session.context must not be read");
	};
	return reads;
}

const RUNNING = { busy: 5 };
const FINISHED = { busy: 5, idle: 9 };
const WRITER_BRIEF = brief("demo", { plan: PLAN });
const editPlan = (root) => writeFileSync(join(root, PLAN), "# Plan\n\nTask 1 changed.\n\n## In-scope amendments\n");

// G1: outside git a gated dispatch is refused; an ungated one passes.
{
	const dir = tempDir("flow-guard-dispatch-nogit-");
	try {
		const host = await plugin(dir);
		assert.equal(await dispatchRefused(host, "flow-planner", brief("demo")), "Flow governance gate requires subagent dispatch from a git repository.");
		await dispatchAllowed(host, "explore", "Find the helper.");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// G2: the agent name is trimmed before comparison.
await withGateRepository(async (root, host) => {
	assert.equal(
		await dispatchRefused(host, " flow-planner ", brief("demo")),
		"Flow governance preflight failed: task: scope demo: no recorded contract approval. Use flow_gate to present/approve the current artifact revision or record acceptance/closure, then retry with the Flow gate manifest.",
	);
});

// G3: an unreadable record fails a gated dispatch closed; an ungated one never reads it.
await withGateRepository(async (root, host) => {
	mkdirSync(join(root, ".flow/runtime"), { recursive: true });
	writeFileSync(join(root, LOG), "a b c\n");
	const reason = await dispatchRefused(host, "flow-planner", brief("demo"));
	assert.match(reason, /^Flow governance preflight failed closed: /);
	assert.ok(reason.includes(LOG), reason);
	await dispatchAllowed(host, "general", "Find the helper.");
});

// G4: a presented, unapproved contract says so.
await withGateRepository(async (root, host) => {
	await present(host, "contract", CONTRACT);
	assert.match(
		await dispatchRefused(host, "flow-planner", brief("demo")),
		/task: scope demo: contract approval is presented but not recorded yet; flow_gate approve must finish before this dispatch/,
	);
});

// G5: a verifier with neither acceptance nor capsule is told about the acceptance first.
await withGateRepository(async (root, host) => {
	const reason = await dispatchRefused(host, "flow-evidence-verifier", brief("demo", { contract: null }));
	assert.match(reason, /scope demo: no acceptance\/closure recorded for the current repository state; flow_gate accept must complete before/);
	assert.ok(!reason.includes("evidence-capsule"), reason);
});

// G6: a dispatch from a child session is checked the same way.
await withGateRepository(async (root, host) => {
	host.sessions.set("ses_child", { id: "ses_child", agent: "general", parentID: "ses_main", time: RUNNING });
	assert.match(await dispatchRefused(host, "flow-planner", brief("demo"), {}, { sessionID: "ses_child" }), /no recorded contract approval/);
});

// G7: the session directory is read per call, so a moved checkout keeps its approvals.
await withGateRepository(async (root, host) => {
	await presentAndApprove(host, "demo", ["contract", CONTRACT]);
	const moved = `${root}-moved`;
	execFileSync("mv", [root, moved]);
	try {
		host.ctx.location.directory = moved;
		await dispatchAllowed(host, "flow-planner", brief("demo"));
	} finally {
		execFileSync("mv", [moved, root]);
	}
});

// A repository with the demo contract and plan approved.
async function withApprovedRepository(body) {
	await withGateRepository(async (root, host) => {
		await presentAndApprove(host, "demo", ["contract", CONTRACT], ["plan", PLAN]);
		await body(root, host);
	});
}

// F1: a running writer gets a follow-up after its plan changed, without a context read.
await withApprovedRepository(async (root, host) => {
	child(host, "ses_w", "flow-plan-executor", RUNNING);
	const reads = forbidContext(host);
	editPlan(root);
	await dispatchAllowed(host, "flow-plan-executor", "stop", { sessionID: "ses_w" });
	assert.equal(reads.count, 0);
});

// F2, F3: a finished writer is checked against its first prompt.
await withApprovedRepository(async (root, host) => {
	child(host, "ses_w", "flow-plan-executor", FINISHED, WRITER_BRIEF);
	await dispatchAllowed(host, "flow-plan-executor", "continue", { sessionID: "ses_w" });
	editPlan(root);
	const reason = await dispatchRefused(host, "flow-plan-executor", "continue", { sessionID: "ses_w" });
	assert.equal(
		reason,
		"Flow governance preflight failed: finished writer ses_w: scope demo: plan artifact changed after approval. A follow-up to a finished session is checked like a dispatch: approve the current artifact first, or start a fresh subagent.",
	);
});

// F4: a finished `general` is a writer only when its first prompt has a block; `explore` is never read.
await withApprovedRepository(async (root, host) => {
	editPlan(root);
	child(host, "ses_g", "general", FINISHED, WRITER_BRIEF);
	assert.match(await dispatchRefused(host, "general", "continue", { sessionID: "ses_g" }), /finished writer ses_g: scope demo: plan artifact changed/);
	child(host, "ses_g2", "general", FINISHED, "Find the helper.");
	await dispatchAllowed(host, "general", "continue", { sessionID: "ses_g2" });
	child(host, "ses_x", "explore", FINISHED);
	const reads = forbidContext(host);
	await dispatchAllowed(host, "explore", "continue", { sessionID: "ses_x" });
	assert.equal(reads.count, 0);
});

// F5: a follow-up's own block wins over the first prompt's.
await withApprovedRepository(async (root, host) => {
	const oldPlan = ".flow/plans/old/PLAN.md";
	mkdirSync(join(root, ".flow/plans/old"), { recursive: true });
	writeFileSync(join(root, oldPlan), "# Plan\n\nOld.\n");
	await presentAndApprove(host, "old", ["contract", OTHER], ["plan", oldPlan]);
	writeFileSync(join(root, oldPlan), "# Plan\n\nOld, edited.\n");
	const oldBrief = brief("old", { contract: OTHER, plan: oldPlan });
	child(host, "ses_a", "flow-plan-executor", FINISHED, oldBrief);
	await dispatchAllowed(host, "flow-plan-executor", WRITER_BRIEF, { sessionID: "ses_a" });
	child(host, "ses_b", "flow-plan-executor", FINISHED, WRITER_BRIEF);
	assert.match(await dispatchRefused(host, "flow-plan-executor", oldBrief, { sessionID: "ses_b" }), /finished writer ses_b: scope old: plan artifact changed/);
});

// F6: whatever cannot be read fails closed.
await withApprovedRepository(async (root, host) => {
	assert.match(
		await dispatchRefused(host, "flow-plan-executor", "continue", { sessionID: "ses_none" }),
		/^Flow governance preflight failed closed: cannot read subagent session ses_none: .+\. Start a fresh subagent instead\.$/,
	);
	child(host, "ses_s", "flow-plan-executor", { busy: "soon" });
	assert.equal(
		await dispatchRefused(host, "flow-plan-executor", "continue", { sessionID: "ses_s" }),
		"Flow governance preflight failed closed: cannot read the state of subagent session ses_s. Start a fresh subagent instead.",
	);
	const firstPromptError = "Flow governance preflight failed closed: cannot read the first prompt of subagent session ses_w. Start a fresh subagent instead.";
	child(host, "ses_w", "flow-plan-executor", FINISHED);
	for (const messages of [[], [{ type: "assistant", text: SPAWN + WRITER_BRIEF }], [{ type: "user", text: WRITER_BRIEF }]]) {
		host.contexts.set("ses_w", messages);
		assert.equal(await dispatchRefused(host, "flow-plan-executor", "continue", { sessionID: "ses_w" }), firstPromptError);
	}
});

// F7: a running child switched to a gated agent is checked; one switched away from a gated agent is not.
await withApprovedRepository(async (root, host) => {
	child(host, "ses_e", "explore", RUNNING, "Find the helper.");
	assert.match(
		await dispatchRefused(host, "flow-plan-executor", "continue", { sessionID: "ses_e" }),
		/^Flow governance preflight failed: session ses_e switched to flow-plan-executor: production writer task must include Flow gate with Scope, Contract, and Plan \(put the block in the subagent prompt\)\. /,
	);
	child(host, "ses_w", "flow-plan-executor", RUNNING, WRITER_BRIEF);
	await dispatchAllowed(host, "general", "stop", { sessionID: "ses_w" });
});

// F8: a finished planner and a finished verifier.
await withApprovedRepository(async (root, host) => {
	await accepted(host, "demo");
	child(host, "ses_v", "flow-evidence-verifier", FINISHED, brief("demo", { contract: null, extra: CAPSULE }));
	await dispatchAllowed(host, "flow-evidence-verifier", "continue", { sessionID: "ses_v" });
	writeFileSync(join(root, "app.txt"), "v2\n");
	assert.match(
		await dispatchRefused(host, "flow-evidence-verifier", "continue", { sessionID: "ses_v" }),
		/^Flow governance preflight failed: finished verifier ses_v: scope demo: repository state changed after acceptance\/closure \(accepted at [0-9a-f]{40}, now at [0-9a-f]{40}\)/,
	);
	child(host, "ses_p", "flow-planner", FINISHED, brief("demo"));
	appendFileSync(join(root, CONTRACT), "edit\n");
	assert.match(await dispatchRefused(host, "flow-planner", "continue", { sessionID: "ses_p" }), /finished planner ses_p: scope demo: contract artifact changed after approval/);
});

// F9: an empty sessionID is a new dispatch.
await withGateRepository(async (root, host) => {
	assert.match(await dispatchRefused(host, "flow-planner", brief("demo"), { sessionID: "" }), /^Flow governance preflight failed: task: scope demo: no recorded contract approval/);
});

// F10: running means `busy` is a number and `idle` is unset or older.
await withApprovedRepository(async (root, host) => {
	editPlan(root);
	for (const [time, running] of [
		[{ busy: 5 }, true],
		[{ busy: 5, idle: 9 }, false],
		[{ busy: 9, idle: 5 }, true],
		[{}, false],
	]) {
		child(host, "ses_t", "flow-plan-executor", time, WRITER_BRIEF);
		const outcome = await subagent(host, "flow-plan-executor", "stop", { sessionID: "ses_t" });
		assert.equal(outcome.refused === undefined, running, `time ${JSON.stringify(time)}: ${JSON.stringify(outcome)}`);
	}
});

// The capsule is checked only once the acceptance holds.
await withGateRepository(async (root, host) => {
	await accepted(host, "demo");
	assert.equal(
		await dispatchRefused(host, "flow-evidence-verifier", brief("demo", { contract: null })),
		"Flow evidence-capsule preflight failed: task: missing evidence capsule:, id:, owns:, independent split check:, excludes:, restore obligation:. Each flow-evidence-verifier task must declare one bounded capsule before dispatch.",
	);
	await dispatchAllowed(host, "flow-evidence-verifier", brief("demo", { contract: null, extra: CAPSULE }));
});

console.log("ok: opencode flow-guard");
