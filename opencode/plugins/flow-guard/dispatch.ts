/**
 * flow-skills — OpenCode flow-guard: the dispatch and follow-up gate on `subagent`.
 *
 * Invariant: a gated agent (planner, writer, verifier) starts or continues only on the approvals its brief's Flow gate
 * block names, read from `.flow/runtime/approvals.log` on every call. A new dispatch is checked from its prompt. A
 * follow-up to a running child passes, so a stop request always reaches it, unless it switches the child to another
 * gated agent; a follow-up to a finished child is checked like a dispatch, from its own block or else from the
 * child's first prompt. Anything that cannot be read refuses. Parsing, checks and messages follow
 * omp/extensions/flow-governance-guard.ts; the capsule markers are a byte-for-byte copy of
 * omp/extensions/flow-evidence-guard.ts, pinned by tests/validate.py.
 */
import { repoRoot, worktreeIdentity } from "./git.ts";
import { artifactIdentity, latestRecord, readRecord, recordedArtifactPath, rootRelativePath } from "./record.ts";
import type { GateKind } from "./record.ts";
import { isPresented } from "./flow-gate.ts";
import type { GateState } from "./flow-gate.ts";
import type { FlowHost } from "./setup.ts";

type ToolInput = Record<string, unknown>;
type GateManifest = { scope?: string; contract?: string; plan?: string };
type Role = "planner" | "writer" | "verifier";

const PLANNER = "flow-planner";
const WRITERS = new Set(["flow-plan-executor", "flow-implementer"]);
// A `general` is a writer on gated work only when its brief carries a Flow gate block.
const GENERAL = "general";
const VERIFIER = "flow-evidence-verifier";
const GATE_HEADER = "flow gate:";
const SPAWN_PREFIX = "You are a subagent spawned by another session.";
const ACCEPT_ORDER_HINT =
	"flow_gate accept must complete before the dependent flow-evidence-verifier dispatch; do not issue both in the same parallel tool batch";
const BLOCK_PLACEMENT = "put the block in the subagent prompt";
const NO_REPOSITORY = "Flow governance gate requires subagent dispatch from a git repository.";

const CAPSULE_MARKERS = [
	"evidence capsule:",
	"id:",
	"owns:",
	"independent split check:",
	"excludes:",
	"restore obligation:",
] as const;
// A marker counts only at the start of a line, optionally as a list item, so
// the `id:` inside `grid:` or `valid:` does not satisfy `ID`. The markers hold
// no regular-expression metacharacters.
const MARKER_PATTERNS = CAPSULE_MARKERS.map(
	(marker) => [marker, new RegExp(`^[ \\t]*(?:-[ \\t]*)?${marker}`, "im")] as const,
);

function missingCapsuleMarkers(task: unknown): string[] {
	if (typeof task !== "string") return [...CAPSULE_MARKERS];
	return MARKER_PATTERNS.filter(([, pattern]) => !pattern.test(task)).map(([marker]) => marker);
}

// OpenCode resolves agent ids by exact match after trimming, so the guard compares the same normalized name.
function agentName(agent: unknown): string | undefined {
	return typeof agent === "string" ? agent.trim() : undefined;
}

function normalizeManifestValue(raw: string): string | undefined {
	let value = raw.trim();
	const first = value[0];
	if (value.length >= 2 && (first === "`" || first === '"' || first === "'") && value.at(-1) === first) {
		value = value.slice(1, -1).trim();
	}
	return value || undefined;
}

// `undefined` means the text has no Flow gate block at all, which differs from a block with no usable fields.
// The block is the bullets right after the header; the first other non-blank line ends it, so a later
// `- Contract:` bullet in the brief's own lists is never read as a manifest value.
function parseManifest(text: unknown): GateManifest | undefined {
	if (typeof text !== "string") return undefined;
	const lines = text.split(/\r?\n/);
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

// The gate an agent passes with a brief whose block is `manifest`; undefined for an agent that is not gated.
function roleOf(agent: string | undefined, manifest: GateManifest | undefined): Role | undefined {
	if (agent === PLANNER) return "planner";
	if (agent === VERIFIER) return "verifier";
	if ((agent !== undefined && WRITERS.has(agent)) || (agent === GENERAL && manifest !== undefined)) return "writer";
	return undefined;
}

// The agents a follow-up can switch a running child to and so must be checked.
function isNamedGated(agent: string | undefined): boolean {
	return agent === PLANNER || agent === VERIFIER || (agent !== undefined && WRITERS.has(agent));
}

function approvalError(state: GateState, root: string, scope: string, kind: GateKind, manifestPath: string): string | undefined {
	const approval = latestRecord(readRecord(root), scope, kind);
	// An approve issued in the same tool batch as this dispatch has not run yet: say that, not that the artifact moved.
	const pending = isPresented(state, root, scope, kind)
		? `scope ${scope}: ${kind} approval is presented but not recorded yet; flow_gate approve must finish before this dispatch, so do not issue both in the same tool batch`
		: undefined;
	if (!approval) return pending ?? `scope ${scope}: no recorded ${kind} approval`;
	const current = artifactIdentity(root, manifestPath, kind);
	if (rootRelativePath(root, current.path) !== recordedArtifactPath(approval.path)) {
		return `scope ${scope}: ${kind} path is not the approved artifact`;
	}
	if (current.sha256 !== approval.digest) return pending ?? `scope ${scope}: ${kind} artifact changed after approval`;
	return undefined;
}

function plannerGateError(state: GateState, root: string, manifest: GateManifest): string | undefined {
	if (!manifest.scope || !manifest.contract) {
		return `flow-planner task must include Flow gate with Scope and Contract (${BLOCK_PLACEMENT})`;
	}
	return approvalError(state, root, manifest.scope, "contract", manifest.contract);
}

function writerGateError(state: GateState, root: string, manifest: GateManifest): string | undefined {
	if (!manifest.scope || !manifest.contract || !manifest.plan) {
		return `production writer task must include Flow gate with Scope, Contract, and Plan (${BLOCK_PLACEMENT})`;
	}
	const contractError = approvalError(state, root, manifest.scope, "contract", manifest.contract);
	if (contractError) return contractError;
	if (manifest.plan.toUpperCase() === "NONE") {
		return approvalError(state, root, manifest.scope, "implementation", manifest.contract);
	}
	return approvalError(state, root, manifest.scope, "plan", manifest.plan);
}

function verifierGateError(root: string, manifest: GateManifest): string | undefined {
	if (!manifest.scope) return `flow-evidence-verifier task must include Flow gate with Scope (${BLOCK_PLACEMENT})`;
	const acceptance = latestRecord(readRecord(root), manifest.scope, "accept");
	if (!acceptance) return `scope ${manifest.scope}: no acceptance/closure recorded for the current repository state; ${ACCEPT_ORDER_HINT}`;
	const current = worktreeIdentity(root);
	if (current.fingerprint !== acceptance.digest) {
		return `scope ${manifest.scope}: repository state changed after acceptance/closure (accepted at ${acceptance.path}, now at ${current.head}); ${ACCEPT_ORDER_HINT}`;
	}
	return undefined;
}

// Checks `role` against `brief` in the session's repository. A gate error goes through `wrap`; the capsule refusal,
// a missing repository and a failure to read are returned whole.
function gateRefusal(host: FlowHost, state: GateState, role: Role, brief: unknown, wrap: (error: string) => string): string | undefined {
	let root: string;
	try {
		root = repoRoot(host.location.directory);
	} catch {
		return NO_REPOSITORY;
	}
	try {
		const manifest = parseManifest(brief) ?? {};
		if (role === "planner") {
			const error = plannerGateError(state, root, manifest);
			return error === undefined ? undefined : wrap(error);
		}
		if (role === "writer") {
			const error = writerGateError(state, root, manifest);
			return error === undefined ? undefined : wrap(error);
		}
		const error = verifierGateError(root, manifest);
		if (error !== undefined) return wrap(error);
		const missing = missingCapsuleMarkers(brief);
		if (missing.length === 0) return undefined;
		return (
			`Flow evidence-capsule preflight failed: task: missing ${missing.join(", ")}. ` +
			"Each flow-evidence-verifier task must declare one bounded capsule before dispatch."
		);
	} catch (error) {
		return `Flow governance preflight failed closed: ${error instanceof Error ? error.message : String(error)}`;
	}
}

const failedClosed = (what: string) => `Flow governance preflight failed closed: ${what}. Start a fresh subagent instead.`;

// The prompt a child was spawned with: its first context message, which OpenCode prefixes with the spawn line.
async function firstPrompt(host: FlowHost, sessionID: string): Promise<string | undefined> {
	let messages: unknown[];
	try {
		messages = await host.session.context({ sessionID });
	} catch {
		return undefined;
	}
	const first = Array.isArray(messages) ? messages[0] : undefined;
	if (typeof first !== "object" || first === null) return undefined;
	const { type, text } = first as ToolInput;
	if (type !== "user" || typeof text !== "string" || !text.startsWith(SPAWN_PREFIX)) return undefined;
	return text.slice(SPAWN_PREFIX.length);
}

async function followUpRefusal(host: FlowHost, state: GateState, input: ToolInput, sessionID: string): Promise<string | undefined> {
	let session: ToolInput;
	try {
		session = await host.session.get({ sessionID });
	} catch (error) {
		return failedClosed(`cannot read subagent session ${sessionID}: ${error instanceof Error ? error.message : String(error)}`);
	}
	const time = (typeof session?.time === "object" && session.time !== null ? session.time : {}) as ToolInput;
	const { busy, idle } = time;
	if ((busy !== undefined && typeof busy !== "number") || (idle !== undefined && typeof idle !== "number")) {
		return failedClosed(`cannot read the state of subagent session ${sessionID}`);
	}
	const running = typeof busy === "number" && (idle === undefined || busy > (idle as number));
	// The call's agent is the one the child runs as afterwards; a call that names none keeps the child's.
	const agent = agentName(input.agent) ?? agentName(session.agent);
	const switched = running && isNamedGated(agent) && agent !== agentName(session.agent);
	if (running && !switched) return undefined;
	if (!isNamedGated(agent) && agent !== GENERAL) return undefined;
	let brief: unknown = input.prompt;
	if (parseManifest(brief) === undefined) {
		brief = await firstPrompt(host, sessionID);
		if (brief === undefined) return failedClosed(`cannot read the first prompt of subagent session ${sessionID}`);
	}
	const role = roleOf(agent, parseManifest(brief));
	if (role === undefined) return undefined;
	const label = switched ? `session ${sessionID} switched to ${agent}` : `finished ${role} ${sessionID}`;
	return gateRefusal(
		host,
		state,
		role,
		brief,
		(error) =>
			`Flow governance preflight failed: ${label}: ${error}. ` +
			"A follow-up to a finished session is checked like a dispatch: approve the current artifact first, or start a fresh subagent.",
	);
}

// The reason a `subagent` call must not run, or undefined.
export async function dispatchRefusal(host: FlowHost, state: GateState, input: ToolInput): Promise<string | undefined> {
	const sessionID = input.sessionID;
	if (typeof sessionID === "string" && sessionID !== "") return followUpRefusal(host, state, input, sessionID);
	const role = roleOf(agentName(input.agent), parseManifest(input.prompt));
	if (role === undefined) return undefined;
	return gateRefusal(
		host,
		state,
		role,
		input.prompt,
		(error) =>
			`Flow governance preflight failed: task: ${error}. ` +
			"Use flow_gate to present/approve the current artifact revision or record acceptance/closure, then retry with the Flow gate manifest.",
	);
}
