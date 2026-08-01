import type { AgentEventInput } from '../../../../../src/core/assistant/events'
import type { HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import { AgentIntentRouter } from '../context/router'
import type { AgentRouteDecision } from '../context/types'

export async function routeAgentGoal(input: {
  runId: string
  goal: string
  snapshot: HostContextSnapshot
  signal: AbortSignal
  classify: (goal: string, snapshot: HostContextSnapshot, signal: AbortSignal) => Promise<unknown>
  emit: (event: AgentEventInput) => void
}): Promise<AgentRouteDecision> {
  const route = await new AgentIntentRouter(input.classify).route(
    input.runId,
    input.goal,
    input.snapshot,
    input.signal
  )
  input.emit({
    type: 'PlanUpdated',
    intent: route.intent,
    summary: route.reason,
    toolDomains: route.toolDomains,
    taskGraph: route.taskGraph,
  })
  return route
}
