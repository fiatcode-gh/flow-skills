/**
 * flow-skills — Claude Code flow-guard: the shell lexer the shell rules read a command through.
 *
 * `lexShellCommand`, `ShellToken` and `tokenizeShellSegments` are ported from `src/tools/shell-tokenize.ts` of
 * `@oh-my-pi/pi-coding-agent` 18.18.6, the OMP release this port matches: words are quote- and escape-removed, and
 * separators are runs of space, tab, `\n`, `;`, `&`, `|`, `(` and `)`. One superset rule is added, because this port
 * refuses or prompts on what a command runs and OMP's lexer reads a substitution as part of a word: a backtick outside
 * single quotes is a separator, and inside double quotes a backtick or `$(` ends the quoted word and double-quote mode
 * and is read as a separator; either one also ends a segment. Every command OMP's lexer splits is split the same way
 * here; a few more are split.
 *
 * `literalArgv` ports the character rules of the same file's `extractLiteralAndChainSegments` for exactly one command.
 */

/** One lexical piece of a shell command: a word, or the whitespace/operator run between words. */
type ShellToken = { kind: "word"; raw: string; value: string } | { kind: "separator"; raw: string };

/**
 * Split a command into its command segments, each a list of quote/escape-removed words: a separator run holding
 * `\n ; & | ( )` or a backtick (the superset rule) ends a segment; spaces and tabs only separate words.
 */
export function tokenizeShellSegments(command: string): string[][] {
	const segments: string[][] = [];
	let current: string[] = [];
	for (const token of lexShellCommand(command)) {
		if (token.kind === "word") {
			// Empty quoted words (`''`) carry no argument text.
			if (token.value.length > 0) current.push(token.value);
		} else if (/[\n;&|()`]/u.test(token.raw) && current.length > 0) {
			segments.push(current);
			current = [];
		}
	}
	if (current.length > 0) segments.push(current);
	return segments;
}

/**
 * One command read as literal words after quote and escape removal, or `undefined` for anything that needs more shell
 * interpretation than that: a control character other than tab; an unquoted `\n \r & | ; < > ` $ ( ) * ? [ ] { } ~` or
 * word-initial `#`; a `$`, backtick or line break inside double quotes; an unterminated quote; or a backslash with
 * nothing (or a line break) after it. `&&` is rejected too: this reads one command, never a chain.
 */
export function literalArgv(command: string): string[] | undefined {
	for (let i = 0; i < command.length; i++) {
		const code = command.charCodeAt(i);
		if ((code < 0x20 && code !== 0x09) || code === 0x7f) return undefined;
	}
	const argv: string[] = [];
	let token = "";
	let tokenStarted = false;
	let quote: "'" | '"' | undefined;
	const pushToken = () => {
		if (!tokenStarted) return;
		argv.push(token);
		token = "";
		tokenStarted = false;
	};
	for (let i = 0; i < command.length; i++) {
		const ch = command[i];
		if (quote === "'") {
			if (ch === "'") quote = undefined;
			else token += ch;
			continue;
		}
		if (quote === '"') {
			if (ch === '"') {
				quote = undefined;
				continue;
			}
			if (ch === "$" || ch === "`" || ch === "\n" || ch === "\r") return undefined;
			if (ch === "\\") {
				const next = command[i + 1];
				if (next === undefined || next === "\n" || next === "\r") return undefined;
				if (next === '"' || next === "\\" || next === "$" || next === "`") {
					token += next;
					i++;
				} else {
					token += ch;
				}
				continue;
			}
			token += ch;
			continue;
		}
		if (ch === "'" || ch === '"') {
			quote = ch;
			tokenStarted = true;
			continue;
		}
		if (ch === "\\") {
			const next = command[i + 1];
			if (next === undefined || next === "\n" || next === "\r") return undefined;
			token += next;
			tokenStarted = true;
			i++;
			continue;
		}
		if (ch === " " || ch === "\t") {
			pushToken();
			continue;
		}
		if ("\n\r&|;<>`$()*?[]{}~".includes(ch) || (ch === "#" && !tokenStarted)) return undefined;
		token += ch;
		tokenStarted = true;
	}
	if (quote !== undefined) return undefined;
	pushToken();
	return argv;
}

/**
 * Lex a command into words and separators with their source text: `value` is the quote/escape-removed word, `raw` its
 * verbatim spelling; separators are runs of spaces, tabs, backticks and the operator characters `\n ; & | ( )`, plus a
 * `$(` that interrupts a double-quoted word.
 */
export function lexShellCommand(command: string): ShellToken[] {
	const tokens: ShellToken[] = [];
	let value = "";
	let wordStart = -1;
	let separatorStart = -1;
	let inSingle = false;
	let inDouble = false;
	const startWord = (index: number) => {
		if (wordStart >= 0) return;
		if (separatorStart >= 0) {
			tokens.push({ kind: "separator", raw: command.slice(separatorStart, index) });
			separatorStart = -1;
		}
		wordStart = index;
	};
	const endWord = (index: number) => {
		if (wordStart < 0) return;
		tokens.push({ kind: "word", raw: command.slice(wordStart, index), value });
		value = "";
		wordStart = -1;
	};
	for (let i = 0; i < command.length; i++) {
		const ch = command[i];
		if (inSingle) {
			if (ch === "'") inSingle = false;
			else value += ch;
			continue;
		}
		if (inDouble) {
			if (ch === "\\" && i + 1 < command.length) {
				const next = command[i + 1];
				if (next === '"' || next === "\\" || next === "$" || next === "`") {
					value += next;
					i++;
					continue;
				}
			}
			// The superset rule: a substitution inside double quotes runs a command of its own.
			if (ch === "`" || (ch === "$" && command[i + 1] === "(")) {
				inDouble = false;
				endWord(i);
				if (separatorStart < 0) separatorStart = i;
				if (ch === "$") i++;
				continue;
			}
			if (ch === '"') inDouble = false;
			else value += ch;
			continue;
		}
		if (
			ch === " " ||
			ch === "\t" ||
			ch === "\n" ||
			ch === ";" ||
			ch === "&" ||
			ch === "|" ||
			ch === "(" ||
			ch === ")" ||
			ch === "`"
		) {
			endWord(i);
			if (separatorStart < 0) separatorStart = i;
			continue;
		}
		startWord(i);
		if (ch === "'") {
			inSingle = true;
		} else if (ch === '"') {
			inDouble = true;
		} else if (ch === "\\" && i + 1 < command.length) {
			value += command[i + 1];
			i++;
		} else {
			value += ch;
		}
	}
	endWord(command.length);
	if (separatorStart >= 0) tokens.push({ kind: "separator", raw: command.slice(separatorStart) });
	return tokens;
}

// PowerShell's escape character is the backtick, so a backtick inside a word escapes nothing the guard reads: removing
// every one gives the text PowerShell itself would see for a name such as ``.flow/run`time``.
export function powerShellText(command: string): string {
	return command.replaceAll("`", "");
}
