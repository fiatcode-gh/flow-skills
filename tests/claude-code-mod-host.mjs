// A model of the Claude Code 2.1.331 mods engine, built from the runtime facts observed on that build:
// `on(event[, matcher], hook)` with one `.catch`, dispatch in registration order, the answer shapes each event takes,
// `next(e)` carrying `e` to the hooks beneath, and `$` as the engine's own API object.
// The model's whole point is the engine's fail-open: a hook that throws, exceeds its budget or answers a shape its
// event does not take is skipped and the call proceeds, so a guard without a working `.catch` gates nothing. A catch
// that also fails (or answers `undefined`) leaves the hook skipped the same way.
// Dependency-free, so Node and Bun both run it.
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";

const DEFAULT_TIMEOUT_MS = 10_000;
// A `.catch` handler's grace, fixed by the engine whatever the hook's own budget is.
const CATCH_TIMEOUT_MS = 1_000;
const NO_ANSWER = Symbol("no answer");
const MAX_OUTPUT = 32 * 1024 * 1024;

// The engine's object matcher: every key of the matcher equals the event's value there, or, for a `RegExp`, tests the
// event's string value.
function matches(matcher, payload) {
	if (matcher === undefined) return true;
	if (payload === null || typeof payload !== "object") return false;
	return Object.keys(matcher).every((key) => {
		const wanted = matcher[key];
		const value = payload[key];
		return wanted instanceof RegExp ? typeof value === "string" && wanted.test(value) : value === wanted;
	});
}

function kindOf(stats) {
	if (stats.isFile()) return "file";
	if (stats.isDirectory()) return "dir";
	return "other";
}

// Where a path really is, as a child process's working directory would land: `..` among the components is applied to
// the directory the link before it points into, never folded into the text first. Node's and Bun's own `realpathSync`
// do fold it — `<repo>/lnk/..` answers `<repo>` even when `lnk` points elsewhere — so the command is asked and the
// host's own answer is only the fallback for a platform without it. The engine's answer speaks the platform's
// separator, as `realpathSync` does: on Windows the `realpath` on PATH is usually Git's MSYS build, which prints
// `/c/Users/...`, so its drive form is read as `C:` and its output rewritten rather than adopted as printed; an answer
// inside the MSYS root (`/tmp/...`) is no Windows path, so the host's own answer is used instead.
function realPathOf(path) {
	const result = spawnSync("realpath", [path], { encoding: "utf8" });
	let printed = result.status === 0 && typeof result.stdout === "string" ? result.stdout.trim() : "";
	if (sep === "\\" && printed.startsWith("/") && !printed.startsWith("//")) {
		const msysDrive = /^\/([A-Za-z])(\/.*)?$/.exec(printed);
		printed = msysDrive === null ? "" : `${msysDrive[1].toUpperCase()}:${msysDrive[2] ?? "/"}`;
	}
	const answer = printed === "" ? realpathSync.native(path) : printed;
	return sep === "\\" ? answer.replaceAll("/", "\\") : answer;
}

function hooksError(message) {
	const error = new Error(message);
	error.name = "HooksError";
	return error;
}

// The registration's budget: a hook still running when it runs out is skipped, exactly as a throwing one is.
function withBudget(promise, timeoutMs) {
	if (!Number.isFinite(timeoutMs)) return promise;
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(hooksError(`the hook did not answer within ${timeoutMs}ms`)), timeoutMs);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

const isObject = (value) => value !== null && typeof value === "object";
const isContentBlocks = (value) => Array.isArray(value) && value.every((block) => isObject(block) && typeof block.type === "string");

// The answer shapes each event takes, as observed on the engine. Any other return, `undefined` included, fails the
// hook; the value the hook's own `next` resolved to is checked by identity before this, at every event.
const ANSWER_SHAPES = {
	"tool.call": (value) =>
		(typeof value.deny === "string" && value.result === undefined) ||
		(value.deny === undefined && (typeof value.result === "string" || isContentBlocks(value.result))),
	"tool.check": (value) =>
		["allow", "ask", "deny"].includes(value.decision) && (value.reason === undefined || typeof value.reason === "string"),
	"agent.spawn": (value) => typeof value.deny === "string",
	"session.start": (value) => typeof value.cwd === "string",
};

function isAnswerShape(event, value) {
	const shape = ANSWER_SHAPES[event];
	return shape !== undefined && isObject(value) && shape(value);
}

function promptText(question) {
	return typeof question === "string" ? question : String(question);
}

// `createModHost({ cwd, pluginName, pluginRoot, timeout, answers, env, agents, messages, store, wrapHook, ignoreStdin, version })`.
// `timeout` replaces the 10 000 ms hook budget, never the catch's. `wrapHook({ event, matcher, hook, run })` stands
// between the engine and a registered hook (never its catch), so a test can make a real guard's hook throw or block on
// I/O and watch the engine skip it. `ignoreStdin: true` models a build whose `$.process.run` drops the `stdin` option.
// An `answers` entry that is a function is called when its dialog opens, and what it returns is the answer.
// `version` is what `$.session.version()` answers (default 2.1.332, the build the types were read from); `version: null`
// models a build that lacks the call, so calling it throws a TypeError where it is made.
export function createModHost(options = {}) {
	const pluginName = options.pluginName ?? "fiatcode";
	const root = options.pluginRoot ?? options.cwd ?? process.cwd();
	const registrations = [];
	const answers = [...(options.answers ?? [])];
	const asks = [];
	const logs = [];
	const registeredTools = [];
	const store = new Map(Object.entries(options.store ?? {}));
	const env = { ...(options.env ?? {}) };
	const agents = options.agents ?? [];
	const messages = options.messages ?? {};
	const budget = options.timeout ?? DEFAULT_TIMEOUT_MS;

	const $ = {
		plugin: { name: pluginName, root },
		fs: {
			// `{ as: "bytes" }` answers the file's bytes as `{ base64 }`, the engine's shape for a binary read.
			async read(path, readOptions = {}) {
				if (readOptions.as === "bytes") return { base64: readFileSync(path).toString("base64") };
				return readFileSync(path, "utf8");
			},
			async write(path, text) {
				mkdirSync(dirname(path), { recursive: true });
				writeFileSync(path, text, "utf8");
			},
			// The engine fills `realPath` only for `{ resolve: true }`; an optionless call answers none, so a host that
			// forgets the option is caught by `canonicalPath`'s tests.
			async stat(path, statOptions = {}) {
				const stats = statSync(path);
				const answer = { kind: kindOf(stats), size: stats.size, isLink: lstatSync(path).isSymbolicLink() };
				if (statOptions.resolve === true) answer.realPath = realPathOf(path);
				return answer;
			},
			async exists(path) {
				return existsSync(path);
			},
			async list(path) {
				return readdirSync(path).map((name) => {
					const link = lstatSync(join(path, name));
					return { name, kind: kindOf(link.isSymbolicLink() ? statSync(join(path, name)) : link), isLink: link.isSymbolicLink() };
				});
			},
		},
		process: {
			// `env` replaces the environment when given, as the engine's own `run` does; `stdin` is written to the
			// child's standard input unless the model stands for a build that ignores it.
			async run(argv, runOptions = {}) {
				const result = spawnSync(argv[0], argv.slice(1), {
					cwd: runOptions.cwd,
					env: runOptions.env === undefined ? process.env : runOptions.env,
					input: options.ignoreStdin === true ? undefined : runOptions.stdin,
					encoding: "utf8",
					maxBuffer: MAX_OUTPUT,
				});
				const isTruncated = result.error?.code === "ENOBUFS";
				const stderr = typeof result.stderr === "string" && result.stderr !== "" ? result.stderr : String(result.error?.message ?? "");
				return {
					exitCode: result.status ?? 1,
					stdout: result.stdout ?? "",
					stderr,
					isStdoutTruncated: isTruncated,
					isStderrTruncated: false,
				};
			},
		},
		env: {
			async get(name) {
				return env[name];
			},
		},
		ui: {
			async log(text) {
				logs.push(String(text));
			},
			// An answer queue: no queued answer, an `undefined` answer or `{ isAnswered: false }` refuses, the way
			// the engine raises `HooksError` for a dismissed dialog or a session that cannot ask. The options argument
			// must be labels, as the real engine's `AskOptions` takes them; anything else is rejected before a dialog.
			async ask(question, askOptions) {
				const isLabels =
					Array.isArray(askOptions) && askOptions.every((label) => typeof label === "string" && label.trim() !== "");
				if (!isLabels) throw hooksError(`$.ui.ask options must be an array of non-empty labels: ${JSON.stringify(askOptions) ?? String(askOptions)}`);
				asks.push({ question: promptText(question), options: askOptions });
				const queued = answers.length === 0 ? NO_ANSWER : answers.shift();
				const answer = typeof queued === "function" ? await queued(question, askOptions) : queued;
				const dismissed = answer === NO_ANSWER || answer === undefined || (answer !== null && typeof answer === "object" && answer.isAnswered === false);
				if (dismissed) throw hooksError("no answer (the dialog was dismissed, or this session cannot ask)");
				return answer;
			},
		},
		tool: {
			async register(spec) {
				const tool = `mcp__${pluginName}__${spec.name}`;
				registeredTools.push({ ...spec, tool });
				return { tool };
			},
			// No configured rules in the model: the engine's own verdict for the current rule set is "allow".
			async check() {
				return { decision: "allow" };
			},
		},
		session: {
			surfaces() {
				return [];
			},
			// What the build says it is (default 2.1.332); removed below for `version: null`.
			async version() {
				return { ...(options.version ?? { version: "2.1.332", base: "2.1.332" }) };
			},
			// The session's working directory, as the engine's own `session.cwd()` answers it.
			async cwd() {
				return options.cwd ?? process.cwd();
			},
			async messages(input) {
				const list = messages[input.agentId];
				if (list === undefined) throw new Error(`no message fixture for agent ${input.agentId}`);
				return list;
			},
		},
		agent: {
			async list() {
				return agents;
			},
		},
		store: {
			async get(key) {
				return store.get(key);
			},
			async set(key, value) {
				store.set(key, value);
			},
			async keys() {
				return [...store.keys()];
			},
		},
		clock: {
			now() {
				return Date.now();
			},
		},
	};
	if (options.version === null) delete $.session.version;

	function on(event, matcherOrHook, maybeHook) {
		const registration = {
			event,
			matcher: maybeHook === undefined ? undefined : matcherOrHook,
			hook: maybeHook === undefined ? matcherOrHook : maybeHook,
			catchHook: undefined,
			timeout: budget,
		};
		registrations.push(registration);
		let caught = false;
		return {
			catch(handler) {
				if (caught) throw new Error(`${event} registered a second .catch: a registration carries one`);
				caught = true;
				registration.catchHook = handler;
				return registration;
			},
		};
	}

	function registrationsOf(event) {
		return registrations.filter((registration) => registration.event === event);
	}

	// One handler invocation under a budget: `{ failed: true }` when it threw or ran out. `wrap` applies `wrapHook` to
	// the registered hook only, so a test can break the guard without breaking its catch.
	async function settle(event, registration, handler, payload, next, wrap, timeoutMs) {
		const run = () => handler($, payload, next);
		try {
			const call =
				!wrap || options.wrapHook === undefined ? run() : options.wrapHook({ event, matcher: registration.matcher, hook: handler, run });
			return { failed: false, value: await withBudget(Promise.resolve(call), timeoutMs) };
		} catch (error) {
			return { failed: true, error };
		}
	}

	// What core answers once every hook has carried the call on: `session.start` echoes the `cwd` of the event `next`
	// was given, `tool.check` resolves the engine's own verdict, and the other events run the call itself.
	function coreAnswer(event, payload) {
		if (event === "session.start") return { cwd: payload?.cwd };
		if (event === "tool.check") return { decision: "allow" };
		return {};
	}

	async function dispatch(event, payload) {
		const hooks = registrations.filter((registration) => registration.event === event && matches(registration.matcher, payload));
		const fromCore = new WeakSet();

		// The hooks from `index` down, then core, for the event `next` carried; resolves to the answer that stands.
		async function runFrom(index, current) {
			for (let position = index; position < hooks.length; position += 1) {
				const settled = await runHook(position, current);
				if (settled.stands) return settled.value;
			}
			const answer = coreAnswer(event, current);
			fromCore.add(answer);
			return answer;
		}

		// One registration: its hook's valid answer stands; a failure asks its catch; a catch that fails too, or
		// answers `undefined`, leaves the hook absent — its last `next` result standing if it called `next`, else the
		// hooks beneath deciding.
		async function runHook(position, current) {
			const registration = hooks[position];
			const resolved = new WeakSet();
			let inFlight;
			let last;
			const next = (nextPayload = current) => {
				next.called = true;
				inFlight = runFrom(position + 1, nextPayload).then((value) => {
					resolved.add(value);
					last = value;
					return value;
				});
				return inFlight;
			};
			next.called = false;
			const isAnswer = (value) => resolved.has(value) || isAnswerShape(event, value);

			const direct = await settle(event, registration, registration.hook, current, next, true, registration.timeout);
			if (!direct.failed && isAnswer(direct.value)) return { stands: true, value: direct.value };
			// The catch runs once a `next` the hook started has settled.
			if (next.called) await inFlight;
			if (registration.catchHook !== undefined) {
				// Replay-safe: after the hook's own `next`, it resolves to that call's result and runs nothing again;
				// before it, it runs the hooks beneath once and a later call replays.
				let replay;
				const caught = (nextPayload = current) => {
					if (next.called) return Promise.resolve(last);
					replay ??= runFrom(position + 1, nextPayload).then((value) => {
						resolved.add(value);
						last = value;
						return value;
					});
					return replay;
				};
				caught.called = next.called;
				caught.error = direct.failed ? direct.error : hooksError(`the ${event} hook answered a shape its event does not take`);
				const handled = await settle(event, registration, registration.catchHook, current, caught, false, CATCH_TIMEOUT_MS);
				if (!handled.failed && isAnswer(handled.value)) return { stands: true, value: handled.value };
				if (replay !== undefined) return { stands: true, value: await replay };
			}
			return next.called ? { stands: true, value: last } : { stands: false };
		}

		const answer = await runFrom(0, payload);
		if (fromCore.has(answer)) {
			const outcome = { proceeded: true };
			if (event === "session.start") outcome.returned = { cwd: answer.cwd };
			return outcome;
		}
		const outcome = { proceeded: answer.deny === undefined };
		if (answer.deny !== undefined) outcome.refused = answer.deny;
		if (answer.decision !== undefined) {
			outcome.decision = answer.decision;
			if (answer.reason !== undefined) outcome.reason = answer.reason;
		}
		if (answer.result !== undefined) outcome.result = answer.result;
		if (event === "session.start") outcome.returned = { cwd: answer.cwd };
		return outcome;
	}

	// One dispatch of any event. `options.toolUseId` fills the `tool_use_id` the engine adds itself.
	async function call(event, payload = {}, callOptions = {}) {
		const filled = callOptions.toolUseId === undefined ? payload : { tool_use_id: callOptions.toolUseId, ...payload };
		return dispatch(event, filled);
	}

	return {
		$,
		on,
		call,
		// Where a test queues the answer to the next dialog at the moment it opens, when the answer depends on what
		// the guard did first.
		answer(value) {
			answers.push(value);
		},
		spawn(spawnEvent = {}) {
			return dispatch("agent.spawn", spawnEvent);
		},
		check(checkEvent = {}) {
			return dispatch("tool.check", checkEvent);
		},
		registrations,
		registrationsOf,
		asks,
		logs,
		registeredTools,
		store,
	};
}
