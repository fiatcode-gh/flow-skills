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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profiles = ["openai-codex", "ollama-cloud", "anthropic"];

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

const patternsOf = (profile) => {
	const text = readFileSync(path.join(root, "profiles", profile, "config.yml"), "utf8");
	const bash = text.slice(text.indexOf("\nbash:\n"), text.indexOf("\ntask:\n"));
	return [...bash.matchAll(/- match: "([^"]+)"\n\s+approval: prompt/g)].map((m) => m[1]);
};

const lists = profiles.map(patternsOf);
for (const list of lists.slice(1)) {
	assert.deepEqual(list, lists[0], "bash.patterns must be identical across profiles");
}
const regexes = lists[0].map(toRegExp);
assert.ok(regexes.length >= 20, "pattern list unexpectedly short");
const prompts = (command) => regexes.some((re) => re.test(normalize(command)));

// Every publication command the flow-review references use, plus adversarial
// spellings of the same writes.
const mustPrompt = [
	'gh api -X POST "repos/$base_repo/pulls/$number/reviews" --input "$payload_file"',
	`gh api graphql -f threadId="$thread_id" -f body="$reply_body" -f query='mutation(...)'`,
	`gh api graphql -f threadId="$thread_id" -f query='mutation(...)'`,
	`gh api graphql --paginate --slurp -F owner=x -F name=y -F number=1 -f query='query(...)'`,
	'gh pr edit "$number" --add-reviewer "$reviewer_login"',
	"gh api repos/o/r/issues/1/comments -f body=hi",
	"gh api -fbody=hi repos/o/r/issues/1/comments",
	"gh api repos/o/r/pulls/1/reviews --method=POST",
	"gh api -XPOST repos/o/r/pulls/1/reviews",
	"gh api --field body=hi repos/o/r/issues/1/comments",
	"gh api repos/o/r/issues/1/comments --raw-field body=hi",
	"gh api repos/o/r/issues/1/comments --input - < body.json",
	"gh   api   -X   DELETE   repos/o/r/pulls/1/requested_reviewers",
	"gh pr close 12",
	"gh pr comment 12 --body hi",
	"gh pr review 12 --approve",
	"gh pr merge 12 --squash",
	"gh pr create --fill",
	"gh issue comment 3 --body hi",
	"gh release create v1.0",
	"git push -u origin flow-v8-trial",
	"git push --force-with-lease",
];

// Read-only commands the same references run; none may prompt.
const mustNotPrompt = [
	"gh api user --jq .login",
	'gh api --paginate --slurp "repos/$base_repo/pulls/$number/reviews?per_page=100"',
	'gh api --paginate --slurp "repos/$base_repo/issues/$number/comments?per_page=100"',
	"gh api repos/fiatcode-gh/omp-flow/pulls/3",
	'gh api -H "Accept: application/vnd.github+json" repos/o/r/pulls/3/files',
	'gh pr view "$pr" --json number,url,headRefOid',
	'gh pr checks "$pr" --json name,state',
	"gh pr diff 3",
	"gh repo view --json nameWithOwner",
	"gh auth status",
	"git fetch --prune origin",
	"git status --porcelain",
];

for (const command of mustPrompt) assert.ok(prompts(command), `must prompt: ${command}`);
for (const command of mustNotPrompt) assert.ok(!prompts(command), `must not prompt: ${command}`);

console.log(`ok: bash approval patterns (${regexes.length} patterns, ${mustPrompt.length} prompt, ${mustNotPrompt.length} silent)`);
