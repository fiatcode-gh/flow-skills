// Behavioral tests for the Flow credentials guard, driven through its registered tool_call handler.
// Dependency-free: Node native TypeScript stripping loads the extension directly.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import guardExtension from "../omp/extensions/flow-credentials-guard.ts";

let toolCall;
guardExtension({
	on(event, handler) {
		if (event === "tool_call") toolCall = handler;
	},
});

assert.equal(typeof toolCall, "function", "guard must register a tool_call handler");

const CWD = "/work/app";
const call = (toolName, input, { cwd = CWD, hasUI = true } = {}) => toolCall({ toolName, input }, { cwd, hasUI });

async function refused(toolName, input, options) {
	const result = await call(toolName, input, options);
	assert.equal(result?.block, true, `${toolName} ${JSON.stringify(input)} must be refused`);
	assert.equal(typeof result.reason, "string");
	return result;
}

async function allowed(toolName, input, options) {
	const result = await call(toolName, input, options);
	assert.equal(result, undefined, `${toolName} ${JSON.stringify(input)} must be allowed, got ${JSON.stringify(result)}`);
}

// Rule 2: the read tool.
for (const path of [
	".env",
	".env.local:1-20",
	"./config/../.env",
	"~/.config/opencode/service.json",
	"mcp.json:raw",
	"sandbox-credentials.md",
	"ssh://host/srv/app/.env",
	":./.env",
	"~/.aws/credentials",
	"keys/id_rsa",
	"certs/server.p12",
	".mcp.json",
	"proj/.mcp.json:1-5",
]) {
	await refused("read", { path });
}

for (const path of [
	".env.example",
	".env.sample",
	"omp/mcp.example.json",
	"service.json",
	"src/auth/credentials.ts",
	"CredentialsForm.tsx",
	"id_rsa.pub",
	"certs/fullchain.pem",
	"certs/server.pub.pem",
	"README.md",
	"app.env",
	".npmrc",
	".mcp.example.json",
]) {
	await allowed("read", { path });
}

// The prefix must not itself name a credentials file: a directory called `…credentials…` counts as one.
const scratch = mkdtempSync(join(tmpdir(), "flow-guard-fixture-"));
try {
	writeFileSync(join(scratch, ".env"), "TOKEN=fixture\n");
	symlinkSync(".env", join(scratch, "notes.txt"));
	await refused("read", { path: "notes.txt" }, { cwd: scratch });
	await refused("read", { path: "notes.txt:1-5" }, { cwd: scratch });
	await allowed("read", { path: scratch });
	await allowed("read", { path: "." }, { cwd: scratch });
} finally {
	rmSync(scratch, { recursive: true, force: true });
}

// Rule 2: the grep tool.
for (const path of [".env", "src;.env.production", "**/*credentials*.json", "!docs;.env*", "**/.mcp.json"]) {
	await refused("grep", { pattern: "TOKEN", path });
}
await allowed("grep", { pattern: "\\.env", path: "docs" });
await allowed("grep", { pattern: "TOKEN", path: "src/**/*.ts" });
await allowed("grep", { pattern: "TOKEN", path: "src;!.env" });
await allowed("grep", { pattern: "TOKEN" });

// Rule 3: bash.
const bashRefused = [
	"cat .env",
	"cat ~/.config/opencode/service.json",
	"sed -n 1,15p sandbox-credentials.md | grep -i -E 'password|token|secret'",
	`sed -E 's/(key"?: *")[^"]+/\\1***/' ~/.omp/profiles/anthropic/agent/mcp.json`,
	"cd /tmp && head -3 /work/app/.env.local",
	"jq . < mcp.json",
	"x=$(< .env)",
	'bash -c "cat .env"',
	"ssh host 'cat /srv/app/.env'",
	`python3 -c "print(open('.env').read())"`,
	"export $(grep -v '^#' .env | xargs)",
	"grep API_KEY .env.local",
	"set -a; . ./.env; set +a",
	"source .env",
	"source .env >/dev/null 2>&1",
	"git diff -- .env",
	"git show HEAD:.env",
	"diff .env.example .env",
	"docker compose exec app cat .env",
	"cat ~/.aws/credentials",
	"cat ~/.ssh/id_ed25519",
	"cat certs/server.key",
	"cat $HOME/.env",
	"cat ${HOME}/.env",
	"echo start\ncat .env",
	// A separator inside quotes does not end the statement; the reader word stays in view.
	"grep -E 'PASSWORD|TOKEN' .env",
	'grep -iE "api|key" .env.local',
	"grep 'A\\|B' .env",
	"sed -n '1,5p;6q' .env",
	"sed 's/;.*//' .env",
	"awk -F= '/KEY|SECRET/ {print $1}' .env",
	"sort -t '|' .env",
	'sed -n "1,5p;6q" .env',
	"jq '.mcpServers | keys' ~/.omp/profiles/anthropic/agent/mcp.json",
	// A reader given by its path.
	"/bin/cat .env",
	"/usr/bin/head -3 .env.local",
	"/usr/bin/grep KEY .env",
	"cat .mcp.json",
	// A line continuation does not end the statement.
	"cat \\\n .env",
	// A nested command and a `$` in the quoted pattern stay refused.
	'bash -c "cd /x; cat .env"',
	`bash -c "grep '$(cat .env)' x"`,
	'grep "$(cat .env)" x',
	"grep '$(cat .env)' x",
];
for (const command of bashRefused) await refused("bash", { command });

const bashAllowed = [
	"docker run --env-file .env app",
	"docker run --env-file .env app cat /etc/hosts",
	"node --env-file=.env server.js",
	"uv run --env-file .env pytest -q",
	"( set -a; . ./.env >/dev/null 2>&1; set +a; exec ./run )",
	"cat .env.example",
	"cp .env.example .env",
	"test -f .env && echo present",
	"ls -la .env mcp.json",
	"chmod 600 .env",
	"echo 'FOO=bar' >> .env",
	"base64 -d key.b64 > certs/server.key",
	"git check-ignore -v .env",
	"cat omp/mcp.example.json",
	"cat src/auth/credentials.ts",
	"grep -rn credentials src/",
	'rg -n "\\.env" docs/ README.md',
	"grep -rn 'mcp.json' docs/",
	"find . -name '.env*' -not -path './node_modules/*' | head",
	"source .env/bin/activate",
	"cat ~/.ssh/id_ed25519.pub",
	"ssh -i ~/.ssh/id_ed25519 deploy@host uptime",
	"openssl x509 -in certs/fullchain.pem -noout -dates",
	"cat service.json",
	"cat docs/environment.md",
	// Quote-aware statement starts and whole quoted search patterns.
	'rg -n "\\.env" docs/',
	"grep -rn 'credentials\\|mcp.json' docs/",
	"git ls-files | grep -E 'mcp\\.json|\\.env'",
	'grep -rn "the .env file" docs/',
	"grep -rn '^\\.env$' .gitignore",
	"/usr/bin/grep -rn '\\.env' docs/",
	'test -f .env && echo "has | pipe"',
	'echo "a;b" && ls .env',
	'docker run -e "X=a|b" --env-file .env app',
	"( set -a; . ./.env >/dev/null 2>&1; set +a; exec ./run 'a;b' )",
	"cat .mcp.example.json",
	// Quote state does not cross a newline; a continuation does not turn a loader into a read.
	"# Let's check the config\ncat package.json | head -20\nls -la .env",
	"docker run \\\n  --env-file .env \\\n  app",
];
for (const command of bashAllowed) await allowed("bash", { command });

// `service.json` is a secret only under an `opencode` directory; the bash cwd decides where a relative path lands.
await refused("bash", { command: "cat service.json", cwd: "/home/u/.config/opencode" });
await refused("bash", { command: "cat service.json", cwd: "../opencode" }, { cwd: "/home/u/.config/app" });
await allowed("bash", { command: "cat service.json", cwd: "/srv/app" });

// Rule 3: eval.
const evalRefused = [
	"print(open('.env').read())",
	"const t = await Bun.file('.env.production').text()",
	"sh('cat .env')",
	"from pathlib import Path\nprint(Path('config/credentials.json').read_text())",
	"r = await tool.read({ path: 'mcp.json' })",
	"print(open('.mcp.json').read())",
];
for (const code of evalRefused) await refused("eval", { language: "py", code });

const evalAllowed = [
	"await d.commit('docs: say that .env is never printed', [])",
	"subprocess.run(['docker', 'run', '--env-file', '.env', 'app'])",
	"print(open('README.md').read())",
];
for (const code of evalAllowed) await allowed("eval", { language: "py", code });

// Other tools and malformed inputs pass.
await allowed("write", { path: ".env", content: "FOO=bar\n" });
await allowed("task", { tasks: [{ task: "cat .env" }] });
await allowed("hub", { op: "send", content: "cat .env" });
await allowed("unknown_tool", { path: ".env", command: "cat .env" });
await allowed("bash", {});
await allowed("bash", { command: 42 });
await allowed("read", { path: 7 });
await allowed("eval", { language: "py" });

// The refusal names the tool and the file and points at a loader instead.
let result = await refused("bash", { command: "cat .env" });
assert.match(result.reason, /\bbash\b/);
assert.match(result.reason, /\(\.env\)/);
assert.match(result.reason, /--env-file/);
assert.match(result.reason, /set -a; \. <file> >\/dev\/null 2>&1; set \+a/);
result = await refused("read", { path: "~/.config/opencode/service.json" });
assert.match(result.reason, /\bread\b.*\(service\.json\)/);

// Headless sessions (subagents) are refused the same way; the guard never asks.
for (const hasUI of [false, true]) {
	result = await refused("bash", { command: "cat .env" }, { hasUI });
	assert.match(result.reason, /--env-file/);
	await refused("read", { path: ".env" }, { hasUI });
	await allowed("bash", { command: "docker run --env-file .env app" }, { hasUI });
}

console.log("ok: flow credentials guard");
