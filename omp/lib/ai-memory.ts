/**
 * omp-stack — OMP AI-memory slicing for the Weft memory hub.
 *
 * Reads `${WEFT_GRAPH}/pages/AI Memory.md` and returns only the page intro,
 * exact Global section, matching project section, and matching harness section.
 * Project lookup follows the main repository across linked worktrees while
 * treating submodules as their own projects. Every I/O/parsing failure degrades
 * to no injected memory rather than breaking OMP startup.
 */
import * as fs from "node:fs";
import * as path from "node:path";

/** Header the injected block always carries — identical across harnesses. */
export const MEMORY_HEADER =
	"# Stored AI memory (from the weft AI memory hub — weft-memory skill for depth)";

/** Lowercase, alphanumerics only — so "fruit-tracker" ⇔ "Fruit Tracker". */
function norm(s: string): string {
	return s.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

/**
 * True only for the hub's Global section: the heading name (brackets already
 * stripped by the caller), cut at the first em-dash descriptor, must
 * normalise to exactly "global". So "Global" and
 * "Global — workflow & preferences (…)" match; "Global Fruit" and
 * "Globalization" do not — those leaked under the old ^Global prefix test.
 */
function isGlobalSection(name: string): boolean {
	return norm(name.split("—")[0]) === "global";
}

/**
 * Main-repository name for a `.git` *file*, or null when that file does not
 * describe a linked worktree.
 *
 * `git worktree add` writes an absolute `gitdir:` whose target holds a
 * `commondir` file pointing back at the main repo's .git; a submodule writes a
 * *relative* `gitdir:` and no `commondir`. Hence both `path.resolve` (to accept
 * either form) and the `commondir` test (to tell the two apart): a worktree
 * must report the parent project so it keeps that project's memory, while a
 * submodule is a different project and keeps its own name.
 *
 * Every failure path returns null so the caller degrades to the directory
 * basename. A malformed gitfile must never break session start.
 */
function mainRepoFromGitfile(dir: string, marker: string): string | null {
	try {
		const m = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(marker, "utf8"));
		if (!m) return null;
		const gitdir = path.resolve(dir, m[1]);
		const commondir = path.join(gitdir, "commondir");
		if (!fs.existsSync(commondir)) return null; // submodule, not a worktree
		const common = path.resolve(
			gitdir,
			fs.readFileSync(commondir, "utf8").trim(),
		);
		// ".../<repo>/.git" -> "<repo>"; a bare "<repo>.git" -> "<repo>".
		return path.basename(common) === ".git"
			? path.basename(path.dirname(common))
			: path.basename(common).replace(/\.git$/, "");
	} catch {
		return null;
	}
}

/**
 * Directory name of the nearest ancestor repo, or "". A linked worktree
 * resolves to its main repository (see mainRepoFromGitfile); everything else,
 * submodules included, reports its own directory name.
 */
function gitRepoName(startDir: string): string {
	let dir = startDir;
	for (;;) {
		const marker = path.join(dir, ".git");
		let stat: fs.Stats | null;
		try {
			stat = fs.statSync(marker);
		} catch {
			stat = null;
		}
		if (stat) {
			if (stat.isDirectory()) return path.basename(dir);
			return mainRepoFromGitfile(dir, marker) ?? path.basename(dir);
		}
		const parent = path.dirname(dir);
		if (parent === dir) return "";
		dir = parent;
	}
}

/**
 * Project key: $WEFT_PROJECT wins, else the git repo dir name (a linked
 * worktree resolves to its main repo), else "".
 */
export function projectKey(cwd: string, env: NodeJS.ProcessEnv): string {
	return env.WEFT_PROJECT?.trim() || gitRepoName(cwd);
}

/**
 * Hub path for the given env, or null when $WEFT_GRAPH is unset. Internal:
 * memoryBlock is the only caller, and callers outside this file want the block,
 * not the path.
 */
function hubPath(env: NodeJS.ProcessEnv): string | null {
	const graph = env.WEFT_GRAPH?.trim();
	return graph ? path.join(graph, "pages", "AI Memory.md") : null;
}

/**
 * Slice the hub to the intro + "## Global" section, plus the one
 * "## [[Project]]" section matching `projectKey`, plus the one
 * "## Harness: [[Name]]" section matching `harnessKey`. Section headers are
 * bare markdown headings ("## "), with legacy Logseq bulleted headings
 * ("- ## ") still accepted for backward compatibility. The Global section
 * (heading name, cut at the first em-dash descriptor, normalising to exactly
 * "global") always emits; the other two only on a name match.
 *
 * The three scopes are flat and independent — there is no project-by-harness
 * intersection.
 *
 * A harness section is matched as "harness" + norm(key), so a project
 * directory named "claude" can never pull "## Harness: [[Claude]]": the two
 * normalise to "claude" and "harnessclaude" respectively. That is why the
 * prefix is part of the format rather than decoration, and why no explicit
 * collision check is needed.
 *
 * Both keys are guarded on their NORMALISED form, not their raw one. norm()
 * strips whitespace along with every other non-alphanumeric, so a blank or
 * whitespace-only key normalises to "" and matches nothing. A raw != ""
 * test would let a whitespace-only harness key through to match a section
 * named "## Harness:".
 *
 */
export function sliceHub(
	content: string,
	projectKey: string,
	harnessKey: string,
): string {
	const nkey = norm(projectKey);
	const nharness = norm(harnessKey);
	let emit = true; // page intro (before the first header) always emits
	const out: string[] = [];
	for (const line of content.split("\n")) {
		if (/^(- )?## /.test(line)) {
			const name = line.replace(/^(- )?## /, "").replace(/\[\[|\]\]/g, "");
			const nname = norm(name);
			emit =
				isGlobalSection(name) ||
				(nkey !== "" && nname === nkey) ||
				(nharness !== "" && nname === `harness${nharness}`);
		}
		if (emit) out.push(line);
	}
	return out.join("\n").trim();
}

/**
 * The full injectable block — header plus the project-scoped slice — or null
 * when there is nothing to inject. Null covers every degraded path: $WEFT_GRAPH
 * unset, hub absent, unreadable, or empty after slicing. A missing graph must
 * forgo the baseline, never break the session.
 */
export function memoryBlock(
	env: NodeJS.ProcessEnv,
	cwd: string,
	harness: string,
): string | null {
	const hub = hubPath(env);
	if (!hub) return null;
	let content: string;
	try {
		content = fs.readFileSync(hub, "utf8");
	} catch {
		return null;
	}
	const sliced = sliceHub(content, projectKey(cwd, env), harness);
	return sliced ? `${MEMORY_HEADER}\n\n${sliced}` : null;
}
