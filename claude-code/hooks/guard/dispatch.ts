/**
 * flow-skills — Claude Code flow-guard: the dispatch and follow-up gate on `Agent` and `agent.spawn`.
 *
 * Invariant: a gated subagent — the planner, a production writer, the evidence verifier — starts only from a brief
 * naming its Flow gate scope, and only while `.flow/runtime/approvals.log` proves the artifacts it names are current.
 * A follow-up to a finished child is checked like a dispatch, from its own block first and from the brief it was
 * spawned with otherwise; a message to a live child is never blocked, because that is how a stop message reaches it,
 * and an agent that is not gated passes whatever its state. Below Claude Code 2.1.299 gated dispatch and `SendMessage`
 * are refused. Anything unreadable fails closed. Roles, block grammar, capsule markers and refusal sentences are
 * opencode/plugins/flow-guard/dispatch.ts's, with Claude Code's agent names.
 */
import type { GateState } from "./gate.ts";
import { isPresented } from "./gate.ts";
import type { Host } from "./host.ts";
import {
	artifactIdentity,
	latestRecord,
	readRecord,
	recordedArtifactPath,
	rootRelativePath,
} from "./record.ts";
import type { GateKind } from "./record.ts";
import { repoRoot, worktreeIdentity } from "./tree.ts";

type ToolInput = Record<string, unknown>;
type GateManifest = { scope?: string; contract?: string; plan?: string };
type Role = "planner" | "writer" | "verifier";

const PLANNER = "flow-planner";
const WRITERS: Record<string, true> = { "flow-plan-executor": true, "flow-implementer": true };
const isWriter = (agent: string | undefined): boolean => agent !== undefined && WRITERS[agent] === true;
// A `general-purpose` is a writer on gated work only when its brief carries a Flow gate block; `Explore` and `Plan`
// are Claude Code's own read-only agents and are never gated.
const GENERAL = "general-purpose";
const VERIFIER = "flow-evidence-verifier";
const GATE_HEADER = "flow gate:";
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

// Claude Code names this plugin's agents under the plugin scope (`fiatcode:flow-planner`) and keeps a built-in bare,
// while the gate compares bare names. The helper trims and strips exactly this plugin's `<pluginName>:` prefix and
// nothing else: another plugin's `other:flow-planner` stays a different agent and is not gated by this plugin.
function agentName(host: Host, agent: unknown): string | undefined {
	if (typeof agent !== "string") return undefined;
	const name = agent.trim();
	const scope = `${host.pluginName}:`;
	return name.startsWith(scope) ? name.slice(scope.length) : name;
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
	if (isWriter(agent) || (agent === GENERAL && manifest !== undefined)) return "writer";
	return undefined;
}

// The agents gated by name, whatever their brief. Two uses: a follow-up that switches a live child to one of them is
// checked like a dispatch, and a follow-up to a finished child is gated when it runs as one of them (or as a
// `general-purpose` whose brief carries a block).
function isNamedGated(agent: string | undefined): boolean {
	return agent === PLANNER || agent === VERIFIER || isWriter(agent);
}

// Claude Code before 2.1.299 raises no `agent.spawn` for a resumed subagent, so the follow-up gate would not see half
// the surface there: gated dispatch and `SendMessage` are refused instead. A `-dev` build of 2.1.299 meets the floor.
const ENGINE_FLOOR = [2, 1, 299] as const;
const UNREADABLE_VERSION =
	"Flow governance preflight failed closed: cannot read the Claude Code version; gated dispatch and SendMessage are refused.";

async function floorRefusal(host: Host): Promise<string | undefined> {
	const version = await host.engineVersion();
	const parts = typeof version === "string" ? /^(\d+)\.(\d+)\.(\d+)/.exec(version) : null;
	if (parts === null) return UNREADABLE_VERSION;
	for (let index = 0; index < ENGINE_FLOOR.length; index += 1) {
		const part = Number(parts[index + 1]);
		if (part > ENGINE_FLOOR[index]) return undefined;
		if (part < ENGINE_FLOOR[index]) {
			return `Flow governance preflight failed closed: Claude Code ${version} is older than 2.1.299, where a resumed subagent is not checked; gated dispatch and SendMessage are refused. Update Claude Code.`;
		}
	}
	return undefined;
}

// The reason a `SendMessage` call must not run, or undefined: it reaches a subagent the resume gate cannot see below
// the version floor.
export async function sendMessageRefusal(host: Host): Promise<string | undefined> {
	return await floorRefusal(host);
}

async function approvalError(
	host: Host,
	state: GateState,
	root: string,
	scope: string,
	kind: GateKind,
	manifestPath: string,
): Promise<string | undefined> {
	const approval = latestRecord(await readRecord(host, root), scope, kind);
	// An approve issued in the same tool batch as this dispatch has not run yet: say that, not that the artifact moved.
	const pending = isPresented(state, root, scope, kind)
		? `scope ${scope}: ${kind} approval is presented but not recorded yet; flow_gate approve must finish before this dispatch, so do not issue both in the same tool batch`
		: undefined;
	if (!approval) return pending ?? `scope ${scope}: no recorded ${kind} approval`;
	const current = await artifactIdentity(host, root, manifestPath, kind);
	if ((await rootRelativePath(host, root, current.path)) !== recordedArtifactPath(approval.path)) {
		return `scope ${scope}: ${kind} path is not the approved artifact`;
	}
	if (current.sha256 !== approval.digest) return pending ?? `scope ${scope}: ${kind} artifact changed after approval`;
	return undefined;
}

async function plannerGateError(host: Host, state: GateState, root: string, manifest: GateManifest): Promise<string | undefined> {
	if (!manifest.scope || !manifest.contract) {
		return `flow-planner task must include Flow gate with Scope and Contract (${BLOCK_PLACEMENT})`;
	}
	return await approvalError(host, state, root, manifest.scope, "contract", manifest.contract);
}

async function writerGateError(host: Host, state: GateState, root: string, manifest: GateManifest): Promise<string | undefined> {
	if (!manifest.scope || !manifest.contract || !manifest.plan) {
		return `production writer task must include Flow gate with Scope, Contract, and Plan (${BLOCK_PLACEMENT})`;
	}
	const contractError = await approvalError(host, state, root, manifest.scope, "contract", manifest.contract);
	if (contractError) return contractError;
	if (manifest.plan.toUpperCase() === "NONE") {
		return await approvalError(host, state, root, manifest.scope, "implementation", manifest.contract);
	}
	return await approvalError(host, state, root, manifest.scope, "plan", manifest.plan);
}

async function verifierGateError(host: Host, root: string, manifest: GateManifest): Promise<string | undefined> {
	if (!manifest.scope) return `flow-evidence-verifier task must include Flow gate with Scope (${BLOCK_PLACEMENT})`;
	const acceptance = latestRecord(await readRecord(host, root), manifest.scope, "accept");
	if (!acceptance) {
		return `scope ${manifest.scope}: no acceptance/closure recorded for the current repository state; ${ACCEPT_ORDER_HINT}`;
	}
	const current = await worktreeIdentity(host, root);
	if (current.fingerprint !== acceptance.digest) {
		return `scope ${manifest.scope}: repository state changed after acceptance/closure (accepted at ${acceptance.path}, now at ${current.head}); ${ACCEPT_ORDER_HINT}`;
	}
	return undefined;
}

// Checks `role` against `brief` in the session's repository. A gate error goes through `wrap`; the capsule refusal,
// a missing repository and a failure to read are returned whole.
async function gateRefusal(
	host: Host,
	state: GateState,
	role: Role,
	brief: unknown,
	wrap: (error: string) => string,
): Promise<string | undefined> {
	let root: string;
	try {
		root = await repoRoot(host, await host.sessionCwd());
	} catch {
		return NO_REPOSITORY;
	}
	try {
		const manifest = parseManifest(brief) ?? {};
		if (role === "planner") {
			const error = await plannerGateError(host, state, root, manifest);
			return error === undefined ? undefined : wrap(error);
		}
		if (role === "writer") {
			const error = await writerGateError(host, state, root, manifest);
			return error === undefined ? undefined : wrap(error);
		}
		const error = await verifierGateError(host, root, manifest);
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

const taskWrap = (error: string) =>
	`Flow governance preflight failed: task: ${error}. ` +
	"Use flow_gate to present/approve the current artifact revision or record acceptance/closure, then retry with the Flow gate manifest.";

// The prompt a child was spawned with: the first user message of its transcript, which the engine keeps for every
// child, so a resumed child's brief can be read back. A transcript that cannot be read, or that holds no user message,
// answers undefined and the caller refuses.
async function firstPrompt(host: Host, agentId: string): Promise<string | undefined> {
	let messages: Array<{ role?: string; text?: string }>;
	try {
		messages = await host.sessionMessages(agentId);
	} catch {
		return undefined;
	}
	if (!Array.isArray(messages)) return undefined;
	for (const message of messages) {
		if (message === null || typeof message !== "object") continue;
		if (typeof message.text !== "string") continue;
		if (message.role !== undefined && message.role !== "user") continue;
		return message.text;
	}
	return undefined;
}

type AgentStatus = "live" | "finished" | "unknown";

// The engine's seven `AgentStatus` values: a live child is one a message may still reach or stop, a finished one
// (ended, or idle between turns) is resumed by a follow-up, which is then a dispatch. Any other value is unknown.
const STATUSES: Record<string, AgentStatus> = {
	pending: "live",
	running: "live",
	waiting: "live",
	idle: "finished",
	completed: "finished",
	failed: "finished",
	killed: "finished",
};

// A child's state and listed type from the engine's agent list. The engine raises a resume only for a child that
// finished or stopped, and a finished foreground child has already left the list, so no entry in a list that was read
// is `finished`. An unlisted status or an unreadable list is `unknown`; the listed type is kept whatever the state, so
// an ungated child is recognised before its state is asked.
async function agentState(host: Host, agentId: string): Promise<{ status: AgentStatus; type?: unknown }> {
	let listed: Array<{ id: string; type?: string; status?: string; taskStatus?: string }>;
	try {
		const answer = await host.agentList();
		if (!Array.isArray(answer)) return { status: "unknown" };
		listed = answer;
	} catch {
		return { status: "unknown" };
	}
	const entry = listed.find((item) => item !== null && typeof item === "object" && item.id === agentId);
	if (entry === undefined) return { status: "finished" };
	const raw = entry.status ?? entry.taskStatus;
	const status = typeof raw === "string" && Object.hasOwn(STATUSES, raw) ? STATUSES[raw] : "unknown";
	return { status, type: entry.type };
}

const unreadableState = (agentId: string) =>
	`Flow governance preflight failed closed: cannot read the state of agent ${agentId}. Start a fresh subagent.`;

// A follow-up (`agent.spawn` with `e.resume`). Gated-ness is decided before state: an agent that is not gated passes
// whatever its state. A live child passes unless the call switches it to a gated agent; a finished one (a child
// missing from the list is finished), or a switch, is checked like a dispatch, from the follow-up's own block first and
// from its spawn brief otherwise; a gated child whose state cannot be read refuses.
async function resumeRefusal(
	host: Host,
	state: GateState,
	event: ToolInput,
	agentId: string,
): Promise<string | undefined> {
	const { status, type } = await agentState(host, agentId);
	// The call's agent is the one the child runs as afterwards; a call that names none keeps the child's.
	const listed = agentName(host, type);
	const agent = agentName(host, event.subagentType) ?? listed;
	if (agent === undefined) return unreadableState(agentId);
	if (!isNamedGated(agent) && agent !== GENERAL) return undefined;
	const switched = status === "live" && isNamedGated(agent) && agent !== listed;
	if (status === "live" && !switched) return undefined;
	let brief: unknown = event.prompt;
	if (parseManifest(brief) === undefined) {
		brief = await firstPrompt(host, agentId);
		if (brief === undefined) {
			// An unreadable list or an unlisted status is the cause worth naming before the transcript.
			if (status === "unknown") return unreadableState(agentId);
			return `Flow governance preflight failed closed: cannot read the brief of resumed agent ${agentId}; put the Flow gate block in the message or start a fresh agent.`;
		}
	}
	const role = roleOf(agent, parseManifest(brief));
	if (role === undefined) return undefined;
	const floor = await floorRefusal(host);
	if (floor !== undefined) return floor;
	if (status === "unknown") return unreadableState(agentId);
	const label = switched ? `agent ${agentId} switched to ${agent}` : `finished ${role} ${agentId}`;
	return await gateRefusal(
		host,
		state,
		role,
		brief,
		(error) =>
			`Flow governance preflight failed: ${label}: ${error}. ` +
			"A follow-up to a finished session is checked like a dispatch: approve the current artifact first, or start a fresh subagent.",
	);
}

// The reason an `agent.spawn` must not run, or undefined. A fresh spawn is the same check as the `Agent` call, so a
// spawn that never went through `tool.call` is gated too.
export async function spawnRefusal(host: Host, state: GateState, event: ToolInput): Promise<string | undefined> {
	const resume = event.resume;
	if (resume !== null && typeof resume === "object") {
		const agentId = (resume as ToolInput).agentId;
		if (typeof agentId !== "string" || agentId === "") {
			return unreadableState(typeof agentId === "string" ? agentId : "unknown");
		}
		return await resumeRefusal(host, state, event, agentId);
	}
	const role = roleOf(agentName(host, event.subagentType), parseManifest(event.prompt));
	if (role === undefined) return undefined;
	return (await floorRefusal(host)) ?? (await gateRefusal(host, state, role, event.prompt, taskWrap));
}

// The reason an `Agent` tool call must not run, or undefined.
export async function agentToolRefusal(host: Host, state: GateState, input: ToolInput): Promise<string | undefined> {
	const role = roleOf(agentName(host, input.subagent_type), parseManifest(input.prompt));
	if (role === undefined) return undefined;
	return (await floorRefusal(host)) ?? (await gateRefusal(host, state, role, input.prompt, taskWrap));
}
