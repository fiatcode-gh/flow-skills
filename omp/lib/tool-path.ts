// How an OMP tool reads a path argument, shared by the Flow guards that must see the path the tool will touch.
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Mirrors OMP 18.4.5 `expandPath` (tools/path-utils.ts:72-130) for POSIX paths, so the guard reads a path as OMP does:
// a stray leading `:` before `/`, `~`, `./` or `../` goes, `@` before `/` or `~` goes, a `file://` URL is decoded
// (`localhost` and percent-escapes included), and `~` expands. OMP leaves an undecodable file URL as a literal path;
// this throws instead, because a guard that cannot tell where a write lands must fail closed.
// Deliberately omitted OMP steps, none of which can produce a `.flow` or `runtime` segment: Unicode-space
// normalisation (it only swaps odd spaces for ASCII ones), the Windows extended-length prefix (`\\?\`, no POSIX
// meaning) and the `InternalUrlRouter` `@` shorthand (it maps `@name` to OMP's own stores, not a checkout path).
export function expandToolPath(raw: string): string {
	let value = /^:(?=[/\\~]|\.\.?[/\\]|[A-Za-z]:)/.test(raw) ? raw.slice(1) : raw;
	const unprefixed = value.slice(1);
	if (value.startsWith("@") && (unprefixed.startsWith("/") || unprefixed === "~" || unprefixed.startsWith("~/"))) value = unprefixed;
	if (value.toLowerCase().startsWith("file://")) {
		// Bun's `fileURLToPath` keeps a malformed escape as written where Node throws; the guard must not depend on that.
		decodeURIComponent(new URL(value).pathname);
		value = fileURLToPath(value);
	}
	if (value === "~") return homedir();
	if (value.startsWith("~/") || value.startsWith("~\\")) return homedir() + value.slice(1);
	if (value.startsWith("~")) return join(homedir(), value.slice(1));
	return value;
}

// A URL with a scheme other than `file:` (`ssh://host/path`): the percent-decoded path after the authority, which is
// what a host that maps it onto this checkout would see. Throws on an undecodable escape; the caller fails closed.
export function nonFileUrlPath(target: string): string | undefined {
	const match = target.match(/^([a-z][a-z0-9+.-]*):\/\/[^/]*([\s\S]*)$/i);
	if (!match || match[1].toLowerCase() === "file") return undefined;
	return decodeURIComponent(match[2]);
}
