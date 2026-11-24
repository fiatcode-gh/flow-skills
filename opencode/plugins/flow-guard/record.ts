/**
 * flow-skills — OpenCode flow-guard: the approval record `.flow/runtime/approvals.log`.
 *
 * Invariant: one line per record, `<scope> <kind> <digest> <path>`, single spaces; the last line for a scope and kind
 * wins. The Claude Code port's `flow_check` reads the same lines. Only `flow_gate` writes the file, whole, through a
 * `.tmp` file and a rename; a line it cannot read makes the record unreadable rather than skipped. The digest and the
 * artifact path rules below are byte-for-byte copies of omp/extensions/flow-governance-guard.ts, the digest region
 * pinned by tests/validate.py.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { ensureFlowExcluded } from "./git.ts";

export type GateKind = "contract" | "plan" | "implementation";
export type RecordLine = { scope: string; kind: string; digest: string; path: string };

export const RECORD_RELATIVE_PATH = ".flow/runtime/approvals.log";

// Lines logged under this heading in a PLAN.md stay outside the plan's digest, so an in-scope amendment keeps the approval current.
const AMENDMENTS_HEADING = Buffer.from("## In-scope amendments");

// Offset just past the last line that is exactly the amendments heading (its newline included), or undefined.
// A `\r\n` line, a deeper heading or one with trailing text does not count. The last one binds, so an earlier
// heading line (quoted in a code fence, say) stays inside the digest.
function amendmentsStart(bytes: Buffer): number | undefined {
	for (let at = bytes.lastIndexOf(AMENDMENTS_HEADING); at !== -1; at = at === 0 ? -1 : bytes.lastIndexOf(AMENDMENTS_HEADING, at - 1)) {
		if (at > 0 && bytes[at - 1] !== 0x0a) continue;
		const end = at + AMENDMENTS_HEADING.length;
		if (end === bytes.length) return end;
		if (bytes[end] === 0x0a) return end + 1;
	}
	return undefined;
}

// A plan is hashed through its amendments heading; every other kind, and a plan without the heading, whole.
function artifactDigest(kind: GateKind, bytes: Buffer): string {
	const end = kind === "plan" ? amendmentsStart(bytes) : undefined;
	return createHash("sha256")
		.update(end === undefined ? bytes : bytes.subarray(0, end))
		.digest("hex");
}

// Non-blank lines under a plan's amendments heading; counted for status, never judged.
function amendmentCount(bytes: Buffer): number {
	const start = amendmentsStart(bytes);
	if (start === undefined) return 0;
	return bytes.subarray(start).toString("utf8").split("\n").filter((line) => line.trim() !== "").length;
}

// A relative path whose first segment is not `.flow` is written relative to `.flow/`.
// The first segment is read before normalizing, so `.flow/../x` stays a repository path and is refused.
function resolveFlowArtifact(root: string, inputPath: string): string {
	const flowRoot = resolve(root, ".flow");
	const first = inputPath.split("/").find((segment) => segment !== "" && segment !== ".");
	const base = first === ".flow" ? root : flowRoot;
	const candidate = isAbsolute(inputPath) ? resolve(inputPath) : resolve(base, inputPath);
	const rel = relative(flowRoot, candidate);
	if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
		throw new Error(
			`Flow gate artifacts must live below ${flowRoot}: write the path as .flow/contracts/<slug>.md or contracts/<slug>.md`,
		);
	}
	if (!existsSync(candidate)) throw new Error(`Flow gate artifact does not exist: ${candidate}`);
	const real = realpathSync(candidate);
	const realRel = relative(flowRoot, real);
	if (realRel === "" || realRel === ".." || realRel.startsWith(`..${sep}`) || isAbsolute(realRel)) {
		throw new Error(`Flow gate artifact escapes ${flowRoot}: ${candidate}`);
	}
	return real;
}

function artifactIdentity(root: string, inputPath: string, kind: GateKind): { path: string; sha256: string; amendments: number } {
	const path = resolveFlowArtifact(root, inputPath);
	const bytes = readFileSync(path);
	return { path, sha256: artifactDigest(kind, bytes), amendments: kind === "plan" ? amendmentCount(bytes) : 0 };
}

// An artifact's path relative to the repository root, `/`-separated: the form an approval record stores.
function rootRelativePath(root: string, path: string): string {
	return relative(root, path).split(sep).join("/");
}

// The root-relative path an approval record names. An older record holds an absolute path: it is read from its last
// `/.flow/` segment on, so a moved checkout still matches; one without that segment is kept and never matches.
function recordedArtifactPath(stored: string): string {
	if (!isAbsolute(stored)) return stored;
	const normalized = stored.replaceAll("\\", "/");
	const at = normalized.lastIndexOf("/.flow/");
	return at === -1 ? stored : normalized.slice(at + 1);
}

export { amendmentCount, artifactDigest, artifactIdentity, recordedArtifactPath, rootRelativePath };

const DIGEST = /^[0-9a-f]{64}$/;

// Every record line, in file order; none when the file does not exist. A line this port cannot read makes the whole
// record unreadable, so no gate decides on a record it only partly understood.
export function readRecord(root: string): RecordLine[] {
	const path = resolve(root, RECORD_RELATIVE_PATH);
	if (!existsSync(path)) return [];
	const lines: RecordLine[] = [];
	for (const [index, line] of readFileSync(path, "utf8").split("\n").entries()) {
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

export function writeRecord(root: string, lines: RecordLine[]): void {
	ensureFlowExcluded(root);
	const path = resolve(root, RECORD_RELATIVE_PATH);
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, lines.map(({ scope, kind, digest, path: artifact }) => `${scope} ${kind} ${digest} ${artifact}\n`).join(""), "utf8");
	renameSync(tmp, path);
}
