/**
 * flow-skills — OpenCode flow-guard: the `flow_gate` tool.
 *
 * Invariant: `approve` and `accept` write nothing unless the user answers the one permission request they publish; the
 * plugin's `evaluate` hook forces that request whatever the rules and saved approvals say, and the request offers no
 * saved rule. Every artifact an `approve` names is checked unchanged before and after the prompt, and all of them land
 * in one record write, or none. Only the parent session presents, approves, accepts or clears. Presentations and the
 * write times of this instance's records live in memory, as in OMP; parsing and messages follow
 * omp/extensions/flow-governance-guard.ts.
 */
import { readFileSync, realpathSync } from "node:fs";
import { ensureFlowExcluded, repoRoot, worktreeIdentity } from "./git.ts";
import {
	artifactDigest,
	artifactIdentity,
	latestRecord,
	readRecord,
	recordedArtifactPath,
	rootRelativePath,
	writeRecord,
} from "./record.ts";
import type { GateKind, RecordLine } from "./record.ts";
import type { FlowHost } from "./setup.ts";

type ToolInput = Record<string, unknown>;
type GateAction = "present" | "approve" | "accept" | "status" | "clear";
type ToolContext = { sessionID: string; agent: string; messageID: string; id: string };

type Presentation = {
	scope: string;
	kind: GateKind;
	path: string;
	sha256: string;
	summary: string;
	presentedAt: number;
};

// When this instance wrote a record line, and which line: a later line for the same scope and kind is not ours.
type Written = { digest: string; path: string; at: number };

export type GateState = {
	presentations: Map<string, Presentation>;
	written: Map<string, Written>;
};

// Every permission action `flow_gate` asserts starts with this; the plugin's `evaluate` hook asks for each one.
export const GATE_ACTION_PREFIX = "flow_gate ";

export function createGateState(): GateState {
	return { presentations: new Map(), written: new Map() };
}

// Keyed by repository root as well: one OpenCode server serves several directories.
function stateKey(root: string, scope: string, kind: string): string {
	return `${root}\0${scope}\0${kind}`;
}

export function isPresented(state: GateState, root: string, scope: string, kind: GateKind): boolean {
	return state.presentations.has(stateKey(root, scope, kind));
}

// Strictly increasing wall-clock milliseconds, so two records written in the same millisecond still order.
let lastStamp = 0;
function stamp(): number {
	lastStamp = Math.max(Date.now(), lastStamp + 1);
	return lastStamp;
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

const SUMMARY_MAX_CHARS = 80;

function summaryError(summary: string): string | undefined {
	if (/[\r\n]/.test(summary) || summary.length > SUMMARY_MAX_CHARS) {
		return `Flow gate summary must be one line of at most ${SUMMARY_MAX_CHARS} characters; put the detail in the chat message that presents the artifact.`;
	}
	return undefined;
}

const targetList = (targets: GateTarget[]) => targets.map(({ scope, kind }) => `${kind} ${scope}`).join(", ");

// Each pair's artifact path, so a different file under the same scope and kind reads differently.
const pairList = (root: string, presented: Presentation[]) =>
	presented.map(({ scope, kind, path }) => `${kind} ${scope} (${rootRelativePath(root, path)})`).join(", ");

// Each target's presentation, still unchanged, or the reason the whole approve must be refused.
function presentedTargets(state: GateState, root: string, targets: GateTarget[]): { presented: Presentation[] } | { error: string } {
	const presented: Presentation[] = [];
	const missing: string[] = [];
	const changed: string[] = [];
	const unreadable: string[] = [];
	for (const target of targets) {
		const pair = `${target.scope}/${target.kind}`;
		const entry = state.presentations.get(stateKey(root, target.scope, target.kind));
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
}

const PARENT_ONLY: Record<Exclude<GateAction, "status">, string> = {
	present: "Flow artifacts are presented by the parent session",
	approve: "Flow approval must be confirmed in the parent session",
	accept: "Flow acceptance state must be recorded by the parent session",
	clear: "Flow gate state is cleared by the parent session",
};

// A child session's records would bind the user's approval to a request the user never saw; an unreadable session
// fails closed.
async function assertParentSession(host: FlowHost, sessionID: string, action: Exclude<GateAction, "status">): Promise<void> {
	let session: Record<string, unknown>;
	try {
		session = await host.session.get({ sessionID });
	} catch (error) {
		throw new Error(`Flow gate cannot read session ${sessionID}: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (session.parentID !== undefined && session.parentID !== null) throw new Error(PARENT_ONLY[action]);
}

// A record this instance wrote at or after `presentedAt` was made against that contract revision and survives its
// approval. A line of unknown origin (an earlier process, another port) counts as older.
function recordedSince(state: GateState, root: string, line: RecordLine | undefined, presentedAt: number): boolean {
	if (line === undefined) return false;
	const written = state.written.get(stateKey(root, line.scope, line.kind));
	return written !== undefined && written.digest === line.digest && written.path === line.path && written.at >= presentedAt;
}

// Replaces `lines` with the scope's records after approving `presented`: its own old line goes, a contract drops the
// older plan, implementation and acceptance, a plan or implementation drops the acceptance.
function applyApproval(state: GateState, root: string, lines: RecordLine[], presented: Presentation): { lines: RecordLine[]; dropped: string[] } {
	const { scope, kind } = presented;
	const dropped = [kind as string];
	if (kind === "contract") {
		for (const later of ["plan", "implementation", "accept"]) {
			if (!recordedSince(state, root, latestRecord(lines, scope, later), presented.presentedAt)) dropped.push(later);
		}
	} else {
		dropped.push("accept");
	}
	const kept = lines.filter((line) => line.scope !== scope || !dropped.includes(line.kind));
	kept.push({ scope, kind, digest: presented.sha256, path: rootRelativePath(root, presented.path) });
	return { lines: kept, dropped };
}

function status(root: string, scope: string): string {
	const lines = readRecord(root);
	const text = ["Flow gate status", `Scope: ${scope}`];
	for (const kind of GATE_KINDS) {
		const approval = latestRecord(lines, scope, kind);
		if (!approval) {
			text.push(`${kind}: missing`);
			continue;
		}
		const recorded = recordedArtifactPath(approval.path);
		let word = "stale";
		let amendments = "";
		try {
			const current = artifactIdentity(root, recorded, kind);
			word = rootRelativePath(root, current.path) === recorded && current.sha256 === approval.digest ? "current" : "stale";
			if (word === "current" && current.amendments > 0) amendments = `, in-scope amendments: ${current.amendments}`;
		} catch {
			word = "missing";
		}
		text.push(`${kind}: ${word} (${recorded}${amendments})`);
	}
	const acceptance = latestRecord(lines, scope, "accept");
	if (acceptance) {
		const current = worktreeIdentity(root);
		text.push(`acceptance: ${current.fingerprint === acceptance.digest ? "current" : "stale"} (${acceptance.path})`);
	} else {
		text.push("acceptance: missing");
	}
	return text.join("\n");
}

export function flowGateTool(host: FlowHost, state: GateState) {
	const toolSource = (context: ToolContext) => ({ type: "tool", messageID: context.messageID, id: context.id });

	async function approve(root: string, input: ToolInput, context: ToolContext): Promise<string> {
		const targets = approvalTargets(input);
		if (!targets) throw new Error("Flow approval requires scope and kind.");
		const before = presentedTargets(state, root, targets);
		if ("error" in before) throw new Error(before.error);
		readRecord(root);
		const [only] = targets;
		const reason =
			targets.length === 1 ? `Approve ${only.kind} for Flow scope ${only.scope}.` : `Approve ${targets.length} Flow artifacts: ${targetList(targets)}.`;
		await host.permission.assert({
			sessionID: context.sessionID,
			agent: context.agent,
			action: `${GATE_ACTION_PREFIX}approve ${pairList(root, before.presented)}`,
			resources: targets.map(({ scope, kind }) => `${kind} ${scope}`),
			metadata: { reason, summaries: Object.fromEntries(before.presented.map(({ scope, kind, summary }) => [`${kind} ${scope}`, summary])) },
			source: toolSource(context),
		});
		// The prompt may stay open for minutes: check again what the answer covers.
		const after = presentedTargets(state, root, targets);
		if ("error" in after) throw new Error(after.error);
		const swapped = after.presented.flatMap((now, i) => {
			const was = before.presented[i];
			return now.path !== was.path || now.sha256 !== was.sha256 || now.presentedAt !== was.presentedAt ? [`${now.scope}/${now.kind}`] : [];
		});
		if (swapped.length) throw new Error(`The Flow presentation changed while the prompt was open: ${swapped.join(", ")}. Approve again.`);
		let lines = readRecord(root);
		const dropped: string[] = [];
		const written: [string, Written][] = [];
		for (const presented of after.presented) {
			const applied = applyApproval(state, root, lines, presented);
			lines = applied.lines;
			for (const kind of applied.dropped) dropped.push(stateKey(root, presented.scope, kind));
			const line = lines[lines.length - 1];
			written.push([stateKey(root, presented.scope, presented.kind), { digest: line.digest, path: line.path, at: stamp() }]);
		}
		writeRecord(root, lines);
		for (const key of dropped) state.written.delete(key);
		for (const [key, value] of written) state.written.set(key, value);
		for (const { scope, kind } of targets) state.presentations.delete(stateKey(root, scope, kind));
		return targets.length === 1
			? `Approved Flow ${only.kind} revision for scope ${only.scope}.`
			: `Approved ${targets.length} Flow artifact revisions: ${targetList(targets)}.`;
	}

	async function accept(root: string, input: ToolInput, context: ToolContext): Promise<string> {
		const source = getString(input, "source");
		if (!source) throw new Error("Flow gate accept requires a source receipt identifier");
		const summary = getString(input, "summary");
		const invalidSummary = summary ? summaryError(summary) : undefined;
		if (invalidSummary) throw new Error(invalidSummary);
		const scopes = listParam(input, "scope");
		if (scopes.length === 0) throw new Error("Flow gate scope is required");
		readRecord(root);
		const reason = scopes.length === 1 ? `Record acceptance for Flow scope ${scopes[0]}.` : `Record acceptance for Flow scopes ${scopes.join(", ")}.`;
		await host.permission.assert({
			sessionID: context.sessionID,
			agent: context.agent,
			action: `${GATE_ACTION_PREFIX}accept ${scopes.join(", ")} (working tree)`,
			resources: scopes,
			metadata: { reason, source, ...(summary ? { summary } : {}) },
			source: toolSource(context),
		});
		// Exclude .flow/ before the identity, or the first accept on a new checkout binds Flow's own state.
		ensureFlowExcluded(root);
		const identity = worktreeIdentity(root);
		const lines = readRecord(root).filter((line) => line.kind !== "accept" || !scopes.includes(line.scope));
		for (const scope of scopes) lines.push({ scope, kind: "accept", digest: identity.fingerprint, path: identity.head });
		writeRecord(root, lines);
		const at = stamp();
		for (const scope of scopes) state.written.set(stateKey(root, scope, "accept"), { digest: identity.fingerprint, path: identity.head, at });
		return `Recorded Flow acceptance/closure for ${scopes.length === 1 ? "scope" : "scopes"} ${scopes.join(", ")}: tree ${identity.tree} at ${identity.head}.`;
	}

	function present(root: string, scope: string, input: ToolInput): string {
		const kind = gateKind(input);
		const path = getString(input, "path");
		const summary = getString(input, "summary");
		if (!kind || !path || !summary) throw new Error("Flow gate present requires kind, path, and summary");
		const invalidSummary = summaryError(summary);
		if (invalidSummary) throw new Error(invalidSummary);
		const identity = artifactIdentity(root, path, kind);
		const displayPath = rootRelativePath(root, identity.path);
		state.presentations.set(stateKey(root, scope, kind), {
			scope,
			kind,
			path: identity.path,
			sha256: identity.sha256,
			summary,
			presentedAt: stamp(),
		});
		// Summary first: the transcript collapses a result to its first few lines.
		return [`Presented ${kind} for scope ${scope}: ${displayPath}`, summary, "", `sha256 ${identity.sha256}`].join("\n");
	}

	function clear(root: string, scope: string): string {
		writeRecord(root, readRecord(root).filter((line) => line.scope !== scope));
		for (const kind of [...GATE_KINDS, "accept"]) {
			state.presentations.delete(stateKey(root, scope, kind));
			state.written.delete(stateKey(root, scope, kind));
		}
		return `Cleared Flow gate state for scope ${scope}.`;
	}

	return {
		name: "flow_gate",
		options: { codemode: false },
		description:
			"Bind Flow contract/plan approvals and acceptance closure to exact repository artifacts/state. " +
			"Use present for each artifact, then one approve naming every scope and kind the user's yes covers; accept after independent acceptance/closure, status to inspect, and clear after integration.",
		input: {
			type: "object",
			properties: {
				action: { type: "string", description: "present | approve | accept | status | clear" },
				scope: { type: "string", description: "Stable Flow scope/slug/unit id. approve and accept also take several, separated by commas" },
				kind: { type: "string", description: "contract | plan | implementation for present. approve also takes several, separated by commas" },
				path: { type: "string", description: "Artifact path for present: .flow/contracts/<slug>.md or contracts/<slug>.md (relative to .flow/)" },
				summary: {
					type: "string",
					description: `One line, at most ${SUMMARY_MAX_CHARS} characters, naming what the user approves; shown in the present result`,
				},
				source: { type: "string", description: "Acceptance/closure receipt identifier or concise source" },
			},
			required: ["action", "scope"],
			additionalProperties: false,
		},
		async execute(raw: unknown, context: ToolContext): Promise<{ content: string }> {
			const input = (typeof raw === "object" && raw !== null ? raw : {}) as ToolInput;
			const action = gateAction(input);
			const scope = getString(input, "scope");
			if (!action) throw new Error("Flow gate action must be present, approve, accept, status, or clear");
			if (!scope) throw new Error("Flow gate scope is required");
			if ((action === "present" || action === "status" || action === "clear") && scope.includes(",")) {
				throw new Error(`Flow gate ${action} takes one scope.`);
			}
			const spaced = listParam(input, "scope").find((item) => /\s/.test(item));
			if (spaced !== undefined) throw new Error(`Flow gate scope must not contain whitespace: ${spaced}`);
			let root: string;
			try {
				root = repoRoot(host.location.directory);
			} catch {
				throw new Error("Flow gate requires a git repository.");
			}
			if (action === "status") return { content: status(root, scope) };
			await assertParentSession(host, context.sessionID, action);
			if (action === "present") return { content: present(root, scope, input) };
			if (action === "approve") return { content: await approve(root, input, context) };
			if (action === "accept") return { content: await accept(root, input, context) };
			return { content: clear(root, scope) };
		},
	};
}
