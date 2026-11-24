/**
 * flow-skills — OpenCode flow-guard: `.flow/runtime` write protection.
 *
 * Invariant: only `flow_gate` writes `.flow/runtime/`. An `edit`, `write` or `patch` target that lands there, as
 * written or with symlinks followed, is refused, and so is a `shell` call whose text names the directory or whose
 * workdir lies inside it. Any error while resolving a target refuses the call. The path logic is OMP's
 * (omp/extensions/flow-governance-guard.ts), with OpenCode's path rule and tool inputs.
 */
import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { repoRoot } from "./git.ts";
import { resolveToolPath } from "./tool-path.ts";

const RUNTIME_WRITE_REASON =
	"Only flow_gate writes .flow/runtime/; a hand-written record is not an approval. Use flow_gate present/approve, accept or clear instead.";
const SHELL_WORKDIR_REASON = "This shell workdir is inside .flow/runtime/. Only flow_gate writes that directory.";

// The file headers of OpenCode's `patch` text (H5): an added, updated or deleted file, and a rename destination.
const PATCH_PATH_LINES = [/^\s*\*{3}\s+(?:Add|Update|Delete|Edit)\s+File:\s*(.+?)\s*$/i, /^\s*\*{3}\s+Move\s+to:\s*(.+?)\s*$/i];

// Where a write lands: the deepest existing ancestor realpathed, the missing tail re-appended.
function canonicalWritePath(absolute: string): string | undefined {
	const tail: string[] = [];
	for (let current = absolute; ; current = dirname(current)) {
		try {
			return resolve(realpathSync(current), ...tail);
		} catch {
			if (dirname(current) === current) return undefined;
			tail.unshift(basename(current));
		}
	}
}

function hasRuntimeSegment(path: string): boolean {
	const parts = path.split(sep);
	return parts.some((part, index) => part === ".flow" && parts[index + 1] === "runtime");
}

function isWithin(dir: string, path: string): boolean {
	const rel = relative(dir, path);
	return rel === "" || !(rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel));
}

function nearestRepoRoot(cwd: string): string {
	try {
		return repoRoot(cwd);
	} catch {
		// Outside git, the working directory is the only anchor.
		return canonicalWritePath(cwd) ?? cwd;
	}
}

// `<root>/.flow/runtime` with symlinks resolved, at the repository root and at the working directory: a write below
// it hits gate state even when `.flow` or `runtime` is a symlink and the written path names neither. The deepest
// existing ancestor anchors it, so a symlinked `.flow` counts before any gate state has been written.
function realRuntimeDirs(cwd: string): string[] {
	const dirs: string[] = [];
	for (const anchor of new Set([nearestRepoRoot(cwd), cwd])) {
		const dir = canonicalWritePath(resolve(anchor, ".flow", "runtime"));
		if (dir !== undefined) dirs.push(dir);
	}
	return dirs;
}

// True when `raw`, resolved from `cwd` as written and with symlinks followed, lands at or below `.flow/runtime`.
// Throws when a path cannot be read.
function landsInRuntime(cwd: string, raw: string, runtimeDirs: string[]): boolean {
	const absolute = resolveToolPath(cwd, raw);
	const canonical = canonicalWritePath(absolute);
	const locations = canonical === undefined ? [absolute] : [absolute, canonical];
	return locations.some((path) => hasRuntimeSegment(path) || runtimeDirs.some((dir) => isWithin(dir, path)));
}

// The paths an `edit`, `write` or `patch` call writes.
function writeTargets(tool: string, input: Record<string, unknown>): string[] {
	if (tool === "patch") {
		if (typeof input.patchText !== "string") return [];
		const targets: string[] = [];
		for (const line of input.patchText.split(/\r?\n/)) {
			for (const pattern of PATCH_PATH_LINES) {
				const path = line.match(pattern)?.[1];
				if (path !== undefined) targets.push(path);
			}
		}
		return targets;
	}
	return typeof input.path === "string" && input.path !== "" ? [input.path] : [];
}

// The reason an `edit`, `write`, `patch` or `shell` call must not run, or undefined.
export function runtimeWriteRefusal(tool: string, input: Record<string, unknown>, cwd: string): string | undefined {
	if (tool === "shell") {
		const { command, workdir } = input;
		if (typeof command === "string" && (command.includes(".flow/runtime") || command.includes(".flow\\runtime"))) {
			return RUNTIME_WRITE_REASON;
		}
		if (typeof workdir !== "string") return undefined;
		try {
			return landsInRuntime(cwd, workdir, realRuntimeDirs(cwd)) ? SHELL_WORKDIR_REASON : undefined;
		} catch {
			return SHELL_WORKDIR_REASON;
		}
	}
	if (tool !== "edit" && tool !== "write" && tool !== "patch") return undefined;
	const targets = writeTargets(tool, input);
	if (targets.length === 0) return undefined;
	try {
		const runtimeDirs = realRuntimeDirs(cwd);
		return targets.some((target) => landsInRuntime(cwd, target, runtimeDirs)) ? RUNTIME_WRITE_REASON : undefined;
	} catch {
		return RUNTIME_WRITE_REASON;
	}
}
