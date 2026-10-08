/**
 * omp-stack — Flow governance guard.
 *
 * Invariant: a planner, executor, implementer or verifier dispatch runs only
 * against a current recorded approval or acceptance. State:
 * `.flow/runtime/gates.json`, written only by the `flow_gate` tool registered
 * here; the `tool_call` hook also blocks file-writing tools on `.flow/runtime/`.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
	appendFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	realpathSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { agentName } from "../lib/agent-name.ts";

type ToolInput = Record<string, unknown>;
type GateKind = "contract" | "plan" | "implementation";
type GateAction = "present" | "approve" | "accept" | "status" | "clear";

type ApprovalRecord = {
	path: string;
	sha256: string;
	approvedAt: string;
};

type AcceptanceRecord = {
	head: string;
	fingerprint: string;
	recordedAt: string;
	source: string;
};

type ScopeState = {
	approvals?: Partial<Record<GateKind, ApprovalRecord>>;
	acceptance?: AcceptanceRecord;
};

type GateState = {
	version: 1;
	scopes: Record<string, ScopeState>;
};

type Presentation = {
	scope: string;
	kind: GateKind;
	path: string;
	displayPath: string;
	sha256: string;
	summary: string;
};

type GateManifest = {
	scope?: string;
	contract?: string;
	plan?: string;
};

const STATE_RELATIVE_PATH = ".flow/runtime/gates.json";
const PLANNER = "flow-planner";
const WRITERS = new Set(["flow-plan-executor", "flow-implementer"]);
const VERIFIER = "flow-evidence-verifier";
const GATE_HEADER = "flow gate:";
const ACCEPT_ORDER_HINT =
	"flow_gate accept must complete before the dependent flow-evidence-verifier dispatch; do not issue both in the same parallel tool batch";

// Tools that write files at paths named in their input. `edit` carries its
// targets in `path`/`_path` (replace/patch modes and OMP's normalized hashline input),
// `paths`, `edits[].rename` (patch mode) and the raw `input`/`_input` text of the
// hashline, apply_patch and sloppy modes. `ast_edit` also covers directories and
// globs (astEditBlock). Not covered: bash (a prompt rule in the profiles, plus the `cwd` check in the hook) and eval writes.
const FILE_WRITE_TOOLS = new Set(["write", "edit", "ast_edit"]);
const INPUT_PATH_LINES = [
	/^\[(.+)\]\s*$/, // hashline header `[PATH#TAG]`
	/^\s*¶+(.+?)\s*$/, // legacy hashline header
	/^\s*MV\s+(.+?)\s*$/, // hashline rename destination
	/^\s*\*{3}\s+(?:Add|Update|Delete|Edit)\s+File:\s*(.+?)\s*$/i, // apply_patch and sloppy
	/^\s*\*{3}\s+Move\s+to:\s*(.+?)\s*$/i, // apply_patch rename destination
];
const RUNTIME_WRITE_REASON =
	"Only flow_gate writes .flow/runtime/; a hand-written record is not an approval. Use flow_gate present/approve, accept or clear instead.";
const GIT_WRITE_REASON =
	"File tools do not write under .git/: repo-local git config, attributes and excludes feed the acceptance fingerprint, so a change there would move or hide what flow_gate accept recorded.";
const BASH_CWD_REASON =
	"This bash cwd is inside .flow/runtime/. The profile prompt rule matches the command text only, so a relative path run from here would not prompt. Only flow_gate writes that directory.";
const AST_NO_TARGET_REASON =
	"ast_edit without a path, _path or paths target walks the working directory, which can reach .flow/runtime/ gate state; name a target.";

// Git output above this size fails closed instead of being truncated.
const GIT_OUTPUT_LIMIT = 256 * 1024 * 1024;

const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

// Bounded so a stalled git (unreachable mount, remote GIT_DIR) cannot hold every file tool; callers treat a failure as
// "outside git" and fall back to the working directory.
function git(cwd: string, args: string[]): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		timeout: 10_000,
	}).trimEnd();
}

function repoRoot(cwd: string): string {
	return realpathSync(git(cwd, ["rev-parse", "--show-toplevel"]));
}

function statePath(root: string): string {
	return resolve(root, STATE_RELATIVE_PATH);
}

function readState(root: string): GateState {
	const path = statePath(root);
	if (!existsSync(path)) return { version: 1, scopes: {} };
	const parsed = JSON.parse(readFileSync(path, "utf8")) as GateState;
	if (parsed.version !== 1 || !parsed.scopes || typeof parsed.scopes !== "object") {
		throw new Error(`Unsupported Flow gate state at ${path}`);
	}
	return parsed;
}

function ensureFlowExcluded(root: string): void {
	const commonDir = git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
	const exclude = resolve(commonDir, "info/exclude");
	const current = existsSync(exclude) ? readFileSync(exclude, "utf8") : "";
	if (current.split(/\r?\n/).includes("/.flow/")) return;
	mkdirSync(dirname(exclude), { recursive: true });
	const separator = current === "" || current.endsWith("\n") ? "" : "\n";
	appendFileSync(exclude, `${separator}/.flow/\n`, "utf8");
}

function writeState(root: string, state: GateState): void {
	ensureFlowExcluded(root);
	const path = statePath(root);
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
	renameSync(tmp, path);
}

// A relative path whose first segment is not `.flow` is written relative to `.flow/`.
// The first segment is read before normalizing, so `.flow/../x` stays a repository path and is refused.
function resolveFlowArtifact(root: string, inputPath: string): string {
	const flowRoot = resolve(root, ".flow");
	const first = inputPath.split("/").find((segment) => segment !== "" && segment !== ".");
	const base = first === ".flow" ? root : flowRoot;
	const candidate = isAbsolute(inputPath) ? resolve(inputPath) : resolve(base, inputPath);
	const rel = relative(flowRoot, candidate);
	if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
		throw new Error(
			`Flow gate artifacts must live below ${flowRoot}: write the path as .flow/contracts/<slug>.md or contracts/<slug>.md`,
		);
	}
	if (!existsSync(candidate)) throw new Error(`Flow gate artifact does not exist: ${candidate}`);
	const real = realpathSync(candidate);
	const realRel = relative(flowRoot, real);
	if (realRel === "" || realRel === ".." || realRel.startsWith(`..${sep}`) || isAbsolute(realRel)) {
		throw new Error(`Flow gate artifact escapes ${flowRoot}: ${candidate}`);
	}
	return real;
}

function artifactIdentity(root: string, inputPath: string): { path: string; sha256: string } {
	const path = resolveFlowArtifact(root, inputPath);
	return { path, sha256: sha256(readFileSync(path)) };
}

function gitBytes(root: string, args: string[]): Buffer {
	return execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"], maxBuffer: GIT_OUTPUT_LIMIT });
}

function headRevision(root: string): string {
	try {
		return git(root, ["rev-parse", "--verify", "--quiet", "HEAD"]);
	} catch (error) {
		// `--verify --quiet` exits 1 without output only when HEAD names no commit yet.
		if ((error as { status?: unknown }).status === 1) return "UNBORN";
		throw error;
	}
}

function worktreeIdentity(root: string): { head: string; fingerprint: string } {
	const head = headRevision(root);
	// An unborn repository diffs its tracked (staged) paths against the empty tree.
	const base = head === "UNBORN" ? git(root, ["hash-object", "-t", "tree", "/dev/null"]) : "HEAD";
	// Raw bytes only: a configured external diff or textconv driver could print the same text for different edits.
	const diff = gitBytes(root, ["diff", "--binary", "--no-ext-diff", "--no-textconv", base, "--", "."]);
	// The index is state too: a change staged and then reverted in the worktree leaves no trace in the diff above.
	const staged = gitBytes(root, ["diff", "--cached", "--binary", "--no-ext-diff", "--no-textconv", base, "--", "."]);
	const untrackedRaw = gitBytes(root, ["ls-files", "--others", "--exclude-standard", "-z"]).toString("utf8");
	const untracked = untrackedRaw.split("\0").filter(Boolean).sort();
	const hash = createHash("sha256");
	hash.update(`head\0${head}\0diff\0`);
	hash.update(diff);
	hash.update("\0staged\0");
	hash.update(staged);
	for (const rel of untracked) {
		const path = resolve(root, rel);
		const stat = lstatSync(path);
		hash.update(`\0path\0${rel}\0mode\0${stat.mode}\0`);
		if (stat.isSymbolicLink()) hash.update(readlinkSync(path));
		else hash.update(readFileSync(path));
	}
	return { head, fingerprint: hash.digest("hex") };
}

function presentationKey(scope: string, kind: GateKind): string {
	return `${scope}\0${kind}`;
}

function getString(input: ToolInput, key: string): string | undefined {
	const value = input[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function gateKind(input: ToolInput): GateKind | undefined {
	const value = getString(input, "kind");
	return value === "contract" || value === "plan" || value === "implementation" ? value : undefined;
}

function gateAction(input: ToolInput): GateAction | undefined {
	const value = getString(input, "action");
	return value === "present" || value === "approve" || value === "accept" || value === "status" || value === "clear"
		? value
		: undefined;
}

function normalizeManifestValue(raw: string): string | undefined {
	let value = raw.trim();
	const first = value[0];
	if (value.length >= 2 && (first === "`" || first === '"' || first === "'") && value.at(-1) === first) {
		value = value.slice(1, -1).trim();
	}
	return value || undefined;
}

// Mirror of `repairDoubleEncodedJsonString` in @oh-my-pi/pi-tui `src/tools/task-repair-args.ts` (OMP 18.8.4).
// OMP applies it to `task`, `context` and each `tasks[].task` after this hook runs, so the guard must read
// the text the child receives: a double-encoded task has no `Flow gate:` line until it is unescaped.
function repairDoubleEncodedTaskText(value: string): string {
	if (!value.includes("\\")) return value;
	let signature = /\\(?:["\\/]|u[0-9a-fA-F]{4})/.test(value);
	for (let i = 0, count = 0; !signature && i < value.length; i += 1) {
		if (value.charCodeAt(i) !== 0x5c) continue;
		count += 1;
		signature = count >= 2;
		i += 1;
	}
	if (!signature) return value;
	try {
		const decoded: unknown = JSON.parse(`"${value}"`);
		return typeof decoded === "string" ? decoded : value;
	} catch {
		return value;
	}
}

// `undefined` means the text has no Flow gate block at all, which differs from a block with no usable fields.
function parseManifest(task: unknown): GateManifest | undefined {
	if (typeof task !== "string") return undefined;
	const lines = repairDoubleEncodedTaskText(task).split(/\r?\n/);
	const start = lines.findIndex((line) => line.trim().toLowerCase() === GATE_HEADER);
	if (start < 0) return undefined;
	const result: GateManifest = {};
	for (let i = start + 1; i < lines.length; i += 1) {
		const line = lines[i];
		if (/^\s*[^-\s].*:\s*$/.test(line)) break;
		const match = line.match(/^\s*-\s*(Scope|Contract|Plan):\s*(.+?)\s*$/i);
		if (!match) continue;
		const key = match[1].toLowerCase();
		const value = normalizeManifestValue(match[2]);
		if (!value) continue;
		if (key === "scope") result.scope = value;
		if (key === "contract") result.contract = value;
		if (key === "plan") result.plan = value;
	}
	return result;
}

function approvalError(root: string, scope: string, kind: GateKind, manifestPath: string): string | undefined {
	const state = readState(root);
	const approval = state.scopes[scope]?.approvals?.[kind];
	if (!approval) return `scope ${scope}: no recorded ${kind} approval`;
	const current = artifactIdentity(root, manifestPath);
	if (current.path !== approval.path) return `scope ${scope}: ${kind} path is not the approved artifact`;
	if (current.sha256 !== approval.sha256) return `scope ${scope}: ${kind} artifact changed after approval`;
	return undefined;
}

const BLOCK_PLACEMENT = "the block may be in the task text or the shared context";

function plannerGateError(root: string, manifest: GateManifest): string | undefined {
	if (!manifest.scope || !manifest.contract) {
		return `flow-planner task must include Flow gate with Scope and Contract (${BLOCK_PLACEMENT})`;
	}
	return approvalError(root, manifest.scope, "contract", manifest.contract);
}

function writerGateError(root: string, manifest: GateManifest): string | undefined {
	if (!manifest.scope || !manifest.contract || !manifest.plan) {
		return `production writer task must include Flow gate with Scope, Contract, and Plan (${BLOCK_PLACEMENT})`;
	}
	const contractError = approvalError(root, manifest.scope, "contract", manifest.contract);
	if (contractError) return contractError;
	if (manifest.plan.toUpperCase() === "NONE") {
		return approvalError(root, manifest.scope, "implementation", manifest.contract);
	}
	return approvalError(root, manifest.scope, "plan", manifest.plan);
}

function verifierGateError(root: string, manifest: GateManifest): string | undefined {
	if (!manifest.scope) return `flow-evidence-verifier task must include Flow gate with Scope (${BLOCK_PLACEMENT})`;
	const acceptance = readState(root).scopes[manifest.scope]?.acceptance;
	if (!acceptance) return `scope ${manifest.scope}: no acceptance/closure recorded for the current repository state; ${ACCEPT_ORDER_HINT}`;
	const current = worktreeIdentity(root);
	if (current.fingerprint !== acceptance.fingerprint) {
		return `scope ${manifest.scope}: repository state changed after acceptance/closure (${acceptance.head} -> ${current.head}); ${ACCEPT_ORDER_HINT}`;
	}
	return undefined;
}

function isGatedAgent(agent: unknown): boolean {
	const name = agentName(agent);
	return name === PLANNER || name === VERIFIER || (name !== undefined && WRITERS.has(name));
}

function requestsGatedRole(input: ToolInput): boolean {
	if (isGatedAgent(input.agent)) return true;
	return Array.isArray(input.tasks) && input.tasks.some((item) => !!item && typeof item === "object" && isGatedAgent((item as ToolInput).agent));
}

function taskGateErrors(root: string, input: ToolInput): string[] {
	const errors: string[] = [];
	// The call's shared context reaches every child, so its block serves any task without one of its own.
	// The whole block comes from one place; fields are never merged.
	const shared = parseManifest(input.context);
	const check = (rawAgent: unknown, task: unknown, label: string) => {
		const agent = agentName(rawAgent);
		const manifest = parseManifest(task) ?? shared ?? {};
		if (agent === PLANNER) {
			const error = plannerGateError(root, manifest);
			if (error) errors.push(`${label}: ${error}`);
			return;
		}
		if (agent !== undefined && WRITERS.has(agent)) {
			const error = writerGateError(root, manifest);
			if (error) errors.push(`${label}: ${error}`);
			return;
		}
		if (agent === VERIFIER) {
			const error = verifierGateError(root, manifest);
			if (error) errors.push(`${label}: ${error}`);
		}
	};

	check(input.agent, input.task, "task");
	if (Array.isArray(input.tasks)) {
		input.tasks.forEach((item, index) => {
			if (!item || typeof item !== "object") return;
			const record = item as ToolInput;
			check(record.agent, record.task, `tasks[${index}]`);
		});
	}
	return errors;
}

function writeTargets(input: ToolInput): string[] {
	const targets: string[] = [];
	const add = (value: unknown) => {
		if (typeof value === "string" && value.trim()) targets.push(value);
	};
	add(input.path);
	add(input._path);
	if (Array.isArray(input.paths)) input.paths.forEach(add);
	if (Array.isArray(input.edits)) {
		for (const entry of input.edits) if (entry && typeof entry === "object") add((entry as ToolInput).rename);
	}
	for (const key of ["input", "_input"]) {
		const text = input[key];
		if (typeof text !== "string") continue;
		for (const line of text.split(/\r?\n/)) {
			for (const pattern of INPUT_PATH_LINES) add(line.match(pattern)?.[1]);
		}
	}
	return targets.map(stripPathDecoration);
}

// Unwraps `[PATH#TAG]`, drops a trailing `#TAG` and matching quotes.
function stripPathDecoration(raw: string): string {
	let value = raw.trim();
	if (value.startsWith("[") && value.endsWith("]")) value = value.slice(1, -1).trim();
	value = value.replace(/#[0-9A-Fa-f]{4}$/, "");
	const first = value[0];
	if (value.length >= 2 && (first === '"' || first === "'") && value.at(-1) === first) value = value.slice(1, -1);
	return value;
}

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

// Mirrors OMP 18.4.5 `expandPath` (tools/path-utils.ts:72-130) for POSIX paths, so the guard reads a path as OMP does:
// a stray leading `:` before `/`, `~`, `./` or `../` goes, `@` before `/` or `~` goes, a `file://` URL is decoded
// (`localhost` and percent-escapes included), and `~` expands. OMP leaves an undecodable file URL as a literal path;
// this throws instead, because a guard that cannot tell where a write lands must fail closed.
// Deliberately omitted OMP steps, none of which can produce a `.flow` or `runtime` segment: Unicode-space
// normalisation (it only swaps odd spaces for ASCII ones), the Windows extended-length prefix (`\\?\`, no POSIX
// meaning) and the `InternalUrlRouter` `@` shorthand (it maps `@name` to OMP's own stores, not a checkout path).
function expandToolPath(raw: string): string {
	let value = /^:(?=[/\\~]|\.\.?[/\\]|[A-Za-z]:)/.test(raw) ? raw.slice(1) : raw;
	const unprefixed = value.slice(1);
	if (value.startsWith("@") && (unprefixed.startsWith("/") || unprefixed === "~" || unprefixed.startsWith("~/"))) value = unprefixed;
	if (value.toLowerCase().startsWith("file://")) {
		// Bun's `fileURLToPath` keeps a malformed escape as written where Node throws; the guard must not depend on that.
		decodeURIComponent(new URL(value).pathname);
		value = fileURLToPath(value);
	}
	if (value === "~") return homedir();
	if (value.startsWith("~/") || value.startsWith("~\\")) return homedir() + value.slice(1);
	if (value.startsWith("~")) return join(homedir(), value.slice(1));
	return value;
}

// A URL with a scheme other than `file:` (`ssh://host/path`): the percent-decoded path after the authority, which is
// what a host that maps it onto this checkout would see. Throws on an undecodable escape; the caller fails closed.
function nonFileUrlPath(target: string): string | undefined {
	const match = target.match(/^([a-z][a-z0-9+.-]*):\/\/[^/]*([\s\S]*)$/i);
	if (!match || match[1].toLowerCase() === "file") return undefined;
	return decodeURIComponent(match[2]);
}

// Every path a write target can land on: as written and with symlinks resolved. Throws when a path cannot be read.
function writeLocations(cwd: string, target: string): string[] {
	const absolute = resolve(cwd, nonFileUrlPath(target) ?? expandToolPath(target));
	const canonical = canonicalWritePath(absolute);
	return canonical === undefined ? [absolute] : [absolute, canonical];
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
		const dir = canonicalWritePath(resolve(anchor, STATE_RELATIVE_PATH, ".."));
		if (dir !== undefined) dirs.push(dir);
	}
	return dirs;
}

function writesFlowRuntime(cwd: string, input: ToolInput): boolean {
	try {
		const runtimeDirs = realRuntimeDirs(cwd);
		return writeTargets(input).some((target) =>
			writeLocations(cwd, target).some((path) => hasRuntimeSegment(path) || runtimeDirs.some((dir) => isWithin(dir, path))),
		);
	} catch {
		return true;
	}
}

// The `.git` directory or gitfile under the repository root, and the common git directory. A linked worktree's `.git`
// is a file and the directory it names (the common dir) lies outside the worktree root, so the common dir is protected
// by its own path.
type GitGuard = { root: string; commonDir: string | undefined };

function gitGuard(cwd: string): GitGuard {
	let commonDir: string | undefined;
	try {
		commonDir = realpathSync(git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]));
	} catch {
		// Outside git there is no common dir; the root fallback below covers a `.git` under the working directory.
	}
	return { root: nearestRepoRoot(cwd), commonDir };
}

function isGitPath(guard: GitGuard, path: string): boolean {
	if (guard.commonDir !== undefined && isWithin(guard.commonDir, path)) return true;
	return isWithin(guard.root, path) && relative(guard.root, path).split(sep).includes(".git");
}

function writesGit(cwd: string, input: ToolInput): boolean {
	try {
		const guard = gitGuard(cwd);
		return writeTargets(input).some((target) => writeLocations(cwd, target).some((path) => isGitPath(guard, path)));
	} catch {
		return true;
	}
}

// OMP 18.4.5 `ast_edit` (tools/ast-edit.ts, tools/path-utils.ts, native `astEdit`): each `paths` entry may pack
// several targets with `;`, `,` or whitespace; each target splits at its first glob segment (`* ? [ {`) into a base
// and a glob. The walk rewrites every file below the base, hidden directories included, whose path relative to the
// base matches the glob (`*` stays inside one segment, `**` crosses them). It does not follow symlinks met inside the
// walk and honours `.gitignore`. It honours the primary checkout's `.git/info/exclude` but not the common-dir exclude
// seen from a linked worktree, so the personal `.flow/` exclude cannot be relied on to keep it out of
// `.flow/runtime/`; this check therefore never relies on an exclude entry. The walk skips every `.git` directory and
// gitfile below its base (measured with a dryRun probe); it reaches git state only when the base is at or inside
// `.git`, so only such a base counts as covering it. Language comes from each file's extension, or from `lang` for any
// file, so a JSON gate state is reachable. Reachability is judged against the files that exist there now.
const AST_RUNTIME_FILE_LIMIT = 10_000;
const GLOB_CHARS = /[*?[{]/;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

// A glob over `/`-separated relative paths, or undefined when it cannot be read with confidence.
function globToRegExp(raw: string): RegExp | undefined {
	const glob = raw.replace(/^(?:\.\/)+/, "").replace(/^\/+/, "");
	let out = "";
	let braces = 0;
	for (let i = 0; i < glob.length; i++) {
		const ch = glob[i]!;
		if (ch === "\\") {
			if (i + 1 >= glob.length) return undefined;
			out += escapeRegExp(glob[++i]!);
		} else if (ch === "*") {
			if (glob[i + 1] !== "*") {
				out += "[^/]*";
				continue;
			}
			while (glob[i + 1] === "*") i++;
			if (glob[i + 1] === "/") {
				i++;
				out += "(?:.*/)?";
			} else out += ".*";
		} else if (ch === "?") {
			out += "[^/]";
		} else if (ch === "[") {
			let start = i + 1;
			const negated = glob[start] === "!" || glob[start] === "^";
			if (negated) start++;
			const close = glob.indexOf("]", start + 1);
			if (close === -1) return undefined;
			out += `${negated ? "(?!/)[^" : "["}${glob.slice(start, close).replace(/[\\\]^]/g, "\\$&")}]`;
			i = close;
		} else if (ch === "{") {
			braces++;
			out += "(?:";
		} else if (ch === "}") {
			if (braces === 0) return undefined;
			braces--;
			out += ")";
		} else if (ch === "," && braces > 0) {
			out += "|";
		} else out += escapeRegExp(ch);
	}
	if (braces !== 0) return undefined;
	try {
		return new RegExp(`^${out}$`, "s");
	} catch {
		return undefined;
	}
}

// Splits at `;`, `,` and whitespace outside braces, as OMP does for a packed `paths` entry.
function splitPackedPaths(entry: string): string[] {
	const parts: string[] = [];
	let braces = 0;
	let start = 0;
	for (let i = 0; i < entry.length; i++) {
		const ch = entry[i]!;
		if (ch === "\\") i++;
		else if (ch === "{") braces++;
		else if (ch === "}" && braces > 0) braces--;
		else if (braces === 0 && /[,;\s]/.test(ch)) {
			parts.push(entry.slice(start, i));
			start = i + 1;
		}
	}
	parts.push(entry.slice(start));
	return parts;
}

// The entry whole, each packed part, and each with a trailing `:selector` dropped.
function astEditCandidates(entry: string): string[] {
	const candidates = new Set<string>();
	for (const raw of [entry, ...splitPackedPaths(entry)]) {
		const value = raw.trim().replace(/^"(.*)"$/s, "$1");
		if (!value) continue;
		candidates.add(value);
		candidates.add(value.replace(/:[^/:]*$/, ""));
	}
	return [...candidates].filter(Boolean);
}

function runtimeFiles(dir: string, files: string[] = []): string[] {
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "ENOTDIR")) throw error;
		files.push(dir);
		return files;
	}
	for (const entry of entries) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) runtimeFiles(path, files);
		else files.push(path);
		if (files.length > AST_RUNTIME_FILE_LIMIT) throw new Error("too many files under .flow/runtime");
	}
	return files;
}

// Files under any `.flow/runtime` that a walk from `base` could reach: the one at the working directory and the
// repository root, and those at `base` or above it (a base inside `.flow` reaches the runtime directory below it).
function reachableRuntimeFiles(base: string, cwd: string, root: string): string[] {
	const anchors = new Set([cwd, root]);
	for (let dir = base; ; dir = dirname(dir)) {
		anchors.add(dir);
		if (dirname(dir) === dir) break;
	}
	const files: string[] = [];
	for (const anchor of anchors) {
		let runtime: string;
		try {
			runtime = realpathSync(join(anchor, ".flow", "runtime"));
		} catch (error) {
			const code = error instanceof Error && "code" in error ? error.code : undefined;
			if (code === "ENOENT" || code === "ENOTDIR") continue;
			throw error;
		}
		runtimeFiles(runtime, files);
	}
	return files;
}

type AstTarget = { base: string; canonical: string; glob: string | undefined };

// A target split into base and glob, or undefined when its URL scheme addresses something other than this checkout.
// Throws when OMP would read the target as something else than written; the caller treats that as covering.
function astTarget(cwd: string, target: string): AstTarget | undefined {
	// OMP splits the raw target at its first glob segment (`parseSearchPath`) and only then expands the base
	// (`expandPath`); the glob stays raw. Expanding first would let `fileURLToPath` read a `?` glob character as a URL query.
	// Other URL schemes address OMP's own stores or remote hosts, never this checkout's `.flow/`.
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(target) && !/^file:\/\//i.test(target)) return undefined;
	const spec = target.replace(/\\/g, "/");
	const segments = spec.split("/");
	const globAt = segments.findIndex((segment) => GLOB_CHARS.test(segment));
	let base = spec;
	let glob: string | undefined;
	if (globAt === 0) {
		base = ".";
		glob = spec;
	} else if (globAt > 0) {
		base = segments.slice(0, globAt).join("/") || "/";
		glob = segments.slice(globAt).join("/");
	}
	// A query or fragment would be dropped by the URL decoder, so what OMP reads is not what the guard would see.
	if (/^file:/i.test(base) && /[?#]/.test(base)) throw new Error("file URL base carries a query or fragment");
	const absolute = resolve(cwd, expandToolPath(base));
	return { base: absolute, canonical: canonicalWritePath(absolute) ?? absolute, glob };
}

function targetCoversRuntime(cwd: string, root: string, target: AstTarget): boolean {
	if (hasRuntimeSegment(target.base) || hasRuntimeSegment(target.canonical)) return true;
	const matcher = target.glob === undefined ? undefined : globToRegExp(target.glob);
	for (const file of reachableRuntimeFiles(target.canonical, cwd, root)) {
		const rel = relative(target.canonical, file);
		if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) continue;
		// An unreadable glob matches everything: fail closed.
		if (target.glob === undefined || matcher === undefined || matcher.test(rel.split(sep).join("/"))) return true;
	}
	return false;
}

// The reason an `ast_edit` call must not run, or undefined. Anything unreadable blocks.
function astEditBlock(cwd: string, input: ToolInput): string | undefined {
	const entries: string[] = [];
	try {
		for (const key of ["path", "_path"]) {
			const value = input[key];
			if (typeof value === "string" && value.trim()) entries.push(value);
		}
		if (input.paths !== undefined) {
			if (!Array.isArray(input.paths)) throw new Error("paths is not an array");
			for (const item of input.paths) {
				if (typeof item !== "string") throw new Error("paths entry is not a string");
				if (item.trim()) entries.push(item);
			}
		}
	} catch {
		return `${RUNTIME_WRITE_REASON} This ast_edit paths input is malformed; name narrower paths.`;
	}
	if (entries.length === 0) return AST_NO_TARGET_REASON;
	const covers = `${RUNTIME_WRITE_REASON} This ast_edit path or glob covers a file there; name narrower paths.`;
	try {
		const root = nearestRepoRoot(cwd);
		const guard = gitGuard(cwd);
		let touchesGit = false;
		for (const entry of entries) {
			for (const candidate of astEditCandidates(entry)) {
				const target = astTarget(cwd, candidate);
				if (!target) continue;
				if (targetCoversRuntime(cwd, root, target)) return covers;
				if (isGitPath(guard, target.base) || isGitPath(guard, target.canonical)) touchesGit = true;
			}
		}
		return touchesGit ? GIT_WRITE_REASON : undefined;
	} catch {
		return covers;
	}
}

function resultText(text: string, details: Record<string, unknown> = {}) {
	return {
		content: [{ type: "text" as const, text }],
		details,
	};
}

// The approval dialog paints every detail line in the theme accent. Bold and dim
// (SGR 1 and 2, both reset by 22) leave that colour alone, so they add structure
// without fighting the theme; OMP's native-terminal path strips the escapes.
const bold = (text: string) => `\x1b[1m${text}\x1b[22m`;
const dim = (text: string) => `\x1b[2m${text}\x1b[22m`;
const field = (label: string, value: string) => `${bold(label.padEnd(9))}${value}`;

// The dialog drops empty detail lines, so a lone space keeps a visual break.
function textBlock(label: string, text: string): string[] {
	return [" ", bold(label), ...text.split(/\r?\n/).map((line) => `  ${line}`)];
}

const APPROVAL_EFFECT: Record<GateKind, string> = {
	contract: "clears this scope's plan and implementation approvals and its acceptance",
	plan: "clears this scope's recorded acceptance",
	implementation: "clears this scope's recorded acceptance",
};

export default function (pi: ExtensionAPI) {
	const presentations = new Map<string, Presentation>();
	const z = pi.zod;

	pi.registerTool({
		name: "flow_gate",
		label: "Flow Gate",
		description:
			"Bind Flow contract/plan approvals and acceptance closure to exact repository artifacts/state. " +
			"Use present -> approve for contract/plan/direct-implementation authorization, accept after independent acceptance/closure, status to inspect, and clear after integration.",
		loadMode: "essential",
		parameters: z.object({
			action: z.string().describe("present | approve | accept | status | clear"),
			scope: z.string().describe("Stable Flow scope/slug/unit id"),
			kind: z.string().optional().describe("contract | plan | implementation for present/approve"),
			path: z.string().optional().describe("Artifact path for present: .flow/contracts/<slug>.md or contracts/<slug>.md (relative to .flow/)"),
			summary: z.string().optional().describe("User-facing summary tied to the presented artifact revision"),
			source: z.string().optional().describe("Acceptance/closure receipt identifier or concise source"),
		}),
		approval: (raw) => {
			const input = raw as ToolInput;
			const action = gateAction(input);
			if (action === "present" || action === "status") return "read";
			if (action === "accept") {
				// Acceptance is user-attested: the parent session must confirm an independent closure happened,
				// not merely record one. Only the later staleness check is mechanical.
				const scope = getString(input, "scope");
				const source = getString(input, "source");
				if (!scope || !source) return { tier: "write", policy: "deny", reason: "Flow acceptance requires scope and a source receipt." };
				return { tier: "write", policy: "prompt", reason: `Record acceptance/closure for Flow scope ${scope} from ${source}.` };
			}
			if (action !== "approve") return "write";
			const scope = getString(input, "scope");
			const kind = gateKind(input);
			if (!scope || !kind) {
				return { tier: "write", policy: "deny", reason: "Flow approval requires scope and kind." };
			}
			const presented = presentations.get(presentationKey(scope, kind));
			if (!presented) {
				return {
					tier: "write",
					policy: "deny",
					reason: "No current Flow gate presentation exists for this scope/kind. Present it first.",
				};
			}
			try {
				const current = { path: realpathSync(presented.path), sha256: sha256(readFileSync(presented.path)) };
				if (current.path !== presented.path || current.sha256 !== presented.sha256) {
					return {
						tier: "write",
						policy: "deny",
						reason: "The presented Flow artifact changed before approval. Present the current revision again.",
					};
				}
			} catch {
				return { tier: "write", policy: "deny", reason: "The presented Flow artifact is no longer readable." };
			}
			return {
				tier: "write",
				policy: "prompt",
				reason: `Approve the presented ${kind} revision for Flow scope ${scope}.`,
			};
		},
		formatApprovalDetails: (raw) => {
			const input = raw as ToolInput;
			const action = gateAction(input);
			const scope = getString(input, "scope");
			if (action === "accept") {
				const summary = getString(input, "summary");
				return [
					field("Source", getString(input, "source") ?? ""),
					field("Effect", "binds acceptance to the current HEAD and working tree; any later change makes it stale"),
					...(summary ? textBlock("Summary", summary) : []),
				];
			}
			if (action !== "approve") return undefined;
			const kind = gateKind(input);
			if (!scope || !kind) return undefined;
			const presented = presentations.get(presentationKey(scope, kind));
			if (!presented) return [field("Scope", scope), field("Kind", kind), field("Status", "not presented")];
			return [
				field("Artifact", presented.displayPath),
				field("Revision", dim(`sha256 ${presented.sha256}`)),
				field("Effect", APPROVAL_EFFECT[kind]),
				...textBlock("Summary", presented.summary),
			];
		},
		async execute(_id, raw, _signal, _onUpdate, ctx) {
			const input = raw as ToolInput;
			const action = gateAction(input);
			const scope = getString(input, "scope");
			if (!action) throw new Error("Flow gate action must be present, approve, accept, status, or clear");
			if (!scope) throw new Error("Flow gate scope is required");
			const root = repoRoot(ctx.cwd);

			if (action === "present") {
				const kind = gateKind(input);
				const path = getString(input, "path");
				const summary = getString(input, "summary");
				if (!kind || !path || !summary) throw new Error("Flow gate present requires kind, path, and summary");
				const identity = artifactIdentity(root, path);
				const displayPath = relative(root, identity.path);
				const presented: Presentation = { scope, kind, path: identity.path, displayPath, sha256: identity.sha256, summary };
				presentations.set(presentationKey(scope, kind), presented);
				// Summary first: the transcript collapses a result to its first few lines.
				return resultText(
					[`Presented ${kind} for scope ${scope}: ${displayPath}`, summary, "", `sha256 ${identity.sha256}`].join("\n"),
					presented,
				);
			}

			if (action === "approve") {
				if (!ctx.hasUI) throw new Error("Flow approval must be confirmed in an interactive parent session");
				const kind = gateKind(input);
				if (!kind) throw new Error("Flow gate approve requires kind");
				const key = presentationKey(scope, kind);
				const presented = presentations.get(key);
				if (!presented) throw new Error("No current Flow gate presentation exists; present the artifact first");
				const current = { path: realpathSync(presented.path), sha256: sha256(readFileSync(presented.path)) };
				if (current.path !== presented.path || current.sha256 !== presented.sha256) {
					throw new Error("Presented Flow artifact changed before approval; present the current revision again");
				}
				const state = readState(root);
				const scopeState = (state.scopes[scope] ??= {});
				const approvals = (scopeState.approvals ??= {});
				approvals[kind] = { path: presented.path, sha256: presented.sha256, approvedAt: new Date().toISOString() };
				if (kind === "contract") {
					delete approvals.plan;
					delete approvals.implementation;
					delete scopeState.acceptance;
				}
				if (kind === "plan" || kind === "implementation") delete scopeState.acceptance;
				writeState(root, state);
				presentations.delete(key);
				return resultText(`Approved Flow ${kind} revision for scope ${scope}.`, approvals[kind] as Record<string, unknown>);
			}

			if (action === "accept") {
				if (!ctx.hasUI) throw new Error("Flow acceptance state must be recorded by the interactive parent session");
				const source = getString(input, "source");
				if (!source) throw new Error("Flow gate accept requires a source receipt identifier");
				// Exclude .flow/ before fingerprinting, or the first accept on a new checkout
				// hashes Flow's own state and the next verifier dispatch sees a change.
				ensureFlowExcluded(root);
				const identity = worktreeIdentity(root);
				const state = readState(root);
				const scopeState = (state.scopes[scope] ??= {});
				scopeState.acceptance = {
					head: identity.head,
					fingerprint: identity.fingerprint,
					recordedAt: new Date().toISOString(),
					source,
				};
				writeState(root, state);
				return resultText(
					`Recorded Flow acceptance/closure for scope ${scope} at ${identity.head} (${identity.fingerprint}).`,
					scopeState.acceptance as unknown as Record<string, unknown>,
				);
			}

			if (action === "clear") {
				const state = readState(root);
				delete state.scopes[scope];
				writeState(root, state);
				for (const kind of ["contract", "plan", "implementation"] as const) {
					presentations.delete(presentationKey(scope, kind));
				}
				return resultText(`Cleared Flow gate state for scope ${scope}.`);
			}

			const state = readState(root);
			const scopeState = state.scopes[scope] ?? {};
			const lines = [`Flow gate status`, `Scope: ${scope}`];
			for (const kind of ["contract", "plan", "implementation"] as const) {
				const approval = scopeState.approvals?.[kind];
				if (!approval) {
					lines.push(`${kind}: missing`);
					continue;
				}
				let status = "stale";
				try {
					const current = artifactIdentity(root, approval.path);
					status = current.path === approval.path && current.sha256 === approval.sha256 ? "current" : "stale";
				} catch {
					status = "missing";
				}
				lines.push(`${kind}: ${status} (${approval.path})`);
			}
			if (scopeState.acceptance) {
				const current = worktreeIdentity(root);
				lines.push(
					`acceptance: ${current.fingerprint === scopeState.acceptance.fingerprint ? "current" : "stale"} (${scopeState.acceptance.head})`,
				);
			} else {
				lines.push("acceptance: missing");
			}
			return resultText(lines.join("\n"), scopeState as unknown as Record<string, unknown>);
		},
	});

	// OMP raises a desktop notification for `ask` but not for a tool approval
	// prompt, so a gate waiting in a background session goes unseen. Lazy import:
	// the tests load this file under plain Node, where the host package does not
	// resolve; OMP maps it to its own instance. A notification failure must never
	// hold up the prompt.
	pi.on("tool_approval_requested", async (event, ctx) => {
		if (event.toolName !== "flow_gate") return;
		try {
			const { TERMINAL } = await import("@oh-my-pi/pi-tui");
			TERMINAL.sendNotification({
				title: ctx.sessionManager.getSessionName() || "omp",
				body: event.reason ?? "Flow gate is waiting for approval",
				type: "ask",
				urgency: "normal",
				actions: "focus",
			});
		} catch {
			// Best effort: the approval prompt itself is the authority.
		}
	});

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName === "bash") {
			const cwd = (event.input as ToolInput).cwd;
			if (typeof cwd !== "string") return;
			try {
				const absolute = resolve(ctx.cwd, expandToolPath(cwd));
				const canonical = canonicalWritePath(absolute) ?? absolute;
				const runtimeDirs = realRuntimeDirs(ctx.cwd);
				if (hasRuntimeSegment(absolute) || hasRuntimeSegment(canonical) || runtimeDirs.some((dir) => isWithin(dir, canonical))) {
					return { block: true, reason: BASH_CWD_REASON };
				}
			} catch {
				return { block: true, reason: BASH_CWD_REASON };
			}
			return;
		}
		if (FILE_WRITE_TOOLS.has(event.toolName)) {
			const input = event.input as ToolInput;
			if (writesFlowRuntime(ctx.cwd, input)) return { block: true, reason: RUNTIME_WRITE_REASON };
			if (writesGit(ctx.cwd, input)) return { block: true, reason: GIT_WRITE_REASON };
			if (event.toolName === "ast_edit") {
				const reason = astEditBlock(ctx.cwd, input);
				if (reason) return { block: true, reason };
			}
			return;
		}
		if (event.toolName !== "task") return;
		if (!requestsGatedRole(event.input as ToolInput)) return;
		let root: string;
		try {
			root = repoRoot(ctx.cwd);
		} catch {
			return {
				block: true,
				reason: "Flow governance gate requires task dispatch from a git repository.",
			};
		}
		try {
			const errors = taskGateErrors(root, event.input as ToolInput);
			if (errors.length > 0) {
				return {
					block: true,
					reason:
						`Flow governance preflight failed: ${errors.join("; ")}. ` +
						"Use flow_gate to present/approve the current artifact revision or record acceptance/closure, then retry with the Flow gate manifest.",
				};
			}
		} catch (error) {
			return {
				block: true,
				reason: `Flow governance preflight failed closed: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
	});
}
