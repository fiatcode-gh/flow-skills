// Behavioral tests for the narrow Flow runtime evidence-capsule preflight.
// Dependency-free: Node native TypeScript stripping loads the extension directly.
import assert from "node:assert/strict";
import guardExtension from "../agent/extensions/flow-evidence-guard.ts";

let toolCall;
guardExtension({
	on(event, handler) {
		if (event === "tool_call") toolCall = handler;
	},
});

assert.equal(typeof toolCall, "function", "guard must register a tool_call handler");

const call = (toolName, input, hasUI = true) =>
	toolCall({ toolName, input }, { hasUI });

for (const input of [
	{ op: "wait" },
	{ op: "wait", ids: ["job-1"] },
	{ op: "wait", name: "server" },
	{ op: "wait", from: "worker-a" },
	{ op: "wait", from: "worker-a", ids: ["job-1"] },
]) {
	const result = await call("hub", input);
	assert.equal(result, undefined, "Flow must not intercept native hub wait semantics");
}

const capsuleWithoutId = `Evidence capsule:
- Owns: one coherent scene
- Independent split check: none
- Excludes: other scenes
- Restore obligation: NONE`;
let result = await call("task", {
	agent: "flow-evidence-verifier",
	task: capsuleWithoutId,
});
assert.equal(result?.block, true, "verifier capsule without ID must be blocked");
assert.match(result.reason, /id:/i, "missing-ID rejection must name the marker");

const completeCapsule = `Evidence capsule:
- ID: scene-a
- Owns: one coherent scene
- Independent split check: none
- Excludes: other scenes
- Restore obligation: NONE`;
result = await call("task", {
	agent: "flow-evidence-verifier",
	task: completeCapsule,
});
assert.equal(result, undefined, "complete verifier capsule must be allowed");

result = await call("task", {
	tasks: [
		{ agent: "scout", task: "read only" },
		{ agent: "flow-evidence-verifier", task: capsuleWithoutId },
	],
});
assert.equal(result?.block, true, "batch verifier capsule without ID must be blocked");
assert.match(result.reason, /tasks\[1\].*id:/i, "batch rejection must identify the bad task");

for (const agent of [" flow-evidence-verifier", "flow-evidence-verifier\n", "\tflow-evidence-verifier "]) {
	result = await call("task", { agent, task: capsuleWithoutId });
	assert.equal(result?.block, true, `padded verifier name ${JSON.stringify(agent)} must be checked like the plain name`);
	assert.match(result.reason, /id:/i);
}
result = await call("task", { tasks: [{ agent: "scout", task: "a" }, { agent: " flow-evidence-verifier ", task: capsuleWithoutId }] });
assert.equal(result?.block, true, "padded verifier name inside a batch must be checked");
assert.match(result.reason, /tasks\[1\].*id:/i);

const capsuleWithLooseId = `Evidence capsule:
- Owns: the valid: scene on grid: 3
- Independent split check: none
- Excludes: other scenes
- Restore obligation: NONE`;
result = await call("task", { agent: "flow-evidence-verifier", task: capsuleWithLooseId });
assert.equal(result?.block, true, "an id: inside another word must not satisfy the ID marker");
assert.match(result.reason, /missing id:/i);

const capsuleWithInlineMarkers = `Evidence capsule: - ID: scene-a - Owns: one scene - Independent split check: none - Excludes: other scenes - Restore obligation: NONE`;
result = await call("task", { agent: "flow-evidence-verifier", task: capsuleWithInlineMarkers });
assert.equal(result?.block, true, "markers count only at the start of a line");

const indentedCapsule = `# Verify

  Evidence capsule:
    - ID: scene-a
    - Owns: one coherent scene
    - Independent split check: none
    - Excludes: other scenes
    - Restore obligation: NONE`;
result = await call("task", { agent: "flow-evidence-verifier", task: indentedCapsule });
assert.equal(result, undefined, "indented marker lines must still count");

console.log("ok: flow evidence capsule preflight");
