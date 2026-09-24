// Behavioral tests for Flow approval-revision and acceptance-state runtime gates.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import guardExtension from "../agent/extensions/flow-governance-guard.ts";

const schema = {
	describe() {
		return this;
	},
	optional() {
		return this;
	},
};
const z = {
	string: () => Object.create(schema),
	object: (shape) => shape,
};

let toolCall;
let flowGate;
guardExtension({
	zod: z,
	registerTool(definition) {
		if (definition.name === "flow_gate") flowGate = definition;
	},
	on(event, handler) {
		if (event === "tool_call") toolCall = handler;
	},
});

assert.equal(typeof toolCall, "function", "governance guard must register a tool_call handler");
assert.equal(flowGate?.name, "flow_gate", "governance guard must register the flow_gate tool");
assert.equal(flowGate.loadMode, "essential", "flow_gate must stay visible for governed Flow work");

const root = mkdtempSync(join(tmpdir(), "flow-governance-test-"));
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
try {
	git("init", "-q");
	git("config", "user.email", "flow-test@example.invalid");
	git("config", "user.name", "Flow Test");
	writeFileSync(join(root, "app.txt"), "v1\n");
	git("add", "app.txt");
	git("commit", "-qm", "test base");

	mkdirSync(join(root, ".flow/contracts"), { recursive: true });
	mkdirSync(join(root, ".flow/plans/demo"), { recursive: true });
	writeFileSync(join(root, ".flow/contracts/demo.md"), "# Contract\n\nBehavior A.\n");
	writeFileSync(join(root, ".flow/plans/demo/PLAN.md"), "# Plan\n\nTask A.\n");

	const ctx = { cwd: root, hasUI: true };
	const callTask = (input) => toolCall({ toolName: "task", input }, ctx);
	const callGate = (input, hasUI = true) => flowGate.execute("gate-1", input, undefined, undefined, { cwd: root, hasUI });

	const plannerTask = `# Plan it\n\nFlow gate:\n- Scope: demo\n- Contract: .flow/contracts/demo.md`;
	let result = await callTask({ agent: "flow-planner", task: plannerTask });
	assert.equal(result?.block, true, "planner dispatch must fail before contract approval");
	assert.match(result.reason, /no recorded contract approval/i);

	assert.equal(
		flowGate.approval({ action: "approve", scope: "demo", kind: "contract" }).policy,
		"deny",
		"approval without a presentation must fail closed",
	);

	await callGate({
		action: "present",
		scope: "demo",
		kind: "contract",
		path: ".flow/contracts/demo.md",
		summary: "Behavior A with its acceptance boundary.",
	});
	writeFileSync(join(root, ".flow/contracts/demo.md"), "# Contract\n\nBehavior A amended before approval.\n");
	const stalePresentationDecision = flowGate.approval({ action: "approve", scope: "demo", kind: "contract" });
	assert.equal(stalePresentationDecision.policy, "deny", "artifact changes after presentation must invalidate approval");
	assert.match(stalePresentationDecision.reason, /changed before approval/i);
	await callGate({
		action: "present",
		scope: "demo",
		kind: "contract",
		path: ".flow/contracts/demo.md",
		summary: "Behavior A amended before approval, now re-presented.",
	});
	const contractDecision = flowGate.approval({ action: "approve", scope: "demo", kind: "contract" });
	assert.equal(contractDecision.policy, "prompt", "contract approval must force a native user prompt even under yolo");
	assert.match(flowGate.formatApprovalDetails({ action: "approve", scope: "demo", kind: "contract" }).join("\n"), /SHA-256:/);
	await callGate({ action: "approve", scope: "demo", kind: "contract" });

	result = await callTask({ agent: "flow-planner", task: plannerTask });
	assert.equal(result, undefined, "planner dispatch must pass for the approved current contract revision");

	writeFileSync(join(root, ".flow/contracts/demo.md"), "# Contract\n\nBehavior B.\n");
	result = await callTask({ agent: "flow-planner", task: plannerTask });
	assert.equal(result?.block, true, "planner dispatch must fail when the contract changed after approval");
	assert.match(result.reason, /contract artifact changed after approval/i);

	await callGate({
		action: "present",
		scope: "demo",
		kind: "contract",
		path: ".flow/contracts/demo.md",
		summary: "Behavior B with its amended acceptance boundary.",
	});
	await callGate({ action: "approve", scope: "demo", kind: "contract" });
	await callGate({
		action: "present",
		scope: "demo",
		kind: "plan",
		path: ".flow/plans/demo/PLAN.md",
		summary: "One sequential execution task with focused proof.",
	});
	await callGate({ action: "approve", scope: "demo", kind: "plan" });

	const writerTask = `# Implement\n\nFlow gate:\n- Scope: demo\n- Contract: .flow/contracts/demo.md\n- Plan: .flow/plans/demo/PLAN.md`;
	result = await callTask({ agent: "flow-plan-executor", task: writerTask });
	assert.equal(result, undefined, "writer dispatch must pass with current contract and plan approvals");

	writeFileSync(join(root, ".flow/plans/demo/PLAN.md"), "# Plan\n\nTask B.\n");
	result = await callTask({ agent: "flow-plan-executor", task: writerTask });
	assert.equal(result?.block, true, "writer dispatch must fail when the plan changed after approval");
	assert.match(result.reason, /plan artifact changed after approval/i);

	await callGate({
		action: "present",
		scope: "demo",
		kind: "plan",
		path: ".flow/plans/demo/PLAN.md",
		summary: "Amended Task B execution plan.",
	});
	await callGate({ action: "approve", scope: "demo", kind: "plan" });

	const batchResult = await callTask({
		tasks: [
			{ agent: "flow-plan-executor", task: writerTask },
			{ agent: "flow-planner", task: plannerTask },
		],
	});
	assert.equal(batchResult, undefined, "batched governed tasks must pass when every manifest is current");

	await callGate({
		action: "present",
		scope: "demo-direct",
		kind: "contract",
		path: ".flow/contracts/demo.md",
		summary: "Tiny direct implementation contract.",
	});
	await callGate({ action: "approve", scope: "demo-direct", kind: "contract" });
	const directWriterTask = `# Tiny direct implementation\n\nFlow gate:\n- Scope: demo-direct\n- Contract: .flow/contracts/demo.md\n- Plan: NONE`;
	result = await callTask({ agent: "flow-implementer", task: directWriterTask });
	assert.equal(result?.block, true, "Plan NONE writer must still require direct implementation approval");
	assert.match(result.reason, /no recorded implementation approval/i);
	await callGate({
		action: "present",
		scope: "demo-direct",
		kind: "implementation",
		path: ".flow/contracts/demo.md",
		summary: "Authorize direct implementation against the approved current contract.",
	});
	await callGate({ action: "approve", scope: "demo-direct", kind: "implementation" });
	result = await callTask({ agent: "flow-implementer", task: directWriterTask });
	assert.equal(result, undefined, "Plan NONE writer must pass after implementation approval bound to current contract");

	const verifierTask = `# Verify\n\nFlow gate:\n- Scope: demo\n\nEvidence capsule:\n- ID: scene-a\n- Owns: current scene\n- Independent split check: none\n- Excludes: other scenes\n- Restore obligation: NONE`;
	result = await callTask({ agent: "flow-evidence-verifier", task: verifierTask });
	assert.equal(result?.block, true, "device evidence must fail before acceptance/closure is recorded");
	assert.match(result.reason, /no acceptance\/closure recorded/i);

	await assert.rejects(
		callGate({ action: "accept", scope: "demo", source: "acceptance-reviewer:ok" }, false),
		/interactive parent session/i,
		"headless agents must not mutate acceptance state",
	);
	await callGate({ action: "accept", scope: "demo", source: "acceptance-reviewer:ok" });

	result = await callTask({ agent: "flow-evidence-verifier", task: verifierTask });
	assert.equal(result, undefined, "device evidence must pass while repository state matches accepted state");

	writeFileSync(join(root, "app.txt"), "v2\n");
	result = await callTask({ agent: "flow-evidence-verifier", task: verifierTask });
	assert.equal(result?.block, true, "device evidence must fail after repository mutation stales acceptance");
	assert.match(result.reason, /repository state changed after acceptance\/closure/i);

	const status = await callGate({ action: "status", scope: "demo" });
	assert.match(status.content[0].text, /acceptance: stale/i, "status must surface stale acceptance");

	await callGate({ action: "clear", scope: "demo" });
	await callGate({ action: "clear", scope: "demo-direct" });
	const state = JSON.parse(readFileSync(join(root, ".flow/runtime/gates.json"), "utf8"));
	assert.deepEqual(state.scopes, {}, "clear must remove each integrated scope's gate state");

	const exclude = readFileSync(join(root, ".git/info/exclude"), "utf8");
	assert.match(exclude, /^\/\.flow\/$/m, "runtime state must enforce the normal .flow personal exclude guard");
} finally {
	rmSync(root, { recursive: true, force: true });
}

console.log("ok: flow governance runtime gates");
