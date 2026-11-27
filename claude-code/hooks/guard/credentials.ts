/**
 * flow-skills — Claude Code flow-guard: secret-file refusal.
 *
 * Invariant: no `Read`, `Grep`, `Bash`, `PowerShell` or `Monitor` call prints a known credentials file, nor does any
 * other tool name an existing one (under the session directory or the repository root) in a single-line string of its
 * input; loading one into a program stays allowed.
 * Rule 1 (what a credentials file is) and Rule 3 (shell text) carry OMP's rules 1 and 3, pinned by
 * `tests/validate.py` — with the substitutions this realm forces: `node:os`'s homedir arrives as a parameter, and
 * `node:fs`'s `realpathSync` is `canonicalPath` (`Host.stat().realPath`, filled because the guard's `stat` passes
 * `{ resolve: true }`, or `realpath` for a host whose `stat` answers none even then). Rule 2 is this port's over
 * Claude's inputs. The guard refuses and never asks, in every session. It is a backstop for the common
 * shapes, not a sandbox (misses: docs/EXTERNAL-INTEROP.md).
 */
import type { Host } from "./host.ts";
import { basename, dirname, exceedsPathLimit, resolve } from "./paths.ts";
import { shellCommand } from "./tool-inputs.ts";
import { absoluteTarget, canonicalPath } from "./tree.ts";

// The mods loader refuses `node:*` and `paths.ts` carries no `extname`, so rule 1's one extension read is answered
// here, as Node answers it: a leading dot is not an extension, a trailing dot is.
function extname(path: string): string {
	const name = basename(path);
	const dot = name.lastIndexOf(".");
	return dot <= 0 ? "" : name.slice(dot);
}

// Rule 1: what a credentials file is, decided on the last segment of an absolute path.
const EXAMPLE_NAME = /(?:^|[._-])(?:example|sample)(?:[._-]|$)/i;
const CREDENTIALS_EXTENSIONS: Record<string, true> = {
	"": true,
	".json": true,
	".yml": true,
	".yaml": true,
	".toml": true,
	".ini": true,
	".cfg": true,
	".conf": true,
	".properties": true,
	".txt": true,
	".md": true,
	".csv": true,
	".xml": true,
	".env": true,
};
const SSH_KEY_NAME = /^id_(?:rsa|dsa|ecdsa|ed25519)(?:_sk)?$/;
const KEY_EXTENSION = /\.(?:pem|key|p12|pfx|ppk)$/;
const PUBLIC_KEY_NAME = /(?:^|[._-])(?:pub|public|cert|certs|chain|fullchain|ca|csr)(?:[._-]|$)/i;

function isCredentialsFile(absolute: string): boolean {
	const name = basename(absolute);
	if (EXAMPLE_NAME.test(name)) return false;
	if (name.startsWith(".env") || name === "mcp.json" || name === ".mcp.json") return true;
	if (name === "service.json" && basename(dirname(absolute)) === "opencode") return true;
	if (name.toLowerCase().includes("credentials") && Object.hasOwn(CREDENTIALS_EXTENSIONS, extname(name).toLowerCase())) return true;
	if (SSH_KEY_NAME.test(name)) return true;
	return KEY_EXTENSION.test(name) && !PUBLIC_KEY_NAME.test(name);
}

// Rule 2 of this port: a `Read` path or a `Grep` entry, resolved from the session cwd with `~` expanded the way the
// harness expands it (`absoluteTarget`), plus its symlink target when it exists. Returns the credentials file it names,
// if any. A target that cannot be resolved to an absolute path throws, and the guard's `.catch` refuses the call,
// because the module has no platform path library to resolve it another way.
async function namedCredentialsFile(host: Host, cwd: string, raw: string): Promise<string | undefined> {
	if (raw === "") return undefined;
	const absolute = await absoluteTarget(host, cwd, raw);
	// The guard's own `stat` passes `{ resolve: true }`, which is what makes the engine fill `realPath`; `realpath`
	// is the fallback for a host whose `stat` answers none even then. A host that can answer neither leaves only the
	// name as written, as OMP does when `realpathSync` throws.
	const locations = [absolute, (await canonicalPath(host, absolute)) ?? absolute];
	const hit = locations.find(isCredentialsFile);
	return hit === undefined ? undefined : basename(hit);
}

// Claude's `grep` searches one path and filters files by `glob`. The glob joins the path as one entry; a glob in its
// last segment is also tested with its wildcards removed (OMP's rule), so `.env*` reads as `.env` and `id_rsa*` as
// `id_rsa`.
async function grepCredentialsFile(
	host: Host,
	cwd: string,
	path: string | undefined,
	glob: string | undefined,
): Promise<string | undefined> {
	if (path !== undefined && path !== "") {
		const hit = await namedCredentialsFile(host, cwd, path);
		if (hit !== undefined) return hit;
	}
	if (glob === undefined || glob === "") return undefined;
	const entry = `${path ?? "."}/${glob}`;
	const slash = entry.lastIndexOf("/");
	const last = entry.slice(slash + 1);
	const entries = /[*?]/.test(last) ? [entry, entry.slice(0, slash + 1) + last.replace(/[*?]/g, "")] : [entry];
	for (const candidate of entries) {
		const hit = await namedCredentialsFile(host, cwd, candidate);
		if (hit !== undefined) return hit;
	}
	return undefined;
}

// Rule 3: `bash` and `eval` text. Each path-like word that names a credentials file is a hit; its context decides.
const PATH_WORD = /[A-Za-z0-9_.~$\/{}@%+-]+/g;
const OUTPUT_TARGET = />\s*["']?$/;
// A search pattern: the hit follows the search word and its flags, or sits inside the still-open quote that starts
// the first argument with no `$` or backtick before it (an outer shell would expand those).
const SEARCH_PATTERN = /(?:^|[\s("'`$|;&\/])(?:grep|egrep|fgrep|rg|ag|ack)(?:\s+-\S*)*\s+(?:["'\\]*|'[^'$`]*|"[^"$`]*)$/;
const SOURCED = /(?:^|[\s;(&|])(?:\.|source)\s+["']?$/;
const QUIET_SOURCE = /^["']?\s*(?:&>\s*\/dev\/null|>\s*\/dev\/null\s+2>\s*(?:&1|\/dev\/null))/;
const INPUT_REDIRECT = /<\s*["']?$/;
const HEREDOC = /<<\s*["']?$/;
const READER_WORD =
	/(?:^|[\s("'`$|;&\/])(?:cat|tac|nl|head|tail|less|more|bat|batcat|grep|egrep|fgrep|rg|ag|ack|sed|awk|gawk|cut|sort|uniq|jq|yq|xxd|od|hexdump|strings|base64|base32|diff|paste|column|fold|tee|dd|show|blame|cat-file)(?=\s)/;
const READ_CALL = /(?:\b(?:open|read\w*|file_get_contents|slurp)|\.file)\s*\(/;

function expandWord(word: string, home: string): string {
	if (word === "~" || word === "$HOME" || word === "${HOME}") return home;
	for (const prefix of ["~/", "$HOME/", "${HOME}/"]) {
		if (word.startsWith(prefix)) return home + word.slice(prefix.length - 1);
	}
	return word;
}

// `(` minus `)`: above zero, the position sits inside an open subshell or group.
function openParens(text: string): number {
	return text.split("(").length - text.split(")").length;
}

// Start of the bash statement that ends at `head`'s end: after the last newline, or after the last `;`, `|` or `&`
// on that line that sits outside quotes. A backslash outside single quotes escapes the next character, so a line
// continuation does not end the statement. Quote state never crosses a newline.
function shellStatementStart(head: string): number {
	let start = 0;
	let quote = "";
	for (let i = 0; i < head.length; i++) {
		const c = head[i];
		if (c === "\\" && quote !== "'") i++;
		else if (c === "\n") {
			start = i + 1;
			quote = "";
		} else if (quote !== "") {
			if (c === quote) quote = "";
		} else if (c === "'" || c === '"') quote = c;
		else if (c === ";" || c === "|" || c === "&") start = i + 1;
	}
	return start;
}

// Whether the hit at [start, end) would be printed. The rules run in their locked order; the first that decides wins.
function hitPrints(text: string, start: number, end: number, shell: boolean): boolean {
	const head = text.slice(0, start);
	const statementStart = shell ? shellStatementStart(head) : head.lastIndexOf("\n") + 1;
	const before = text.slice(statementStart, start);
	const lineEnd = text.indexOf("\n", end);
	const after = text.slice(end, lineEnd === -1 ? text.length : lineEnd);

	if (OUTPUT_TARGET.test(before)) return false;
	if (SEARCH_PATTERN.test(before)) return false;
	if (SOURCED.test(before)) return !(openParens(head) > 0 && QUIET_SOURCE.test(after));
	if (INPUT_REDIRECT.test(before) && !HEREDOC.test(before)) return true;
	if (READER_WORD.test(before)) return true;
	if (shell) return READ_CALL.test(before);
	const lineStart = head.lastIndexOf("\n") + 1;
	return READ_CALL.test(text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd));
}

function printedCredentialsFile(text: string, cwd: string, shell: boolean, home: string): string | undefined {
	for (const match of text.matchAll(PATH_WORD)) {
		const word = match[0].replace(/[.,:]+$/, "");
		if (word === "") continue;
		const absolute = resolve(cwd, expandWord(word, home));
		if (!isCredentialsFile(absolute)) continue;
		const start = match.index ?? 0;
		if (hitPrints(text, start, start + match[0].length, shell)) return basename(absolute);
	}
	return undefined;
}

// These are the PowerShell spellings of a reader that OMP's bash reader list cannot name: the `[IO.File]::Read*` calls,
// the `${path}` variable that reads a file, and `Get-Content`, `Select-String`, `Format-Hex` with their aliases, in any
// case. They are spelled as the bash reader they mirror, in this order, before the ordered rules run, so the
// PowerShell tool is held to the same matcher and the same allowed loader shapes (this port's input rule). The pipe
// form `Get-Item <file> | Get-Content` names no file to its reader and stays a listed miss.
function powerShellReaders(command: string): string {
	return command
		.replace(/\[(?:System\.)?IO\.File\]::Read\w*\s*\(/gi, "cat (")
		.replace(/\$\{([^}]+)\}/g, "cat $1")
		.replace(/\b(?:Get-Content|gc|cat|type|Select-String|sls|Format-Hex|fhx)\b/gi, "cat");
}

// OMP's refusal sentence unchanged, with the tool named in lowercase so one pattern matches both ports.
export function credentialsRefusal(tool: string, name: string): string {
	return (
		`Flow credentials guard: this ${tool.toLowerCase()} call would print a credentials file (${name}). ` +
		"Cite its path instead; take key names from a committed example file or from the user. " +
		"Loading it stays allowed: a program's own loader (--env-file), or ( set -a; . <file> >/dev/null 2>&1; set +a; exec <command> )."
	);
}

// A single-line string of a tool with no rule of its own (`foreignToolRefusal`), judged as rule 2 judges a `Read` path
// but only when it names an existing file, symlinks followed: such a tool can only print a file that exists, and a
// string that names none is prose ("rotate the credentials") or a file still to be written. It is looked up from each
// of `bases` in turn, the session directory first, then the repository root, because MCP and IDE servers often resolve
// relative paths against the project root; the first base where it names an existing file decides. A string that
// resolves past the path limit names no file. A string that cannot be resolved is left to the `.flow/runtime` rule,
// which refuses it.
export async function secretPathRefusal(
	host: Host,
	bases: readonly string[],
	tool: string,
	raw: string,
): Promise<string | undefined> {
	const tried = new Set<string>();
	for (const base of bases) {
		let absolute: string;
		try {
			absolute = await absoluteTarget(host, base, raw);
		} catch {
			continue;
		}
		if (tried.has(absolute) || exceedsPathLimit(absolute)) continue;
		tried.add(absolute);
		if (!(await namesExistingFile(host, absolute))) continue;
		const hit = await namedCredentialsFile(host, base, raw);
		return hit === undefined ? undefined : credentialsRefusal(tool, hit);
	}
	return undefined;
}

// True when `absolute` is a file, or a link that lands on one.
async function namesExistingFile(host: Host, absolute: string): Promise<boolean> {
	const stats = await host.stat(absolute).catch(() => undefined);
	if (stats === undefined) return false;
	if (stats.kind === "file") return true;
	const canonical = await canonicalPath(host, absolute);
	return canonical !== undefined && (await host.stat(canonical).catch(() => undefined))?.kind === "file";
}

// The reason a `Read`, `Grep` or shell-tool call (`shellCommand`) must not run, or undefined. A malformed input (a
// field of the wrong type, or an empty path) raises no refusal, as the OpenCode guard answers it; an unresolvable
// target throws.
export async function secretRefusal(
	host: Host,
	cwd: string,
	tool: string,
	input: Record<string, unknown>,
): Promise<string | undefined> {
	if (tool === "Read") {
		const path = input.file_path;
		if (typeof path !== "string") return undefined;
		const hit = await namedCredentialsFile(host, cwd, path);
		return hit === undefined ? undefined : credentialsRefusal(tool, hit);
	}
	if (tool === "Grep") {
		const path = input.path;
		const glob = input.glob;
		if (path !== undefined && typeof path !== "string") return undefined;
		if (glob !== undefined && typeof glob !== "string") return undefined;
		const hit = await grepCredentialsFile(host, cwd, path, glob);
		return hit === undefined ? undefined : credentialsRefusal(tool, hit);
	}
	const command = shellCommand(tool, input);
	if (command !== undefined) {
		const home = (await host.env("HOME")) ?? (await host.env("USERPROFILE")) ?? "";
		const text = tool === "PowerShell" ? powerShellReaders(command) : command;
		const hit = printedCredentialsFile(text, cwd, true, home);
		return hit === undefined ? undefined : credentialsRefusal(tool, hit);
	}
	return undefined;
}
