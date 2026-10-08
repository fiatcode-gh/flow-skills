// Behavioral tests for Flow approval-revision and acceptance-state runtime gates.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
	assert.match(
		flowGate.formatApprovalDetails({ action: "approve", scope: "demo", kind: "contract" }).join("\n"),
		/[0-9a-f]{64}/,
		"the approval prompt must name the exact artifact revision being approved",
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
		assert.equal(stateIn(dir).scopes.short.approvals.contract.path, full, "approval must bind to the same artifact");
		const shortPlanner = "Flow gate:\n- Scope: short\n- Contract: contracts/c.md";
		assert.equal(await dispatchIn(dir, { agent: "flow-planner", task: shortPlanner }), undefined, "a planner manifest using the short Contract form must bind to the approval");

		await approveIn(dir, "short", "plan", "plans/c/PLAN.md");
		assert.equal(stateIn(dir).scopes.short.approvals.plan.path, realpathSync(join(dir, ".flow/plans/c/PLAN.md")), "a short-form plan must bind too");
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
