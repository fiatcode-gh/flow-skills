/**
 * flow-skills — Claude Code flow-guard: `.flow/runtime` write protection.
 *
 * Invariant: only `flow_gate` writes `.flow/runtime/`. A `Write`, `Edit` or `NotebookEdit` target that lands there, as
 * written or with symlinks followed, is refused. A shell tool's call (`shellCommand`) is refused when its text, read
 * the way the shell reads it, names the directory, enters `.flow` and names `runtime`, or runs from a session directory
 * inside `.flow` and names `runtime` (or inside `.flow/runtime` at all). Every comparison folds case and a part's
 * trailing dots and spaces, on every platform: Windows and macOS disks treat `.flow/Runtime` and `.flow.\runtime.` as
 * the directory, and refusing those spellings on Linux is only a fail-closed false positive. Any error while resolving
 * refuses the call. The path logic is OMP's (omp/extensions/flow-governance-guard.ts), over this port's tool inputs.
 *
 * Text-only remainder: a name built by a variable, a glob such as `runt?me`, or a command built at run time is not
 * seen in shell text; nor is a working directory the engine's session does not report. Being a text search, the
 * substring clause also refuses text that only mentions the directory (`echo .flow/runtime`, `.flow/runtimes`,
 * `x.flow/runtime`, `.flow/../runtime`).
 */
import type { Host } from "./host.ts";
import { exceedsPathLimit, resolve, sepOf } from "./paths.ts";
import { lexShellCommand, powerShellText } from "./shell.ts";
import { shellCommand } from "./tool-inputs.ts";
import { absoluteTarget, canonicalPath, repoRoot } from "./tree.ts";

const RUNTIME_WRITE_REASON =
	"Only flow_gate writes .flow/runtime/; a hand-written record is not an approval. Use flow_gate present/approve, accept or clear instead.";

// The input field each write tool names its target in (Claude Code 2.1.331's tool inputs, checked live).
const TARGET_FIELDS: Record<string, string> = {
	Write: "file_path",
	Edit: "file_path",
	NotebookEdit: "notebook_path",
};

// Shell words that move the shell into the directory named after them; `-C` is git's and make's.
const ENTER_WORDS: Record<string, true> = { cd: true, pushd: true, chdir: true, "set-location": true, sl: true, "push-location": true };

// A path's parts as a case-insensitive, trailing-dot-stripping disk reads them: empty and `.` parts dropped, every other
// part lower-cased and stripped of trailing dots and spaces, except `..`, which stays a climb. `\` separates only when
// `windows` is set: on POSIX it is a file-name character.
function foldedParts(path: string, windows: boolean): string[] {
	const parts: string[] = [];
	for (const part of path.split(windows ? /[\\/]+/ : /\/+/)) {
		const folded = part === ".." ? part : withoutTrailingDotsAndSpaces(part.toLowerCase());
		if (folded !== "") parts.push(folded);
	}
	return parts;
}

// One backward scan: a `[. ]+$` pattern retries from every dot or space in a long run and costs its square.
function withoutTrailingDotsAndSpaces(part: string): string {
	let end = part.length;
	while (end > 0 && (part[end - 1] === "." || part[end - 1] === " ")) end -= 1;
	return part.slice(0, end);
}

// `..` applied lexically, as the shell and the filesystem apply it to a path that names no symlink.
function collapsed(parts: string[]): string[] {
	const out: string[] = [];
	for (const part of parts) {
		if (part === ".." && out.length > 0 && out[out.length - 1] !== "..") out.pop();
		else out.push(part);
	}
	return out;
}

function namesRuntimeDir(parts: string[]): boolean {
	return [parts, collapsed(parts)].some((list) => list.some((part, index) => part === ".flow" && list[index + 1] === "runtime"));
}

// `.flow/runtime` anywhere in the text, folded: any case, trailing dots and spaces on `.flow`, and repeated separators
// or `.` parts between the two. A substring test with no boundary on either side, as the OpenCode port's `includes`,
// so a path glued to a redirect, an option or an assignment (`>.flow/…`, `-o.flow/…`, `of=.flow/…`) is found.
const RUNTIME_SPELLED = /\.flow[. ]*\/(?:[. ]*\/)*runtime/i;
const RUNTIME_SPELLED_WINDOWS = /\.flow[. ]*[\\/](?:[. ]*[\\/])*runtime/i;

// The characters a shell or a quoted program puts around a path: a word split on them yields the path itself, so
// `x>runtime/a` holds the part `runtime` and `.flow;printf` the target `.flow`.
const PIECE_BREAK = /[\s<>=:'"(),;&|`$]+/;

function pieces(words: string[]): string[] {
	return words.flatMap((word) => word.split(PIECE_BREAK).filter((piece) => piece !== ""));
}

// True when a word that moves the shell (`cd`, `pushd`, `Set-Location`, `-C`, …) is followed by a path holding `.flow`;
// options between them (`cd -P`, `Set-Location -Path`) are skipped.
function entersFlow(words: string[], windows: boolean): boolean {
	return words.some((word, index) => {
		if (ENTER_WORDS[word.toLowerCase()] !== true && word !== "-C") return false;
		const target = words.slice(index + 1).find((next) => word === "-C" || !next.startsWith("-"));
		return target !== undefined && foldedParts(target, windows).includes(".flow");
	});
}

// The reason a shell tool's command must not run, or undefined. The text is searched for the directory as written and
// after the lexer's quote and escape removal; then the words are read in four forms — the lexer's values, the raw
// whitespace-separated words, and each of those split into pieces — so a quoted, escaped, glued or `\`-separated
// spelling is read in whichever form names the directory.
export async function runtimeShellRefusal(host: Host, cwd: string, tool: string, command: string): Promise<string | undefined> {
	try {
		const text = tool === "PowerShell" ? powerShellText(command) : command;
		const windows = tool === "PowerShell" || sepOf(cwd) === "\\";
		const lexed = lexShellCommand(text).flatMap((token) => (token.kind === "word" ? [token.value] : []));
		const spelled = windows ? RUNTIME_SPELLED_WINDOWS : RUNTIME_SPELLED;
		if (spelled.test(text) || spelled.test(lexed.join(" "))) return RUNTIME_WRITE_REASON;
		const raw = text.split(/\s+/).filter((word) => word !== "");
		const rawPieces = pieces(raw);
		const parts = [...lexed, ...raw, ...pieces(lexed), ...rawPieces].map((word) => foldedParts(word, windows));
		if (parts.some(namesRuntimeDir)) return RUNTIME_WRITE_REASON;
		const namesRuntime = parts.some((list) => list.includes("runtime"));
		if (namesRuntime && [lexed, raw, rawPieces].some((words) => entersFlow(words, windows))) return RUNTIME_WRITE_REASON;
		if (cwd === "") return undefined;
		const canonical = await canonicalPath(host, cwd);
		for (const dir of canonical === undefined ? [cwd] : [cwd, canonical]) {
			const dirParts = collapsed(foldedParts(dir, windows));
			if (namesRuntimeDir(dirParts)) return RUNTIME_WRITE_REASON;
			if (namesRuntime && dirParts.includes(".flow")) return RUNTIME_WRITE_REASON;
		}
		return undefined;
	} catch {
		return RUNTIME_WRITE_REASON;
	}
}

// True when `path` is `dir` or below it, compared on folded parts.
function isWithin(dir: string, path: string): boolean {
	const dirParts = collapsed(foldedParts(dir, sepOf(dir) === "\\"));
	const pathParts = collapsed(foldedParts(path, sepOf(path) === "\\"));
	return dirParts.length <= pathParts.length && dirParts.every((part, index) => part === pathParts[index]);
}

// `<root>/.flow/runtime` with symlinks resolved, at the repository root and at the working directory: a write below
// it hits gate state even when `.flow` or `runtime` is a symlink and the written path names neither. The deepest
// existing ancestor anchors it, so a symlinked `.flow` counts before any gate state has been written.
async function realRuntimeDirs(host: Host, cwd: string): Promise<string[]> {
	const anchors: string[] = [];
	if (cwd !== "") {
		try {
			anchors.push(await repoRoot(host, cwd));
		} catch {
			// Outside git, the working directory is the only anchor.
			anchors.push((await canonicalPath(host, cwd)) ?? cwd);
		}
		anchors.push(cwd);
	}
	const dirs: string[] = [];
	for (const anchor of new Set(anchors)) {
		const dir = await canonicalPath(host, resolve(anchor, ".flow/runtime"));
		if (dir !== undefined) dirs.push(dir);
	}
	return dirs;
}

// The reason a write to any of `raws`, each resolved from `cwd` as written and with symlinks followed, must not run, or
// undefined. The real runtime directories are read once for the whole list. A path past the limit cannot be opened, so
// it is judged on its text and never refuses as uncanonicalisable.
export async function runtimePathRefusal(host: Host, cwd: string, raws: readonly string[]): Promise<string | undefined> {
	if (raws.length === 0) return undefined;
	try {
		const runtimeDirs = await realRuntimeDirs(host, cwd);
		const landsIn = (path: string) =>
			namesRuntimeDir(foldedParts(path, sepOf(path) === "\\")) || runtimeDirs.some((dir) => isWithin(dir, path));
		for (const raw of raws) {
			const written = await absoluteTarget(host, cwd, raw);
			if (exceedsPathLimit(written)) {
				if (landsIn(written)) return RUNTIME_WRITE_REASON;
				continue;
			}
			const canonical = await canonicalPath(host, written);
			// A host that can canonicalise neither the target nor one of its ancestors cannot prove the target is outside
			// `.flow/runtime/`, so the answer is "it might be" rather than the path as written.
			if (canonical === undefined) return RUNTIME_WRITE_REASON;
			if ([written, canonical].some(landsIn)) return RUNTIME_WRITE_REASON;
		}
		return undefined;
	} catch {
		return RUNTIME_WRITE_REASON;
	}
}

// The reason a shell tool's, `Write`, `Edit` or `NotebookEdit` call must not run, or undefined. A tool with no
// write target raises no refusal: this guard is a write guard, so reading `.flow/runtime` through a file tool stays
// allowed.
export async function runtimeWriteRefusal(
	host: Host,
	cwd: string,
	tool: string,
	input: Record<string, unknown>,
): Promise<string | undefined> {
	const command = shellCommand(tool, input);
	if (command !== undefined) return await runtimeShellRefusal(host, cwd, tool, command);
	const field = TARGET_FIELDS[tool];
	if (field === undefined) return undefined;
	const target = input[field];
	if (typeof target !== "string" || target === "") return undefined;
	return await runtimePathRefusal(host, cwd, [target]);
}
