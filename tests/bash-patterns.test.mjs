// Proves the profiles' bash.patterns against a port of OMP's matcher.
//
// Port of normalizeBashApprovalPattern and bashApprovalPatternToRegExp from
// packages/coding-agent/src/tools/bash.ts in can1357/oh-my-pi at 78b7531
// (OMP 18.2.6, 2026-09-18): trim, collapse whitespace, `*` -> `.*`, every
// other character literal, anchored at both ends, case-sensitive. `prompt`
// rules also fire on any segment of a compound command; whole-command
// matching is the stricter case, so it is what this test checks.
// Re-check the port when upgrading OMP across substantial releases.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mustNotPrompt, mustPrompt } from "./fixtures/bash-pattern-corpus.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profiles = ["openai-codex", "anthropic", "commandcode"];

const normalize = (value) => value.trim().replace(/\s+/gu, " ");
const toRegExp = (pattern) =>
	new RegExp(
		"^" +
			normalize(pattern)
				.split("*")
				.map((part) => part.replace(/[\\^$+?.()|[\]{}]/gu, "\\$&"))
				.join(".*") +
			"$",
		"u",
	);

// Parse each profile with a real YAML parser (PyYAML through uv, as tests/run.sh
// already requires) and keep the `prompt` rules in their configured order.
const loadPatterns = `
import json, sys, yaml
print(json.dumps([(yaml.safe_load(open(p)) or {}).get("bash", {}).get("patterns") or [] for p in sys.argv[1:]]))
`;
const configs = profiles.map((profile) => path.join(root, "omp", "profiles", profile, "config.yml"));
const lists = JSON.parse(
	execFileSync("uv", ["run", "--with", "pyyaml", "python", "-c", loadPatterns, ...configs], { encoding: "utf8" }),
).map((patterns) => patterns.filter((rule) => rule.approval === "prompt").map((rule) => rule.match));
for (const list of lists.slice(1)) {
	assert.deepEqual(list, lists[0], "bash.patterns must be identical across profiles");
}
const regexes = lists[0].map(toRegExp);
const prompts = (command) => regexes.some((re) => re.test(normalize(command)));

for (const command of mustPrompt) assert.ok(prompts(command), `must prompt: ${command}`);
for (const command of mustNotPrompt) assert.ok(!prompts(command), `must not prompt: ${command}`);

console.log(`ok: bash approval patterns (${regexes.length} patterns, ${mustPrompt.length} prompt, ${mustNotPrompt.length} silent)`);
