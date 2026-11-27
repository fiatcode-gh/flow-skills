/**
 * flow-skills — Claude Code flow-guard: which tools run a shell, and the rule for every other tool.
 *
 * Invariant: `Workflow` is refused by name, since it runs scripts and starts subagents the guard cannot inspect. A tool
 * in `UNJUDGED_TOOLS` is left to its own rule or opens no file the model names. Every other tool is judged by its
 * input: a code key that carries code refuses the call, because the guard cannot read code it does not run; then every
 * key and every value anywhere in the input that is a single-line string is judged as a path. A string that is one line
 * once its surrounding whitespace is trimmed is judged trimmed too, and a `file:` URI (with or without `//`) by its
 * decoded path. The secret-file rule refuses one that names a credentials file existing under the session directory or
 * the repository root, and the `.flow/runtime` rule refuses one that lands there or cannot be resolved, so a path the
 * file tools are refused cannot reach another tool. Strings are judged by value rather than by key name because MCP
 * tools name files under keys no list foresees (`source`, `destination`, `pathInProject`, `uri`), and sometimes as
 * keys; a multi-line string is content, not a path, and is not judged.
 * `shellCommand` is the one answer to which tools run a shell, so the secret, runtime and publication rules cannot
 * disagree on it.
 */
import { secretPathRefusal } from "./credentials.ts";
import type { Host } from "./host.ts";
import { runtimePathRefusal } from "./runtime-writes.ts";
import { repoRoot } from "./tree.ts";

// Each tool the rule below leaves alone, mapped to the reason. A tool is added only with its reason.
const UNJUDGED_TOOLS: Record<string, string> = {
	Read: "secret rule 2 on its file_path",
	Grep: "secret rule 2 on its path and glob",
	Write: "the .flow/runtime rule on its target",
	Edit: "the .flow/runtime rule on its target",
	NotebookEdit: "the .flow/runtime rule on its target",
	Bash: "the shell rules on its command",
	PowerShell: "the shell rules on its command",
	Monitor: "the shell rules on its command",
	Agent: "the dispatch gate reads its brief",
	SendMessage: "the resume gate and the version floor",
	TodoWrite: "keeps the session's task list; opens no file",
	AskUserQuestion: "asks the user; opens no file",
	ExitPlanMode: "shows the plan to the user; opens no file",
	Skill: "loads a skill by name; opens no file the model names",
	WebSearch: "queries the web; opens no local file",
	WebFetch: "fetches a URL over the network; opens no local file",
	mcp__fiatcode__flow_gate: "its own handler resolves the artifact inside .flow/ and refuses control characters",
};

const WORKFLOW_REFUSAL =
	"Flow guard: Workflow runs scripts and starts subagents the guard cannot inspect, so it is refused. Run the steps through Bash and Agent, where the secret-file, .flow/runtime, publication and dispatch checks apply.";

const SHELL_TOOLS: Record<string, true> = { Bash: true, PowerShell: true, Monitor: true };

// A tool that runs code and may still pass, mapped to the reason it is safe. A tool is added only with its reason.
const CODE_TOOL_ALLOW: Record<string, string> = {};

// Keys compared lower-cased with `-` and `_` removed, so `command`, `Command` and `com-mand` are one key.
const CODE_KEYS: Record<string, true> = { command: true, script: true, code: true };

// The engine's own keys on a `tool.call` event, beside the tool's arguments; they are not the tool's input.
const ENGINE_KEYS: Record<string, true> = { tool: true, tool_use_id: true, agentId: true };

// The input itself is level 1; a container below level 16 is not read, and the call is refused instead.
const MAX_DEPTH = 16;

function isContainer(value: unknown): value is Record<string, unknown> | unknown[] {
	return value !== null && typeof value === "object";
}

type Reading = { codeKey: string | undefined; unreadable: boolean; values: string[] };

// Records `text` when it is non-empty and holds no line break, and its trimmed form when that differs and passes the
// same test: a path pasted with a trailing newline or padded with spaces still names the file.
function collect(text: string, reading: Reading): void {
	const single = (candidate: string) => candidate !== "" && !candidate.includes("\n") && !candidate.includes("\r");
	if (single(text)) reading.values.push(text);
	const trimmed = text.trim();
	if (trimmed !== text && single(trimmed)) reading.values.push(trimmed);
}

// Walks `value` at `depth`, recording the first code key as written, whether a part lay too deep to read, and every
// string `collect` keeps, keys included; the engine's own top-level keys are skipped with their values.
function walk(value: unknown, depth: number, reading: Reading): void {
	if (typeof value === "string") {
		collect(value, reading);
		return;
	}
	if (!isContainer(value)) return;
	if (depth > MAX_DEPTH) {
		reading.unreadable = true;
		return;
	}
	if (Array.isArray(value)) {
		for (const item of value) walk(item, depth + 1, reading);
		return;
	}
	for (const [key, child] of Object.entries(value)) {
		if (depth === 1 && ENGINE_KEYS[key] === true) continue;
		// Code is a non-empty string, a list or an object: a number or a flag runs nothing.
		const name = key.toLowerCase().replace(/[-_]/g, "");
		const isCode = (typeof child === "string" && child !== "") || isContainer(child);
		if (reading.codeKey === undefined && CODE_KEYS[name] === true && isCode) reading.codeKey = key;
		collect(key, reading);
		walk(child, depth + 1, reading);
	}
}

// A `file:` URI's path, with or without `//`: cut at the first `?` or `#` (a query or fragment, as URL parsers read it;
// an encoded `%23` stays in the name), percent-decoded (left as written when it does not decode), a drive path's
// leading `/` dropped, and an authority other than `localhost` kept as `//<authority>`. Any other value is returned
// unchanged.
function fileUriPath(value: string): string {
	const match = /^file:(?:\/\/([^/?#]*)(\/[^?#]*)?|(\/[^?#]*))(?:[?#].*)?$/is.exec(value);
	if (match === null) return value;
	const authority = match[1] ?? "";
	const rawPath = match[2] ?? match[3] ?? "/";
	let path: string;
	try {
		path = decodeURIComponent(rawPath);
	} catch {
		return value;
	}
	if (/^\/[A-Za-z]:[\\/]/.test(path)) path = path.slice(1);
	return authority === "" || authority.toLowerCase() === "localhost" ? path : `//${authority}${path}`;
}

// The shell text a tool runs: `Bash`, `PowerShell`, and a `Monitor` with a `command` (one with only `ws` runs none).
export function shellCommand(tool: string, input: Record<string, unknown>): string | undefined {
	if (SHELL_TOOLS[tool] !== true) return undefined;
	return typeof input.command === "string" ? input.command : undefined;
}

// The reason a tool without a rule of its own must not run, or undefined. The first refusal wins: `Workflow`, code, an
// input nested too deep, a string naming an existing secret file, then a string that lands in `.flow/runtime` or cannot
// be resolved. The repository root is read once per call, never per string.
export async function foreignToolRefusal(
	host: Host,
	cwd: string,
	tool: string,
	input: Record<string, unknown>,
): Promise<string | undefined> {
	if (tool === "Workflow") return WORKFLOW_REFUSAL;
	if (Object.hasOwn(UNJUDGED_TOOLS, tool)) return undefined;
	const reading: Reading = { codeKey: undefined, unreadable: false, values: [] };
	walk(input, 1, reading);
	if (reading.codeKey !== undefined && !Object.hasOwn(CODE_TOOL_ALLOW, tool)) {
		return (
			`Flow guard: ${tool} runs code the guard cannot inspect (${reading.codeKey}), so it is refused. ` +
			"Run it through Bash, where the secret-file, .flow/runtime and publication checks apply."
		);
	}
	if (reading.unreadable) return `Flow guard failed closed: the ${tool} input is nested deeper than ${MAX_DEPTH} levels; nothing ran.`;
	const values = [...new Set(reading.values.map(fileUriPath))];
	if (values.length === 0) return undefined;
	const root = cwd === "" ? undefined : await repoRoot(host, cwd).catch(() => undefined);
	const bases = root === undefined || root === cwd ? [cwd] : [cwd, root];
	for (const value of values) {
		const refusal = await secretPathRefusal(host, bases, tool, value);
		if (refusal !== undefined) return refusal;
	}
	return await runtimePathRefusal(host, cwd, values);
}
