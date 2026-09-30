import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

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

function missingCapsuleMarkers(task: unknown): string[] {
	if (typeof task !== "string") return [...CAPSULE_MARKERS];
	const lower = task.toLowerCase();
	return CAPSULE_MARKERS.filter((marker) => !lower.includes(marker));
}

function verifierBriefErrors(input: ToolInput): string[] {
	const errors: string[] = [];
	const check = (agent: unknown, task: unknown, label: string) => {
		if (agent !== VERIFIER) return;
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
