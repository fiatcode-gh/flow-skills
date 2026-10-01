// Behavioral tests for Flow approval-revision and acceptance-state runtime gates.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
	assert.match(flowGate.formatApprovalDetails({ action: "approve", scope: "demo", kind: "contract" }).join("\n"), /SHA-256:/);
	await callGate({ action: "approve", scope: "demo", kind: "contract" });

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
			/must live below/,
			"present must refuse an artifact outside .flow/",
		);
		symlinkSync("../app.txt", join(dir, ".flow/escape.md"));
		await assert.rejects(
			gateIn(dir, { action: "present", scope: "outside", kind: "contract", path: ".flow/escape.md", summary: "s" }),
			/escapes/,
			"present must refuse a .flow/ symlink that resolves outside .flow/",
		);
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
		]) {
			assert.equal(await callTool(toolName, input), undefined, `${toolName} ${JSON.stringify(input)} must pass`);
		}
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
