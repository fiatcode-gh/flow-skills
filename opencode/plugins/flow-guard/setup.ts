/**
 * flow-skills — OpenCode flow-guard: the plugin's `setup`.
 *
 * Invariant: every agent tool call passes one `execute.before` hook before it runs, Code Mode's nested calls and
 * child sessions included (OpenCode 2.2.5). A refusal is a thrown `Error`: that call alone fails and the model sees
 * the reason. The hook refuses and never asks. It captures no state at setup: the session directory is read again
 * on every call, so a moved checkout is judged where it now is. The `flow_gate` tool is the only writer of the
 * approval record, and the permission `evaluate` hook turns each of its `flow_gate …` actions into a prompt. A
 * `subagent` call that starts or continues a gated agent passes the dispatch gate on that record. A switch to or from
 * `ask` stores one reminder in the session, and the session `context` hook restores one a request has lost.
 */
import { askReminders } from "./ask-mode.ts";
import { credentialsRefusal, grepCredentialsFile, namedCredentialsFile, printedCredentialsFile } from "./credentials.ts";
import { dispatchRefusal } from "./dispatch.ts";
import { createGateState, flowGateTool, GATE_ACTION_PREFIX } from "./flow-gate.ts";
import { runtimeWriteRefusal } from "./runtime-writes.ts";
import { resolveToolPath } from "./tool-path.ts";
import type { AskHost } from "./ask-mode.ts";

type Registration = Promise<{ dispose(): void }>;

export type ToolEvent = { tool: string; sessionID: string; agent: string; messageID: string; id: string; input: unknown };

export type PermissionInput = {
	sessionID: string;
	agent: string;
	action: string;
	resources: string[];
	metadata?: Record<string, unknown>;
	source?: unknown;
	save?: string[];
};

export type PermissionEvent = Omit<PermissionInput, "save"> & { effect: "allow" | "ask" | "deny"; message?: string };

// The members of OpenCode's plugin `ctx` this plugin uses, structurally, so tests can supply a host model. The
// event stream and the session's `context` hook and `synthetic` come from `AskHost`.
export type FlowHost = AskHost & {
	location: { directory: string };
	tool: {
		transform(callback: (editor: { add(tool: Record<string, unknown>): void }) => void | Promise<void>): Registration;
		hook(name: "execute.before", callback: (event: ToolEvent) => void | Promise<void>): Registration;
	};
	permission: {
		hook(name: "evaluate", callback: (event: PermissionEvent) => void | Promise<void>): Registration;
		assert(input: PermissionInput): Promise<unknown>;
	};
	session: {
		get(input: { sessionID: string }): Promise<Record<string, unknown>>;
		context(input: { sessionID: string }): Promise<unknown[]>;
	};
};

// The credentials file a `read`, `grep` or `shell` call would print, if any. Fields of the wrong type are ignored.
function printedSecret(cwd: string, tool: string, input: Record<string, unknown>): string | undefined {
	const text = (value: unknown) => (typeof value === "string" ? value : undefined);
	if (tool === "read") {
		const path = text(input.path);
		return path === undefined ? undefined : namedCredentialsFile(cwd, path);
	}
	if (tool === "grep") return grepCredentialsFile(cwd, text(input.path), text(input.include));
	if (tool === "shell") {
		const command = text(input.command);
		if (command === undefined) return undefined;
		const workdir = text(input.workdir);
		return printedCredentialsFile(command, workdir === undefined ? cwd : resolveToolPath(cwd, workdir), true);
	}
	return undefined;
}

export async function setup(ctx: FlowHost): Promise<void> {
	const state = createGateState();
	await ctx.tool.transform((editor) => editor.add(flowGateTool(ctx, state)));
	// Rules and saved approvals cannot answer a gate prompt: every `flow_gate …` action asks the user.
	await ctx.permission.hook("evaluate", (event) => {
		if (typeof event.action !== "string" || !event.action.startsWith(GATE_ACTION_PREFIX)) return;
		event.effect = "ask";
		const reason = event.metadata?.reason;
		event.message = typeof reason === "string" ? reason : event.action;
	});
	await askReminders(ctx);
	await ctx.tool.hook("execute.before", async (event) => {
		if (typeof event.input !== "object" || event.input === null) return;
		const input = event.input as Record<string, unknown>;
		const cwd = ctx.location.directory;
		// OpenCode's input repair renames `bash` to `shell`; whether it runs before this hook is unproven.
		const tool = event.tool === "bash" ? "shell" : event.tool;
		const hit = printedSecret(cwd, tool, input);
		if (hit !== undefined) throw new Error(credentialsRefusal(tool, hit));
		const runtimeWrite = runtimeWriteRefusal(tool, input, cwd);
		if (runtimeWrite !== undefined) throw new Error(runtimeWrite);
		if (event.tool !== "subagent") return;
		const dispatch = await dispatchRefusal(ctx, state, input);
		if (dispatch !== undefined) throw new Error(dispatch);
	});
}
