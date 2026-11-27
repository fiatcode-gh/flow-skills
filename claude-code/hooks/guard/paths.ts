/**
 * flow-skills — Claude Code flow-guard: POSIX and Windows path helpers.
 *
 * The mods loader refuses the platform path module, so every path the guard judges is resolved here
 * by hand: the separator a path already uses decides the form of the answer, `..` never climbs above a root, and the
 * answer is `/`-separated where a record or a message needs one fixed form.
 *
 * A POSIX path splits on `/` only. There a backslash is a file-name character, as `node:path`'s POSIX helpers and the
 * filesystem read it: splitting on it would collapse `.flow/runtime/x\..\..\notes.md` — one file inside
 * `.flow/runtime` — to `notes.md`, and record an artifact named `a\b.md` as `a/b.md`.
 */

const DRIVE = /^[A-Za-z]:[\\/]/;
const UNC = /^\\\\/;

// The separator a path already speaks. A drive letter or a UNC prefix is Windows even when it spells `/`.
export function sepOf(path: string): "\\" | "/" {
	return DRIVE.test(path) || UNC.test(path) ? "\\" : "/";
}

export function isAbsolute(path: string): boolean {
	return path.startsWith("/") || DRIVE.test(path) || UNC.test(path);
}

// A stored absolute record path is rewritten to the `/` form before its last `/.flow/` segment is read. Only paths that
// may be Windows-form are passed here: a POSIX file name may legally hold a backslash.
export function normalizeSeparators(path: string): string {
	return path.replaceAll("\\", "/");
}

// A canonical answer rewritten into the separator form of the path it was resolved from: the engine may print the
// `/` form on Windows while every root and record path the guard builds speaks `\`. Only that direction is rewritten:
// on POSIX a `\` is a legal file name character, so the answer is the identity key and must stay byte-identical.
export function inSeparatorForm(path: string, sep: "\\" | "/"): string {
	return sep === "\\" ? path.replaceAll("/", "\\") : path;
}

// The parts of `text`, split on the separators of `sep`'s form: `/` on POSIX, `/` and `\` on Windows. `sep` is read
// from the whole path, because a body sliced past its drive or UNC root no longer shows its form.
function partsOf(text: string, sep: "\\" | "/"): string[] {
	return text.split(sep === "/" ? /\/+/ : /[\\/]+/);
}

// The part of `path` that `..` cannot climb above: `/`, `C:\`, or a UNC share root; "" for a relative path.
function rootPrefix(path: string): string {
	const drive = /^([A-Za-z]:)[\\/]/.exec(path);
	if (drive !== null) return `${drive[1]}\\`;
	if (UNC.test(path)) {
		const share = partsOf(path.slice(2), "\\").filter((part) => part !== "");
		return share.length >= 2 ? `\\\\${share[0]}\\${share[1]}\\` : `\\\\${share.join("\\")}`;
	}
	return path.startsWith("/") ? "/" : "";
}

function collapse(parts: string[], rooted: boolean): string[] {
	const out: string[] = [];
	for (const part of parts) {
		if (part === "" || part === ".") continue;
		if (part === "..") {
			if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
			else if (!rooted) out.push("..");
			continue;
		}
		out.push(part);
	}
	return out;
}

// An absolute `raw` wins over `base`; `.` and `..` collapse; the result keeps the separator of the path it came from.
export function resolve(base: string, raw: string): string {
	const source = isAbsolute(raw) || base === "" ? raw : `${base}${sepOf(base)}${raw}`;
	const prefix = rootPrefix(source);
	const sep = sepOf(source);
	const body = collapse(partsOf(source.slice(prefix.length), sep), prefix !== "").join(sep);
	if (prefix === "") return body === "" ? "." : body;
	return body === "" ? prefix : `${prefix}${body}`;
}

// `/`-separated: the form an approval record stores and every message names. A target on another root is answered
// whole, as Node answers it.
export function relative(from: string, to: string): string {
	const a = splitPath(from);
	const b = splitPath(to);
	if (a.root !== b.root) return normalizeSeparators(to);
	let at = 0;
	while (at < a.parts.length && at < b.parts.length && a.parts[at] === b.parts[at]) at += 1;
	const up = Array.from({ length: a.parts.length - at }, () => "..");
	return [...up, ...b.parts.slice(at)].join("/");
}

function splitPath(path: string): { root: string; parts: string[] } {
	const prefix = rootPrefix(path);
	const parts = collapse(partsOf(path.slice(prefix.length), sepOf(path)), prefix !== "");
	return { root: normalizeSeparators(prefix).toLowerCase(), parts };
}

export function join(...parts: string[]): string {
	const kept = parts.filter((part) => part !== "");
	if (kept.length === 0) return ".";
	const prefix = rootPrefix(kept[0]);
	const sep = sepOf(kept[0]);
	// The root is spelled once, by `prefix`; the first part's own root text must not come back as a segment.
	const segments = [kept[0].slice(prefix.length), ...kept.slice(1)].flatMap((part) =>
		partsOf(part, sep).filter((segment) => segment !== ""),
	);
	return `${prefix}${segments.join(sep)}`;
}

export function dirname(path: string): string {
	const prefix = rootPrefix(path);
	const windows = sepOf(path) === "\\";
	const body = path.slice(prefix.length).replace(windows ? /[\\/]+$/ : /\/+$/, "");
	const at = windows ? Math.max(body.lastIndexOf("/"), body.lastIndexOf("\\")) : body.lastIndexOf("/");
	if (at === -1) return prefix === "" ? "." : prefix;
	return `${prefix}${body.slice(0, at)}`;
}

// True when `path` is longer than any path the system opens: 4 096 on POSIX, 32 767 on Windows. POSIX `PATH_MAX`
// counts bytes and a UTF-16 code unit is at least one UTF-8 byte, so an openable path is never called too long.
export function exceedsPathLimit(path: string): boolean {
	return path.length > (sepOf(path) === "\\" ? 32767 : 4096);
}

// The directories `canonicalPath` walks up through, deepest first, each with the tail that re-appends the rest of
// `path`: `path` itself, every parent, then the root (`.` for a relative path). Built in one backward scan, so a path
// with many separators costs time linear in its length. A trailing separator run belongs to the last name, and a run
// touching the root belongs to the root.
export function ancestors(path: string): { dir: string; tail: string }[] {
	const prefix = rootPrefix(path);
	const windows = sepOf(path) === "\\";
	const isSep = (c: string) => c === "/" || (windows && c === "\\");
	const list = [{ dir: path, tail: "" }];
	let end = path.length;
	while (end > prefix.length && isSep(path[end - 1])) end -= 1;
	let at = end - 1;
	while (at >= prefix.length) {
		if (!isSep(path[at])) {
			at -= 1;
			continue;
		}
		let start = at;
		while (start > prefix.length && isSep(path[start - 1])) start -= 1;
		if (start === prefix.length) break;
		list.push({ dir: path.slice(0, start), tail: path.slice(at + 1) });
		at = start - 1;
	}
	let first = prefix.length;
	while (first < path.length && isSep(path[first])) first += 1;
	const root = prefix === "" ? "." : prefix;
	if ((first < path.length || prefix === "") && root !== path) list.push({ dir: root, tail: path.slice(first) });
	return list;
}

export function basename(path: string): string {
	const windows = sepOf(path) === "\\";
	const trimmed = path.replace(windows ? /[\\/]+$/ : /\/+$/, "");
	const at = windows ? Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) : trimmed.lastIndexOf("/");
	return trimmed.slice(at + 1);
}

// `~`, `~/` and `~\`: the harness expands a home-relative path before it opens it, so the guard judges the same target.
export function expandHome(raw: string, home: string | undefined, platform: string): string {
	if (home === undefined || !raw.startsWith("~")) return raw;
	if (raw.length === 1) return home;
	if (!raw.startsWith("~/") && !raw.startsWith("~\\")) return raw;
	const sep = platform === "win32" ? "\\" : "/";
	return `${home.replace(/[\\/]+$/, "")}${sep}${raw.slice(2)}`;
}
