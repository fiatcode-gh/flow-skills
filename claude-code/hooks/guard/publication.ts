/**
 * flow-skills — Claude Code flow-guard: the publication decision.
 *
 * A shell tool's command (`shellCommand`: Bash, PowerShell, Monitor) that matches one of the ported OMP publication
 * patterns asks through the real permission prompt. The decision is always `ask`: this guard never denies and never
 * allows a publication. A cloud session carries one narrowed exception — two exact literal shapes, a push of the branch
 * the session started on and a draft pull request, run from the session root — and `exemptInCloud` is the only place
 * that decides it.
 *
 * The matcher is the port of OMP 18.18.6's `commandSegmentMatchesBashApprovalPattern`: trim, collapse whitespace,
 * `*` → `.*`, everything else literal, anchored at both ends, case-sensitive, tried on the whole command and then on
 * each segment `tokenizeShellSegments` reads. It reads the pattern list from `patterns.ts` and keeps no copy of its own.
 */
import { PUBLICATION_PATTERNS } from "./patterns.ts";
import { literalArgv, powerShellText, tokenizeShellSegments } from "./shell.ts";
import { shellCommand } from "./tool-inputs.ts";
import { canonicalPath } from "./tree.ts";
import type { Host, RunResult } from "./host.ts";

// The exemption reads the session's directory, its git and its environment, and canonicalises paths through `stat`.
type PublicationHost = Pick<Host, "env" | "run" | "sessionCwd" | "stat">;
type PublicationDecision = { decision: "ask"; reason: string };
// What a cloud `session.start` saw: the canonical session root and the branch git named there.
export type SessionStart = { root: string; branch: string };

export const CLOUD_SESSION_ENV = ["CLAUDE_CODE_REMOTE", "CLAUDE_CODE_REMOTE_SESSION_ID"];

// OMP's normalizeBashApprovalPattern.
function normalizeBashApprovalPattern(value: string): string {
	return value.trim().replace(/\s+/gu, " ");
}

// OMP's bashApprovalPatternToRegExp.
function patternRegExp(pattern: string): RegExp {
	return new RegExp(
		"^" +
			normalizeBashApprovalPattern(pattern)
				.split("*")
				.map((part) => part.replace(/[\\^$+?.()|[\]{}]/gu, "\\$&"))
				.join(".*") +
			"$",
		"u",
	);
}

const PATTERN_EXPRESSIONS = PUBLICATION_PATTERNS.map(patternRegExp);

// The whole command first, then each segment joined with one space (PowerShell text with its backtick escapes removed
// first); the first pattern in list order that matches a candidate wins, and the candidate it matched is what the
// reason names.
export function publishingSegment(command: string, tool = "Bash"): string | undefined {
	const text = tool === "PowerShell" ? powerShellText(command) : command;
	const candidates = [command, ...tokenizeShellSegments(text).map((segment) => segment.join(" "))];
	for (const expression of PATTERN_EXPRESSIONS) {
		for (const candidate of candidates) {
			const normalized = normalizeBashApprovalPattern(candidate);
			if (normalized.length > 0 && expression.test(normalized)) return candidate;
		}
	}
	return undefined;
}

export async function cloudSession(host: Pick<Host, "env">): Promise<boolean> {
	for (const name of CLOUD_SESSION_ENV) {
		let value: string | undefined;
		try {
			value = await host.env(name);
		} catch {
			continue;
		}
		if (typeof value === "string" && value.length > 0) return true;
	}
	return false;
}

// A git child's trimmed answer, or undefined when it cannot be read: no child, a failing exit or a truncated output.
async function gitAnswer(host: Pick<Host, "run">, argv: string[], cwd: string): Promise<string | undefined> {
	let result: RunResult;
	try {
		result = await host.run(argv, { cwd });
	} catch {
		return undefined;
	}
	if (result.exitCode !== 0 || result.isTruncated) return undefined;
	return result.stdout.trim();
}

// The branch `git rev-parse --abbrev-ref HEAD` names in `directory`; a detached head (`HEAD`) and an empty answer name
// none.
async function currentBranch(host: Pick<Host, "run">, directory: string): Promise<string | undefined> {
	const branch = await gitAnswer(host, ["git", "rev-parse", "--abbrev-ref", "HEAD"], directory);
	return branch === undefined || branch === "" || branch === "HEAD" ? undefined : branch;
}

// The facts a cloud `session.start` records once: the canonical session root and the branch git names there. Any
// failure answers undefined, and a session without facts has no exemption.
export async function readSessionStart(host: PublicationHost, cwd: string): Promise<SessionStart | undefined> {
	if (cwd === "") return undefined;
	const root = await canonicalPath(host, cwd).catch(() => undefined);
	if (root === undefined) return undefined;
	const branch = await currentBranch(host, root);
	return branch === undefined ? undefined : { root, branch };
}

async function sessionRoot(host: PublicationHost): Promise<string | undefined> {
	try {
		return await canonicalPath(host, await host.sessionCwd());
	} catch {
		return undefined;
	}
}

// `git push`, then optionally one `-u` or `--set-upstream`, then nothing or exactly `<remote> <start branch>`: the
// remote is one `git remote` lists in the session root, the checkout there is still on the start branch, and the start
// branch is no remote's default — at least one remote's default must be readable, so an unknown default never exempts.
async function exemptPush(host: PublicationHost, args: string[], start: SessionStart): Promise<boolean> {
	const rest = args[0] === "-u" || args[0] === "--set-upstream" ? args.slice(1) : args;
	if (rest.length !== 0 && (rest.length !== 2 || rest[1] !== start.branch)) return false;
	const listed = await gitAnswer(host, ["git", "remote"], start.root);
	if (listed === undefined) return false;
	const remotes = listed
		.split(/\r?\n/u)
		.map((name) => name.trim())
		.filter((name) => name.length > 0);
	if (rest.length === 2 && !remotes.includes(rest[0])) return false;
	if ((await currentBranch(host, start.root)) !== start.branch) return false;
	let defaultRead = false;
	for (const remote of remotes) {
		const head = await gitAnswer(host, ["git", "symbolic-ref", "--quiet", "--short", `refs/remotes/${remote}/HEAD`], start.root);
		if (head === undefined || !head.startsWith(`${remote}/`)) continue;
		defaultRead = true;
		if (head.slice(remote.length + 1) === start.branch) return false;
	}
	return defaultRead;
}

// `gh pr create`, then tokens read left to right: `--draft` and `--fill` alone; `--title`, `--body` and `--base` with
// the next token as their value or `=value` attached; exactly one `--draft`; any other token is outside the grammar.
// `--title --draft` makes `--draft` the title, so it carries no draft flag.
function exemptDraft(args: string[]): boolean {
	let drafts = 0;
	for (let index = 0; index < args.length; index += 1) {
		const token = args[index];
		if (token === "--draft") {
			drafts += 1;
		} else if (token === "--fill") {
			continue;
		} else if (token === "--title" || token === "--body" || token === "--base") {
			if (index + 1 >= args.length) return false;
			index += 1;
		} else if (!/^--(?:title|body|base)=/u.test(token)) {
			return false;
		}
	}
	return drafts === 1;
}

// The narrowed cloud exception, and the only place that decides it: the command must read as one literal command, run
// from the root the session started in, and be one of the two exact shapes. Every other spelling — an assignment,
// `env`, `-C`, `-c`, a refspec other than the start branch, a flag outside the grammar — prompts.
export async function exemptInCloud(host: PublicationHost, command: string, start: SessionStart): Promise<boolean> {
	const argv = literalArgv(command);
	if (argv === undefined) return false;
	if ((await sessionRoot(host)) !== start.root) return false;
	if (argv[0] === "git" && argv[1] === "push") return await exemptPush(host, argv.slice(2), start);
	if (argv[0] === "gh" && argv[1] === "pr" && argv[2] === "create") return exemptDraft(argv.slice(3));
	return false;
}

export async function publicationDecision(
	host: PublicationHost,
	tool: unknown,
	input: unknown,
	start: SessionStart | undefined,
): Promise<PublicationDecision | undefined> {
	if (typeof tool !== "string" || input === null || typeof input !== "object") return undefined;
	const command = shellCommand(tool, input as Record<string, unknown>);
	if (command === undefined) return undefined;
	const segment = publishingSegment(command, tool);
	if (segment === undefined) return undefined;
	if (start !== undefined && (await cloudSession(host)) && (await exemptInCloud(host, command, start))) return undefined;
	return { decision: "ask", reason: `Flow publication guard: this command publishes: ${segment}` };
}
