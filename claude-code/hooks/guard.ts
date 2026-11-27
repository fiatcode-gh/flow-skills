/**
 * flow-skills — Claude Code flow-guard: the plugin's hooks module.
 *
 * Invariant: the engine runs a gating hook through `on(event[, matcher], hook)` and skips a hook that throws or runs
 * out of its budget before it answers, letting the call proceed ungated. So every gating registration carries one
 * `.catch` that refuses in its place: a hook the guard could not finish never lets a gated call through, and
 * `tool.check` asks instead of denying so a publication whose guard broke still reaches the user. The
 * `session.start` registration gates nothing; its `.catch` logs and carries the event on.
 *
 * The engine's own object is read in `guard/host.ts` only: no hook below touches it. This file is the only one in the
 * plugin that names `on`, and no hook here returns `allow`.
 */

import { secretRefusal } from "./guard/credentials.ts";
import { agentToolRefusal, sendMessageRefusal, spawnRefusal } from "./guard/dispatch.ts";
import { createGateState, flowGateSpec, gateAction } from "./guard/gate.ts";
import { hostOf } from "./guard/host.ts";
import { cloudSession, publicationDecision, readSessionStart, type SessionStart } from "./guard/publication.ts";
import { runtimeWriteRefusal } from "./guard/runtime-writes.ts";
import { foreignToolRefusal } from "./guard/tool-inputs.ts";

// The name the engine serves a registered tool under: the plugin's scope and the tool's own name.
const FLOW_GATE_TOOL = "mcp__fiatcode__flow_gate";

// What the engine hands a hook: its own object, the event, and `next`, which carries the call on and remembers that
// it did.
type Next = ((event: unknown) => Promise<unknown>) & { called: boolean };
type Hook = (ctx: unknown, event: Record<string, unknown>, next: Next) => unknown;
type Registration = { catch(handler: Hook): unknown };
type On = {
	(event: "session.start" | "tool.call" | "agent.spawn" | "tool.check", hook: Hook): Registration;
	(event: "session.start" | "tool.call" | "agent.spawn" | "tool.check", matcher: Record<string, string>, hook: Hook): Registration;
};
type HostSource = Parameters<typeof hostOf>[0];

const TOOL_CALL_REASON =
	"Flow guard failed closed: the tool.call hook could not decide. Retry; if it keeps failing, report it instead of working around it.";
const AGENT_SPAWN_REASON =
	"Flow guard failed closed: the agent.spawn hook could not decide. Retry; if it keeps failing, report it instead of working around it.";
const TOOL_CHECK_REASON = "Flow guard failed closed: the tool.check hook could not decide. Approve only the command you meant to run.";
const SESSION_START_FAILED = "Flow guard: session.start failed; flow_gate is not registered in this session.";
const FLOW_GATE_REASON =
	"Flow gate failed closed: the flow_gate hook could not decide. Retry; if it keeps failing, report it instead of working around it.";

// Presentations outlive one call but not this process: the record is the only durable state. They are not kept in the
// engine's store, because a presentation must not outlive the conversation or cross checkouts.
const gateState = createGateState();

// Registration runs once per process: a second `session.start` in the same session would ask the engine for a server
// it already has.
let registered = false;

// The cloud exemption's start facts: the session root and the branch it started on. Safe to keep here:
// only the engine raises `session.start`, so no tool call, file or shell command can assign this variable, and it
// lives in this process alone, so no other checkout or session shares it — which is why the engine's store, shared
// across the machine, does not hold it. A reloaded module holds no facts, and so no exemption, until its next
// `session.start`.
let sessionStartFacts: SessionStart | undefined;

// The engine takes only `next(e)`'s result from a `session.start` hook, so this one carries the event on and other
// plugins' hooks beneath it still run. A cloud session also records its start facts here, and only here.
async function sessionStart(ctx: unknown, event: Record<string, unknown>, next: Next): Promise<unknown> {
	const host = hostOf(ctx as HostSource);
	if (!registered) {
		try {
			await host.registerTool(flowGateSpec());
			registered = true;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			// Another instance of this module already registered the server for this session; the name is unchanged,
			// so the model still calls the tool this process serves.
			if (!/already has an MCP server/i.test(message)) throw error;
			registered = true;
			await host.log(`Flow gate tool already registered: ${message}`);
		}
	}
	if (await cloudSession(host)) sessionStartFacts = await readSessionStart(host, typeof event.cwd === "string" ? event.cwd : "");
	return await next(event);
}

// A registered tool's call is answered here, not in `tool.run`, which needs a later Claude Code than the 2.1.299 floor
// (see docs/decisions/claude-code-port.md). The engine takes this hook's returned `{ result }` as the tool's output, and
// the array form is the one it accepts. A refusal is a denial, so the model reads the gate's sentence and records
// nothing. `gateAction` decides the parent-only rule from whether the call carries `agentId`: only the main
// conversation presents, approves, accepts and clears.
async function flowGate(ctx: unknown, event: Record<string, unknown>): Promise<unknown> {
	try {
		const isParent = event.agentId === undefined;
		const text = await gateAction(hostOf(ctx as HostSource), gateState, event, { isParent });
		return { result: [{ type: "text", text }] };
	} catch (error) {
		return { deny: error instanceof Error ? error.message : String(error) };
	}
}

// A `tool.call` event carries the tool's own arguments and no working directory, so the session's
// cwd comes from the host, which reads it from the engine's session.
async function toolCall(ctx: unknown, event: Record<string, unknown>, next: Next): Promise<unknown> {
	const host = hostOf(ctx as HostSource);
	const tool = typeof event.tool === "string" ? event.tool : "";
	const cwd = await host.sessionCwd();
	// OMP runs the credentials guard first, so a call that would both print a secret and write `.flow/runtime` is
	// refused for the secret: that is the invariant the user has to see.
	const secret = await secretRefusal(host, cwd, tool, event);
	if (secret !== undefined) return { deny: secret };
	const refusal = await runtimeWriteRefusal(host, cwd, tool, event);
	if (refusal !== undefined) return { deny: refusal };
	// Every tool without a rule of its own is judged by its input's single-line strings; `Workflow` is refused by name;
	// the tools in `UNJUDGED_TOOLS` (dispatch, messaging, the user's dialogs, `flow_gate`) are left to their own checks.
	const foreign = await foreignToolRefusal(host, cwd, tool, event);
	if (foreign !== undefined) return { deny: foreign };
	// Below the engine floor a resumed subagent raises no `agent.spawn`, so the message that would resume it is refused.
	if (tool === "SendMessage") {
		const message = await sendMessageRefusal(host);
		if (message !== undefined) return { deny: message };
	}
	// A gated dispatch is refused here and again in `agent.spawn`: the engine raises both for one spawn, and the spawn
	// event also covers a spawn that never went through `tool.call`.
	if (tool === "Agent") {
		const dispatch = await agentToolRefusal(host, gateState, event);
		if (dispatch !== undefined) return { deny: dispatch };
	}
	return await next(event);
}

async function agentSpawn(ctx: unknown, event: Record<string, unknown>, next: Next): Promise<unknown> {
	const refusal = await spawnRefusal(hostOf(ctx as HostSource), gateState, event);
	if (refusal !== undefined) return { deny: refusal };
	return await next(event);
}

async function toolCheck(ctx: unknown, event: Record<string, unknown>, next: Next): Promise<unknown> {
	const decision = await publicationDecision(hostOf(ctx as HostSource), event.tool, event.input, sessionStartFacts);
	return decision === undefined ? await next(event) : decision;
}

// A failed `session.start` is logged, not refused: the engine takes only `next(e)`'s result there, so a refusal is the
// wrong shape and would be skipped. The session runs without `flow_gate`, and the dispatch gate still decides on the
// records approved earlier. A log that fails too must not keep the event from going on.
async function logBrokenSessionStart(ctx: unknown, event: Record<string, unknown>, next: Next): Promise<unknown> {
	try {
		await hostOf(ctx as HostSource).log(SESSION_START_FAILED);
	} catch {
		// Nothing else can be told; the session still starts.
	}
	return next(event);
}

// A hook that already carried the call on with `next` is not refused in its place: the catch finishes what the hook
// started, and only a hook that never got there is refused.
function refuseBrokenToolCall(ctx: unknown, event: Record<string, unknown>, next: Next): unknown {
	return next.called ? next(event) : { deny: TOOL_CALL_REASON };
}

function refuseBrokenFlowGate(ctx: unknown, event: Record<string, unknown>, next: Next): unknown {
	return next.called ? next(event) : { deny: FLOW_GATE_REASON };
}

function refuseBrokenAgentSpawn(ctx: unknown, event: Record<string, unknown>, next: Next): unknown {
	return next.called ? next(event) : { deny: AGENT_SPAWN_REASON };
}

function refuseBrokenToolCheck(ctx: unknown, event: Record<string, unknown>, next: Next): unknown {
	return next.called ? next(event) : { decision: "ask", reason: TOOL_CHECK_REASON };
}

export function register(on: On): void {
	on("session.start", sessionStart).catch(logBrokenSessionStart);
	on("tool.call", toolCall).catch(refuseBrokenToolCall);
	on("tool.call", { tool: FLOW_GATE_TOOL }, flowGate).catch(refuseBrokenFlowGate);
	on("agent.spawn", agentSpawn).catch(refuseBrokenAgentSpawn);
	on("tool.check", toolCheck).catch(refuseBrokenToolCheck);
}
