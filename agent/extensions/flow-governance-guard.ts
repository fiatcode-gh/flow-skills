import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
	appendFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readlinkSync,
	realpathSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

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

const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

function git(cwd: string, args: string[]): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
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
	appendFileSync(exclude, "/.flow/\n", "utf8");
}

function writeState(root: string, state: GateState): void {
	ensureFlowExcluded(root);
	const path = statePath(root);
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
	renameSync(tmp, path);
}

function resolveFlowArtifact(root: string, inputPath: string): string {
	const candidate = isAbsolute(inputPath) ? resolve(inputPath) : resolve(root, inputPath);
	const flowRoot = resolve(root, ".flow");
	const rel = relative(flowRoot, candidate);
	if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
		throw new Error(`Flow gate artifacts must live below ${flowRoot}`);
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

function worktreeIdentity(root: string): { head: string; fingerprint: string } {
	let head = "UNBORN";
	try {
		head = git(root, ["rev-parse", "HEAD"]);
	} catch {
		// An unborn repository is still fingerprintable from its working tree.
	}

	let diff = "";
	try {
		diff = execFileSync("git", ["diff", "--binary", "HEAD", "--", "."], {
			cwd: root,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
	} catch {
		diff = execFileSync("git", ["diff", "--binary", "--no-index", "/dev/null", "/dev/null"], {
			cwd: root,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
	}

	const untrackedRaw = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
		cwd: root,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	const untracked = untrackedRaw.split("\0").filter(Boolean).sort();
	const hash = createHash("sha256");
	hash.update(`head\0${head}\0diff\0`);
	hash.update(diff);
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

function parseManifest(task: unknown): GateManifest {
	if (typeof task !== "string") return {};
	const lines = task.split(/\r?\n/);
	const start = lines.findIndex((line) => line.trim().toLowerCase() === GATE_HEADER);
	if (start < 0) return {};
	const result: GateManifest = {};
	for (let i = start + 1; i < lines.length; i += 1) {
		const line = lines[i];
		if (/^\s*[^-\s].*:\s*$/.test(line)) break;
		const match = line.match(/^\s*-\s*(Scope|Contract|Plan):\s*(.+?)\s*$/i);
		if (!match) continue;
		const key = match[1].toLowerCase();
		const value = match[2].trim();
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

function plannerGateError(root: string, task: unknown): string | undefined {
	const manifest = parseManifest(task);
	if (!manifest.scope || !manifest.contract) {
		return "flow-planner task must include Flow gate with Scope and Contract";
	}
	return approvalError(root, manifest.scope, "contract", manifest.contract);
}

function writerGateError(root: string, task: unknown): string | undefined {
	const manifest = parseManifest(task);
	if (!manifest.scope || !manifest.contract || !manifest.plan) {
		return "production writer task must include Flow gate with Scope, Contract, and Plan";
	}
	const contractError = approvalError(root, manifest.scope, "contract", manifest.contract);
	if (contractError) return contractError;
	if (manifest.plan.toUpperCase() === "NONE") {
		return approvalError(root, manifest.scope, "implementation", manifest.contract);
	}
	return approvalError(root, manifest.scope, "plan", manifest.plan);
}

function verifierGateError(root: string, task: unknown): string | undefined {
	const manifest = parseManifest(task);
	if (!manifest.scope) return "flow-evidence-verifier task must include Flow gate with Scope";
	const acceptance = readState(root).scopes[manifest.scope]?.acceptance;
	if (!acceptance) return `scope ${manifest.scope}: no acceptance/closure recorded for the current repository state`;
	const current = worktreeIdentity(root);
	if (current.fingerprint !== acceptance.fingerprint) {
		return `scope ${manifest.scope}: repository state changed after acceptance/closure (${acceptance.head} -> ${current.head})`;
	}
	return undefined;
}

function taskGateErrors(root: string, input: ToolInput): string[] {
	const errors: string[] = [];
	const check = (agent: unknown, task: unknown, label: string) => {
		if (agent === PLANNER) {
			const error = plannerGateError(root, task);
			if (error) errors.push(`${label}: ${error}`);
			return;
		}
		if (typeof agent === "string" && WRITERS.has(agent)) {
			const error = writerGateError(root, task);
			if (error) errors.push(`${label}: ${error}`);
			return;
		}
		if (agent === VERIFIER) {
			const error = verifierGateError(root, task);
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

function resultText(text: string, details: Record<string, unknown> = {}) {
	return {
		content: [{ type: "text" as const, text }],
		details,
	};
}

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
			path: z.string().optional().describe("Artifact path below .flow/ for present"),
			summary: z.string().optional().describe("User-facing summary tied to the presented artifact revision"),
			source: z.string().optional().describe("Acceptance/closure receipt identifier or concise source"),
		}),
		approval: (raw) => {
			const input = raw as ToolInput;
			const action = gateAction(input);
			if (action === "present" || action === "status") return "read";
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
			if (gateAction(input) !== "approve") return undefined;
			const scope = getString(input, "scope");
			const kind = gateKind(input);
			if (!scope || !kind) return undefined;
			const presented = presentations.get(presentationKey(scope, kind));
			if (!presented) return [`Scope: ${scope}`, `Kind: ${kind}`, "Presentation: missing"];
			return [
				`Scope: ${scope}`,
				`Kind: ${kind}`,
				`Artifact: ${presented.path}`,
				`SHA-256: ${presented.sha256}`,
				`Summary: ${presented.summary}`,
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
				const presented: Presentation = { scope, kind, path: identity.path, sha256: identity.sha256, summary };
				presentations.set(presentationKey(scope, kind), presented);
				return resultText(
					[`Flow ${kind} presentation`, `Scope: ${scope}`, `Artifact: ${identity.path}`, `SHA-256: ${identity.sha256}`, "", summary].join("\n"),
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

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "task") return;
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
