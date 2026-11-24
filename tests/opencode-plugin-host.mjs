// A model of the OpenCode 2.2.5 plugin host, built from the host facts in the port-parity plan (H3, H6-H11):
// the `ctx` a V2 plugin's `setup` receives, tool calls through `execute.before` and plugin tools, sessions, the
// permission service of `packages/core/src/permission.ts`, the session `context` hook of
// `packages/core/src/session/model-request.ts`, the event stream of `packages/plugin/src/promise/event.ts` and
// stored synthetic messages (`ctx.session.synthetic`). Plugin tests drive `setup` through it; nothing here starts
// `opencode`. Dependency-free, so Node and Bun both run it.

const BASE_RULE = { action: "*", resource: "*", effect: "allow" };

// OpenCode's wildcard: the whole text must match, `*` is any run of characters (`/` included), `?` is one.
function wildcard(pattern, text) {
	const source = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
	return new RegExp(`^${source}$`, "s").test(text);
}

// The effect of the last rule that matches both the action and the resource.
function effectOf(rules, action, resource) {
	let effect;
	for (const rule of rules) {
		if (wildcard(rule.action, action) && wildcard(rule.resource, resource)) effect = rule.effect;
	}
	return effect;
}

function registered() {
	return Promise.resolve({ dispose() {} });
}

function push(map, name, callback) {
	if (!map.has(name)) map.set(name, []);
	map.get(name).push(callback);
}

// A stored session message as `ctx.session.context` returns it, turned into the request's message
// (`session/runner/to-llm-message.ts`): a new object every request, so a hook editing it never touches the store.
// A stored synthetic message goes to the model as a user message of its text; one stored with `texts` (a prompt
// with an attachment, say) goes as one message with a text part for each.
function toRequestMessage(stored) {
	if (stored.type === "tool") {
		return { role: "tool", content: [{ type: "tool-result", id: stored.id, name: stored.name, result: { type: "text", value: stored.text } }] };
	}
	const role = stored.type === "synthetic" ? "user" : stored.type;
	return { role, content: (stored.texts ?? [stored.text]).map((text) => ({ type: "text", text })) };
}

// What one request offers the model before any hook runs: the system prompt parts and the tool definitions.
function requestPrefix() {
	return {
		system: [{ type: "text", text: "You are OpenCode." }],
		tools: {
			read: { description: "Read a file.", input: { type: "object", properties: { path: { type: "string" } } } },
			edit: { description: "Edit a file.", input: { type: "object", properties: { path: { type: "string" } } } },
			shell: { description: "Run a shell command.", input: { type: "object", properties: { command: { type: "string" } } } },
		},
	};
}

export function createHost({ directory }) {
	const tools = new Map();
	const toolHooks = new Map();
	const permissionHooks = new Map();
	const sessionHooks = new Map();
	const sessions = new Map([["ses_main", { id: "ses_main", agent: "build", time: {} }]]);
	const contexts = new Map();
	const synthetics = [];
	const subscribers = new Set();
	const rules = [];
	const saved = [];
	const pending = [];
	const asked = [];
	const waiters = [];
	const settle = new Map();
	let calls = 0;
	let requests = 0;
	let events = 0;

	// One subscription of `ctx.event.subscribe({ types })`: an async iterable of the published events of those types.
	// `drained` holds the publishers waiting for the plugin to finish with an event, which it has when it asks for the next.
	function subscribe({ types } = {}) {
		return {
			[Symbol.asyncIterator]() {
				const subscriber = { types, queue: [], take: undefined, drained: [] };
				subscribers.add(subscriber);
				return {
					next() {
						for (const done of subscriber.drained.splice(0)) done();
						if (subscriber.queue.length > 0) return Promise.resolve({ value: subscriber.queue.shift(), done: false });
						return new Promise((resolve) => {
							subscriber.take = resolve;
						});
					},
					return() {
						subscribers.delete(subscriber);
						return Promise.resolve({ value: undefined, done: true });
					},
				};
			},
		};
	}

	// Publish one event on the bus and resolve once every subscriber to its type has handled it.
	async function publish(type, data) {
		events += 1;
		const event = { id: `evt_${events}`, type, data };
		const handled = [];
		for (const subscriber of subscribers) {
			if (subscriber.types !== undefined && !subscriber.types.includes(type)) continue;
			handled.push(new Promise((resolve) => subscriber.drained.push(resolve)));
			const take = subscriber.take;
			subscriber.take = undefined;
			if (take === undefined) subscriber.queue.push(event);
			else take({ value: event, done: false });
		}
		await Promise.all(handled);
	}

	const ctx = {
		event: { subscribe },
		location: { directory },
		tool: {
			async transform(callback) {
				await callback({
					add(tool) {
						tools.set(tool.name, tool);
					},
				});
				return { dispose() {} };
			},
			hook(name, callback) {
				push(toolHooks, name, callback);
				return registered();
			},
		},
		permission: {
			hook(name, callback) {
				push(permissionHooks, name, callback);
				return registered();
			},
			async assert(input) {
				const { action } = input;
				const resources = input.resources ?? [];
				const configured = [BASE_RULE, ...rules];
				// Configured denials win before any hook runs; saved approvals cannot lift them.
				if (resources.some((resource) => effectOf(configured, action, resource) === "deny")) {
					throw new Error(`Permission denied: ${action}`);
				}
				const effective = [BASE_RULE, ...rules, ...saved];
				const event = {
					sessionID: input.sessionID,
					agent: input.agent,
					action,
					resources,
					metadata: input.metadata,
					source: input.source,
					effect: resources.some((resource) => effectOf(effective, action, resource) === "ask") ? "ask" : "allow",
				};
				for (const callback of permissionHooks.get("evaluate") ?? []) await callback(event);
				if (event.effect === "deny") throw new Error(event.message ?? `Permission denied: ${action}`);
				if (event.effect !== "ask") return;
				requests += 1;
				const request = { id: `per_${requests}`, ...input, message: event.message };
				const answered = new Promise((resolve, reject) => settle.set(request.id, { resolve, reject }));
				pending.push(request);
				asked.push(request);
				waiters.shift()?.(request);
				return answered;
			},
		},
		session: {
			hook(name, callback) {
				push(sessionHooks, name, callback);
				return registered();
			},
			async get({ sessionID }) {
				if (!sessions.has(sessionID)) throw new Error(`Session not found: ${sessionID}`);
				return sessions.get(sessionID);
			},
			async context({ sessionID }) {
				return contexts.get(sessionID) ?? [];
			},
			// Durably admit a synthetic message (`Session.synthetic`): from then on the session's history holds it.
			// Every call is kept in `synthetics`, so tests see what was stored and with which `resume`.
			async synthetic(input) {
				if (!sessions.has(input.sessionID)) throw new Error(`Session not found: ${input.sessionID}`);
				synthetics.push(input);
				const message = { type: "synthetic", id: `msg_syn_${synthetics.length}`, text: input.text };
				contexts.set(input.sessionID, [...(contexts.get(input.sessionID) ?? []), message]);
				return message;
			},
		},
	};

	// `Session.create`: the new session with its agent, then `session.created` on the bus.
	async function createSession({ sessionID, agent = "build" }) {
		sessions.set(sessionID, { id: sessionID, agent, time: {} });
		contexts.set(sessionID, []);
		await publish("session.created", { sessionID, agent });
	}

	// `Session.switchAgent` (`packages/core/src/session/session.ts`): `session.agent.selected` with the agent the
	// session had as `previous`, published even when the two are the same; the projector then records the new agent.
	async function selectAgent({ sessionID = "ses_main", agent }) {
		const previous = sessions.get(sessionID).agent;
		sessions.get(sessionID).agent = agent;
		await publish("session.agent.selected", { sessionID, agent, previous });
	}

	// The user's prompt, stored in the session's history.
	function prompt(text, { sessionID = "ses_main" } = {}) {
		contexts.set(sessionID, [...(contexts.get(sessionID) ?? []), { type: "user", text }]);
	}

	// One primary model request (`SessionModelRequest.primary`): the stored messages become this request's own list,
	// every `context` hook runs in order on `{sessionID, model, system, messages, options, agent, tools}`, and the
	// event as the hooks left it is what goes to the provider.
	async function request({ sessionID = "ses_main", agent = sessions.get(sessionID).agent } = {}) {
		const prefix = requestPrefix();
		const event = {
			sessionID,
			model: { providerID: "anthropic", id: "claude-opus" },
			system: prefix.system,
			messages: (contexts.get(sessionID) ?? []).map(toRequestMessage),
			options: { maxTokens: 32000 },
			agent,
			tools: prefix.tools,
		};
		for (const callback of sessionHooks.get("context") ?? []) await callback(event);
		return event;
	}

	// One agent tool call: every `execute.before` hook in order, then the plugin's own tool when it added one.
	async function call(tool, input, { sessionID = "ses_main", agent = "build", id } = {}) {
		calls += 1;
		const event = { tool, sessionID, agent, messageID: "msg_1", id: id ?? `call_${calls}`, input };
		for (const callback of toolHooks.get("execute.before") ?? []) {
			try {
				await callback(event);
			} catch (error) {
				return { refused: error.message };
			}
		}
		const definition = tools.get(tool);
		if (definition === undefined) return {};
		const context = {
			sessionID,
			agent,
			messageID: event.messageID,
			id: event.id,
			signal: new AbortController().signal,
			progress() {},
		};
		try {
			return { result: await definition.execute(event.input, context) };
		} catch (error) {
			return { error };
		}
	}

	// The user's answer to a pending permission request: `once`, `always` or `reject` (with optional feedback).
	function reply(id, decision, message) {
		const index = pending.findIndex((request) => request.id === id);
		if (index === -1) throw new Error(`No pending permission request: ${id}`);
		const [request] = pending.splice(index, 1);
		const { resolve, reject } = settle.get(id);
		settle.delete(id);
		if (decision === "once") return resolve();
		if (decision === "always") {
			for (const resource of request.save ?? []) saved.push({ action: request.action, resource, effect: "allow" });
			return resolve();
		}
		if (decision !== "reject") throw new Error(`Unknown permission decision: ${decision}`);
		const feedback = typeof message === "string" && message !== "";
		const error = new Error(feedback ? message : "");
		error.name = feedback ? "Tool.Error" : "Permission.DeclinedError";
		reject(error);
	}

	function nextRequest() {
		if (pending.length > 0) return Promise.resolve(pending[0]);
		return new Promise((resolve) => waiters.push(resolve));
	}

	return {
		ctx,
		call,
		request,
		requestPrefix,
		createSession,
		selectAgent,
		prompt,
		tools,
		toolHooks,
		permissionHooks,
		sessionHooks,
		sessions,
		contexts,
		synthetics,
		subscribers,
		rules,
		saved,
		pending,
		asked,
		reply,
		nextRequest,
	};
}
