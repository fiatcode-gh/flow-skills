/**
 * flow-skills — OpenCode flow-guard: the `ask` agent's reminders.
 *
 * `ask` offers `build`'s tools, so the model cannot tell the two apart from its request. The plugin keeps the
 * reminders the way OpenCode 2.2.5 keeps its own plan ones (`packages/core/src/plugin/plan.ts`): a session created as
 * `ask`, or switched to it, gets the enter reminder stored once; a switch from `ask` to another agent stores the leave
 * reminder once. Each is a synthetic message, stored without resuming the session, so it reaches the model as its
 * own user message in every later request and the requests' prefix stays the same from one step to the next. Before
 * each request the `context` hook checks the latest of the two in the request: when compaction or a revert dropped the
 * one the session's agent needs, it adds it, before the user's prompt when the request ends on one and otherwise last,
 * and stores it. The system prompt and the tools are never touched.
 */

export const ASK_AGENT = "ask";

export const ASK_ENTER = `<system-reminder>
You are in the ask agent. Nothing changes without the user's approval: every edit, shell command and subagent dispatch asks the user first. To change files, ask the user to switch to the build agent.
</system-reminder>`;

export const ASK_LEAVE = `<system-reminder>
You are no longer in the ask agent; its limits no longer apply.
</system-reminder>`;

// OpenCode's `SessionContext` (`@opencode/plugin` promise `session.ts`): the request about to go to the provider.
// `system` and `tools` are the cached prefix and stay untouched here.
export type RequestMessage = { role: string; content: Array<{ type: string; text?: string }> };
export type SessionContext = {
	readonly sessionID: string;
	readonly agent: string;
	readonly model: { id: string; providerID: string; variant?: string };
	system: unknown[];
	messages: RequestMessage[];
	tools: Record<string, { description: string; input: unknown }>;
	options: Record<string, unknown>;
};

// The two bus events a switch shows up in (`@opencode/client` `OpenCodeEvent`), as far as this plugin reads them.
export const SWITCH_EVENTS = ["session.created", "session.agent.selected"];
export type SwitchEvent = { type: string; data: { sessionID: string; agent?: string; previous?: string } };

export type AskHost = {
	event: { subscribe(options: { types: string[] }): AsyncIterable<SwitchEvent> };
	session: {
		hook(name: "context", callback: (event: SessionContext) => void | Promise<void>): Promise<{ dispose(): void }>;
		synthetic(input: { sessionID: string; text: string; resume: boolean }): Promise<unknown>;
	};
};

// The reminder a switch stores, if any: plan.ts `switchReminder` with `ask` for `plan`.
function switchReminder(event: SwitchEvent): string | undefined {
	if (event.type === "session.created") return event.data.agent === ASK_AGENT ? ASK_ENTER : undefined;
	if (event.type !== "session.agent.selected" || event.data.agent === event.data.previous) return undefined;
	if (event.data.agent === ASK_AGENT) return ASK_ENTER;
	if (event.data.previous === ASK_AGENT) return ASK_LEAVE;
	return undefined;
}

// The latest of the two reminders in the request, each its own one-part user message: plan.ts `lastReminder`.
function lastReminder(messages: RequestMessage[]): string | undefined {
	let found: string | undefined;
	for (const message of messages) {
		const part = message.role === "user" && message.content.length === 1 ? message.content[0] : undefined;
		if (part?.type === "text" && (part.text === ASK_ENTER || part.text === ASK_LEAVE)) found = part.text;
	}
	return found;
}

export async function askReminders(host: AskHost): Promise<void> {
	// A V2 plugin's `ctx` has no logger: a reminder that fails to store is dropped, as plan.ts drops its own after a
	// warning, and the `context` hook adds it again on the session's next request.
	const store = (sessionID: string, text: string) =>
		host.session.synthetic({ sessionID, text, resume: false }).then(
			() => undefined,
			() => undefined,
		);

	await host.session.hook("context", (event) => {
		const latest = lastReminder(event.messages);
		const missing = event.agent === ASK_AGENT && latest !== ASK_ENTER;
		const stale = event.agent !== ASK_AGENT && latest === ASK_ENTER;
		const text = missing ? ASK_ENTER : stale ? ASK_LEAVE : undefined;
		if (text === undefined) return;
		const at = event.messages.at(-1)?.role === "user" ? event.messages.length - 1 : event.messages.length;
		event.messages.splice(at, 0, { role: "user", content: [{ type: "text", text }] });
		return store(event.sessionID, text);
	});

	// Subscribed before setup returns, so no switch after the plugin loads is missed. Should the stream fail, the
	// `context` hook still adds and stores whichever reminder a request lacks.
	const switches = host.event.subscribe({ types: SWITCH_EVENTS });
	void (async () => {
		for await (const event of switches) {
			const text = switchReminder(event);
			if (text !== undefined) await store(event.data.sessionID, text);
		}
	})().catch(() => undefined);
}
