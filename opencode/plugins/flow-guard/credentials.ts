/**
 * flow-skills — OpenCode flow-guard: secret-file refusal.
 *
 * Invariant: no `read`, `grep` or `shell` call prints a known credentials file; loading one into a program stays
 * allowed. Rule 1 (what a credentials file is) and Rule 3 (shell text) are byte-for-byte copies of
 * omp/extensions/flow-credentials-guard.ts, pinned by tests/validate.py, so both ports share one matcher. Rule 2 is
 * this port's: OpenCode's path rule and its `grep` inputs (one path plus an `include` glob).
 */
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, resolve } from "node:path";
import { resolveToolPath } from "./tool-path.ts";

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

// Rule 2 of this port: a `read` or `grep` path, resolved as OpenCode resolves it (no selector chains or URLs, which
// OpenCode tools do not take), plus its symlink target when it exists. Returns the credentials file it names, if any.
export function namedCredentialsFile(cwd: string, raw: string): string | undefined {
	if (raw === "") return undefined;
	let absolute: string;
	try {
		absolute = resolveToolPath(cwd, raw);
	} catch {
		return undefined;
	}
	const locations = [absolute];
	try {
		locations.push(realpathSync(absolute));
	} catch {
		// A path that does not exist has no symlink target to check.
	}
	const hit = locations.find(isCredentialsFile);
	return hit === undefined ? undefined : basename(hit);
}

// OpenCode's `grep` searches one path and filters files by `include`. The include joins the path as one entry; a glob
// in its last segment is also tested with its wildcards removed (OMP's rule), so `.env*` reads as `.env`.
export function grepCredentialsFile(cwd: string, path: string | undefined, include: string | undefined): string | undefined {
	if (path !== undefined && path !== "") {
		const hit = namedCredentialsFile(cwd, path);
		if (hit !== undefined) return hit;
	}
	if (include === undefined || include === "") return undefined;
	const entry = `${path ?? "."}/${include}`;
	const slash = entry.lastIndexOf("/");
	const last = entry.slice(slash + 1);
	const entries = /[*?]/.test(last) ? [entry, entry.slice(0, slash + 1) + last.replace(/[*?]/g, "")] : [entry];
	for (const candidate of entries) {
		const hit = namedCredentialsFile(cwd, candidate);
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

// OMP's refusal sentence unchanged, so one pattern matches both ports.
export function credentialsRefusal(tool: string, name: string): string {
	return (
		`Flow credentials guard: this ${tool} call would print a credentials file (${name}). ` +
		"Cite its path instead; take key names from a committed example file or from the user. " +
		"Loading it stays allowed: a program's own loader (--env-file), or ( set -a; . <file> >/dev/null 2>&1; set +a; exec <command> )."
	);
}

export { printedCredentialsFile };
