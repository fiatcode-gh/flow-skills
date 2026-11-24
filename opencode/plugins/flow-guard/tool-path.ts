/**
 * flow-skills — OpenCode flow-guard: where an OpenCode tool path lands.
 *
 * Invariant: a guard judges the absolute path the tool itself will touch. Mirrors OpenCode 2.2.5
 * `FileAccess.resolvePath` (packages/core/src/file-access.ts): a lone `~` is the home directory, a leading `~/`
 * (and `~\` on Windows) expands to it, and the result resolves against the session directory.
 */
import { homedir } from "node:os";
import { resolve } from "node:path";

function expandHome(raw: string): string {
	if (raw === "~") return homedir();
	if (raw.startsWith("~/") || (process.platform === "win32" && raw.startsWith("~\\"))) return homedir() + raw.slice(1);
	return raw;
}

export function resolveToolPath(cwd: string, raw: string): string {
	return resolve(cwd, expandHome(raw));
}
