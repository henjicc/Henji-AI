import type { HostScopeRevisions } from '../../../../../src/core/assistant/hostContracts'
import type { AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import type { ModelStepToolCall } from '../../../../../src/core/llm/modelStep'
import type { AgentRouteDecision } from '../context/types'
import type { AgentToolRegistry } from '../tools/registry'
import { buildRecoveryGuidance } from './result-verifier'

export async function executeAgentToolTurn(input: {
  toolCalls: ModelStepToolCall[]
  route: AgentRouteDecision
  scopeRevisions: Partial<HostScopeRevisions>
  activeToolNames: string[]
  observations: AgentToolObservation[]
  registry: AgentToolRegistry
  saveBefore: () => Promise<unknown>
  waitIfPaused: () => Promise<void>
  throwIfCancelled: () => void
  execute: (
    calls: ModelStepToolCall[],
    route: AgentRouteDecision,
    revisions: Partial<HostScopeRevisions>,
    activeNames: ReadonlySet<string>
  ) => Promise<void>
  flushConversation: () => Promise<void>
  appendGuidance: (message: string) => void
  saveAfter: () => Promise<unknown>
  registerExternalWait: (observations: AgentToolObservation[]) => Promise<boolean>
  progressGuidance: () => string | null
}): Promise<boolean> {
  await input.saveBefore()
  await input.waitIfPaused()
  input.throwIfCancelled()
  const observationStart = input.observations.length
  await input.execute(
    input.toolCalls,
    input.route,
    input.scopeRevisions,
    new Set(input.activeToolNames)
  )
  await input.flushConversation()
  const turnObservations = input.observations.slice(observationStart)
  const guidance = buildRecoveryGuidance(turnObservations, input.registry)
  if (guidance) input.appendGuidance(guidance)
  const progressGuidance = input.progressGuidance()
  if (progressGuidance) input.appendGuidance(progressGuidance)
  await input.saveAfter()
  return input.registerExternalWait(turnObservations)
}
