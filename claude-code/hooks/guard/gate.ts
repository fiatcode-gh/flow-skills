/**
 * flow-skills — Claude Code flow-guard: the `flow_gate` tool.
 *
 * Invariant: `approve` and `accept` write nothing unless the user answers the one dialog they raise; every artifact an
 * `approve` names is checked unchanged before and after that dialog, and all of them land in one record write, or
 * none. Only the parent session presents, approves, accepts or clears. Presentations and the write times of this
 * instance's records live in memory, as in OMP; parsing, messages and the record's drops follow
 * opencode/plugins/flow-guard/flow-gate.ts and omp/extensions/flow-governance-guard.ts.
 *
 * The engine's own object is not named here: every file, process and dialog goes through `Host` (guard/host.ts).
 */
import type { AskOption, Host } from "./host.ts";
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
import { canonicalPath, ensureFlowExcluded, headRevision, repoRoot, worktreeIdentity } from "./tree.ts";

type ToolInput = Record<string, unknown>;

type GateAction = "present" | "approve" | "accept" | "status" | "clear";

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

export function createGateState(): GateState {
	return { presentations: new Map(), written: new Map() };
}

// Keyed by repository root as well: one process serves several checkouts, and a presentation from another one must
// never approve a path this conversation did not show.
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

function kindParam(input: ToolInput): GateKind | undefined {
	const value = getString(input, "kind");
	return value === "contract" || value === "plan" || value === "implementation" ? value : undefined;
}

function actionParam(input: ToolInput): GateAction | undefined {
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

const CONTROL = /[\u0000-\u001f]/;

// A control character in a field the dialog shows or a record line holds could forge another line, so it is refused
// before anything is looked up. The raw input value is judged, before any trimming or parsing.
function refuseControlCharacters(field: string, value: unknown): void {
	if (typeof value === "string" && CONTROL.test(value)) throw new Error(`Flow gate ${field} must not contain control characters.`);
}

const targetList = (targets: GateTarget[]) => targets.map(({ scope, kind }) => `${kind} ${scope}`).join(", ");

// Each target's presentation, still unchanged, or the reason the whole approve must be refused. The digest is read
// again and the canonical path compared: a different file under the same presentation, or a link that moved, is a
// change.
async function presentedTargets(
	host: Host,
	state: GateState,
	root: string,
	targets: GateTarget[],
): Promise<{ presented: Presentation[] } | { error: string }> {
	const presented: Presentation[] = [];
	const missing: string[] = [];
	const changed: string[] = [];
	const unreadable: string[] = [];
	for (const target of targets) {
		const pair = `${target.scope}/${target.kind}`;
		const entry = state.presentations.get(stateKey(root, target.scope, target.kind));
		if (entry === undefined) {
			missing.push(pair);
			continue;
		}
		try {
			const canonical = await canonicalPath(host, entry.path);
			const text = await host.read(entry.path);
			// An absent canonical path is unknown, which fails closed exactly as a moved file does.
			if (canonical !== entry.path || (await artifactDigest(host, entry.kind, text)) !== entry.sha256) changed.push(pair);
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

// The sentence a writing action refuses with when it comes from a subagent, or undefined for `status` and for an
// action this module does not know (the action error names that better). This module is the only owner of the rule:
// the hooks module tells it whether the call came from the parent conversation.
function parentOnlyRefusal(input: ToolInput): string | undefined {
	const action = actionParam(input);
	return action === undefined || action === "status" ? undefined : PARENT_ONLY[action];
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
async function applyApproval(
	host: Host,
	state: GateState,
	root: string,
	lines: RecordLine[],
	presented: Presentation,
): Promise<{ lines: RecordLine[]; dropped: string[] }> {
	const { scope, kind } = presented;
	const dropped: string[] = [kind];
	if (kind === "contract") {
		for (const later of ["plan", "implementation", "accept"]) {
			if (!recordedSince(state, root, latestRecord(lines, scope, later), presented.presentedAt)) dropped.push(later);
		}
	} else {
		dropped.push("accept");
	}
	const kept = lines.filter((line) => line.scope !== scope || !dropped.includes(line.kind));
	kept.push({ scope, kind, digest: presented.sha256, path: await rootRelativePath(host, root, presented.path) });
	return { lines: kept, dropped };
}

// The exact shape `tests/guard-cases.test.mjs`'s `parseStatus` reads.
async function status(host: Host, root: string, scope: string): Promise<string> {
	const lines = await readRecord(host, root);
	const text = ["Flow gate status", `Scope: ${scope}`];
	for (const kind of GATE_KINDS) {
		const approval = latestRecord(lines, scope, kind);
		if (approval === undefined) {
			text.push(`${kind}: missing`);
			continue;
		}
		const recorded = recordedArtifactPath(approval.path);
		let word = "stale";
		let amendments = "";
		try {
			const current = await artifactIdentity(host, root, recorded, kind);
			word = (await rootRelativePath(host, root, current.path)) === recorded && current.sha256 === approval.digest ? "current" : "stale";
			if (word === "current" && current.amendments > 0) amendments = `, in-scope amendments: ${current.amendments}`;
		} catch {
			word = "missing";
		}
		text.push(`${kind}: ${word} (${recorded}${amendments})`);
	}
	const acceptance = latestRecord(lines, scope, "accept");
	if (acceptance !== undefined) {
		const current = await worktreeIdentity(host, root);
		text.push(`acceptance: ${current.fingerprint === acceptance.digest ? "current" : "stale"} (${acceptance.path})`);
	} else {
		text.push("acceptance: missing");
	}
	return text.join("\n");
}

const APPROVE_OPTIONS: AskOption[] = [
	{ label: "Approve", description: "Record these approvals and drop the records they supersede." },
	{ label: "Refuse", description: "Record nothing." },
];

const ACCEPT_OPTIONS: AskOption[] = [
	{ label: "Record", description: "Bind the current working tree to this acceptance." },
	{ label: "Refuse", description: "Record nothing." },
];

const DIALOG_UNANSWERED = "Flow gate: the approval dialog was not answered; nothing was recorded.";

// A dismissal, an engine that cannot ask (`-p`, `dontAsk`), an answer naming neither label and an answer naming both
// all write nothing.
async function confirmed(host: Host, question: string, options: AskOption[]): Promise<boolean> {
	try {
		return await host.ask(question, options);
	} catch {
		return false;
	}
}

// One dialog per call, naming every artifact it would record: each pair with its root-relative path and its summary.
async function approveDialog(host: Host, root: string, presented: Presentation[]): Promise<string> {
	const [only] = presented;
	const headline =
		presented.length === 1 && only !== undefined
			? `Flow gate: approve the ${only.kind} for scope ${only.scope}?`
			: `Flow gate: approve ${presented.length} Flow artifacts?`;
	const lines: string[] = [];
	for (const entry of presented) {
		lines.push(`- ${entry.kind} ${entry.scope} — ${await rootRelativePath(host, root, entry.path)} — ${entry.summary}`);
	}
	return [headline, "", ...lines].join("\n");
}

// One dialog per call, naming each scope, the source receipt and the head read before the dialog, plus the summary
// when one was given.
function acceptDialog(scopes: string[], source: string, head: string, summary: string | undefined): string {
	const headline =
		scopes.length === 1
			? `Flow gate: record acceptance for scope ${scopes[0]}?`
			: `Flow gate: record acceptance for scopes ${scopes.join(", ")}?`;
	const lines = scopes.map((scope) => `- ${scope} — ${source} — head ${head}`);
	if (summary !== undefined) lines.push(`- summary — ${summary}`);
	return [headline, "", ...lines].join("\n");
}

async function present(host: Host, state: GateState, root: string, scope: string, input: ToolInput): Promise<string> {
	refuseControlCharacters("scope", input.scope);
	refuseControlCharacters("kind", input.kind);
	refuseControlCharacters("path", input.path);
	const kind = kindParam(input);
	const path = getString(input, "path");
	const summary = getString(input, "summary");
	if (kind === undefined || path === undefined || summary === undefined) {
		throw new Error("Flow gate present requires kind, path, and summary");
	}
	const invalidSummary = summaryError(summary);
	if (invalidSummary !== undefined) throw new Error(invalidSummary);
	refuseControlCharacters("summary", input.summary);
	const identity = await artifactIdentity(host, root, path, kind);
	const displayPath = await rootRelativePath(host, root, identity.path);
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

// The dialog may stay open for minutes, so what it will record is read again before and after the answer, and one
// write of the record happens only behind an affirmative answer.
async function approve(host: Host, state: GateState, root: string, input: ToolInput): Promise<string> {
	const targets = approvalTargets(input);
	if (targets === undefined) throw new Error("Flow approval requires scope and kind.");
	const before = await presentedTargets(host, state, root, targets);
	if ("error" in before) throw new Error(before.error);
	await readRecord(host, root);
	const answered = await confirmed(host, await approveDialog(host, root, before.presented), APPROVE_OPTIONS);
	if (!answered) throw new Error(DIALOG_UNANSWERED);
	const after = await presentedTargets(host, state, root, targets);
	if ("error" in after) throw new Error(after.error);
	const swapped = after.presented.flatMap((now, index) => {
		const was = before.presented[index];
		return was === undefined || now.path !== was.path || now.sha256 !== was.sha256 || now.presentedAt !== was.presentedAt
			? [`${now.scope}/${now.kind}`]
			: [];
	});
	if (swapped.length > 0) {
		throw new Error(`The Flow presentation changed while the prompt was open: ${swapped.join(", ")}. Approve again.`);
	}
	let lines = await readRecord(host, root);
	const dropped: string[] = [];
	const written: [string, Written][] = [];
	for (const entry of after.presented) {
		const applied = await applyApproval(host, state, root, lines, entry);
		lines = applied.lines;
		for (const kind of applied.dropped) dropped.push(stateKey(root, entry.scope, kind));
		const line = lines[lines.length - 1];
		written.push([stateKey(root, entry.scope, entry.kind), { digest: line.digest, path: line.path, at: stamp() }]);
	}
	await writeRecord(host, root, lines);
	for (const key of dropped) state.written.delete(key);
	for (const [key, value] of written) state.written.set(key, value);
	for (const { scope, kind } of targets) state.presentations.delete(stateKey(root, scope, kind));
	const [only] = targets;
	return targets.length === 1 && only !== undefined
		? `Approved Flow ${only.kind} revision for scope ${only.scope}.`
		: `Approved ${targets.length} Flow artifact revisions: ${targetList(targets)}.`;
}

// The discrete dialog comes before the fingerprint, so a refusal costs nothing; the head it names is read before it
// and compared with the head the fingerprint reads after it, so the record never binds a head the dialog did not
// name. `ensureFlowExcluded` runs before the fingerprint too: the first accept on a new checkout must not bind Flow's
// own state.
async function accept(host: Host, state: GateState, root: string, input: ToolInput): Promise<string> {
	const source = getString(input, "source");
	if (source === undefined) throw new Error("Flow gate accept requires a source receipt identifier");
	refuseControlCharacters("source", input.source);
	const summary = getString(input, "summary");
	if (summary !== undefined) {
		const invalidSummary = summaryError(summary);
		if (invalidSummary !== undefined) throw new Error(invalidSummary);
		refuseControlCharacters("summary", input.summary);
	}
	const scopes = listParam(input, "scope");
	if (scopes.length === 0) throw new Error("Flow gate scope is required");
	for (const scope of scopes) refuseControlCharacters("scope", scope);
	await readRecord(host, root);
	const head = await headRevision(host, root);
	const answered = await confirmed(host, acceptDialog(scopes, source, head, summary), ACCEPT_OPTIONS);
	if (!answered) throw new Error(DIALOG_UNANSWERED);
	await ensureFlowExcluded(host, root);
	const identity = await worktreeIdentity(host, root);
	if (identity.head !== head) {
		throw new Error(
			`Flow gate: HEAD moved from ${head} to ${identity.head} while the acceptance dialog was open; nothing was recorded. Run accept again.`,
		);
	}
	const lines = (await readRecord(host, root)).filter((line) => line.kind !== "accept" || !scopes.includes(line.scope));
	for (const scope of scopes) lines.push({ scope, kind: "accept", digest: identity.fingerprint, path: identity.head });
	await writeRecord(host, root, lines);
	const at = stamp();
	for (const scope of scopes) state.written.set(stateKey(root, scope, "accept"), { digest: identity.fingerprint, path: identity.head, at });
	return `Recorded Flow acceptance/closure for ${scopes.length === 1 ? "scope" : "scopes"} ${scopes.join(", ")}: tree ${identity.tree} at ${identity.head}.`;
}

async function clear(host: Host, state: GateState, root: string, scope: string): Promise<string> {
	await writeRecord(host, root, (await readRecord(host, root)).filter((line) => line.scope !== scope));
	for (const kind of [...GATE_KINDS, "accept"]) {
		state.presentations.delete(stateKey(root, scope, kind));
		state.written.delete(stateKey(root, scope, kind));
	}
	return `Cleared Flow gate state for scope ${scope}.`;
}

/**
 * One `flow_gate` call. Validates the action and scope, resolves the repository and refuses a writing action from a
 * subagent before any record or artifact is read, then dispatches. Throws the refusal sentence; the caller answers
 * the tool call with it.
 */
export async function gateAction(
	host: Host,
	state: GateState,
	input: ToolInput,
	context: { isParent: boolean },
): Promise<string> {
	const action = actionParam(input);
	const scope = getString(input, "scope");
	if (action === undefined) throw new Error("Flow gate action must be present, approve, accept, status, or clear");
	if (scope === undefined) throw new Error("Flow gate scope is required");
	if ((action === "present" || action === "status" || action === "clear") && scope.includes(",")) {
		throw new Error(`Flow gate ${action} takes one scope.`);
	}
	const spaced = listParam(input, "scope").find((item) => /\s/.test(item));
	if (spaced !== undefined) throw new Error(`Flow gate scope must not contain whitespace: ${spaced}`);
	let root: string;
	try {
		root = await repoRoot(host, await host.sessionCwd());
	} catch {
		throw new Error("Flow gate requires a git repository.");
	}
	const refusal = context.isParent ? undefined : parentOnlyRefusal(input);
	if (refusal !== undefined) throw new Error(refusal);
	if (action === "status") return await status(host, root, scope);
	if (action === "present") return await present(host, state, root, scope, input);
	if (action === "approve") return await approve(host, state, root, input);
	if (action === "accept") return await accept(host, state, root, input);
	return await clear(host, state, root, scope);
}

// OMP's tool text and properties, unchanged, as the JSON schema the engine registers.
export function flowGateSpec(): { name: string; description: string; inputSchema: Record<string, unknown> } {
	return {
		name: "flow_gate",
		description:
			"Bind Flow contract/plan approvals and acceptance closure to exact repository artifacts/state. " +
			"Use present for each artifact, then one approve naming every scope and kind the user's yes covers; accept after independent acceptance/closure, status to inspect, and clear after integration.",
		inputSchema: {
			type: "object",
			properties: {
				action: { type: "string", description: "present | approve | accept | status | clear" },
				scope: { type: "string", description: "Stable Flow scope/slug/unit id. approve and accept also take several, separated by commas" },
				kind: { type: "string", description: "contract | plan | implementation for present. approve also takes several, separated by commas" },
				path: { type: "string", description: "Artifact path for present: .flow/contracts/<slug>.md or contracts/<slug>.md (relative to .flow/)" },
				summary: {
					type: "string",
					description: `One line, at most ${SUMMARY_MAX_CHARS} characters, naming what the user approves; shown in the approval prompt`,
				},
				source: { type: "string", description: "Acceptance/closure receipt identifier or concise source" },
			},
			required: ["action", "scope"],
			additionalProperties: false,
		},
	};
}
