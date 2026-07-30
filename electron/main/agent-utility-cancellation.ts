import type { AgentRunState } from '../../src/core/assistant/events'

export interface AgentUtilityCancellableRunner {
  cancelAndWait(reason?: string): Promise<AgentRunState>
}

export async function cancelUtilityRun(
  runner: AgentUtilityCancellableRunner,
  reason: string
): Promise<AgentRunState> {
  return await runner.cancelAndWait(reason)
}

export async function prepareUtilityShutdown(
  runners: Iterable<AgentUtilityCancellableRunner>,
  reason = '应用正在退出'
): Promise<void> {
  await Promise.all(Array.from(runners, (runner) => runner.cancelAndWait(reason)))
}
