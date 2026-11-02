// OMP trims the agent name before resolving it, so Flow guards compare the same normalized name.
export function agentName(agent: unknown): string | undefined {
	return typeof agent === "string" ? agent.trim() : undefined;
}
