/**
 * omp-stack — Flow evidence-capsule guard.
 *
 * Invariant: every `flow-evidence-verifier` dispatch carries one complete
 * `Evidence capsule:` manifest. Stateless: it reads only the task input.
 */
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { agentName } from "../lib/agent-name.ts";

type ToolInput = Record<string, unknown>;

const VERIFIER = "flow-evidence-verifier";
const CAPSULE_MARKERS = [
	"evidence capsule:",
	"id:",
	"owns:",
	"independent split check:",
	"excludes:",
	"restore obligation:",
] as const;
// A marker counts only at the start of a line, optionally as a list item, so
// the `id:` inside `grid:` or `valid:` does not satisfy `ID`. The markers hold
// no regular-expression metacharacters.
const MARKER_PATTERNS = CAPSULE_MARKERS.map(
	(marker) => [marker, new RegExp(`^[ \\t]*(?:-[ \\t]*)?${marker}`, "im")] as const,
);

function missingCapsuleMarkers(task: unknown): string[] {
	if (typeof task !== "string") return [...CAPSULE_MARKERS];
	return MARKER_PATTERNS.filter(([, pattern]) => !pattern.test(task)).map(([marker]) => marker);
}

function verifierBriefErrors(input: ToolInput): string[] {
	const errors: string[] = [];
	const check = (agent: unknown, task: unknown, label: string) => {
		if (agentName(agent) !== VERIFIER) return;
		const missing = missingCapsuleMarkers(task);
		if (missing.length > 0) errors.push(`${label}: missing ${missing.join(", ")}`);
	};

	check(input.agent, input.task, "task");
	if (Array.isArray(input.tasks)) {
		input.tasks.forEach((item, index) => {
			if (!item || typeof item !== "object") return;
			const record = item as ToolInput;
			check(record.agent, record.task, `tasks[${index}]`);
		});
	}
	return errors;
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event) => {
		const input = event.input as ToolInput;

		// OMP owns Agent Hub wait/steering semantics. Flow intentionally does not
		// intercept hub waits; this extension only guards verifier task manifests.
		if (event.toolName === "task") {
			const errors = verifierBriefErrors(input);
			if (errors.length > 0) {
				return {
					block: true,
					reason:
						`Flow evidence-capsule preflight failed: ${errors.join("; ")}. ` +
						"Each flow-evidence-verifier task must declare one bounded capsule before dispatch.",
				};
			}
		}
	});
}
