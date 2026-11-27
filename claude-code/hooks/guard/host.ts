/**
 * flow-skills — Claude Code flow-guard: the host boundary.
 *
 * The mods loader reads a hooks module's source before it loads it and refuses any use of `$` other than
 * `$.noun.method(...)` at the call site (`$.plugin.name` and `$.plugin.root` may be read as values), plus any `$`
 * bound, spread, returned or passed anywhere but into a named function declared at the top of a file of the module.
 * So `$` is read in this file and nowhere else: `hostOf` hands every other module a plain `Host`, which is ordinary
 * TypeScript and loads in the Node/Bun tests unchanged (see docs/decisions/claude-code-port.md).
 */

export type RunResult = { exitCode: number; stdout: string; stderr: string; isTruncated: boolean };
type StatResult = { kind: "file" | "dir" | "other"; size: number; realPath?: string };
export type AskOption = { label: string; description?: string };

export type Host = {
	pluginName: string;
	// The session's working directory, which a `tool.call` event does not carry.
	sessionCwd(): Promise<string>;
	// The engine's own agent list: the resume gate reads a child's state and agent type from it.
	agentList(): Promise<Array<{ id: string; type?: string; status?: string; taskStatus?: string }>>;
	// A child's transcript: its first user message is the brief the child was spawned with.
	sessionMessages(agentId: string): Promise<Array<{ role?: string; text?: string }>>;
	// The build's own version (`base` when the build has one, so a `-dev` build reads as its release), or undefined when
	// the build lacks the call or answers no version: the dispatch gate refuses gated work below its version floor.
	engineVersion(): Promise<string | undefined>;
	read(path: string): Promise<string>;
	// The file's exact bytes: an artifact is judged on them, because a lossy text read can hide bytes that are not UTF-8.
	readBytes(path: string): Promise<Uint8Array>;
	write(path: string, text: string): Promise<void>;
	stat(path: string): Promise<StatResult>;
	exists(path: string): Promise<boolean>;
	run(argv: string[], options?: { cwd?: string; env?: Record<string, string>; stdin?: string }): Promise<RunResult>;
	env(name: string): Promise<string | undefined>;
	sha256(text: string): Promise<string>;
	ask(question: string, options: AskOption[]): Promise<boolean>;
	log(text: string): Promise<void>;
	registerTool(spec: { name: string; description: string; inputSchema: Record<string, unknown> }): Promise<string>;
};

// The members of the engine's own object this file reads, structurally. `isLink` is the engine's own field; a caller
// that needs it added to `Host` adds it there, not here.
type Engine = {
	plugin: { name: string };
	fs: {
		read(path: string): Promise<string>;
		// A binary read answers `{ base64 }`; the shape is checked where it is read, not trusted.
		read(path: string, options: { as: "bytes" }): Promise<unknown>;
		write(path: string, text: string): Promise<void>;
		// The engine resolves the final path only when asked: `stat(path, { resolve: true })` fills `realPath`, and an
		// optionless call answers none, so the host always passes the option.
		stat(path: string, options?: { resolve?: boolean }): Promise<StatResult & { isLink: boolean }>;
		exists(path: string): Promise<boolean>;
	};
	process: {
		run(
			argv: string[],
			options: { cwd?: string; env?: Record<string, string>; stdin?: string },
		): Promise<{ exitCode: number; stdout: string; stderr: string; isStdoutTruncated: boolean; isStderrTruncated: boolean }>;
	};
	env: { get(name: string): Promise<string | undefined> };
	session: {
		cwd(): Promise<string>;
		messages(input: { agentId: string }): Promise<Array<{ role?: string; text?: string }>>;
		version(): Promise<{ version: string; base?: string }>;
	};
	agent: { list(): Promise<Array<{ id: string; type?: string; status?: string; taskStatus?: string }>> };
	// The engine's own options are labels; a `{ label, description }` object is rejected before any dialog opens.
	ui: { ask(question: string, options: readonly string[]): Promise<unknown>; log(text: string): Promise<void> };
	tool: { register(spec: { name: string; description: string; inputSchema: Record<string, unknown> }): Promise<{ tool: string }> };
};

// The answer keys a dialog's answer carries its label in, at one level.
const ANSWER_KEYS = ["label", "value", "answer", "selected", "answers"] as const;

// A dismissal is not an answer even when it echoes a label.
function isDismissed(answer: unknown): boolean {
	if (answer === undefined || answer === null) return true;
	if (typeof answer !== "object") return false;
	const record = answer as Record<string, unknown>;
	return record.isAnswered === false || record.dismissed === true;
}

// The strings a label can be carried in: a string answer, and one level below each answer key (an array's strings,
// or an object's own string values).
function oneLevelStrings(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
	if (value !== null && typeof value === "object") {
		return Object.values(value as Record<string, unknown>).filter((item): item is string => typeof item === "string");
	}
	return [];
}

function answerCandidates(answer: unknown): string[] {
	const candidates = typeof answer === "string" ? [answer] : [];
	if (answer !== null && typeof answer === "object") {
		const record = answer as Record<string, unknown>;
		for (const key of ANSWER_KEYS) {
			const value = record[key];
			if (value !== undefined) candidates.push(...oneLevelStrings(value));
		}
	}
	return candidates;
}

// True only when a candidate trims to exactly the first option's label and none trims to the second's. A candidate
// equal to the question is ignored, so an answer that echoes the prompt is not an answer.
function wasAnswered(answer: unknown, question: string, approve: string, refuse: string): boolean {
	if (isDismissed(answer)) return false;
	const asked = question.trim();
	const wanted = approve.trim();
	const unwanted = refuse.trim();
	let accepted = false;
	for (const raw of answerCandidates(answer)) {
		const candidate = raw.trim();
		if (candidate === "" || candidate === asked) continue;
		if (candidate === unwanted) return false;
		if (candidate === wanted) accepted = true;
	}
	return accepted;
}

function bytesToHex(bytes: Uint8Array): string {
	let hex = "";
	for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
	return hex;
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// The engine's binary read answers base64, and the module's realm is not known to offer a decoder (no `atob`, no
// `Uint8Array.fromBase64` is assumed), so it is decoded here. Padding is accepted only at the end; any other
// character, or a length that is not a multiple of four, throws rather than decoding to different bytes.
function decodeBase64(text: string): Uint8Array {
	if (text.length % 4 !== 0) throw new Error("the engine answered base64 of an invalid length");
	const padding = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
	const bytes = new Uint8Array((text.length / 4) * 3 - padding);
	let at = 0;
	for (let start = 0; start < text.length; start += 4) {
		let chunk = 0;
		for (let offset = 0; offset < 4; offset += 1) {
			const position = start + offset;
			const isPadding = position >= text.length - padding;
			const value = isPadding ? 0 : BASE64_ALPHABET.indexOf(text[position]);
			if (value === -1) throw new Error(`the engine answered a character that is not base64 at offset ${position}`);
			chunk = (chunk << 6) | value;
		}
		for (const shift of [16, 8, 0]) {
			if (at < bytes.length) bytes[at++] = (chunk >> shift) & 0xff;
		}
	}
	return bytes;
}

export function hostOf($: Engine): Host {
	return {
		pluginName: $.plugin.name,
		sessionCwd: async () => await $.session.cwd(),
		agentList: async () => await $.agent.list(),
		sessionMessages: async (agentId) => await $.session.messages({ agentId }),
		// A build without `$.session.version` throws a TypeError at this call; that and any other failure read as unknown.
		engineVersion: async () => {
			try {
				const answer = await $.session.version();
				return answer.base ?? answer.version;
			} catch {
				return undefined;
			}
		},
		read: async (path) => await $.fs.read(path),
		readBytes: async (path) => {
			const answer = await $.fs.read(path, { as: "bytes" });
			const base64 = answer !== null && typeof answer === "object" && "base64" in answer ? answer.base64 : undefined;
			if (typeof base64 !== "string") throw new Error(`the engine answered no bytes for ${path}`);
			return decodeBase64(base64);
		},
		write: async (path, text) => {
			await $.fs.write(path, text);
		},
		stat: async (path) => {
			// `resolve: true` is what makes the engine fill `realPath`; without it the answer carries none.
			const stats = await $.fs.stat(path, { resolve: true });
			return stats.realPath === undefined
				? { kind: stats.kind, size: stats.size }
				: { kind: stats.kind, size: stats.size, realPath: stats.realPath };
		},
		exists: async (path) => await $.fs.exists(path),
		run: async (argv, options) => {
			const stdin = options?.stdin;
			const result = await $.process.run(
				argv,
				stdin === undefined ? { cwd: options?.cwd, env: options?.env } : { cwd: options?.cwd, env: options?.env, stdin },
			);
			return {
				exitCode: result.exitCode,
				stdout: result.stdout,
				stderr: result.stderr,
				isTruncated: result.isStdoutTruncated || result.isStderrTruncated,
			};
		},
		// The mods loader requires a literal name at every `$.env.get` call site so the variables a module reads can be
		// listed; a name outside this set reads as unset, which is the fail-closed answer for every caller.
		env: async (name) => {
			switch (name) {
				case "HOME":
					return await $.env.get("HOME");
				case "USERPROFILE":
					return await $.env.get("USERPROFILE");
				case "PATH":
					return await $.env.get("PATH");
				case "TMPDIR":
					return await $.env.get("TMPDIR");
				case "TEMP":
					return await $.env.get("TEMP");
				case "TMP":
					return await $.env.get("TMP");
				case "SystemRoot":
					return await $.env.get("SystemRoot");
				case "GIT_CONFIG_GLOBAL":
					return await $.env.get("GIT_CONFIG_GLOBAL");
				case "GIT_CONFIG_SYSTEM":
					return await $.env.get("GIT_CONFIG_SYSTEM");
				case "XDG_CONFIG_HOME":
					return await $.env.get("XDG_CONFIG_HOME");
				case "GIT_CONFIG_NOSYSTEM":
					return await $.env.get("GIT_CONFIG_NOSYSTEM");
				case "CLAUDE_CODE_REMOTE":
					return await $.env.get("CLAUDE_CODE_REMOTE");
				case "CLAUDE_CODE_REMOTE_SESSION_ID":
					return await $.env.get("CLAUDE_CODE_REMOTE_SESSION_ID");
				default:
					return undefined;
			}
		},
		// WebCrypto in the module's own realm: the engine exposes no Node crypto module, no `sha256sum` and no
		// `git hash-object`.
		sha256: async (text) => bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))),
		// True only when a candidate value names the first option and none names the second; a dismissal, a question
		// echo, an empty answer and a shape that names neither label all answer false, and a thrown `HooksError`
		// propagates to the refusing caller.
		ask: async (question, options) => {
			const answer = await $.ui.ask(question, options.map((option) => option.label));
			const [approve, refuse] = options;
			if (approve === undefined || refuse === undefined) return false;
			return wasAnswered(answer, question, approve.label, refuse.label);
		},
		log: async (text) => {
			await $.ui.log(text);
		},
		registerTool: async (spec) => (await $.tool.register(spec)).tool,
	};
}
