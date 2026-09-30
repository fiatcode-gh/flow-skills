/**
 * omp-stack — OMP adapter for the Weft AI-memory hub.
 *
 * Appends the current project/harness slice from `agent/lib/ai-memory.ts` to
 * OMP's system prompt at `before_agent_start`. Missing/unreadable memory is a
 * no-op so the extension can never block session start.
 */
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { memoryBlock } from "../lib/ai-memory.ts";

/** This extension is only ever loaded by omp, so it names itself. */
export const HARNESS = "omp";

export default function (pi: ExtensionAPI) {
	pi.on("before_agent_start", async (event) => {
		const block = memoryBlock(process.env, process.cwd(), HARNESS);
		if (!block) return;
		return { systemPrompt: [...event.systemPrompt, `${block}\n`] };
	});
}
