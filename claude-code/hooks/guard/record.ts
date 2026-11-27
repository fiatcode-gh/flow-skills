/**
 * flow-skills — Claude Code flow-guard: the approval record `.flow/runtime/approvals.log`.
 *
 * Invariant: one line per record, `<scope> <kind> <digest> <path>`, single spaces; the last line for a scope and kind
 * wins. Only the `flow_gate` tool writes the file, whole, in one write; a line it cannot read makes the record
 * unreadable rather than skipped. The digest rule and the artifact path rules below are the ones in
 * omp/extensions/flow-governance-guard.ts and opencode/plugins/flow-guard/record.ts, adapted to text and to the Host
 * boundary: this module has no crypto module and no Buffer, so it hashes text through the Host.
 */
import type { Host } from "./host.ts";
import { isAbsolute, normalizeSeparators, relative, resolve } from "./paths.ts";
import { canonicalPath, ensureFlowExcluded } from "./tree.ts";

export type GateKind = "contract" | "plan" | "implementation";
export type RecordLine = { scope: string; kind: string; digest: string; path: string };

export const RECORD_RELATIVE_PATH = ".flow/runtime/approvals.log";

// Lines logged under this heading in a plan stay outside the plan's digest, so an in-scope amendment keeps the approval current.
const AMENDMENTS_HEADING = "## In-scope amendments";

// Offset just past the last line that is exactly the amendments heading (its newline included), or undefined.
// A `\r\n` line, a deeper heading or one with trailing text does not count. The last one binds, so an earlier
// heading line (quoted in a code fence, say) stays inside the digest.
function amendmentsStart(text: string): number | undefined {
	for (let at = text.lastIndexOf(AMENDMENTS_HEADING); at !== -1; at = at === 0 ? -1 : text.lastIndexOf(AMENDMENTS_HEADING, at - 1)) {
		if (at > 0 && text[at - 1] !== "\n") continue;
		const end = at + AMENDMENTS_HEADING.length;
		if (end === text.length) return end;
		if (text[end] === "\n") return end + 1;
	}
	return undefined;
}

// A plan is hashed through its amendments heading; every other kind, and a plan without the heading, whole. The slice
// ends on a line boundary, so its UTF-8 bytes are the file's bytes up to the same offset.
export async function artifactDigest(host: Host, kind: GateKind, text: string): Promise<string> {
	const end = kind === "plan" ? amendmentsStart(text) : undefined;
	return host.sha256(end === undefined ? text : text.slice(0, end));
}

// Non-blank lines under a plan's amendments heading; counted for status, never judged.
function amendmentCount(text: string): number {
	const start = amendmentsStart(text);
	if (start === undefined) return 0;
	return text.slice(start).split("\n").filter((line) => line.trim() !== "").length;
}

// True when `path` is strictly below `dir`: the directory itself and anything beside it are not.
function isBelow(dir: string, path: string): boolean {
	const rel = relative(dir, path);
	return rel !== "" && !(rel === ".." || rel.startsWith("../") || isAbsolute(rel));
}

// A path `.flow/` does not hold but the repository root does: the form an approval record stores, because a `.flow`
// that is a symlink resolves to a directory whose root-relative path is not below `.flow/`. A path that climbs is
// never read that way.
function recordedCandidate(root: string, inputPath: string): string | undefined {
	if (isAbsolute(inputPath) || inputPath.split("/").includes("..")) return undefined;
	return resolve(root, inputPath);
}

// A relative path whose first segment is not `.flow` is written relative to `.flow/`; a path that `.flow/` does not
// hold but the repository root does is the form the approval record stores. The first segment is read before
// normalizing, so `.flow/../x` stays a repository path and is refused. The canonical answer is the artifact's path.
async function resolveFlowArtifact(host: Host, root: string, inputPath: string): Promise<string> {
	const flowRoot = resolve(root, ".flow");
	const first = inputPath.split("/").find((segment) => segment !== "" && segment !== ".");
	const base = first === ".flow" ? root : flowRoot;
	let candidate = isAbsolute(inputPath) ? resolve(flowRoot, inputPath) : resolve(base, inputPath);
	if (await host.exists(candidate)) {
		if (!isBelow(flowRoot, candidate)) {
			throw new Error(
				`Flow gate artifacts must live below ${flowRoot}: write the path as .flow/contracts/<slug>.md or contracts/<slug>.md`,
			);
		}
	} else {
		const stored = recordedCandidate(root, inputPath);
		if (stored === undefined || !(await host.exists(stored))) throw new Error(`Flow gate artifact does not exist: ${candidate}`);
		candidate = stored;
	}
	// The canonical paths are the only proof that a link stays below `.flow` inside the repository. A host that cannot
	// answer one is unknown, and unknown fails closed exactly as a link that leaves `.flow` does.
	const canonicalRoot = await canonicalPath(host, root);
	const canonicalFlowRoot = await canonicalPath(host, flowRoot);
	const canonicalCandidate = await canonicalPath(host, candidate);
	if (canonicalRoot === undefined || canonicalFlowRoot === undefined || canonicalCandidate === undefined) {
		throw new Error(`Flow gate artifact escapes ${flowRoot}: ${candidate}`);
	}
	if (!isBelow(canonicalRoot, canonicalFlowRoot)) throw new Error(`Flow gate artifact escapes ${root}: ${candidate}`);
	if (!isBelow(canonicalFlowRoot, canonicalCandidate)) {
		throw new Error(`Flow gate artifact escapes ${flowRoot}: ${candidate}`);
	}
	return canonicalCandidate;
}

// True when two byte sequences are equal, byte for byte.
function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
	if (left.length !== right.length) return false;
	for (let index = 0; index < left.length; index += 1) {
		if (left[index] !== right[index]) return false;
	}
	return true;
}

// The digest, the path and the amendment count of one artifact. Bytes that are not UTF-8 decode lossily, and a
// truncated sequence can decode to U+FFFD of the same length, so the text read is encoded again and compared with the
// file's bytes: only a file whose bytes are exactly its text carries a digest OMP and OpenCode reproduce. A file that
// changes between the two reads compares unequal and is refused too.
export async function artifactIdentity(
	host: Host,
	root: string,
	inputPath: string,
	kind: GateKind,
): Promise<{ path: string; sha256: string; amendments: number }> {
	const path = await resolveFlowArtifact(host, root, inputPath);
	const text = await host.read(path);
	const bytes = await host.readBytes(path);
	if (!sameBytes(new TextEncoder().encode(text), bytes)) {
		throw new Error(`Flow gate artifact is not UTF-8 text: ${path}`);
	}
	return { path, sha256: await artifactDigest(host, kind, text), amendments: kind === "plan" ? amendmentCount(text) : 0 };
}

// An artifact's path relative to the repository root, `/`-separated: the form an approval record stores. The path an
// artifact identity answers is canonical, so the root is canonicalised the same way, and through the same fallback
// when the engine's `stat` gives no `realPath`.
export async function rootRelativePath(host: Host, root: string, path: string): Promise<string> {
	return relative((await canonicalPath(host, root)) ?? root, path);
}

// The root-relative path an approval record names. An older record holds an absolute path: it is read from its last
// `/.flow/` segment on, so a moved checkout still matches; one without that segment is kept and never matches.
export function recordedArtifactPath(stored: string): string {
	if (!isAbsolute(stored)) return stored;
	const normalized = normalizeSeparators(stored);
	const at = normalized.lastIndexOf("/.flow/");
	return at === -1 ? stored : normalized.slice(at + 1);
}

const DIGEST = /^[0-9a-f]{64}$/;

// Every record line, in file order; none when the file does not exist. A line this port cannot read makes the whole
// record unreadable, so no gate decides on a record it only partly understood.
export async function readRecord(host: Host, root: string): Promise<RecordLine[]> {
	const path = resolve(root, RECORD_RELATIVE_PATH);
	if (!(await host.exists(path))) return [];
	const lines: RecordLine[] = [];
	for (const [index, line] of (await host.read(path)).split("\n").entries()) {
		if (line === "") continue;
		const fields = line.split(" ");
		if (fields.length < 4 || !DIGEST.test(fields[2])) {
			throw new Error(`Unreadable Flow approval record at ${RECORD_RELATIVE_PATH}: line ${index + 1}`);
		}
		const [scope, kind, digest, ...artifact] = fields;
		lines.push({ scope, kind, digest, path: artifact.join(" ") });
	}
	return lines;
}

export function latestRecord(lines: RecordLine[], scope: string, kind: string): RecordLine | undefined {
	return lines.findLast((line) => line.scope === scope && line.kind === kind);
}

// A control character in any field (a line break above all) would let one line forge another, so the whole write is
// refused before anything, the exclude included, changes.
const CONTROL = /[\u0000-\u001f]/;

// One write of the whole file, no temporary file: the engine's file API has no rename. A torn write leaves an
// unreadable record, which every gate refuses until the artifacts are presented and approved again.
export async function writeRecord(host: Host, root: string, lines: RecordLine[]): Promise<void> {
	if (lines.some(({ scope, kind, digest, path }) => [scope, kind, digest, path].some((field) => CONTROL.test(field)))) {
		throw new Error("Flow approval record line holds a control character; nothing was written.");
	}
	await ensureFlowExcluded(host, root);
	const path = resolve(root, RECORD_RELATIVE_PATH);
	await host.write(path, lines.map(({ scope, kind, digest, path: artifact }) => `${scope} ${kind} ${digest} ${artifact}\n`).join(""));
}
