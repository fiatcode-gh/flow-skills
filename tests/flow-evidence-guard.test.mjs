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

console.log("ok: flow evidence capsule preflight");
