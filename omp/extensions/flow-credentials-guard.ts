/**
 * flow-skills — Flow credentials guard.
 *
 * Invariant: no tool call prints a known credentials file. A `read` or `grep` call that names one is refused, and so
 * is a `bash` or `eval` call whose text would print one; loading the file into a program stays allowed. The guard
 * refuses and never asks, in every session, headless subagents included. Stateless: it reads only the tool input.
 * It is a backstop for the common shapes, not a sandbox (misses: docs/OMP-COMPATIBILITY.md).
 */
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, resolve } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { expandToolPath, nonFileUrlPath } from "../lib/tool-path.ts";

type ToolInput = Record<string, unknown>;

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

// Rule 2: a `read` or `grep` path, as written and without a trailing selector chain (`:1-20`, `:raw`), expanded the
// way OMP expands it, plus its symlink target when it exists. Returns the credentials file it names, if any.
const SELECTOR_CHAIN = /(?::[^/:]*)+$/;

function namedCredentialsFile(cwd: string, raw: string): string | undefined {
	const candidates = new Set([raw, raw.replace(SELECTOR_CHAIN, "")]);
	for (const candidate of candidates) {
		if (candidate === "") continue;
		let absolute: string;
		try {
			absolute = resolve(cwd, nonFileUrlPath(candidate) ?? expandToolPath(candidate));
		} catch {
			continue;
		}
		const locations = [absolute];
		try {
			locations.push(realpathSync(absolute));
		} catch {
			// A path that does not exist has no symlink target to check.
		}
		const hit = locations.find(isCredentialsFile);
		if (hit !== undefined) return basename(hit);
	}
	return undefined;
}

// A grep path is a `;` list; `!` entries exclude. A glob in the last segment is tested with its wildcards removed,
// so `.env*` reads as `.env` and `*credentials*.json` as `credentials.json`.
function grepCredentialsFile(cwd: string, raw: string): string | undefined {
	for (const entry of raw.split(";")) {
		if (entry === "" || entry.startsWith("!")) continue;
		const slash = entry.lastIndexOf("/");
		const last = entry.slice(slash + 1);
		const entries = /[*?]/.test(last) ? [entry, entry.slice(0, slash + 1) + last.replace(/[*?]/g, "")] : [entry];
		for (const candidate of entries) {
			const hit = namedCredentialsFile(cwd, candidate);
			if (hit !== undefined) return hit;
		}
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

function expandWord(word: string): string {
	if (word === "~" || word === "$HOME" || word === "${HOME}") return homedir();
	for (const prefix of ["~/", "$HOME/", "${HOME}/"]) {
		if (word.startsWith(prefix)) return homedir() + word.slice(prefix.length - 1);
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

function printedCredentialsFile(text: string, cwd: string, shell: boolean): string | undefined {
	for (const match of text.matchAll(PATH_WORD)) {
		const word = match[0].replace(/[.,:]+$/, "");
		if (word === "") continue;
		const absolute = resolve(cwd, expandWord(word));
		if (!isCredentialsFile(absolute)) continue;
		const start = match.index ?? 0;
		if (hitPrints(text, start, start + match[0].length, shell)) return basename(absolute);
	}
	return undefined;
}

function refusal(tool: string, name: string) {
	return {
		block: true,
		reason:
			`Flow credentials guard: this ${tool} call would print a credentials file (${name}). ` +
			"Cite its path instead; take key names from a committed example file or from the user. " +
			"Loading it stays allowed: a program's own loader (--env-file), or ( set -a; . <file> >/dev/null 2>&1; set +a; exec <command> ).",
	};
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		const input = event.input as ToolInput;
		const cwd = typeof ctx?.cwd === "string" ? ctx.cwd : process.cwd();
		let hit: string | undefined;

		if (event.toolName === "read" && typeof input.path === "string") {
			hit = namedCredentialsFile(cwd, input.path);
		} else if (event.toolName === "grep" && typeof input.path === "string") {
			hit = grepCredentialsFile(cwd, input.path);
		} else if (event.toolName === "bash" && typeof input.command === "string") {
			const shellCwd = typeof input.cwd === "string" ? resolve(cwd, expandToolPath(input.cwd)) : cwd;
			hit = printedCredentialsFile(input.command, shellCwd, true);
		} else if (event.toolName === "eval" && typeof input.code === "string") {
			hit = printedCredentialsFile(input.code, cwd, false);
		}

		if (hit !== undefined) return refusal(event.toolName, hit);
	});
}
