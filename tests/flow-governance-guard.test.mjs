// Behavioral tests for Flow approval-revision and acceptance-state runtime gates.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import guardExtension from "../omp/extensions/flow-governance-guard.ts";

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
const nonGit = mkdtempSync(join(tmpdir(), "flow-governance-nogit-"));
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const caseRepos = [];
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
	assert.doesNotMatch(result.reason, /flow_gate accept must complete/i);

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
	const approvalDetails = flowGate.formatApprovalDetails({ action: "approve", scope: "demo", kind: "contract" });
	assert.match(
		approvalDetails[0],
		/Behavior A amended before approval, now re-presented\./,
		"the summary must lead the approval prompt: OMP's picker cuts later detail lines",
	);
	assert.match(approvalDetails.join("\n"), /\.flow\/contracts\/demo\.md/, "the approval prompt must name the artifact being approved");
	for (const summary of ["Line one\nline two", "x".repeat(81)]) {
		await assert.rejects(
			callGate({ action: "present", scope: "demo", kind: "contract", path: ".flow/contracts/demo.md", summary }),
			/one line of at most 80 characters/,
			"present must refuse a summary the approval prompt cannot show whole",
		);
	}
	assert.equal(
		flowGate.formatApprovalDetails({ action: "approve", scope: "demo", kind: "contract" })[0],
		approvalDetails[0],
		"a refused present must leave the current presentation in place",
	);
	assert.equal(
		flowGate.approval({ action: "accept", scope: "demo", source: "closure-1", summary: "x".repeat(81) }).policy,
		"deny",
		"accept must refuse a summary the approval prompt cannot show whole",
	);
	await callGate({ action: "approve", scope: "demo", kind: "contract" });
	const acceptDecision = flowGate.approval({ action: "accept", scope: "demo", source: "closure-1" });
	assert.equal(acceptDecision.policy, "prompt", "acceptance must force a native user prompt: it is user-attested, not controller-asserted");
	assert.match(
		flowGate.formatApprovalDetails({ action: "accept", scope: "demo", source: "closure-1" }).join("\n"),
		/closure-1/,
		"the acceptance prompt must name the receipt being attested",
	);
	assert.equal(flowGate.approval({ action: "accept", scope: "demo" }).policy, "deny", "acceptance without a source receipt must fail closed");
	assert.equal(flowGate.approval({ action: "clear", scope: "demo" }), "write", "clear stays a plain write");

	result = await callTask({ agent: "flow-planner", task: plannerTask });
	assert.equal(result, undefined, "planner dispatch must pass for the approved current contract revision");

	const codePlannerTask = `# Plan it\n\nFlow gate:\n- Scope: \`demo\`\n- Contract: \`.flow/contracts/demo.md\``;
	result = await callTask({ agent: "flow-planner", task: codePlannerTask });
	assert.equal(result, undefined, "planner dispatch must pass when Scope/Contract are wrapped in backticks");

	const quotedPlannerTask = `# Plan it\n\nFlow gate:\n- Scope: "demo"\n- Contract: '.flow/contracts/demo.md'`;
	result = await callTask({ agent: "flow-planner", task: quotedPlannerTask });
	assert.equal(result, undefined, "planner dispatch must pass when Scope/Contract are wrapped in matching quotes");

	const spacedCodePlannerTask = `# Plan it\n\nFlow gate:\n- Scope: \` demo \`\n- Contract: \` .flow/contracts/demo.md \``;
	result = await callTask({ agent: "flow-planner", task: spacedCodePlannerTask });
	assert.equal(result, undefined, "planner dispatch must pass when backtick-wrapped Scope/Contract carry inner spaces");

	const emptyScopeTask = `# Plan it\n\nFlow gate:\n- Scope: \`\`\n- Contract: .flow/contracts/demo.md`;
	result = await callTask({ agent: "flow-planner", task: emptyScopeTask });
	assert.equal(result?.block, true, "empty-after-strip Scope must be treated as absent");
	assert.match(result.reason, /must include Flow gate with Scope and Contract/i);

	const mismatchedScopeTask = `# Plan it\n\nFlow gate:\n- Scope: \`demo"\n- Contract: .flow/contracts/demo.md`;
	result = await callTask({ agent: "flow-planner", task: mismatchedScopeTask });
	assert.equal(result?.block, true, "mismatched wrapper must fail closed as an unknown scope");
	assert.match(result.reason, /no recorded contract approval/i);

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

	for (const agent of [" flow-implementer", "flow-plan-executor\n", "\tflow-planner ", " flow-evidence-verifier"]) {
		result = await callTask({ agent, task: "No manifest." });
		assert.equal(result?.block, true, `padded gated agent ${JSON.stringify(agent)} must still be gated`);
		assert.match(result.reason, /must include Flow gate/);
	}
	result = await callTask({ tasks: [{ agent: "scout", task: "a" }, { agent: " flow-implementer ", task: "No manifest." }] });
	assert.equal(result?.block, true, "padded gated agent inside a batch must still be gated");
	assert.match(result.reason, /tasks\[1\]: production writer task must include Flow gate/);

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

	const codeDirectWriterTask = `# Tiny direct implementation\n\nFlow gate:\n- Scope: demo-direct\n- Contract: .flow/contracts/demo.md\n- Plan: \`NONE\``;
	result = await callTask({ agent: "flow-implementer", task: codeDirectWriterTask });
	assert.equal(result, undefined, "Plan NONE writer must pass when the manifest value is backticked");

	await callGate({
		action: "present",
		scope: "demo-epic/unit-1",
		kind: "contract",
		path: ".flow/contracts/demo.md",
		summary: "In-flight unit contract under an epic/unit scope.",
	});
	await callGate({ action: "approve", scope: "demo-epic/unit-1", kind: "contract" });
	await callGate({
		action: "present",
		scope: "demo-epic/unit-1",
		kind: "plan",
		path: ".flow/plans/demo/PLAN.md",
		summary: "In-flight unit plan.",
	});
	await callGate({ action: "approve", scope: "demo-epic/unit-1", kind: "plan" });
	const unitWriterTask = `# Implement\n\nFlow gate:\n- Scope: demo-epic/unit-1\n- Contract: .flow/contracts/demo.md\n- Plan: .flow/plans/demo/PLAN.md`;
	result = await callTask({ agent: "flow-plan-executor", task: unitWriterTask });
	assert.equal(result, undefined, "an in-flight epic/unit scope must keep passing with current contract and plan approvals");

	const verifierTask = `# Verify\n\nFlow gate:\n- Scope: demo\n\nEvidence capsule:\n- ID: scene-a\n- Owns: current scene\n- Independent split check: none\n- Excludes: other scenes\n- Restore obligation: NONE`;
	result = await callTask({ agent: "flow-evidence-verifier", task: verifierTask });
	assert.equal(result?.block, true, "device evidence must fail before acceptance/closure is recorded");
	assert.match(result.reason, /no acceptance\/closure recorded/i);
	assert.match(result.reason, /flow_gate accept must complete before the dependent flow-evidence-verifier dispatch/i);
	assert.match(result.reason, /same parallel tool batch/i);

	const verifierNoScopeTask = `# Verify\n\nEvidence capsule:\n- ID: scene-a\n- Owns: current scene\n- Independent split check: none\n- Excludes: other scenes\n- Restore obligation: NONE`;
	result = await callTask({ agent: "flow-evidence-verifier", task: verifierNoScopeTask });
	assert.equal(result?.block, true, "verifier dispatch without a Scope line must be blocked");
	assert.match(result.reason, /flow-evidence-verifier task must include Flow gate with Scope/i);
	assert.doesNotMatch(result.reason, /flow_gate accept must complete before the dependent flow-evidence-verifier dispatch/i);

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
	assert.match(result.reason, /flow_gate accept must complete before the dependent flow-evidence-verifier dispatch/i);
	assert.match(result.reason, /same parallel tool batch/i);

	const status = await callGate({ action: "status", scope: "demo" });
	assert.match(status.content[0].text, /acceptance: stale/i, "status must surface stale acceptance");

	await callGate({ action: "clear", scope: "demo" });
	await callGate({ action: "clear", scope: "demo-direct" });
	await callGate({ action: "clear", scope: "demo-epic/unit-1" });
	const state = JSON.parse(readFileSync(join(root, ".flow/runtime/gates.json"), "utf8"));
	assert.deepEqual(state.scopes, {}, "clear must remove each integrated scope's gate state");

	const exclude = readFileSync(join(root, ".git/info/exclude"), "utf8");
	assert.match(exclude, /^\/\.flow\/$/m, "runtime state must enforce the normal .flow personal exclude guard");

	// Fresh repositories for acceptance-fingerprint edge cases. Each uses its own scope.
	const caseRepo = (commit = true) => {
		const dir = mkdtempSync(join(tmpdir(), "flow-governance-case-"));
		caseRepos.push(dir);
		const run = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
		run("init", "-q");
		run("config", "user.email", "flow-test@example.invalid");
		run("config", "user.name", "Flow Test");
		run("config", "maintenance.auto", "false");
		if (commit) {
			writeFileSync(join(dir, "app.txt"), "v1\n");
			run("add", "app.txt");
			run("commit", "-qm", "case base");
		}
		return { dir, run };
	};
	const gateIn = (dir, input) => flowGate.execute("gate-case", input, undefined, undefined, { cwd: dir, hasUI: true });
	const verifyIn = (dir, scope) =>
		toolCall({ toolName: "task", input: { agent: "flow-evidence-verifier", task: verifierTask.replace("- Scope: demo", `- Scope: ${scope}`) } }, { cwd: dir, hasUI: true });

	// A tracked diff larger than the default 1 MiB child-process buffer still counts.
	{
		const { dir } = caseRepo();
		writeFileSync(join(dir, "app.txt"), "x".repeat(64).concat("\n").repeat(32 * 1024));
		await gateIn(dir, { action: "accept", scope: "big-diff", source: "test" });
		assert.equal(await verifyIn(dir, "big-diff"), undefined, "an unchanged tree with a large tracked diff must keep its acceptance");
		writeFileSync(join(dir, "app.txt"), "y".repeat(64).concat("\n").repeat(32 * 1024));
		result = await verifyIn(dir, "big-diff");
		assert.equal(result?.block, true, "a change inside a >1 MiB tracked diff must stale acceptance");
		assert.match(result.reason, /repository state changed after acceptance\/closure/i);
	}

	// On an unborn HEAD, staged content is part of the fingerprint.
	{
		const { dir, run } = caseRepo(false);
		writeFileSync(join(dir, "a.txt"), "v1\n");
		run("add", "a.txt");
		await gateIn(dir, { action: "accept", scope: "unborn", source: "test" });
		assert.equal(await verifyIn(dir, "unborn"), undefined, "an unchanged unborn tree must keep its acceptance");
		writeFileSync(join(dir, "a.txt"), "v2\n");
		run("add", "a.txt");
		result = await verifyIn(dir, "unborn");
		assert.equal(result?.block, true, "a staged change on an unborn HEAD must stale acceptance");
		assert.match(result.reason, /repository state changed after acceptance\/closure/i);
	}

	// Any other git diff failure fails closed instead of hashing an empty diff.
	{
		const { dir, run } = caseRepo();
		const branchRef = run("symbolic-ref", "HEAD");
		writeFileSync(join(dir, ".git", branchRef), `${"1".repeat(40)}\n`);
		await assert.rejects(
			gateIn(dir, { action: "accept", scope: "bad-head", source: "test" }),
			/bad object/i,
			"accept must fail when git cannot diff against HEAD",
		);
	}

	// The first accept on a checkout without the .flow/ exclude does not hash .flow/**.
	{
		const { dir } = caseRepo();
		mkdirSync(join(dir, ".flow/contracts"), { recursive: true });
		writeFileSync(join(dir, ".flow/contracts/c.md"), "# Contract\n");
		assert.doesNotMatch(readFileSync(join(dir, ".git/info/exclude"), "utf8"), /^\/\.flow\/$/m, "precondition: no .flow exclude yet");
		await gateIn(dir, { action: "accept", scope: "first-accept", source: "test" });
		assert.equal(await verifyIn(dir, "first-accept"), undefined, "the verifier after a first accept on an unchanged tree must pass");
	}

	// An exclude file without a trailing newline keeps its last rule intact.
	{
		const { dir, run } = caseRepo();
		writeFileSync(join(dir, ".git/info/exclude"), "build/");
		mkdirSync(join(dir, "build"));
		writeFileSync(join(dir, "build/out.txt"), "artifact\n");
		mkdirSync(join(dir, ".flow"));
		writeFileSync(join(dir, ".flow/note.md"), "note\n");
		await gateIn(dir, { action: "accept", scope: "no-newline", source: "test" });
		assert.equal(readFileSync(join(dir, ".git/info/exclude"), "utf8"), "build/\n/.flow/\n", "the guard must add a newline before its entry");
		assert.equal(run("status", "--porcelain"), "", "both the user rule and .flow/ must stay ignored");
	}

	// Fixture for the fail-closed cases below: a case repository with one contract and one plan.
	const governedRepo = () => {
		const repo = caseRepo();
		mkdirSync(join(repo.dir, ".flow/contracts"), { recursive: true });
		mkdirSync(join(repo.dir, ".flow/plans/c"), { recursive: true });
		writeFileSync(join(repo.dir, ".flow/contracts/c.md"), "# Contract\n");
		writeFileSync(join(repo.dir, ".flow/plans/c/PLAN.md"), "# Plan\n");
		return repo;
	};
	const approveIn = async (dir, scope, kind, path) => {
		await gateIn(dir, { action: "present", scope, kind, path, summary: `${kind} for ${scope}` });
		await gateIn(dir, { action: "approve", scope, kind });
	};
	const dispatchIn = (dir, input) => toolCall({ toolName: "task", input }, { cwd: dir, hasUI: true });
	const stateIn = (dir) => JSON.parse(readFileSync(join(dir, ".flow/runtime/gates.json"), "utf8"));
	const writerIn = (scope, plan) => `# Implement\n\nFlow gate:\n- Scope: ${scope}\n- Contract: .flow/contracts/c.md\n- Plan: ${plan}`;

	// Re-approving the contract drops the plan, implementation and acceptance records.
	{
		const { dir } = governedRepo();
		await approveIn(dir, "cascade", "contract", ".flow/contracts/c.md");
		await approveIn(dir, "cascade", "plan", ".flow/plans/c/PLAN.md");
		await approveIn(dir, "cascade", "implementation", ".flow/contracts/c.md");
		await gateIn(dir, { action: "accept", scope: "cascade", source: "test" });
		assert.deepEqual(Object.keys(stateIn(dir).scopes.cascade.approvals).sort(), ["contract", "implementation", "plan"]);
		assert.ok(stateIn(dir).scopes.cascade.acceptance, "precondition: acceptance recorded");
		await approveIn(dir, "cascade", "contract", ".flow/contracts/c.md");
		const scopeState = stateIn(dir).scopes.cascade;
		assert.deepEqual(Object.keys(scopeState.approvals), ["contract"], "contract re-approval must drop plan and implementation approvals");
		assert.equal(scopeState.acceptance, undefined, "contract re-approval must drop acceptance");
		result = await dispatchIn(dir, { agent: "flow-plan-executor", task: writerIn("cascade", ".flow/plans/c/PLAN.md") });
		assert.equal(result?.block, true, "a writer must be blocked after the cascade dropped its plan approval");
		assert.match(result.reason, /no recorded plan approval/i);
	}

	// A contract and its plan presented together, then approved in either order, both stay approved:
	// the plan was approved against the presented contract revision (01a125e9#805-#814).
	{
		const { dir } = governedRepo();
		await gateIn(dir, { action: "present", scope: "batch", kind: "contract", path: ".flow/contracts/c.md", summary: "contract" });
		await gateIn(dir, { action: "present", scope: "batch", kind: "plan", path: ".flow/plans/c/PLAN.md", summary: "plan" });
		await gateIn(dir, { action: "approve", scope: "batch", kind: "plan" });
		await gateIn(dir, { action: "approve", scope: "batch", kind: "contract" });
		assert.deepEqual(Object.keys(stateIn(dir).scopes.batch.approvals).sort(), ["contract", "plan"], "a plan approved after the contract presentation must survive the contract approval");
		result = await dispatchIn(dir, { agent: "flow-plan-executor", task: writerIn("batch", ".flow/plans/c/PLAN.md") });
		assert.equal(result, undefined, "the writer must dispatch after a same-batch contract and plan approval");
	}

	// One approve covers every scope × kind pair the user's yes names, behind one prompt.
	{
		const { dir } = governedRepo();
		const present = (scope, kind, path, summary) => gateIn(dir, { action: "present", scope, kind, path, summary });
		await present("multi-kind", "contract", ".flow/contracts/c.md", "Contract for the multi-kind unit.");
		await present("multi-kind", "implementation", ".flow/contracts/c.md", "Direct implementation route.");
		const input = { action: "approve", scope: "multi-kind", kind: "contract,implementation" };
		const decision = flowGate.approval(input);
		assert.equal(decision.policy, "prompt", "two kinds for one scope must ask once");
		assert.match(decision.reason, /contract multi-kind/);
		assert.match(decision.reason, /implementation multi-kind/);
		const details = flowGate.formatApprovalDetails(input).join("\n");
		assert.match(details, /Contract for the multi-kind unit\./);
		assert.match(details, /Direct implementation route\./);
		assert.match(details, /each clears its scope's later records, as a single approval does/);
		const text = (await gateIn(dir, input)).content[0].text;
		assert.match(text, /contract multi-kind/);
		assert.match(text, /implementation multi-kind/);
		assert.deepEqual(Object.keys(stateIn(dir).scopes["multi-kind"].approvals).sort(), ["contract", "implementation"]);
		result = await dispatchIn(dir, { agent: "flow-implementer", task: writerIn("multi-kind", "NONE") });
		assert.equal(result, undefined, "the direct implementation route must dispatch after one approve of both kinds");
		assert.equal(flowGate.approval({ action: "approve", scope: "multi-kind", kind: "contract,bogus" }).policy, "deny", "an unknown kind in the list must deny");
		assert.match(flowGate.approval({ action: "approve", scope: "multi-kind", kind: "contract,bogus" }).reason, /requires scope and kind/);
	}

	// Two scopes in one approve.
	{
		const { dir } = governedRepo();
		await gateIn(dir, { action: "present", scope: "u1", kind: "contract", path: ".flow/contracts/c.md", summary: "u1 contract" });
		await gateIn(dir, { action: "present", scope: "u2", kind: "contract", path: ".flow/contracts/c.md", summary: "u2 contract" });
		const input = { action: "approve", scope: "u1, u2,u1", kind: "contract" };
		const decision = flowGate.approval(input);
		assert.equal(decision.policy, "prompt");
		assert.match(decision.reason, /^Approve 2 Flow artifacts: contract u1, contract u2\.$/);
		await gateIn(dir, input);
		assert.ok(stateIn(dir).scopes.u1.approvals.contract, "u1 contract must be recorded");
		assert.ok(stateIn(dir).scopes.u2.approvals.contract, "u2 contract must be recorded");
	}

	// A pair without a presentation denies the whole call and records nothing.
	{
		const { dir } = governedRepo();
		await gateIn(dir, { action: "present", scope: "multi-missing", kind: "contract", path: ".flow/contracts/c.md", summary: "c" });
		const input = { action: "approve", scope: "multi-missing", kind: "contract,plan" };
		const decision = flowGate.approval(input);
		assert.equal(decision.policy, "deny");
		assert.match(decision.reason, /multi-missing\/plan/);
		assert.doesNotMatch(decision.reason, /multi-missing\/contract/);
		await assert.rejects(gateIn(dir, input), /multi-missing\/plan/);
		assert.equal(existsSync(join(dir, ".flow/runtime/gates.json")), false, "a refused approve must record nothing");
	}

	// A pair whose artifact changed after presentation denies the whole call and records nothing.
	{
		const { dir } = governedRepo();
		await gateIn(dir, { action: "present", scope: "multi-changed", kind: "contract", path: ".flow/contracts/c.md", summary: "c" });
		await gateIn(dir, { action: "present", scope: "multi-changed", kind: "plan", path: ".flow/plans/c/PLAN.md", summary: "p" });
		writeFileSync(join(dir, ".flow/plans/c/PLAN.md"), "# Plan\n\nEdited.\n");
		const input = { action: "approve", scope: "multi-changed", kind: "contract,plan" };
		const decision = flowGate.approval(input);
		assert.equal(decision.policy, "deny");
		assert.match(decision.reason, /changed before approval/i);
		assert.match(decision.reason, /multi-changed\/plan/);
		await assert.rejects(gateIn(dir, input), /changed before approval/i);
		assert.equal(existsSync(join(dir, ".flow/runtime/gates.json")), false, "a refused approve must record nothing");
	}

	// A contract and its plan in one approve, in either order: both records stay.
	{
		const { dir } = governedRepo();
		await gateIn(dir, { action: "present", scope: "multi-both", kind: "contract", path: ".flow/contracts/c.md", summary: "c" });
		await gateIn(dir, { action: "present", scope: "multi-both", kind: "plan", path: ".flow/plans/c/PLAN.md", summary: "p" });
		const text = (await gateIn(dir, { action: "approve", scope: "multi-both", kind: "plan,contract" })).content[0].text;
		assert.ok(text.indexOf("contract multi-both") < text.indexOf("plan multi-both"), "pairs follow the contract, plan, implementation order");
		assert.deepEqual(Object.keys(stateIn(dir).scopes["multi-both"].approvals).sort(), ["contract", "plan"], "the contract approval must not drop the plan approved in the same call");
		result = await dispatchIn(dir, { agent: "flow-plan-executor", task: writerIn("multi-both", ".flow/plans/c/PLAN.md") });
		assert.equal(result, undefined);
	}

	// accept takes several scopes behind one prompt.
	{
		const { dir } = caseRepo();
		const input = { action: "accept", scope: "acc1,acc2", source: "closure" };
		const decision = flowGate.approval(input);
		assert.equal(decision.policy, "prompt");
		assert.match(decision.reason, /acc1/);
		assert.match(decision.reason, /acc2/);
		await gateIn(dir, input);
		assert.equal(await verifyIn(dir, "acc1"), undefined, "acc1 must be accepted");
		assert.equal(await verifyIn(dir, "acc2"), undefined, "acc2 must be accepted");
	}

	// present, status and clear take one scope.
	{
		const { dir } = governedRepo();
		for (const input of [
			{ action: "status", scope: "a,b" },
			{ action: "clear", scope: "a,b" },
			{ action: "present", scope: "a,b", kind: "contract", path: ".flow/contracts/c.md", summary: "s" },
		]) {
			await assert.rejects(gateIn(dir, input), new RegExp(`Flow gate ${input.action} takes one scope\\.`));
		}
	}

	// A dispatch that meets a presented but unrecorded approval says so, instead of blaming the artifact.
	{
		const { dir } = governedRepo();
		await approveIn(dir, "same-batch", "contract", ".flow/contracts/c.md");
		await approveIn(dir, "same-batch", "plan", ".flow/plans/c/PLAN.md");
		writeFileSync(join(dir, ".flow/plans/c/PLAN.md"), "# Plan\n\nRevised.\n");
		await gateIn(dir, { action: "present", scope: "same-batch", kind: "plan", path: ".flow/plans/c/PLAN.md", summary: "p" });
		result = await dispatchIn(dir, { agent: "flow-plan-executor", task: writerIn("same-batch", ".flow/plans/c/PLAN.md") });
		assert.equal(result?.block, true);
		assert.match(result.reason, /presented but not recorded yet/);
		assert.match(result.reason, /same tool batch/);
		assert.doesNotMatch(result.reason, /changed after approval/);

		await approveIn(dir, "same-batch-new", "contract", ".flow/contracts/c.md");
		await gateIn(dir, { action: "present", scope: "same-batch-new", kind: "plan", path: ".flow/plans/c/PLAN.md", summary: "p" });
		result = await dispatchIn(dir, { agent: "flow-plan-executor", task: writerIn("same-batch-new", ".flow/plans/c/PLAN.md") });
		assert.equal(result?.block, true);
		assert.match(result.reason, /scope same-batch-new: plan approval is presented but not recorded yet/);
		assert.doesNotMatch(result.reason, /no recorded plan approval/);
	}

	// The gate block ends at the first non-bullet line; a later `- Contract:` bullet in the brief is not a manifest value (01a13341#32).
	{
		const { dir } = governedRepo();
		await approveIn(dir, "inputs", "contract", ".flow/contracts/c.md");
		await approveIn(dir, "inputs", "plan", ".flow/plans/c/PLAN.md");
		const brief = `${writerIn("inputs", ".flow/plans/c/PLAN.md")}\n\n# Inputs\n- Contract: \`.flow/contracts/c.md\` (approved). Parent: \`.flow/contracts/parent.md\`\n- Plan: see above`;
		result = await dispatchIn(dir, { agent: "flow-plan-executor", task: brief });
		assert.equal(result, undefined, "bullets after the gate block must not override its values");
		const spaced = `Flow gate:\n\n- Scope: inputs\n- Contract: .flow/contracts/c.md\n\n- Plan: .flow/plans/c/PLAN.md\nImplement it.`;
		result = await dispatchIn(dir, { agent: "flow-plan-executor", task: spaced });
		assert.equal(result, undefined, "blank lines inside the block must not end it");
	}

	// A manifest that names a different artifact than the approved one is rejected.
	{
		const { dir } = governedRepo();
		mkdirSync(join(dir, ".flow/plans/other"), { recursive: true });
		writeFileSync(join(dir, ".flow/plans/other/PLAN.md"), "# Plan\n");
		await approveIn(dir, "path", "contract", ".flow/contracts/c.md");
		await approveIn(dir, "path", "plan", ".flow/plans/c/PLAN.md");
		result = await dispatchIn(dir, { agent: "flow-plan-executor", task: writerIn("path", ".flow/plans/other/PLAN.md") });
		assert.equal(result?.block, true, "a writer naming an unapproved plan path must be blocked");
		assert.match(result.reason, /plan path is not the approved artifact/i);
	}

	// Approval records store the artifact path relative to the repository root, so they survive a folder move.
	{
		const { dir } = governedRepo();
		await approveIn(dir, "moved", "contract", ".flow/contracts/c.md");
		await approveIn(dir, "moved", "plan", ".flow/plans/c/PLAN.md");
		const approvals = stateIn(dir).scopes.moved.approvals;
		assert.equal(approvals.contract.path, ".flow/contracts/c.md", "a contract approval must record its path relative to the repository root");
		assert.equal(approvals.plan.path, ".flow/plans/c/PLAN.md", "a plan approval must record its path relative to the repository root");
		const moved = `${dir}-moved`;
		renameSync(dir, moved);
		caseRepos.push(moved);
		result = await dispatchIn(moved, { agent: "flow-plan-executor", task: writerIn("moved", ".flow/plans/c/PLAN.md") });
		assert.equal(result, undefined, "a writer must dispatch after the checkout folder moved");
		const status = (await gateIn(moved, { action: "status", scope: "moved" })).content[0].text;
		assert.match(status, /contract: current \(\.flow\/contracts\/c\.md\)/, "status must see the contract approval as current after a folder move");
		assert.match(status, /plan: current \(\.flow\/plans\/c\/PLAN\.md\)/, "status must see the plan approval as current after a folder move");
	}

	// An older record holding an absolute path is read from its last /.flow/ segment on.
	{
		const { dir } = governedRepo();
		const digest = (rel) => createHash("sha256").update(readFileSync(join(dir, rel))).digest("hex");
		const record = (path, rel) => ({ path, sha256: digest(rel), approvedAt: new Date().toISOString() });
		const writeOld = (contractPath, planPath) => {
			mkdirSync(join(dir, ".flow/runtime"), { recursive: true });
			const approvals = {
				contract: record(contractPath, ".flow/contracts/c.md"),
				plan: record(planPath, ".flow/plans/c/PLAN.md"),
			};
			writeFileSync(join(dir, ".flow/runtime/gates.json"), JSON.stringify({ version: 1, scopes: { old: { approvals } } }));
		};
		writeOld("/gone/elsewhere/.flow/contracts/c.md", "/gone/elsewhere/.flow/plans/c/PLAN.md");
		result = await dispatchIn(dir, { agent: "flow-plan-executor", task: writerIn("old", ".flow/plans/c/PLAN.md") });
		assert.equal(result, undefined, "an older absolute record under a moved checkout must still bind");

		writeOld("/gone/elsewhere/contracts/c.md", "/gone/elsewhere/.flow/plans/c/PLAN.md");
		result = await dispatchIn(dir, { agent: "flow-plan-executor", task: writerIn("old", ".flow/plans/c/PLAN.md") });
		assert.equal(result?.block, true, "an older absolute record without a /.flow/ segment must not bind");
		assert.match(result.reason, /contract path is not the approved artifact/i);
	}

	// Lines under a plan's `## In-scope amendments` heading stay outside its digest; everything through the heading line is material.
	{
		const heading = "## In-scope amendments\n";
		const planPath = ".flow/plans/c/PLAN.md";
		const amendedRepo = (plan = `# Plan\n\nTask A.\n\n${heading}`) => {
			const repo = governedRepo();
			writeFileSync(join(repo.dir, planPath), plan);
			return repo;
		};
		const approvePlan = async (dir, scope) => {
			await approveIn(dir, scope, "contract", ".flow/contracts/c.md");
			await approveIn(dir, scope, "plan", planPath);
		};
		const append = (dir, rel, text) => writeFileSync(join(dir, rel), readFileSync(join(dir, rel), "utf8") + text);
		const statusText = async (dir, scope) => (await gateIn(dir, { action: "status", scope })).content[0].text;

		{
			const { dir } = amendedRepo();
			await approvePlan(dir, "amend");
			assert.match(await statusText(dir, "amend"), /^plan: current \(\.flow\/plans\/c\/PLAN\.md\)$/m, "a plan with nothing under the heading shows no amendment count");
			append(dir, planPath, "- task 03: fix the test command\n");
			result = await dispatchIn(dir, { agent: "flow-plan-executor", task: writerIn("amend", planPath) });
			assert.equal(result, undefined, "a line under the heading must leave the plan approval current");
			assert.match(await statusText(dir, "amend"), /^plan: current \(\.flow\/plans\/c\/PLAN\.md, in-scope amendments: 1\)$/m);
			append(dir, planPath, "\n- task 04: rename a helper\n");
			assert.match(await statusText(dir, "amend"), /in-scope amendments: 2\)$/m, "blank lines under the heading are not counted");
		}

		{
			const { dir } = amendedRepo();
			await approvePlan(dir, "above");
			writeFileSync(join(dir, planPath), `# Plan\n\nTask B.\n\n${heading}`);
			result = await dispatchIn(dir, { agent: "flow-plan-executor", task: writerIn("above", planPath) });
			assert.equal(result?.block, true, "a byte above the heading is material");
			assert.match(result.reason, /plan artifact changed after approval/);
		}

		{
			const { dir } = amendedRepo();
			await approvePlan(dir, "heading");
			writeFileSync(join(dir, planPath), "# Plan\n\nTask A.\n\n## In-scope amendments (2)\n- task 03: fix\n");
			result = await dispatchIn(dir, { agent: "flow-plan-executor", task: writerIn("heading", planPath) });
			assert.equal(result?.block, true, "editing the heading line is material");
			assert.match(result.reason, /plan artifact changed after approval/);
		}

		{
			const { dir } = amendedRepo();
			writeFileSync(join(dir, ".flow/contracts/c.md"), `# Contract\n\n${heading}`);
			await approveIn(dir, "whole", "contract", ".flow/contracts/c.md");
			append(dir, ".flow/contracts/c.md", "- outcome 2: widened\n");
			result = await dispatchIn(dir, { agent: "flow-planner", task: "Flow gate:\n- Scope: whole\n- Contract: .flow/contracts/c.md" });
			assert.equal(result?.block, true, "a contract is hashed whole, heading or not");
			assert.match(result.reason, /contract artifact changed after approval/);
		}

		{
			const { dir } = amendedRepo("# Plan\n\nTask A.\n");
			await approvePlan(dir, "none");
			append(dir, planPath, `\n${heading}- task 03: fix\n`);
			result = await dispatchIn(dir, { agent: "flow-plan-executor", task: writerIn("none", planPath) });
			assert.equal(result?.block, true, "a plan approved without the heading gets no exemption");
			assert.match(result.reason, /plan artifact changed after approval/);
		}

		{
			const fenced = (decision) => `# Plan\n\n\`\`\`text\n${heading}\`\`\`\n\n- L1: ${decision}\n\n${heading}`;
			const { dir } = amendedRepo(fenced("polling"));
			await approvePlan(dir, "fenced");
			const amendment = "- task 03: fix the test command\n";
			append(dir, planPath, amendment);
			result = await dispatchIn(dir, { agent: "flow-plan-executor", task: writerIn("fenced", planPath) });
			assert.equal(result, undefined, "a line under the last heading leaves the plan approval current");
			assert.match(await statusText(dir, "fenced"), /in-scope amendments: 1\)$/m, "only lines under the last heading are counted");
			writeFileSync(join(dir, planPath), fenced("push") + amendment);
			result = await dispatchIn(dir, { agent: "flow-plan-executor", task: writerIn("fenced", planPath) });
			assert.equal(result?.block, true, "a decision after an earlier heading line is material");
			assert.match(result.reason, /plan artifact changed after approval/);
		}

		{
			const { dir } = amendedRepo();
			await approvePlan(dir, "second");
			append(dir, planPath, `${heading}- L1: push\n`);
			result = await dispatchIn(dir, { agent: "flow-plan-executor", task: writerIn("second", planPath) });
			assert.equal(result?.block, true, "a second heading line under the first moves the boundary");
			assert.match(result.reason, /plan artifact changed after approval/);
		}

		for (const near of ["### In-scope amendments\n", "## In-scope amendments (draft)\n", "## In-scope amendments  \n", "## In-scope amendments\r\n", "x## In-scope amendments\n"]) {
			const { dir } = amendedRepo(`# Plan\n\n${near}`);
			await approvePlan(dir, "near");
			append(dir, planPath, "- task 03: fix\n");
			result = await dispatchIn(dir, { agent: "flow-plan-executor", task: writerIn("near", planPath) });
			assert.equal(result?.block, true, `${JSON.stringify(near)} is not the heading: the plan is hashed whole`);
			assert.match(result.reason, /plan artifact changed after approval/);
		}

		{
			const { dir } = amendedRepo();
			const whole = (rel) => createHash("sha256").update(readFileSync(join(dir, rel))).digest("hex");
			const record = (path) => ({ path, sha256: whole(path), approvedAt: new Date().toISOString() });
			mkdirSync(join(dir, ".flow/runtime"), { recursive: true });
			const approvals = { contract: record(".flow/contracts/c.md"), plan: record(planPath) };
			writeFileSync(join(dir, ".flow/runtime/gates.json"), JSON.stringify({ version: 1, scopes: { legacy: { approvals } } }));
			result = await dispatchIn(dir, { agent: "flow-plan-executor", task: writerIn("legacy", planPath) });
			assert.equal(result, undefined, "an old whole-file record of a plan ending with the bare heading stays current");
			append(dir, planPath, "- task 03: fix\n");
			result = await dispatchIn(dir, { agent: "flow-plan-executor", task: writerIn("legacy", planPath) });
			assert.equal(result, undefined, "and stays current after a line under the heading");
		}

		{
			const { dir } = amendedRepo();
			await gateIn(dir, { action: "present", scope: "pres", kind: "plan", path: planPath, summary: "p" });
			append(dir, planPath, "- task 03: fix\n");
			assert.equal(flowGate.approval({ action: "approve", scope: "pres", kind: "plan" }).policy, "prompt", "a line under the heading keeps the presentation current");
			await gateIn(dir, { action: "approve", scope: "pres", kind: "plan" });
			assert.match(await statusText(dir, "pres"), /plan: current \(\.flow\/plans\/c\/PLAN\.md, in-scope amendments: 1\)/);

			await gateIn(dir, { action: "present", scope: "pres-above", kind: "plan", path: planPath, summary: "p" });
			writeFileSync(join(dir, planPath), readFileSync(join(dir, planPath), "utf8").replace("Task A.", "Task B."));
			const decision = flowGate.approval({ action: "approve", scope: "pres-above", kind: "plan" });
			assert.equal(decision.policy, "deny");
			assert.match(decision.reason, /changed before approval/);
			await assert.rejects(gateIn(dir, { action: "approve", scope: "pres-above", kind: "plan" }), /changed before approval/);
		}
	}

	// Corrupt or unsupported gate state fails closed.
	for (const [content, pattern] of [
		["{", /failed closed/i],
		[JSON.stringify({ version: 2, scopes: {} }), /Unsupported Flow gate state/],
		[JSON.stringify({ version: 1 }), /Unsupported Flow gate state/],
	]) {
		const { dir } = governedRepo();
		await approveIn(dir, "corrupt", "contract", ".flow/contracts/c.md");
		writeFileSync(join(dir, ".flow/runtime/gates.json"), content);
		result = await dispatchIn(dir, { agent: "flow-planner", task: "Flow gate:\n- Scope: corrupt\n- Contract: .flow/contracts/c.md" });
		assert.equal(result?.block, true, `gate state ${JSON.stringify(content)} must block dispatch`);
		assert.match(result.reason, pattern);
		await assert.rejects(gateIn(dir, { action: "status", scope: "corrupt" }), Error, "status must fail on the same gate state");
	}

	// present accepts only artifacts that stay below .flow/.
	{
		const { dir } = governedRepo();
		await assert.rejects(
			gateIn(dir, { action: "present", scope: "outside", kind: "contract", path: "app.txt", summary: "s" }),
			/does not exist: .*\.flow[\\/]app\.txt/,
			"a bare relative path resolves below .flow/, so a file that only exists at the repository root is not an artifact",
		);
		symlinkSync("../app.txt", join(dir, ".flow/escape.md"));
		await assert.rejects(
			gateIn(dir, { action: "present", scope: "outside", kind: "contract", path: ".flow/escape.md", summary: "s" }),
			/escapes/,
			"present must refuse a .flow/ symlink that resolves outside .flow/",
		);
	}

	// Artifact paths written relative to .flow/ resolve like their .flow/-prefixed spelling.
	{
		const { dir } = governedRepo();
		const present = (path) => gateIn(dir, { action: "present", scope: "short", kind: "contract", path, summary: "s" });
		const full = (await present(".flow/contracts/c.md")).details?.path;
		assert.ok(full, "precondition: present reports the artifact path");
		for (const path of ["contracts/c.md", "./contracts/c.md", "./.flow/contracts/c.md", join(dir, ".flow/contracts/c.md")]) {
			assert.equal((await present(path)).details?.path, full, `present ${path} must record the same artifact as .flow/contracts/c.md`);
		}

		await gateIn(dir, { action: "approve", scope: "short", kind: "contract" });
		assert.match((await gateIn(dir, { action: "status", scope: "short" })).content[0].text, /contract: current/, "status must see the short-form approval as current");
		assert.equal(stateIn(dir).scopes.short.approvals.contract.path, ".flow/contracts/c.md", "approval must bind to the same artifact");
		const shortPlanner = "Flow gate:\n- Scope: short\n- Contract: contracts/c.md";
		assert.equal(await dispatchIn(dir, { agent: "flow-planner", task: shortPlanner }), undefined, "a planner manifest using the short Contract form must bind to the approval");

		await approveIn(dir, "short", "plan", "plans/c/PLAN.md");
		assert.equal(stateIn(dir).scopes.short.approvals.plan.path, ".flow/plans/c/PLAN.md", "a short-form plan must bind too");
		assert.equal(
			await dispatchIn(dir, { agent: "flow-plan-executor", task: "Flow gate:\n- Scope: short\n- Contract: contracts/c.md\n- Plan: plans/c/PLAN.md" }),
			undefined,
			"a writer manifest using short Contract and Plan forms must bind to the approvals",
		);

		writeFileSync(join(dir, ".flow/contracts/c.md"), "# Contract\n\nchanged\n");
		result = await dispatchIn(dir, { agent: "flow-planner", task: shortPlanner });
		assert.equal(result?.block, true, "the short form must still see a changed artifact");
		assert.match(result.reason, /contract artifact changed after approval/i);

		result = await dispatchIn(dir, { agent: "flow-planner", task: "Flow gate:\n- Scope: short\n- Contract: nope/c.md" });
		assert.equal(result?.block, true, "a short path that names nothing must block");
		assert.match(result.reason, /does not exist/);
	}

	// Nothing outside .flow/ becomes an artifact, whichever way the path is spelled.
	{
		const { dir } = governedRepo();
		const outside = mkdtempSync(join(tmpdir(), "flow-governance-outside-"));
		caseRepos.push(outside);
		writeFileSync(join(outside, "x.md"), "outside\n");
		writeFileSync(join(dir, "x.md"), "root\n");
		symlinkSync(outside, join(dir, ".flow/out"));
		symlinkSync(join(outside, "x.md"), join(dir, ".flow/contracts/link.md"));
		for (const [path, pattern] of [
			["../x.md", /must live below/],
			["./../x.md", /must live below/],
			[".flow/../x.md", /must live below/],
			["contracts/../../x.md", /must live below/],
			[join(dir, "x.md"), /must live below/],
			[join(outside, "x.md"), /must live below/],
			[".flow", /must live below/],
			// POSIX `resolve` keeps `\` in a name, so the base choice must not read it as a separator.
			[".flow\\..\\x.md", /does not exist/],
			["contracts\\c.md", /does not exist/],
			["", /requires kind, path, and summary/],
			["out/x.md", /escapes/],
			[".flow/out/x.md", /escapes/],
			["contracts/link.md", /escapes/],
		]) {
			await assert.rejects(
				gateIn(dir, { action: "present", scope: "esc", kind: "contract", path, summary: "s" }),
				pattern,
				`present ${JSON.stringify(path)} must be refused`,
			);
		}
		await assert.rejects(
			gateIn(dir, { action: "present", scope: "esc", kind: "contract", path: "../x.md", summary: "s" }),
			/\.flow\/contracts\/<slug>\.md.*contracts\/<slug>\.md/s,
			"the path error must name both accepted forms",
		);
		result = await dispatchIn(dir, { agent: "flow-planner", task: "Flow gate:\n- Scope: esc\n- Contract: ../x.md" });
		assert.equal(result?.block, true, "a manifest path that escapes .flow/ must block dispatch");
	}

	// The Flow gate block may sit in the call's shared context; the task's own block wins.
	{
		const { dir } = governedRepo();
		await approveIn(dir, "ctx", "contract", "contracts/c.md");
		await approveIn(dir, "ctx", "plan", "plans/c/PLAN.md");
		const block = (scope, extra = "") => `Flow gate:\n- Scope: ${scope}\n- Contract: .flow/contracts/c.md\n- Plan: .flow/plans/c/PLAN.md${extra}`;
		const shared = (scope) => `Shared brief.\n\n${block(scope)}`;
		const verifierBody = "# Verify\n\nEvidence capsule:\n- ID: a\n- Owns: a\n- Independent split check: none\n- Excludes: b\n- Restore obligation: NONE";

		// planner, writer and verifier read the block from context
		await gateIn(dir, { action: "accept", scope: "ctx", source: "test" });
		result = await dispatchIn(dir, {
			context: shared("ctx"),
			tasks: [
				{ agent: "flow-planner", task: "Plan it." },
				{ agent: "flow-plan-executor", task: "Implement it." },
				{ agent: "flow-evidence-verifier", task: verifierBody },
			],
		});
		assert.equal(result, undefined, "planner, writer and verifier must pass with the block only in context");
		result = await dispatchIn(dir, { agent: "flow-planner", context: shared("ctx"), task: "Plan it." });
		assert.equal(result, undefined, "a single-task call must read the block from context too");

		// the same reasons fail it as when the block sits in the task text
		result = await dispatchIn(dir, { context: shared("unknown"), tasks: [{ agent: "flow-planner", task: "Plan it." }] });
		assert.equal(result?.block, true, "an unapproved scope in context must block");
		assert.match(result.reason, /tasks\[0\]: scope unknown: no recorded contract approval/);
		result = await dispatchIn(dir, { context: shared("unknown"), tasks: [{ agent: "flow-plan-executor", task: "Implement it." }] });
		assert.match(result?.reason ?? "", /scope unknown: no recorded contract approval/);
		result = await dispatchIn(dir, { context: shared("unknown"), tasks: [{ agent: "flow-evidence-verifier", task: verifierBody }] });
		assert.match(result?.reason ?? "", /scope unknown: no acceptance\/closure recorded/);
		result = await dispatchIn(dir, { context: "Flow gate:\n- Scope: ctx\n- Contract: .flow/contracts/c.md", tasks: [{ agent: "flow-plan-executor", task: "Implement it." }] });
		assert.match(result?.reason ?? "", /production writer task must include Flow gate with Scope, Contract, and Plan/, "an incomplete block in context must fail as an incomplete block in the task would");
		writeFileSync(join(dir, "app.txt"), "dirty\n");
		result = await dispatchIn(dir, { context: shared("ctx"), tasks: [{ agent: "flow-evidence-verifier", task: verifierBody }] });
		assert.match(result?.reason ?? "", /repository state changed after acceptance\/closure/);
		writeFileSync(join(dir, "app.txt"), "v1\n");

		// backticked and quoted values keep working in context
		for (const wrap of ["`", '"', "'"]) {
			const wrapped = `Flow gate:\n- Scope: ${wrap}ctx${wrap}\n- Contract: ${wrap}contracts/c.md${wrap}\n- Plan: ${wrap}plans/c/PLAN.md${wrap}`;
			result = await dispatchIn(dir, { context: wrapped, tasks: [{ agent: "flow-plan-executor", task: "Implement it." }] });
			assert.equal(result, undefined, `values wrapped in ${wrap} must pass in context`);
		}

		// the task's own block wins, in both directions, and is never merged with context
		result = await dispatchIn(dir, { context: shared("stale"), tasks: [{ agent: "flow-planner", task: block("ctx") }] });
		assert.equal(result, undefined, "a current block in the task must win over a stale block in context");
		result = await dispatchIn(dir, { context: shared("ctx"), tasks: [{ agent: "flow-planner", task: block("stale") }] });
		assert.equal(result?.block, true, "a stale block in the task must win over a current block in context");
		assert.match(result.reason, /scope stale: no recorded contract approval/);
		result = await dispatchIn(dir, { context: shared("ctx"), tasks: [{ agent: "flow-plan-executor", task: "Flow gate:\n- Scope: ctx" }] });
		assert.equal(result?.block, true, "a partial block in the task must not borrow fields from context");
		assert.match(result.reason, /production writer task must include Flow gate with Scope, Contract, and Plan/);
		result = await dispatchIn(dir, {
			context: shared("ctx"),
			tasks: [{ agent: "flow-planner", task: "Plan it." }, { agent: "flow-planner", task: block("stale") }],
		});
		assert.match(result?.reason ?? "", /tasks\[1\]: scope stale/, "each task picks its own block");
		assert.doesNotMatch(result.reason, /tasks\[0\]/);

		// no block anywhere is still blocked, and says where it may sit
		for (const input of [
			{ agent: "flow-planner", task: "Plan it." },
			{ agent: "flow-planner", context: "Background only.", task: "Plan it." },
			{ context: "Background only.", tasks: [{ agent: "flow-plan-executor", task: "Implement it." }] },
			{ context: "Background only.", tasks: [{ agent: "flow-evidence-verifier", task: verifierBody }] },
			{ context: "Flow gate:\n- Scope: ctx", tasks: [{ agent: "flow-planner", task: "Plan it." }] },
			{ context: 7, tasks: [{ agent: "flow-planner", task: "Plan it." }] },
		]) {
			result = await dispatchIn(dir, input);
			assert.equal(result?.block, true, `${JSON.stringify(input)} must be blocked`);
			assert.match(result.reason, /must include Flow gate/);
			assert.match(result.reason, /task text or the shared context/i, "the error must say the block may sit in the shared context");
		}

		// context never gates an ungated agent
		assert.equal(await dispatchIn(dir, { context: shared("stale"), tasks: [{ agent: "scout", task: "Look." }] }), undefined);

		// OMP un-escapes a double-encoded task or context after the hook runs, so the guard reads the repaired text.
		const doubleEncoded = (text) => JSON.stringify(text).slice(1, -1);
		result = await dispatchIn(dir, { context: shared("ctx"), tasks: [{ agent: "flow-planner", task: doubleEncoded(block("stale")) }] });
		assert.equal(result?.block, true, "a double-encoded task block must not fall back to a current block in context");
		assert.match(result.reason, /scope stale: no recorded contract approval/);
		result = await dispatchIn(dir, { context: shared("stale"), tasks: [{ agent: "flow-planner", task: doubleEncoded(block("ctx")) }] });
		assert.equal(result, undefined, "a double-encoded current block in the task must win over a stale block in context");
		result = await dispatchIn(dir, { context: doubleEncoded(shared("ctx")), tasks: [{ agent: "flow-planner", task: "Plan it." }] });
		assert.equal(result, undefined, "a double-encoded block in context must be read");
		result = await dispatchIn(dir, { context: doubleEncoded(shared("stale")), tasks: [{ agent: "flow-planner", task: "Plan it." }] });
		assert.match(result?.reason ?? "", /scope stale: no recorded contract approval/, "a double-encoded stale block in context must fail like a plain one");
		result = await dispatchIn(dir, { agent: "flow-planner", task: doubleEncoded(block("stale")) });
		assert.match(result?.reason ?? "", /scope stale: no recorded contract approval/, "a single double-encoded task must be read too");
	}

	// A `sonic` that carries a Flow gate block, in its task or the shared context, is a writer on gated work.
	{
		const { dir } = governedRepo();
		await approveIn(dir, "sonic", "contract", ".flow/contracts/c.md");
		await approveIn(dir, "sonic", "plan", ".flow/plans/c/PLAN.md");
		const block = (scope) => `Flow gate:\n- Scope: ${scope}\n- Contract: .flow/contracts/c.md\n- Plan: .flow/plans/c/PLAN.md`;

		result = await dispatchIn(dir, { agent: "sonic", task: `# Do it\n\n${block("unapproved")}` });
		assert.equal(result?.block, true, "a sonic with a block for an unapproved scope must be blocked");
		assert.match(result.reason, /scope unapproved: no recorded contract approval/);

		result = await dispatchIn(dir, { context: `Shared.\n\n${block("unapproved")}`, tasks: [{ agent: "scout", task: "Look." }, { agent: "sonic", task: "Do it." }] });
		assert.equal(result?.block, true, "a sonic must read the block from the shared context");
		assert.match(result.reason, /tasks\[1\]: scope unapproved: no recorded contract approval/);
		assert.doesNotMatch(result.reason, /tasks\[0\]/, "a scout in the same batch stays unchecked");

		assert.equal(await dispatchIn(dir, { agent: "sonic", task: block("sonic") }), undefined, "a sonic with a current block must pass");
		assert.equal(await dispatchIn(dir, { agent: "sonic", task: "Quiz this file." }), undefined, "a sonic with no block must pass");
		assert.equal(await dispatchIn(dir, { context: "Background only.", tasks: [{ agent: "sonic", task: "Do it." }] }), undefined);

		result = await dispatchIn(dir, { agent: " sonic ", task: block("unapproved") });
		assert.equal(result?.block, true, "a padded sonic name must be checked");
		assert.match(result.reason, /scope unapproved: no recorded contract approval/);

		result = await dispatchIn(dir, { agent: "sonic", task: "Flow gate:\n- Scope: sonic" });
		assert.equal(result?.block, true, "a sonic with a partial block must be blocked");
		assert.match(result.reason, /production writer task must include Flow gate with Scope, Contract, and Plan/);
	}

	// A message to a parked writer is checked like a dispatch; a live agent is never blocked.
	{
		const { dir } = governedRepo();
		const planPath = ".flow/plans/c/PLAN.md";
		await approveIn(dir, "parked", "contract", ".flow/contracts/c.md");
		await approveIn(dir, "parked", "plan", planPath);
		const block = "Flow gate:\n- Scope: parked\n- Contract: .flow/contracts/c.md\n- Plan: .flow/plans/c/PLAN.md";
		const sessions = mkdtempSync(join(tmpdir(), "flow-governance-sessions-"));
		caseRepos.push(sessions);
		const sessionFile = join(sessions, "s.jsonl");
		writeFileSync(sessionFile, `${JSON.stringify({ type: "session", id: "main" })}\n`);
		const sessionCtx = { cwd: dir, hasUI: true, sessionManager: { getSessionFile: () => sessionFile } };
		const child = (rel, { agent, task = "Do the work.", systemPrompt = ["You are a worker."], init = true, parked = true }) => {
			const entries = [{ type: "session", id: rel }, { type: "model_change", model: "m" }];
			if (init) entries.push({ type: "session_init", agent, task, systemPrompt });
			entries.push({ type: "message", message: { role: "assistant", content: "Done." } });
			if (parked) entries.push({ type: "custom", customType: "session_exit", data: {} });
			const path = join(sessions, "s", rel);
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
		};
		const message = (path, context = sessionCtx) => toolCall({ toolName: "write", input: { path, content: "Continue." } }, context);

		child("Exec.jsonl", { agent: "flow-plan-executor", task: `# Task\n\n${block}` });
		assert.equal(await message("agent://Exec"), undefined, "a parked writer with current approvals must accept a message");

		writeFileSync(join(dir, planPath), "# Plan\n\nTask B.\n");
		result = await message("agent://Exec");
		assert.equal(result?.block, true, "a message to a parked writer with a stale plan must be blocked");
		assert.match(result.reason, /parked writer Exec/);
		assert.match(result.reason, /plan artifact changed after approval/);
		assert.match((await message("agent://Exec?progress"))?.reason ?? "", /parked writer Exec/, "a query on the agent path is checked like the plain path");

		child("Live.jsonl", { agent: "flow-plan-executor", task: block, parked: false });
		assert.equal(await message("agent://Live"), undefined, "a live writer must never be blocked");

		child("Prompted.jsonl", { agent: "flow-implementer", systemPrompt: ["You are a worker.", `# Goal\n\n${block}`] });
		assert.match((await message("agent://Prompted"))?.reason ?? "", /parked writer Prompted: scope parked: plan artifact changed/, "a block in the system prompt must be read");

		child("Reviewer.jsonl", { agent: "flow-acceptance-reviewer", task: block });
		assert.equal(await message("agent://Reviewer"), undefined, "a parked non-writer must not be checked");
		child("Quiz.jsonl", { agent: "sonic", task: "Quiz this file." });
		assert.equal(await message("agent://Quiz"), undefined, "a parked sonic without a block must not be checked");
		child("Fast.jsonl", { agent: "sonic", task: block });
		assert.match((await message("agent://Fast"))?.reason ?? "", /parked writer Fast/, "a parked sonic with a block is a writer");

		child("Blank.jsonl", { agent: "flow-plan-executor", task: block, init: false });
		result = await message("agent://Blank");
		assert.equal(result?.block, true, "a parked transcript without session_init must fail closed");
		assert.match(result.reason, /cannot read the parked agent Blank/);

		child("all.jsonl", { agent: "flow-plan-executor", task: block });
		assert.equal(await message("agent://all"), undefined, "a broadcast is not a message to one agent");
		assert.equal(await message("agent://Ghost"), undefined, "an agent without a transcript is not checked");
		assert.equal(await message("agent://Exec", { cwd: dir, hasUI: true }), undefined, "a caller without a session file is not checked");
		assert.equal(await message("agent://Exec/sub"), undefined, "an id with a slash is not an agent message");

		child("A/A.B.jsonl", { agent: "flow-plan-executor", task: block });
		assert.match((await message("agent://A.B"))?.reason ?? "", /parked writer A\.B/, "a nested id must find its transcript");
		child("A/A.B/A.B.C.jsonl", { agent: "flow-plan-executor", task: block });
		assert.match((await message("agent://A.B.C"))?.reason ?? "", /parked writer A\.B\.C/, "a doubly nested id must find its transcript");
	}

	// A new untracked file stales acceptance.
	{
		const { dir } = caseRepo();
		await gateIn(dir, { action: "accept", scope: "untracked", source: "test" });
		assert.equal(await verifyIn(dir, "untracked"), undefined, "precondition: acceptance current");
		writeFileSync(join(dir, "new.txt"), "new\n");
		result = await verifyIn(dir, "untracked");
		assert.equal(result?.block, true, "an added untracked file must stale acceptance");
		assert.match(result.reason, /repository state changed after acceptance\/closure/i);
	}

	// A textconv driver that prints constant text must not hide an edit from the fingerprint.
	{
		const { dir, run } = caseRepo();
		writeFileSync(join(dir, ".gitattributes"), "*.txt diff=mask\n");
		run("add", ".gitattributes");
		run("commit", "-qm", "attributes");
		run("config", "diff.mask.textconv", "echo constant; :");
		writeFileSync(join(dir, "app.txt"), "edit one\n");
		await gateIn(dir, { action: "accept", scope: "textconv", source: "test" });
		assert.equal(await verifyIn(dir, "textconv"), undefined, "precondition: acceptance current");
		writeFileSync(join(dir, "app.txt"), "edit two\n");
		result = await verifyIn(dir, "textconv");
		assert.equal(result?.block, true, "a textconv driver must not hide an edit from the fingerprint");
		assert.match(result.reason, /repository state changed after acceptance\/closure/i);
	}

	// An external diff that prints nothing must not hide an edit from the fingerprint.
	{
		const { dir, run } = caseRepo();
		run("config", "diff.external", "sh -c true");
		writeFileSync(join(dir, "app.txt"), "edit one\n");
		await gateIn(dir, { action: "accept", scope: "external", source: "test" });
		assert.equal(await verifyIn(dir, "external"), undefined, "precondition: acceptance current");
		writeFileSync(join(dir, "app.txt"), "edit two\n");
		result = await verifyIn(dir, "external");
		assert.equal(result?.block, true, "an external diff must not hide an edit from the fingerprint");
		assert.match(result.reason, /repository state changed after acceptance\/closure/i);
	}

	// A change staged and then reverted in the working tree still differs from the accepted state.
	{
		const { dir, run } = caseRepo();
		await gateIn(dir, { action: "accept", scope: "staged-revert", source: "test" });
		assert.equal(await verifyIn(dir, "staged-revert"), undefined, "precondition: acceptance current");
		writeFileSync(join(dir, "app.txt"), "staged\n");
		run("add", "app.txt");
		writeFileSync(join(dir, "app.txt"), "v1\n");
		result = await verifyIn(dir, "staged-revert");
		assert.equal(result?.block, true, "a staged change reverted in the working tree must stale acceptance");
		assert.match(result.reason, /repository state changed after acceptance\/closure/i);
	}

	// Acceptance binds the tree, not HEAD: committing the accepted tree keeps it current.
	{
		const { dir, run } = caseRepo();
		writeFileSync(join(dir, "app.txt"), "v2\n");
		writeFileSync(join(dir, "new.txt"), "new\n");
		const head = run("rev-parse", "HEAD");
		const accepted = (await gateIn(dir, { action: "accept", scope: "commit", source: "test" })).content[0].text;
		const tree = stateIn(dir).scopes.commit.acceptance.tree;
		assert.match(tree, /^[0-9a-f]{40,64}$/, "accept must record the tree id");
		assert.equal(stateIn(dir).scopes.commit.acceptance.head, head, "accept must record the head");
		assert.ok(accepted.includes(tree) && accepted.includes(head), "the accept result must name the tree id and the head");
		run("add", "-A");
		run("commit", "-qm", "accepted tree");
		assert.equal(run("rev-parse", "HEAD^{tree}"), tree, "the recorded tree must be the tree git add -A writes");
		assert.equal(await verifyIn(dir, "commit"), undefined, "a commit of the accepted tree must keep its acceptance");
		assert.match((await gateIn(dir, { action: "status", scope: "commit" })).content[0].text, /acceptance: current/);

		// A change after that commit stales it, and the error names both heads.
		writeFileSync(join(dir, "app.txt"), "v3\n");
		result = await verifyIn(dir, "commit");
		assert.equal(result?.block, true, "a change after committing the accepted tree must stale acceptance");
		assert.match(result.reason, /repository state changed after acceptance\/closure/i);
		assert.ok(result.reason.includes(`(accepted at ${head}, now at ${run("rev-parse", "HEAD")})`), "the stale error must name both heads");
	}

	// A racy index entry (file rewritten at the index's own mtime, same size) still counts as changed.
	{
		const { dir, run } = caseRepo();
		// Seconds-only stat comparison must hinge on mtime alone, not on when the test's writes landed.
		run("config", "core.trustctime", "false");
		const stamp = new Date("2026-01-01T00:00:00Z");
		utimesSync(join(dir, "app.txt"), stamp, stamp);
		run("add", "app.txt");
		writeFileSync(join(dir, "app.txt"), "v2\n");
		utimesSync(join(dir, "app.txt"), stamp, stamp);
		utimesSync(join(dir, ".git/index"), stamp, stamp);
		await gateIn(dir, { action: "accept", scope: "racy", source: "test" });
		const tree = stateIn(dir).scopes.racy.acceptance.tree;
		run("add", "-A");
		assert.notEqual(tree, run("rev-parse", "HEAD^{tree}"), "a racy rewrite must not record the committed tree");
		assert.equal(tree, run("write-tree"), "the recorded tree must be the tree git add -A writes for a racy entry");
	}

	// Committing only the tracked change of the accepted tree keeps it current.
	{
		const { dir, run } = caseRepo();
		writeFileSync(join(dir, "app.txt"), "v2\n");
		writeFileSync(join(dir, "new.txt"), "new\n");
		await gateIn(dir, { action: "accept", scope: "partial", source: "test" });
		run("commit", "-qam", "tracked only");
		assert.equal(await verifyIn(dir, "partial"), undefined, "a partial commit of the accepted tree must keep its acceptance");
	}

	// Acceptance survives a folder move.
	{
		const { dir } = caseRepo();
		writeFileSync(join(dir, "app.txt"), "v2\n");
		await gateIn(dir, { action: "accept", scope: "moved-accept", source: "test" });
		const moved = `${dir}-moved`;
		renameSync(dir, moved);
		caseRepos.push(moved);
		assert.equal(await verifyIn(moved, "moved-accept"), undefined, "acceptance must stay current after the checkout folder moved");
	}

	// Computing the identity writes nothing into the repository's object database.
	{
		const { dir } = caseRepo();
		const countFiles = (path) =>
			readdirSync(path, { withFileTypes: true }).reduce((n, entry) => n + (entry.isDirectory() ? countFiles(join(path, entry.name)) : 1), 0);
		writeFileSync(join(dir, "app.txt"), "dirty tracked\n");
		writeFileSync(join(dir, "new.txt"), "dirty untracked\n");
		const before = countFiles(join(dir, ".git/objects"));
		await gateIn(dir, { action: "accept", scope: "no-write", source: "test" });
		await gateIn(dir, { action: "status", scope: "no-write" });
		assert.equal(countFiles(join(dir, ".git/objects")), before, "accept and status must not write into .git/objects");
	}

	// The accept prompt says what keeps the acceptance current.
	assert.match(
		flowGate.formatApprovalDetails({ action: "accept", scope: "demo", source: "closure-1" }).join("\n"),
		/stays current across commits of this tree; goes stale when the tree changes/,
	);

	// approve refuses a headless session and records nothing.
	{
		const { dir } = governedRepo();
		await gateIn(dir, { action: "present", scope: "headless", kind: "contract", path: ".flow/contracts/c.md", summary: "s" });
		await assert.rejects(
			flowGate.execute("gate-case", { action: "approve", scope: "headless", kind: "contract" }, undefined, undefined, { cwd: dir, hasUI: false }),
			/interactive parent session/i,
			"headless agents must not record approvals",
		);
		assert.equal(existsSync(join(dir, ".flow/runtime/gates.json")), false, "a refused approve must write no gate state");
		const headless = (input) => flowGate.execute("gate-case", input, undefined, undefined, { cwd: dir, hasUI: false });
		await assert.rejects(headless({ action: "present", scope: "headless", kind: "plan", path: ".flow/plans/c/PLAN.md", summary: "s" }), /interactive parent session/i, "a subagent must not present (01a157ad PlanTeamBudgets#159)");
		assert.equal(flowGate.approval({ action: "approve", scope: "headless", kind: "plan" }).policy, "deny", "a refused present must leave no presentation behind");
		await approveIn(dir, "headless", "contract", ".flow/contracts/c.md");
		await assert.rejects(headless({ action: "clear", scope: "headless" }), /interactive parent session/i, "a subagent must not clear gate state");
		assert.ok(stateIn(dir).scopes.headless.approvals.contract, "a refused clear must keep the approval");
	}

	// Only flow_gate writes .flow/runtime/: file-writing tools are blocked there, in every input shape.
	{
		const callTool = (toolName, input) => toolCall({ toolName, input }, ctx);
		symlinkSync("runtime", join(root, ".flow/runtime-link"));
		for (const [toolName, input] of [
			["write", { path: ".flow/runtime/gates.json", content: "{}" }],
			["write", { path: join(root, ".flow/runtime/new.json"), content: "{}" }],
			["write", { path: "[.flow/runtime/gates.json#ABCD]", content: "{}" }],
			["write", { path: ".flow/runtime-link/gates.json", content: "{}" }],
			["edit", { path: ".flow/runtime/gates.json", old_string: "a", new_string: "b" }],
			["edit", { input: "[.flow/runtime/gates.json#ABCD]\nPUT 1.=1:\n+{}" }],
			["edit", { input: "[.flow/plans/demo/PLAN.md#ABCD]\nMV .flow/runtime/gates.json" }],
			["edit", { input: "*** Begin Patch\n*** Update File: .flow/runtime/gates.json\n@@\n-a\n+b\n*** End Patch" }],
			["edit", { input: "*** Begin Patch\n*** Update File: .flow/plans/demo/PLAN.md\n*** Move to: .flow/runtime/gates.json\n*** End Patch" }],
			["edit", { path: ".flow/plans/demo/PLAN.md", edits: [{ op: "update", rename: ".flow/runtime/gates.json" }] }],
			["edit", { input: "*** Begin Patch\n*** Add File: .flow/runtime/gates.json\n+{}\n*** End Patch" }],
			["edit", { input: "*** Begin Patch\n*** Delete File: .flow/runtime/gates.json\n*** End Patch" }],
			["edit", { input: "*** Begin Patch\n*** Edit File: .flow/runtime/gates.json\n@@\n-a\n+b\n*** End Patch" }],
			["edit", { input: "¶.flow/runtime/gates.json\nPUT 1.=1:\n+{}" }],
			["edit", { _input: "[.flow/runtime/gates.json#ABCD]\nPUT 1.=1:\n+{}" }],
			["edit", { _input: "*** Begin Patch\n*** Update File: .flow/runtime/gates.json\n@@\n-a\n+b\n*** End Patch" }],
			["write", { _path: ".flow/runtime/gates.json", content: "{}" }],
			["ast_edit", { ops: [{ pat: "a", out: "b" }], paths: [".flow/runtime/gates.json"] }],
		]) {
			result = await callTool(toolName, input);
			assert.equal(result?.block, true, `${toolName} ${JSON.stringify(input)} must be blocked`);
			assert.match(result.reason, /Only flow_gate writes \.flow\/runtime\//);
		}
		for (const [toolName, input] of [
			["write", { path: ".flow/contracts/new.md", content: "# New\n" }],
			["write", { path: ".flow/runtime-notes.md", content: "notes\n" }],
			["edit", { input: "[.flow/plans/demo/PLAN.md#ABCD]\nPUT 1.=1:\n++ .flow/runtime/gates.json is flow_gate's" }],
			["edit", { path: "app.txt", old_string: "v2", new_string: "v3" }],
			["write", { path: ".flowx/runtime/x.json", content: "{}" }],
			["write", { path: "my.flow/runtime/x.json", content: "{}" }],
		]) {
			assert.equal(await callTool(toolName, input), undefined, `${toolName} ${JSON.stringify(input)} must pass`);
		}
	}

	// A percent-encoded file URL names the same gate state as the plain path.
	result = await toolCall({ toolName: "write", input: { path: `file://${root}/%2Eflow/runtime/gates.json`, content: "{}" } }, ctx);
	assert.equal(result?.block, true, "a write through a percent-encoded file URL must be blocked");

	// A non-file URL scheme still names a path: the percent-decoded path component is what a host sees.
	{
		const callTool = (toolName, input, cwd = root) => toolCall({ toolName, input }, { cwd, hasUI: true });
		for (const path of [
			`ssh://localhost${root}/%2Eflow/runtime/gates.json`,
			`ssh://localhost${root}/.flow/runtime/gates.json`,
			`ssh://localhost${root}/%2egit/config`,
			"ssh://localhost/%E0%A4%A",
		]) {
			result = await callTool("write", { path, content: "{}" });
			assert.equal(result?.block, true, `write ${path} must be blocked`);
		}
		assert.equal(await callTool("write", { path: `ssh://localhost${root}/app.txt`, content: "x" }), undefined, "an unrelated URL write must pass");
	}

	// bash matches its prompt rules on `command` only, yet runs in `cwd`: a cwd inside the runtime directory is the hook's to refuse.
	{
		const callBash = (input, cwd = root) => toolCall({ toolName: "bash", input }, { cwd, hasUI: true });
		for (const cwd of [
			".flow/runtime",
			`${root}/.flow/runtime`,
			".flow/runtime/sub",
			".flow/runtime-link",
			`file://${root}/%2Eflow/runtime`,
			"file://localhost/%E0%A4%A",
		]) {
			result = await callBash({ command: "rm gates.json", cwd });
			assert.equal(result?.block, true, `bash cwd ${cwd} must be blocked`);
			assert.match(result.reason, /command/);
		}
		for (const input of [{ command: "ls", cwd: "." }, { command: "ls", cwd: ".flow/plans" }, { command: "ls", cwd: ".flow/runtime-notes" }, { command: "ls" }, { command: "ls", cwd: 7 }]) {
			assert.equal(await callBash(input), undefined, `bash ${JSON.stringify(input)} must pass`);
		}
	}

	// The acceptance fingerprint reads repo-local git config, attributes and excludes, so file tools stay out of `.git/`.
	{
		const { dir, run } = caseRepo();
		mkdirSync(join(dir, "src"));
		writeFileSync(join(dir, "src/a.ts"), "const a = 1;\n");
		const callTool = (toolName, input, cwd = dir) => toolCall({ toolName, input }, { cwd, hasUI: true });
		for (const [toolName, input, cwd] of [
			["write", { path: ".git/config", content: "" }],
			["write", { path: ".git/info/exclude", content: "" }],
			["write", { path: ".git/info/attributes", content: "" }],
			["write", { path: ".git/hooks/pre-commit", content: "" }],
			["write", { path: join(dir, ".git/info/exclude"), content: "" }],
			["write", { path: "../.git/config", content: "" }, join(dir, "src")],
			["write", { path: "src/../.git/config", content: "" }],
			["write", { path: `file://${dir}/%2Egit/config`, content: "" }],
			["edit", { path: ".git/config", old_string: "a", new_string: "b" }],
			["edit", { input: "[.git/info/attributes#ABCD]\nPUT 1.=1:\n+* filter=x" }],
			["edit", { input: "*** Begin Patch\n*** Update File: .git/config\n@@\n-a\n+b\n*** End Patch" }],
			["ast_edit", { ops: [{ pat: "a", out: "b" }], paths: [".git/config"] }],
			["ast_edit", { ops: [{ pat: "a", out: "b" }], paths: [".git"] }],
			["ast_edit", { ops: [{ pat: "a", out: "b" }], paths: [".git/info/**"] }],
			["ast_edit", { ops: [{ pat: "a", out: "b" }], paths: ["src", ".git/info"] }],
			["ast_edit", { ops: [{ pat: "a", out: "b" }], path: ".git/info" }],
		]) {
			result = await callTool(toolName, input, cwd);
			assert.equal(result?.block, true, `${toolName} ${JSON.stringify(input)} must be blocked`);
			assert.match(result.reason, /fingerprint/);
		}
		for (const [toolName, input] of [
			["write", { path: ".gitignore", content: "x\n" }],
			["write", { path: ".gitattributes", content: "x\n" }],
			["write", { path: ".github/workflows/ci.yml", content: "x\n" }],
			["write", { path: "x.git/config", content: "x\n" }],
			["write", { path: "src/.gitkeep", content: "" }],
			["edit", { path: "app.txt", old_string: "v1", new_string: "v2" }],
			// OMP's walk skips every `.git` below its base, so a base above it never reaches git state.
			["ast_edit", { ops: [{ pat: "a", out: "b" }], paths: ["."] }],
			["ast_edit", { ops: [{ pat: "a", out: "b" }], paths: ["src"] }],
			["ast_edit", { ops: [{ pat: "a", out: "b" }], paths: ["**/*.ts"] }],
		]) {
			assert.equal(await callTool(toolName, input), undefined, `${toolName} ${JSON.stringify(input)} must pass`);
		}

		// A linked worktree's `.git` is a file; the directory it points to lies outside the worktree root.
		const linked = `${dir}-linked`;
		caseRepos.push(linked);
		run("worktree", "add", "-q", "-b", "linked", linked);
		const common = join(dir, ".git");
		const gitdir = readFileSync(join(linked, ".git"), "utf8").replace(/^gitdir: /, "").trim();
		for (const [toolName, input] of [
			["write", { path: ".git", content: "" }],
			["write", { path: join(common, "config"), content: "" }],
			["write", { path: join(common, "info/exclude"), content: "" }],
			["write", { path: join(gitdir, "info/exclude"), content: "" }],
			["ast_edit", { ops: [{ pat: "a", out: "b" }], paths: [join(common, "info")] }],
		]) {
			result = await callTool(toolName, input, linked);
			assert.equal(result?.block, true, `${toolName} ${JSON.stringify(input)} from a linked worktree must be blocked`);
			assert.match(result.reason, /fingerprint/);
		}
		assert.equal(await callTool("write", { path: "app.txt", content: "x\n" }, linked), undefined, "an ordinary write in a linked worktree must pass");

		// A real directory behind a symlinked `.flow` or `.flow/runtime` is gate state however it is spelled.
		mkdirSync(join(dir, "store/runtime"), { recursive: true });
		symlinkSync("store", join(dir, ".flow"));
		for (const path of ["store/runtime/gates.json", join(dir, "store/runtime/new.json"), "store/runtime"]) {
			result = await callTool("write", { path, content: "{}" });
			assert.equal(result?.block, true, `write ${path} behind a symlinked .flow must be blocked`);
			assert.match(result.reason, /Only flow_gate writes \.flow\/runtime\//);
		}
		assert.equal(await callTool("write", { path: "store/notes.md", content: "x" }), undefined, "a sibling of the real runtime directory must pass");
	}
	{
		const { dir } = caseRepo();
		mkdirSync(join(dir, ".flow"));
		mkdirSync(join(dir, "state"));
		symlinkSync("../state", join(dir, ".flow/runtime"));
		const callTool = (path) => toolCall({ toolName: "write", input: { path, content: "{}" } }, { cwd: dir, hasUI: true });
		result = await callTool("state/gates.json");
		assert.equal(result?.block, true, "write behind a symlinked .flow/runtime must be blocked");
		assert.equal(await callTool("state-notes/x.json"), undefined, "a sibling directory must pass");
	}
	{
		// No gate state yet: the link alone must anchor the real location, or the first forged record would pass.
		const { dir } = caseRepo();
		mkdirSync(join(dir, "store"));
		symlinkSync("store", join(dir, ".flow"));
		const callTool = (path) => toolCall({ toolName: "write", input: { path, content: "{}" } }, { cwd: dir, hasUI: true });
		result = await callTool("store/runtime/gates.json");
		assert.equal(result?.block, true, "write behind a symlinked .flow whose runtime directory does not exist yet must be blocked");
		assert.equal(await callTool("store/other/x.json"), undefined, "an unrelated path behind the link must pass");
	}

	// ast_edit rewrites every file a directory or glob covers, so a call that could reach gate state is blocked.
	{
		const { dir } = caseRepo();
		mkdirSync(join(dir, "src/deep"), { recursive: true });
		mkdirSync(join(dir, ".flow/plans"), { recursive: true });
		writeFileSync(join(dir, "src/a.ts"), "const a = 1;\n");
		writeFileSync(join(dir, "src/deep/b.ts"), "const b = 1;\n");
		writeFileSync(join(dir, ".flow/plans/PLAN.md"), "# Plan\n");
		const callAst = (paths, cwd = dir) => toolCall({ toolName: "ast_edit", input: { ops: [{ pat: "a", out: "b" }], paths } }, { cwd, hasUI: true });
		const ordinary = [["."], ["src"], ["src/**/*.ts"], ["**/*.ts"], ["src", "src/deep/b.ts"]];

		// Without gate state there is nothing to rewrite under the runtime directory.
		for (const paths of ordinary) {
			assert.equal(await callAst(paths), undefined, `ast_edit ${JSON.stringify(paths)} must pass without gate state`);
		}
		mkdirSync(join(dir, ".flow/runtime"));
		assert.equal(await callAst(["."]), undefined, "an empty runtime directory has nothing to rewrite");

		// OMP's walk does not honour .git/info/exclude, so the exclude entry that accept adds must not relax the check.
		await gateIn(dir, { action: "accept", scope: "ast", source: "test" });
		assert.match(readFileSync(join(dir, ".git/info/exclude"), "utf8"), /^\/\.flow\/$/m, "precondition: .flow is excluded");
		assert.equal(existsSync(join(dir, ".flow/runtime/gates.json")), true, "precondition: gate state exists");
		symlinkSync(".flow", join(dir, "flowlink"));

		for (const paths of ordinary) {
			// `.` could rewrite the JSON gate state by its extension; everything else cannot reach it.
			if (paths[0] === ".") continue;
			assert.equal(await callAst(paths), undefined, `ast_edit ${JSON.stringify(paths)} must pass with gate state present`);
		}
		// A glob that names only the runtime directory matches no file, and OMP's walk matches files only.
		for (const paths of [[".flow/plans"], [".flow/**/*.md"], ["*.json"], ["*/*.json"], ["src/*.ts", ".flow/plans/PLAN.md"], [".f*/runtime"]]) {
			assert.equal(await callAst(paths), undefined, `ast_edit ${JSON.stringify(paths)} cannot reach gate state`);
		}
		for (const paths of [
			["."],
			[".flow"],
			["flowlink"],
			[dir],
			[`file://${dir}`],
			["**/*.json"],
			["**/gates.json"],
			["**"],
			["*/*/*.json"],
			[".flow/**"],
			[".flow/**/*.json"],
			[".fl?w/run*/*"],
			["[.]flow/runtime/gates.json"],
			["{src,.flow}/**/*.json"],
			["src", "."],
			["src;.flow"],
			[".flow/plans, .flow/runtime"],
			["src/**/*.ts", "**/*.json"],
			[".flow/[run"],
			[".flow/{runtime"],
		]) {
			result = await callAst(paths);
			assert.equal(result?.block, true, `ast_edit ${JSON.stringify(paths)} must be blocked`);
			assert.match(result.reason, /Only flow_gate writes \.flow\/runtime\//);
		}
		for (const paths of ["src", [42], [["."]]]) {
			result = await callAst(paths);
			assert.equal(result?.block, true, `ast_edit paths ${JSON.stringify(paths)} is malformed and must fail closed`);
		}
		result = await callAst(undefined);
		assert.equal(result?.block, true, "ast_edit without a target walks the working directory and must be blocked");
		result = await toolCall({ toolName: "ast_edit", input: { ops: [{ pat: "a", out: "b" }] } }, { cwd: dir, hasUI: true });
		assert.equal(result?.block, true, "ast_edit with no path, _path or paths must be blocked");
		result = await toolCall({ toolName: "ast_edit", input: { ops: [{ pat: "a", out: "b" }], path: "  ", paths: [] } }, { cwd: dir, hasUI: true });
		assert.equal(result?.block, true, "ast_edit with only blank targets must be blocked");
		assert.equal(
			await toolCall({ toolName: "ast_edit", input: { ops: [{ pat: "a", out: "b" }], _path: "src" } }, { cwd: dir, hasUI: true }),
			undefined,
			"ast_edit naming a target through _path must pass when it cannot reach gate state",
		);

		// OMP's expandPath accepts these spellings of a directory, so the check must see through them.
		for (const [paths, cwd] of [
			[[`@${dir}`], dir],
			[[`:${dir}`], dir],
			[[":./"], dir],
			[[":../"], join(dir, "src")],
			[[`file://localhost${dir}`], dir],
			[[`file://${dir}/%2Eflow`], dir],
			[[`file://${dir}/%2Eflow/**/*.json`], dir],
			[["file://example.invalid/tmp"], dir],
			// OMP splits the raw URL at its first glob segment, so a `?` glob is not the start of a URL query.
			[[`file://${dir}/.flow/r?ntime/gates.json`], dir],
			[[`file://${dir}/.fl?w/runtime/*`], dir],
			[[`file://localhost${dir}/.f*/runtime/*.json`], dir],
			[[`file://${dir}/.flow#frag`], dir],
		]) {
			result = await callAst(paths, cwd);
			assert.equal(result?.block, true, `ast_edit ${JSON.stringify(paths)} from ${cwd} must be blocked`);
		}
		assert.equal(await callAst([":../src"], join(dir, "src")), undefined, "a decorated path that cannot reach gate state must pass");
	}

	// Hub waits are OMP's; the guard passes them through untouched.
	assert.equal(await toolCall({ toolName: "hub", input: { op: "wait", ids: ["job-1"] } }, ctx), undefined, "Flow must not intercept native hub waits");

	const savedCeiling = process.env.GIT_CEILING_DIRECTORIES;
	try {
		process.env.GIT_CEILING_DIRECTORIES = tmpdir();
		assert.throws(
			() => execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: nonGit, stdio: "ignore" }),
			"precondition: nonGit must not resolve to a git repository",
		);

		const nonGitCtx = { cwd: nonGit, hasUI: true };
		const callNonGitTask = (input) => toolCall({ toolName: "task", input }, nonGitCtx);

		result = await callNonGitTask({ agent: "scout", task: "Find the entry point." });
		assert.equal(result, undefined, "ungated agent must pass outside git without touching git");

		result = await callNonGitTask({ tasks: [{ agent: "scout", task: "a" }, { task: "default agent" }] });
		assert.equal(result, undefined, "batch with only ungated/default agents must pass outside git");

		result = await callNonGitTask({ agent: "flow-planner", task: plannerTask });
		assert.equal(result?.block, true, "planner dispatch must still fail outside git");
		assert.match(result.reason, /requires task dispatch from a git repository/);

		result = await callNonGitTask({ agent: "flow-implementer", task: directWriterTask });
		assert.equal(result?.block, true, "writer dispatch must still fail outside git");
		assert.match(result.reason, /requires task dispatch from a git repository/);

		result = await callNonGitTask({ agent: " flow-implementer", task: directWriterTask });
		assert.equal(result?.block, true, "padded writer dispatch must still fail outside git");
		assert.match(result.reason, /requires task dispatch from a git repository/);

		result = await callNonGitTask({
			tasks: [{ agent: "scout", task: "a" }, { agent: "flow-evidence-verifier", task: verifierTask }],
		});
		assert.equal(result?.block, true, "batch with any gated role must still fail outside git");
		assert.match(result.reason, /requires task dispatch from a git repository/);
	} finally {
		if (savedCeiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
		else process.env.GIT_CEILING_DIRECTORIES = savedCeiling;
	}
} finally {
	rmSync(root, { recursive: true, force: true });
	rmSync(nonGit, { recursive: true, force: true });
	for (const dir of caseRepos) rmSync(dir, { recursive: true, force: true });
}

console.log("ok: flow governance runtime gates");
