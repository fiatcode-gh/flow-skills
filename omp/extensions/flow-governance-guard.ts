/**
 * flow-skills — Flow governance guard.
 *
 * Invariant: a planner, executor, implementer or verifier dispatch, a `sonic`
 * dispatch that carries a Flow gate block, and a message to a parked writer
 * (`write` to `agent://<id>` whose transcript ends in `session_exit`) run only
 * against a current recorded approval or acceptance. State:
 * `.flow/runtime/gates.json`, written only by the `flow_gate` tool registered
 * here; the `tool_call` hook also blocks file-writing tools on `.flow/runtime/`.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
	appendFileSync,
	closeSync,
	copyFileSync,
	existsSync,
	fstatSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readdirSync,
	readFileSync,
	readSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { agentName } from "../lib/agent-name.ts";
import { expandToolPath, nonFileUrlPath } from "../lib/tool-path.ts";

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
	tree: string;
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
	presentedAt: number;
};

// Strictly increasing wall-clock milliseconds, so two records written in the same millisecond still order.
let lastStamp = 0;
function stamp(): number {
	lastStamp = Math.max(Date.now(), lastStamp + 1);
	return lastStamp;
}

// A record made after the contract revision was presented was made against that revision and survives its approval.
function recordedSince(at: string | undefined, presentedAt: number): boolean {
	return at !== undefined && Date.parse(at) >= presentedAt;
}

type GateManifest = {
	scope?: string;
	contract?: string;
	plan?: string;
};

const STATE_RELATIVE_PATH = ".flow/runtime/gates.json";
const PLANNER = "flow-planner";
const WRITERS = new Set(["flow-plan-executor", "flow-implementer"]);
// A `sonic` is a writer on gated work only when it carries a Flow gate block.
const SONIC = "sonic";
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

// Lines logged under this heading in a PLAN.md stay outside the plan's digest, so an in-scope amendment keeps the approval current.
const AMENDMENTS_HEADING = Buffer.from("## In-scope amendments");

// Offset just past the last line that is exactly the amendments heading (its newline included), or undefined.
// A `\r\n` line, a deeper heading or one with trailing text does not count. The last one binds, so an earlier
// heading line (quoted in a code fence, say) stays inside the digest.
function amendmentsStart(bytes: Buffer): number | undefined {
	for (let at = bytes.lastIndexOf(AMENDMENTS_HEADING); at !== -1; at = at === 0 ? -1 : bytes.lastIndexOf(AMENDMENTS_HEADING, at - 1)) {
		if (at > 0 && bytes[at - 1] !== 0x0a) continue;
		const end = at + AMENDMENTS_HEADING.length;
		if (end === bytes.length) return end;
		if (bytes[end] === 0x0a) return end + 1;
	}
	return undefined;
}

// A plan is hashed through its amendments heading; every other kind, and a plan without the heading, whole.
function artifactDigest(kind: GateKind, bytes: Buffer): string {
	const end = kind === "plan" ? amendmentsStart(bytes) : undefined;
	return createHash("sha256")
		.update(end === undefined ? bytes : bytes.subarray(0, end))
		.digest("hex");
}

// Non-blank lines under a plan's amendments heading; counted for status, never judged.
function amendmentCount(bytes: Buffer): number {
	const start = amendmentsStart(bytes);
	if (start === undefined) return 0;
	return bytes.subarray(start).toString("utf8").split("\n").filter((line) => line.trim() !== "").length;
}

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

function artifactIdentity(root: string, inputPath: string, kind: GateKind): { path: string; sha256: string; amendments: number } {
	const path = resolveFlowArtifact(root, inputPath);
	const bytes = readFileSync(path);
	return { path, sha256: artifactDigest(kind, bytes), amendments: kind === "plan" ? amendmentCount(bytes) : 0 };
}

// An artifact's path relative to the repository root, `/`-separated: the form an approval record stores.
function rootRelativePath(root: string, path: string): string {
	return relative(root, path).split(sep).join("/");
}

// The root-relative path an approval record names. An older record holds an absolute path: it is read from its last
// `/.flow/` segment on, so a moved checkout still matches; one without that segment is kept and never matches.
function recordedArtifactPath(stored: string): string {
	if (!isAbsolute(stored)) return stored;
	const normalized = stored.replaceAll("\\", "/");
	const at = normalized.lastIndexOf("/.flow/");
	return at === -1 ? stored : normalized.slice(at + 1);
}

function gitBytes(root: string, args: string[], env?: NodeJS.ProcessEnv): Buffer {
	return execFileSync("git", args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"], maxBuffer: GIT_OUTPUT_LIMIT });
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

// The tree `git add -A` would write for the working tree: tracked and untracked files, ignore rules applied. It is
// built in a scratch index and a scratch object directory that reads the real one as an alternate, so nothing is
// written into the repository.
function worktreeTree(root: string): string {
	const index = git(root, ["rev-parse", "--path-format=absolute", "--git-path", "index"]);
	const objects = git(root, ["rev-parse", "--path-format=absolute", "--git-path", "objects"]);
	const scratch = mkdtempSync(join(tmpdir(), "flow-gate-tree-"));
	try {
		const scratchIndex = join(scratch, "index");
		if (existsSync(index)) {
			copyFileSync(index, scratchIndex);
			// Git's racy-entry check compares entry mtimes with the index's own mtime; keep it, or a same-size
			// rewrite in the second of the last index write looks clean and `add -A` keeps the stale blob.
			const { atime, mtime } = statSync(index);
			utimesSync(scratchIndex, atime, mtime);
		}
		const scratchObjects = join(scratch, "objects");
		mkdirSync(scratchObjects);
		const env = {
			...process.env,
			GIT_INDEX_FILE: scratchIndex,
			GIT_OBJECT_DIRECTORY: scratchObjects,
			// The variable is `:`-separated; a C-quoted entry keeps a path that holds `:` whole.
			GIT_ALTERNATE_OBJECT_DIRECTORIES: `"${objects.replace(/[\\"]/g, "\\$&")}"`,
		};
		gitBytes(root, ["add", "-A", "--", "."], env);
		return gitBytes(root, ["write-tree"], env).toString("utf8").trim();
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
}

// Index entries of the paths staged differently from `base` and edited again in the working tree: the tree above
// reads only the working tree, so a change staged and then reverted would otherwise leave no trace.
function mixedEntries(root: string, base: string): Buffer {
	const stagedPaths = gitBytes(root, ["diff", "--cached", "--name-only", "-z", "--no-ext-diff", base, "--", "."]);
	const editedPaths = gitBytes(root, ["diff", "--name-only", "-z", "--no-ext-diff", "--no-textconv", "--", "."]);
	const staged = new Set(stagedPaths.toString("utf8").split("\0").filter(Boolean));
	const edited = editedPaths.toString("utf8").split("\0").filter(Boolean);
	const mixed = edited.filter((path) => staged.has(path)).sort();
	if (mixed.length === 0) return Buffer.alloc(0);
	return gitBytes(root, ["--literal-pathspecs", "ls-files", "-s", "-z", "--", ...mixed]);
}

// `head` is for messages only: a commit of the accepted tree keeps the fingerprint.
function worktreeIdentity(root: string): { head: string; tree: string; fingerprint: string } {
	const head = headRevision(root);
	// An unborn repository compares its staged paths against the empty tree.
	const base = head === "UNBORN" ? git(root, ["hash-object", "-t", "tree", "/dev/null"]) : "HEAD";
	const tree = worktreeTree(root);
	const mixed = mixedEntries(root, base);
	const hash = createHash("sha256");
	hash.update(`tree\0${tree}`);
	if (mixed.length > 0) {
		hash.update("\0mixed\0");
		hash.update(mixed);
	}
	return { head, tree, fingerprint: hash.digest("hex") };
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

const GATE_KINDS: readonly GateKind[] = ["contract", "plan", "implementation"];

// A list parameter: split on `,`, trimmed, empty items and repeats dropped, order kept.
function listParam(input: ToolInput, key: string): string[] {
	const value = input[key];
	if (typeof value !== "string") return [];
	return [...new Set(value.split(",").map((item) => item.trim()).filter((item) => item !== ""))];
}

type GateTarget = { scope: string; kind: GateKind };

// Every scope × kind pair an approve names: scopes in the order given, kinds in contract, plan, implementation
// order. Undefined when no scope or kind is named or any kind is unknown.
function approvalTargets(input: ToolInput): GateTarget[] | undefined {
	const scopes = listParam(input, "scope");
	const kinds = listParam(input, "kind");
	if (scopes.length === 0 || kinds.length === 0) return undefined;
	if (!kinds.every((kind) => (GATE_KINDS as readonly string[]).includes(kind))) return undefined;
	return scopes.flatMap((scope) => GATE_KINDS.filter((kind) => kinds.includes(kind)).map((kind) => ({ scope, kind })));
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
// The block is the bullets right after the header; the first other non-blank line ends it, so a later
// `- Contract:` bullet in the brief's own lists is never read as a manifest value.
function parseManifest(task: unknown): GateManifest | undefined {
	if (typeof task !== "string") return undefined;
	const lines = repairDoubleEncodedTaskText(task).split(/\r?\n/);
	const start = lines.findIndex((line) => line.trim().toLowerCase() === GATE_HEADER);
	if (start < 0) return undefined;
	const result: GateManifest = {};
	for (let i = start + 1; i < lines.length; i += 1) {
		const line = lines[i];
		if (line.trim() === "") continue;
		if (!/^\s*-/.test(line)) break;
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

// Whether a scope and kind has a presentation waiting for `approve`. The map lives in the extension instance.
type IsPresented = (scope: string, kind: GateKind) => boolean;

function approvalError(root: string, scope: string, kind: GateKind, manifestPath: string, isPresented: IsPresented): string | undefined {
	const state = readState(root);
	const approval = state.scopes[scope]?.approvals?.[kind];
	// An approve issued in the same tool batch as this dispatch has not run yet: say that, not that the artifact moved.
	const pending = isPresented(scope, kind)
		? `scope ${scope}: ${kind} approval is presented but not recorded yet; flow_gate approve must finish before this dispatch, so do not issue both in the same tool batch`
		: undefined;
	if (!approval) return pending ?? `scope ${scope}: no recorded ${kind} approval`;
	const current = artifactIdentity(root, manifestPath, kind);
	if (rootRelativePath(root, current.path) !== recordedArtifactPath(approval.path)) {
		return `scope ${scope}: ${kind} path is not the approved artifact`;
	}
	if (current.sha256 !== approval.sha256) return pending ?? `scope ${scope}: ${kind} artifact changed after approval`;
	return undefined;
}

const BLOCK_PLACEMENT = "the block may be in the task text or the shared context";

function plannerGateError(root: string, manifest: GateManifest, isPresented: IsPresented): string | undefined {
	if (!manifest.scope || !manifest.contract) {
		return `flow-planner task must include Flow gate with Scope and Contract (${BLOCK_PLACEMENT})`;
	}
	return approvalError(root, manifest.scope, "contract", manifest.contract, isPresented);
}

function writerGateError(root: string, manifest: GateManifest, isPresented: IsPresented): string | undefined {
	if (!manifest.scope || !manifest.contract || !manifest.plan) {
		return `production writer task must include Flow gate with Scope, Contract, and Plan (${BLOCK_PLACEMENT})`;
	}
	const contractError = approvalError(root, manifest.scope, "contract", manifest.contract, isPresented);
	if (contractError) return contractError;
	if (manifest.plan.toUpperCase() === "NONE") {
		return approvalError(root, manifest.scope, "implementation", manifest.contract, isPresented);
	}
	return approvalError(root, manifest.scope, "plan", manifest.plan, isPresented);
}

function verifierGateError(root: string, manifest: GateManifest): string | undefined {
	if (!manifest.scope) return `flow-evidence-verifier task must include Flow gate with Scope (${BLOCK_PLACEMENT})`;
	const acceptance = readState(root).scopes[manifest.scope]?.acceptance;
	if (!acceptance) return `scope ${manifest.scope}: no acceptance/closure recorded for the current repository state; ${ACCEPT_ORDER_HINT}`;
	const current = worktreeIdentity(root);
	if (current.fingerprint !== acceptance.fingerprint) {
		return `scope ${manifest.scope}: repository state changed after acceptance/closure (accepted at ${acceptance.head}, now at ${current.head}); ${ACCEPT_ORDER_HINT}`;
	}
	return undefined;
}

// `found` is the Flow gate block the agent reads, or undefined when it has none.
function isWriter(name: string | undefined, found: GateManifest | undefined): boolean {
	return (name !== undefined && WRITERS.has(name)) || (name === SONIC && found !== undefined);
}

// `shared` is the block in the call's context; a task's own block wins over it.
function isGatedAgent(agent: unknown, task: unknown, shared: GateManifest | undefined): boolean {
	const name = agentName(agent);
	return name === PLANNER || name === VERIFIER || isWriter(name, parseManifest(task) ?? shared);
}

function requestsGatedRole(input: ToolInput): boolean {
	const shared = parseManifest(input.context);
	if (isGatedAgent(input.agent, input.task, shared)) return true;
	return (
		Array.isArray(input.tasks) &&
		input.tasks.some((item) => !!item && typeof item === "object" && isGatedAgent((item as ToolInput).agent, (item as ToolInput).task, shared))
	);
}

function taskGateErrors(root: string, input: ToolInput, isPresented: IsPresented): string[] {
	const errors: string[] = [];
	// The call's shared context reaches every child, so its block serves any task without one of its own.
	// The whole block comes from one place; fields are never merged.
	const shared = parseManifest(input.context);
	const check = (rawAgent: unknown, task: unknown, label: string) => {
		const agent = agentName(rawAgent);
		const found = parseManifest(task) ?? shared;
		const manifest = found ?? {};
		if (agent === PLANNER) {
			const error = plannerGateError(root, manifest, isPresented);
			if (error) errors.push(`${label}: ${error}`);
			return;
		}
		if (isWriter(agent, found)) {
			const error = writerGateError(root, manifest, isPresented);
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

// Transcript reads stay bounded: the exit marker is the last line, `session_init` sits near the top.
const TRANSCRIPT_TAIL_BYTES = 64 * 1024;
const TRANSCRIPT_HEAD_BYTES = 4 * 1024 * 1024;

type SessionInit = { agent: string; task?: unknown; systemPrompt?: unknown };

// The one agent a `write` path messages: `agent://<id>`, optionally with a `?query`. A broadcast or a sub-path is not one.
function messagedAgent(path: unknown): string | undefined {
	if (typeof path !== "string") return undefined;
	const id = path.trim().match(/^agent:\/\/([^/?]+)(?:\?.*)?$/s)?.[1];
	return id === "all" ? undefined : id;
}

// A child's transcript sits beside the session file, in a directory of the same name: `<children>/<id>.jsonl`, or for
// a nested id `A.B.C`, `<children>/A/A.B/A.B.C.jsonl`.
function transcriptPath(sessionFile: string, id: string): string | undefined {
	if (!sessionFile.endsWith(".jsonl")) return undefined;
	const children = sessionFile.slice(0, -".jsonl".length);
	const flat = join(children, `${id}.jsonl`);
	if (existsSync(flat)) return flat;
	const parts = id.split(".");
	if (parts.length < 2) return undefined;
	const ancestors = parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("."));
	const nested = join(children, ...ancestors, `${id}.jsonl`);
	return existsSync(nested) ? nested : undefined;
}

// At most `limit` bytes from the start or the end of a file, and whether that is the whole file.
function readBounded(path: string, from: "head" | "tail", limit: number): { text: string; whole: boolean } {
	const fd = openSync(path, "r");
	try {
		const size = fstatSync(fd).size;
		const buffer = Buffer.alloc(Math.min(size, limit));
		const start = from === "tail" ? size - buffer.length : 0;
		let filled = 0;
		while (filled < buffer.length) {
			const read = readSync(fd, buffer, filled, buffer.length - filled, start + filled);
			if (read === 0) break;
			filled += read;
		}
		return { text: buffer.subarray(0, filled).toString("utf8"), whole: filled === size };
	} finally {
		closeSync(fd);
	}
}

function isParked(path: string): boolean {
	const last = readBounded(path, "tail", TRANSCRIPT_TAIL_BYTES)
		.text.split("\n")
		.findLast((line) => line.trim() !== "");
	if (last === undefined) return false;
	try {
		const entry = JSON.parse(last);
		return entry?.type === "custom" && entry.customType === "session_exit";
	} catch {
		return false;
	}
}

// The first `session_init` entry in the head of a transcript, or undefined when none can be read there.
function sessionInit(path: string): SessionInit | undefined {
	const { text, whole } = readBounded(path, "head", TRANSCRIPT_HEAD_BYTES);
	const lines = text.split("\n");
	// A head cut short ends in a partial line.
	if (!whole) lines.pop();
	for (const line of lines) {
		if (!line.includes("session_init")) continue;
		let entry: unknown;
		try {
			entry = JSON.parse(line);
		} catch {
			continue;
		}
		if (!entry || typeof entry !== "object" || (entry as ToolInput).type !== "session_init") continue;
		return typeof (entry as ToolInput).agent === "string" ? (entry as SessionInit) : undefined;
	}
	return undefined;
}

// The reason a message to agent `id` must not be sent, or undefined. Only a parked writer is checked: a live agent
// always gets the message, so a stop request reaches a running worker while its plan is being amended.
function parkedWriterError(cwd: string, sessionFile: string | undefined, id: string, isPresented: IsPresented): string | undefined {
	if (sessionFile === undefined) return undefined;
	const path = transcriptPath(sessionFile, id);
	if (path === undefined || !isParked(path)) return undefined;
	const init = sessionInit(path);
	if (!init) return `Flow governance preflight failed closed: cannot read the parked agent ${id}'s session_init. Start a fresh agent instead.`;
	const prompt = Array.isArray(init.systemPrompt) ? init.systemPrompt.join("\n") : init.systemPrompt;
	const found = parseManifest(init.task) ?? parseManifest(prompt);
	if (!isWriter(agentName(init.agent), found)) return undefined;
	let root: string;
	try {
		root = repoRoot(cwd);
	} catch {
		return "Flow governance gate requires task dispatch from a git repository.";
	}
	const error = writerGateError(root, found ?? {}, isPresented);
	if (!error) return undefined;
	return (
		`Flow governance preflight failed: parked writer ${id}: ${error}. ` +
		"A message to a parked writer is checked like a dispatch: approve the current artifact first, or start a fresh writer."
	);
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

// The approval dialog paints every detail line in the theme accent. Bold (SGR 1,
// reset by 22) leaves that colour alone, so it adds structure without fighting
// the theme; OMP's native-terminal path strips the escapes.
const bold = (text: string) => `\x1b[1m${text}\x1b[22m`;
const field = (label: string, value: string) => `${bold(`${label}:`)} ${value}`;

// OMP 18.10 shows an Approve/Deny prompt as a native picker whose subtitle holds every
// detail line and fits about one line, so the summary leads and must fit one line.
const SUMMARY_MAX_CHARS = 80;

function summaryError(summary: string): string | undefined {
	if (/[\r\n]/.test(summary) || summary.length > SUMMARY_MAX_CHARS) {
		return `Flow gate summary must be one line of at most ${SUMMARY_MAX_CHARS} characters; put the detail in the chat message that presents the artifact.`;
	}
	return undefined;
}

const APPROVAL_EFFECT: Record<GateKind, string> = {
	contract: "clears this scope's later approvals and acceptance",
	plan: "clears this scope's acceptance",
	implementation: "clears this scope's acceptance",
};

export default function (pi: ExtensionAPI) {
	const presentations = new Map<string, Presentation>();
	const z = pi.zod;

	// Each target's presentation, still unchanged, or the reason the whole approve must be refused.
	const presentedTargets = (targets: GateTarget[]): { presented: Presentation[] } | { error: string } => {
		const presented: Presentation[] = [];
		const missing: string[] = [];
		const changed: string[] = [];
		const unreadable: string[] = [];
		for (const target of targets) {
			const pair = `${target.scope}/${target.kind}`;
			const entry = presentations.get(presentationKey(target.scope, target.kind));
			if (!entry) {
				missing.push(pair);
				continue;
			}
			try {
				if (realpathSync(entry.path) !== entry.path || artifactDigest(entry.kind, readFileSync(entry.path)) !== entry.sha256) changed.push(pair);
			} catch {
				unreadable.push(pair);
			}
			presented.push(entry);
		}
		if (missing.length > 0) return { error: `No current Flow gate presentation for: ${missing.join(", ")}. Present each first.` };
		if (changed.length > 0) {
			return { error: `The presented Flow artifact changed before approval: ${changed.join(", ")}. Present the current revision again.` };
		}
		if (unreadable.length > 0) return { error: `The presented Flow artifact is no longer readable: ${unreadable.join(", ")}.` };
		return { presented };
	};
	const targetList = (targets: GateTarget[]) => targets.map(({ scope, kind }) => `${kind} ${scope}`).join(", ");

	pi.registerTool({
		name: "flow_gate",
		label: "Flow Gate",
		description:
			"Bind Flow contract/plan approvals and acceptance closure to exact repository artifacts/state. " +
			"Use present for each artifact, then one approve naming every scope and kind the user's yes covers; accept after independent acceptance/closure, status to inspect, and clear after integration.",
		loadMode: "essential",
		parameters: z.object({
			action: z.string().describe("present | approve | accept | status | clear"),
			scope: z.string().describe("Stable Flow scope/slug/unit id. approve and accept also take several, separated by commas"),
			kind: z.string().optional().describe("contract | plan | implementation for present. approve also takes several, separated by commas"),
			path: z.string().optional().describe("Artifact path for present: .flow/contracts/<slug>.md or contracts/<slug>.md (relative to .flow/)"),
			summary: z.string().optional().describe(`One line, at most ${SUMMARY_MAX_CHARS} characters, naming what the user approves; shown in the approval prompt`),
			source: z.string().optional().describe("Acceptance/closure receipt identifier or concise source"),
		}),
		approval: (raw) => {
			const input = raw as ToolInput;
			const action = gateAction(input);
			if (action === "present" || action === "status") return "read";
			if (action === "accept") {
				// Acceptance is user-attested: the parent session must confirm an independent closure happened,
				// not merely record one. Only the later staleness check is mechanical.
				const scopes = listParam(input, "scope");
				const source = getString(input, "source");
				if (scopes.length === 0 || !source) return { tier: "write", policy: "deny", reason: "Flow acceptance requires scope and a source receipt." };
				const summary = getString(input, "summary");
				const invalidSummary = summary ? summaryError(summary) : undefined;
				if (invalidSummary) return { tier: "write", policy: "deny", reason: invalidSummary };
				const reason = scopes.length === 1 ? `Record acceptance for Flow scope ${scopes[0]}.` : `Record acceptance for Flow scopes ${scopes.join(", ")}.`;
				return { tier: "write", policy: "prompt", reason };
			}
			if (action !== "approve") return "write";
			const targets = approvalTargets(input);
			if (!targets) {
				return { tier: "write", policy: "deny", reason: "Flow approval requires scope and kind." };
			}
			const checked = presentedTargets(targets);
			if ("error" in checked) return { tier: "write", policy: "deny", reason: checked.error };
			const [only] = targets;
			return {
				tier: "write",
				policy: "prompt",
				reason:
					targets.length === 1
						? `Approve ${only.kind} for Flow scope ${only.scope}.`
						: `Approve ${targets.length} Flow artifacts: ${targetList(targets)}.`,
			};
		},
		formatApprovalDetails: (raw) => {
			const input = raw as ToolInput;
			const action = gateAction(input);
			if (action === "accept") {
				const summary = getString(input, "summary");
				return [
					...(summary ? [field("Summary", summary)] : []),
					field("Source", getString(input, "source") ?? ""),
					field("Effect", "stays current across commits of this tree; goes stale when the tree changes"),
				];
			}
			if (action !== "approve") return undefined;
			const targets = approvalTargets(input);
			if (!targets) return undefined;
			if (targets.length === 1) {
				const [{ scope, kind }] = targets;
				const presented = presentations.get(presentationKey(scope, kind));
				if (!presented) return [field("Scope", scope), field("Kind", kind), field("Status", "not presented")];
				return [
					field("Summary", presented.summary),
					field("Artifact", presented.displayPath),
					field("Effect", APPROVAL_EFFECT[kind]),
				];
			}
			return [
				...targets.map(({ scope, kind }) => field(`${kind} ${scope}`, presentations.get(presentationKey(scope, kind))?.summary ?? "not presented")),
				field("Effect", "each clears its scope's later records, as a single approval does"),
			];
		},
		async execute(_id, raw, _signal, _onUpdate, ctx) {
			const input = raw as ToolInput;
			const action = gateAction(input);
			const scope = getString(input, "scope");
			if (!action) throw new Error("Flow gate action must be present, approve, accept, status, or clear");
			if (!scope) throw new Error("Flow gate scope is required");
			if ((action === "present" || action === "status" || action === "clear") && scope.includes(",")) {
				throw new Error(`Flow gate ${action} takes one scope.`);
			}
			const root = repoRoot(ctx.cwd);

			if (action === "present") {
				// A subagent's presentation would sit in the shared map until Main approves it as its own.
				if (!ctx.hasUI) throw new Error("Flow artifacts are presented by the interactive parent session");
				const kind = gateKind(input);
				const path = getString(input, "path");
				const summary = getString(input, "summary");
				if (!kind || !path || !summary) throw new Error("Flow gate present requires kind, path, and summary");
				const invalidSummary = summaryError(summary);
				if (invalidSummary) throw new Error(invalidSummary);
				const identity = artifactIdentity(root, path, kind);
				const displayPath = relative(root, identity.path);
				const presented: Presentation = { scope, kind, path: identity.path, displayPath, sha256: identity.sha256, summary, presentedAt: stamp() };
				presentations.set(presentationKey(scope, kind), presented);
				// Summary first: the transcript collapses a result to its first few lines.
				return resultText(
					[`Presented ${kind} for scope ${scope}: ${displayPath}`, summary, "", `sha256 ${identity.sha256}`].join("\n"),
					presented,
				);
			}

			if (action === "approve") {
				if (!ctx.hasUI) throw new Error("Flow approval must be confirmed in an interactive parent session");
				const targets = approvalTargets(input);
				if (!targets) throw new Error("Flow gate approve requires kind");
				const checked = presentedTargets(targets);
				if ("error" in checked) throw new Error(checked.error);
				// One state object, written once: a refused target above leaves nothing recorded.
				const state = readState(root);
				const records: Record<string, unknown> = {};
				for (const presented of checked.presented) {
					const { scope: target, kind } = presented;
					const scopeState = (state.scopes[target] ??= {});
					const approvals = (scopeState.approvals ??= {});
					approvals[kind] = {
						path: rootRelativePath(root, presented.path),
						sha256: presented.sha256,
						approvedAt: new Date(stamp()).toISOString(),
					};
					if (kind === "contract") {
						if (!recordedSince(approvals.plan?.approvedAt, presented.presentedAt)) delete approvals.plan;
						if (!recordedSince(approvals.implementation?.approvedAt, presented.presentedAt)) delete approvals.implementation;
						if (!recordedSince(scopeState.acceptance?.recordedAt, presented.presentedAt)) delete scopeState.acceptance;
					}
					if (kind === "plan" || kind === "implementation") delete scopeState.acceptance;
					records[`${kind} ${target}`] = approvals[kind];
				}
				writeState(root, state);
				for (const { scope: target, kind } of targets) presentations.delete(presentationKey(target, kind));
				if (targets.length === 1) {
					const [{ scope: target, kind }] = targets;
					return resultText(`Approved Flow ${kind} revision for scope ${target}.`, records[`${kind} ${target}`] as Record<string, unknown>);
				}
				return resultText(`Approved ${targets.length} Flow artifact revisions: ${targetList(targets)}.`, records);
			}

			if (action === "accept") {
				if (!ctx.hasUI) throw new Error("Flow acceptance state must be recorded by the interactive parent session");
				const source = getString(input, "source");
				if (!source) throw new Error("Flow gate accept requires a source receipt identifier");
				const scopes = listParam(input, "scope");
				if (scopes.length === 0) throw new Error("Flow gate scope is required");
				// Exclude .flow/ before the first identity, or the first accept on a new checkout
				// binds Flow's own state and the next verifier dispatch sees a change.
				ensureFlowExcluded(root);
				const identity = worktreeIdentity(root);
				const acceptance: AcceptanceRecord = {
					head: identity.head,
					tree: identity.tree,
					fingerprint: identity.fingerprint,
					recordedAt: new Date().toISOString(),
					source,
				};
				const state = readState(root);
				for (const target of scopes) (state.scopes[target] ??= {}).acceptance = { ...acceptance };
				writeState(root, state);
				return resultText(
					`Recorded Flow acceptance/closure for ${scopes.length === 1 ? "scope" : "scopes"} ${scopes.join(", ")}: tree ${identity.tree} at ${identity.head}.`,
					acceptance as unknown as Record<string, unknown>,
				);
			}

			if (action === "clear") {
				if (!ctx.hasUI) throw new Error("Flow gate state is cleared by the interactive parent session");
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
				const recorded = recordedArtifactPath(approval.path);
				let status = "stale";
				let amendments = "";
				try {
					const current = artifactIdentity(root, recorded, kind);
					status = rootRelativePath(root, current.path) === recorded && current.sha256 === approval.sha256 ? "current" : "stale";
					if (status === "current" && current.amendments > 0) amendments = `, in-scope amendments: ${current.amendments}`;
				} catch {
					status = "missing";
				}
				lines.push(`${kind}: ${status} (${recorded}${amendments})`);
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
			const id = event.toolName === "write" ? messagedAgent(input.path) : undefined;
			if (id !== undefined) {
				try {
					const sessionFile = ctx.sessionManager?.getSessionFile?.();
					const reason = parkedWriterError(ctx.cwd, sessionFile, id, (scope, kind) => presentations.has(presentationKey(scope, kind)));
					if (reason) return { block: true, reason };
				} catch (error) {
					return {
						block: true,
						reason: `Flow governance preflight failed closed: ${error instanceof Error ? error.message : String(error)}`,
					};
				}
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
			const errors = taskGateErrors(root, event.input as ToolInput, (scope, kind) => presentations.has(presentationKey(scope, kind)));
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
