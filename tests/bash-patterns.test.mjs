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

// Parse each profile with a real YAML parser (PyYAML through uv, as tests/run.sh
// already requires) and keep the `prompt` rules in their configured order.
const loadPatterns = `
import json, sys, yaml
print(json.dumps([(yaml.safe_load(open(p)) or {}).get("bash", {}).get("patterns") or [] for p in sys.argv[1:]]))
`;
const configs = profiles.map((profile) => path.join(root, "profiles", profile, "config.yml"));
const lists = JSON.parse(
	execFileSync("uv", ["run", "--with", "pyyaml", "python", "-c", loadPatterns, ...configs], { encoding: "utf8" }),
).map((patterns) => patterns.filter((rule) => rule.approval === "prompt").map((rule) => rule.match));
for (const list of lists.slice(1)) {
	assert.deepEqual(list, lists[0], "bash.patterns must be identical across profiles");
}
const regexes = lists[0].map(toRegExp);
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
	'git -C "$wt" push -u origin feat',
	"git -C /tmp/wt push --force-with-lease",
	"git -c credential.helper= push origin main",
	"env GIT_TRACE=1 git push origin main",
	"env GH_TOKEN=x gh api user",
	"env GH_TOKEN=x gh pr create --fill",
	"gh issue create --title t --body b",
	"gh issue close 3",
	"gh issue edit 3 --add-label bug",
	"gh pr ready 12",
	"gh pr reopen 12",
	"gh release edit v1.0 --draft=false",
	"gh release upload v1.0 dist.tar.gz",
	"gh release delete v1.0 --yes",
	"gh repo edit --visibility public",
	"gh repo delete o/r --yes",
	"gh secret set TOKEN < token.txt",
	"gh workflow run ci.yml",
	"echo {} > .flow/runtime/gates.json",
	"cp x .flow/runtime/gates.json",
	"cd /repo && printf '{}' | tee .flow/runtime/gates.json",
	"rm -rf /repo/.flow/runtime",
	"echo {} >.flow/runtime/gates.json",
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
	'git -C "$wt" status --porcelain',
	"git -C /tmp/wt log --oneline -5",
	"git -c core.pager=cat log -1",
	"env LC_ALL=C git status",
	"gh pr view 12",
	"gh issue list",
	"gh issue view 3",
	"gh release view v1.0",
	"gh release list",
	"gh secret list",
	"gh workflow list",
	"gh workflow view ci.yml",
	"ls .flow/plans",
	"rm -rf .flow/contracts/x.md",
	"cat .flow/contracts/audit-residuals.md",
	"echo notes > .flow/plans/demo/PLAN.md",
];

for (const command of mustPrompt) assert.ok(prompts(command), `must prompt: ${command}`);
for (const command of mustNotPrompt) assert.ok(!prompts(command), `must not prompt: ${command}`);

console.log(`ok: bash approval patterns (${regexes.length} patterns, ${mustPrompt.length} prompt, ${mustNotPrompt.length} silent)`);
