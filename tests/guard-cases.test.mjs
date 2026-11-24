// Runs the shared guard case table (tests/fixtures/guard-cases.json) against every harness adapter.
// Each adapter answers the same cases on the same fixture repository, so a port that drifts from
// the OMP guards fails here with the adapter and the case named.
// Dependency-free: Node native TypeScript stripping and Bun both load the extensions directly.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import credentialsExtension from "../omp/extensions/flow-credentials-guard.ts";
import evidenceExtension from "../omp/extensions/flow-evidence-guard.ts";
import governanceExtension from "../omp/extensions/flow-governance-guard.ts";
import { latestRecord, readRecord } from "../opencode/plugins/flow-guard/record.ts";
import { setup as setupOpenCode } from "../opencode/plugins/flow-guard/setup.ts";
import { createHost } from "./opencode-plugin-host.mjs";

const table = JSON.parse(readFileSync(new URL("./fixtures/guard-cases.json", import.meta.url), "utf8"));
const SECRET_CWD = "/work/app";
const STATUS_KINDS = ["contract", "plan", "implementation", "acceptance"];

// --- OMP adapter -----------------------------------------------------------

const OMP_ROLES = {
	planner: "flow-planner",
	executor: "flow-plan-executor",
	implementer: "flow-implementer",
	mechanical: "sonic",
	verifier: "flow-evidence-verifier",
	reader: "scout",
};

const schema = {
	describe() {
		return this;
	},
	optional() {
		return this;
	},
};
const zod = {
	string: () => Object.create(schema),
	object: (shape) => shape,
};

// A fresh instance of the three extensions: their `tool_call` handlers and the `flow_gate` tool.
function loadOmp() {
	const handlers = [];
	let flowGate;
	const pi = {
		zod,
		registerTool(definition) {
			if (definition.name === "flow_gate") flowGate = definition;
		},
		on(event, handler) {
			if (event === "tool_call") handlers.push(handler);
		},
	};
	for (const extension of [credentialsExtension, evidenceExtension, governanceExtension]) extension(pi);
	assert.equal(handlers.length, 3, "omp: each guard must register a tool_call handler");
	assert.equal(flowGate?.name, "flow_gate", "omp: the governance guard must register flow_gate");
	return { handlers, flowGate };
}

// Refused when any handler blocks; the reasons of every blocking handler are joined.
async function ompCall(handlers, toolName, input, cwd) {
	const reasons = [];
	for (const handler of handlers) {
		const result = await handler({ toolName, input }, { cwd, hasUI: true });
		if (result?.block) reasons.push(result.reason);
	}
	return reasons.length > 0 ? { refused: true, reason: reasons.join("\n") } : { refused: false };
}

const secretGuards = loadOmp().handlers;

const ompAdapter = {
	name: "omp",
	read: (cwd, path) => ompCall(secretGuards, "read", { path }, cwd),
	grep: (cwd, dir, glob) => ompCall(secretGuards, "grep", { pattern: "TOKEN", path: glob === null ? dir : `${dir}/${glob}` }, cwd),
	shell: (cwd, command) => ompCall(secretGuards, "bash", { command }, cwd),
	open(root) {
		const { handlers, flowGate } = loadOmp();
		let cwd = root;
		const gate = (input) => flowGate.execute("guard-cases", input, undefined, undefined, { cwd, hasUI: true });
		return {
			setRoot(next) {
				cwd = next;
			},
			async approve(scope, items) {
				for (const { kind, path } of items) await gate({ action: "present", scope, kind, path, summary: `${kind} for ${scope}` });
				await gate({ action: "approve", scope, kind: items.map(({ kind }) => kind).join(",") });
			},
			async accept(scopes) {
				await gate({ action: "accept", scope: scopes.join(","), source: "guard-cases closure" });
			},
			dispatch: (role, brief) => ompCall(handlers, "task", { agent: OMP_ROLES[role], task: brief }, cwd),
			async status(scope) {
				const result = await gate({ action: "status", scope });
				return parseStatus(result.content.map(({ text }) => text).join("\n"));
			},
			recorded(scope, kind) {
				const path = join(cwd, ".flow/runtime/gates.json");
				if (!existsSync(path)) return undefined;
				const entry = JSON.parse(readFileSync(path, "utf8")).scopes?.[scope];
				return kind === "accept" ? entry?.acceptance?.fingerprint : entry?.approvals?.[kind]?.sha256;
			},
		};
	},
};

// --- OpenCode adapter --------------------------------------------------------

// A fresh plugin on a fresh host per call; a throw from `execute.before` is the refusal.
async function openCodeCall(cwd, tool, input) {
	const host = createHost({ directory: cwd });
	await setupOpenCode(host.ctx);
	const outcome = await host.call(tool, input);
	return outcome.refused === undefined ? { refused: false } : { refused: true, reason: outcome.refused };
}

// One plugin instance per scenario, as one OpenCode server; each prompt is answered `once`.
const OPENCODE_ROLES = {
	planner: "flow-planner",
	executor: "flow-plan-executor",
	implementer: "flow-implementer",
	mechanical: "general",
	verifier: "flow-evidence-verifier",
	reader: "explore",
};

function openOpenCode(root) {
	const host = createHost({ directory: root });
	const ready = setupOpenCode(host.ctx);
	const settle = (outcome, input) => {
		if (outcome.refused !== undefined) throw new Error(outcome.refused);
		if (outcome.error !== undefined) throw outcome.error;
		if (typeof outcome.result?.content !== "string") throw new Error(`flow_gate ${JSON.stringify(input)} returned no text`);
		return outcome.result.content;
	};
	const gate = async (input) => {
		await ready;
		return settle(await host.call("flow_gate", input), input);
	};
	const answered = async (input) => {
		await ready;
		const call = host.call("flow_gate", input);
		const first = await Promise.race([host.nextRequest().then((request) => ({ request })), call.then((outcome) => ({ outcome }))]);
		if (first.request === undefined) return settle(first.outcome, input);
		host.reply(first.request.id, "once");
		return settle(await call, input);
	};
	return {
		setRoot(next) {
			host.ctx.location.directory = next;
		},
		async approve(scope, items) {
			for (const { kind, path } of items) await gate({ action: "present", scope, kind, path, summary: `${kind} for ${scope}` });
			await answered({ action: "approve", scope, kind: items.map(({ kind }) => kind).join(",") });
		},
		async accept(scopes) {
			await answered({ action: "accept", scope: scopes.join(","), source: "case" });
		},
		dispatch: async (role, brief) => {
			await ready;
			const outcome = await host.call("subagent", { agent: OPENCODE_ROLES[role], description: "case", prompt: brief });
			return outcome.refused === undefined ? { refused: false } : { refused: true, reason: outcome.refused };
		},
		async status(scope) {
			return parseStatus(await gate({ action: "status", scope }));
		},
		recorded(scope, kind) {
			return latestRecord(readRecord(host.ctx.location.directory), scope, kind)?.digest;
		},
	};
}

const openCodeAdapter = {
	name: "opencode",
	read: (cwd, path) => openCodeCall(cwd, "read", { path }),
	grep: (cwd, dir, glob) => openCodeCall(cwd, "grep", glob === null ? { pattern: "x", path: dir } : { pattern: "x", path: dir, include: glob }),
	shell: (cwd, command) => openCodeCall(cwd, "shell", { command }),
	open: openOpenCode,
};

const adapters = [ompAdapter, openCodeAdapter];

// --- Runner ------------------------------------------------------------------

// The four words of a `Flow gate status` text, from its `<kind>: <word>` lines.
function parseStatus(text) {
	assert.match(text, /^Flow gate status/, `status text must start with "Flow gate status", got ${JSON.stringify(text)}`);
	const words = {};
	for (const line of text.split(/\r?\n/)) {
		const match = line.match(/^(contract|plan|implementation|acceptance): (\w+)/);
		if (match) words[match[1]] = match[2];
	}
	return words;
}

// Every adapter answers every section, so no port can skip one.
const ADAPTER_METHODS = ["read", "grep", "shell", "open"];
const GATE_METHODS = ["setRoot", "approve", "accept", "dispatch", "status", "recorded"];

function assertImplements(label, object, methods) {
	for (const method of methods) assert.equal(typeof object[method], "function", `${label} must implement ${method}`);
}

for (const adapter of adapters) assertImplements(`${adapter.name} adapter`, adapter, ADAPTER_METHODS);

function expectRefusal(result, refuse, name, label) {
	assert.equal(result.refused, refuse, `${label}: expected ${refuse ? "refuse" : "allow"}, got ${JSON.stringify(result)}`);
	if (refuse && name !== undefined) {
		assert.ok(result.reason?.includes(`(${name})`), `${label}: the refusal must name (${name}), got ${JSON.stringify(result.reason)}`);
	}
}

const counts = { secretRead: 0, secretGrep: 0, secretShell: 0, scenarios: 0, agreed: 0 };

for (const adapter of adapters) {
	for (const { path, refuse, name } of table.secretRead) {
		expectRefusal(await adapter.read(SECRET_CWD, path), refuse, name, `${adapter.name} secretRead ${JSON.stringify(path)}`);
		counts.secretRead += 1;
	}
}

for (const adapter of adapters) {
	for (const { dir, glob, refuse, name } of table.secretGrep) {
		expectRefusal(await adapter.grep(SECRET_CWD, dir, glob), refuse, name, `${adapter.name} secretGrep ${JSON.stringify([dir, glob])}`);
		counts.secretGrep += 1;
	}
}

for (const adapter of adapters) {
	for (const { command, refuse, name } of table.secretShell) {
		expectRefusal(await adapter.shell(SECRET_CWD, command), refuse, name, `${adapter.name} secretShell ${JSON.stringify(command)}`);
		counts.secretShell += 1;
	}
}

const gitIn = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

function fixtureRepository(unborn) {
	const root = mkdtempSync(join(tmpdir(), "flow-guard-cases-"));
	gitIn(root, ["init", "-q"]);
	gitIn(root, ["config", "user.email", "flow-test@example.invalid"]);
	gitIn(root, ["config", "user.name", "Flow Test"]);
	if (!unborn) {
		writeFileSync(join(root, "app.txt"), "v1\n");
		gitIn(root, ["add", "app.txt"]);
		gitIn(root, ["commit", "-qm", "base"]);
	}
	return root;
}

// After an approve or accept, every adapter must have stored the same digest or fingerprint.
function assertRecordedAgree(sessions, scope, kind, label) {
	const values = sessions.map(({ adapter, gate }) => [adapter.name, gate.recorded(scope, kind)]);
	for (const [name, value] of values) assert.ok(value !== undefined, `${label}: ${name} recorded no ${kind} for scope ${scope}`);
	const [, first] = values[0];
	for (const [name, value] of values) {
		assert.equal(value, first, `${label}: ${name} recorded ${kind} ${scope} as ${value}, ${values[0][0]} as ${first}`);
	}
	if (sessions.length > 1) counts.agreed += 1;
}

for (const scenario of table.scenarios) {
	let root = fixtureRepository(scenario.unborn);
	try {
		const sessions = adapters.map((adapter) => ({ adapter, gate: adapter.open(root) }));
		for (const { adapter, gate } of sessions) assertImplements(`${adapter.name} gate`, gate, GATE_METHODS);
		for (const [index, step] of scenario.steps.entries()) {
			const where = `${scenario.name} step ${index + 1}`;
			if (step.write) {
				for (const [path, content] of Object.entries(step.write)) {
					mkdirSync(dirname(join(root, path)), { recursive: true });
					writeFileSync(join(root, path), content);
				}
			} else if (step.git) {
				gitIn(root, step.git);
			} else if (step.move) {
				const moved = `${root}-moved`;
				renameSync(root, moved);
				root = moved;
				for (const { gate } of sessions) gate.setRoot(root);
			} else if (step.approve) {
				for (const { adapter, gate } of sessions) {
					await gate.approve(step.scope, step.approve).catch((error) => assert.fail(`${adapter.name} ${where}: approve failed: ${error.message}`));
				}
				for (const { kind } of step.approve) assertRecordedAgree(sessions, step.scope, kind, where);
			} else if (step.accept) {
				for (const { adapter, gate } of sessions) {
					await gate.accept(step.accept).catch((error) => assert.fail(`${adapter.name} ${where}: accept failed: ${error.message}`));
				}
				for (const scope of step.accept) assertRecordedAgree(sessions, scope, "accept", where);
			} else if (step.dispatch) {
				const { role, brief } = step.dispatch;
				for (const { adapter, gate } of sessions) {
					const label = `${adapter.name} ${where}: ${role} dispatch`;
					const result = await gate.dispatch(role, brief);
					expectRefusal(result, step.expect === "deny", undefined, label);
					if (step.expect === "deny" && step.reason !== undefined) {
						assert.match(result.reason, new RegExp(step.reason, "i"), `${label}: refusal reason`);
					}
				}
			} else if (step.status) {
				for (const { adapter, gate } of sessions) {
					const words = await gate.status(step.status);
					for (const kind of STATUS_KINDS.filter((item) => item in step.expect)) {
						assert.equal(words[kind], step.expect[kind], `${adapter.name} ${where}: status ${kind} for scope ${step.status}`);
					}
				}
			} else {
				assert.fail(`${where}: unknown step ${JSON.stringify(step)}`);
			}
		}
		counts.scenarios += 1;
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

assert.ok(counts.secretRead > 0 && counts.secretGrep > 0 && counts.secretShell > 0 && counts.scenarios > 0, "every section must run");
console.log(
	`guard cases: ${counts.secretRead} read, ${counts.secretGrep} grep, ${counts.secretShell} shell, ${counts.scenarios} scenarios, ${counts.agreed} recorded agreements`,
);
console.log(`ok: guard cases (${adapters.map(({ name }) => name).join(", ")})`);
