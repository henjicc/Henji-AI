import type { HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import type { AgentMemoryContextEntry } from '../../../../../src/core/assistant/memory'
import type { AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import type { AgentWorkingSummary } from '../../../../../src/core/assistant/workingContext'
import type { ModelStepMessage } from '../../../../../src/core/llm/modelStep'
import type { AgentTurnSnapshotDraft } from '../../../../../src/core/assistant/turn'
import { AgentContextBuilder } from '../context/builder'
import type { AgentRouteDecision } from '../context/types'
import type { AgentToolRegistration } from '../tools/types'
import type { AgentConversationCompactor } from './conversation-compactor'
import { emitAgentContextEvents } from './context-events'
import type { AgentRuntimeModelSet } from './models'
import type { AgentSavePointCoordinator } from './save-point-coordinator'
import { buildAgentTurnSnapshotDraft } from './turn-snapshot'

interface TurnContextCoordinatorOptions {
  runId: string
  threadId: string
  models: AgentRuntimeModelSet
  contextBuilder: AgentContextBuilder
  compactor: AgentConversationCompactor
  savePoints: AgentSavePointCoordinator
  emit: Parameters<typeof emitAgentContextEvents>[3]
}

interface PrepareTurnContextInput {
  turn: number
  goal: string
  userInstructions?: string
  memoryContext: AgentMemoryContextEntry[]
  host: HostContextSnapshot
  route: AgentRouteDecision
  conversation: ModelStepMessage[]
  observations: AgentToolObservation[]
  registrations: AgentToolRegistration[]
  workingSummary?: AgentWorkingSummary
  artifactRefs: string[]
  approvalMode: 'ask' | 'assistant_decides' | 'full_access'
}

export class AgentTurnContextCoordinator {
  private lastModelUsage: {
    inputTokens: number
    conversationMessageCount: number
  } | undefined

  constructor(private readonly options: TurnContextCoordinatorOptions) {}

  recordModelInputUsage(inputTokens: number | null, conversationMessageCount: number): void {
    if (inputTokens === null || inputTokens <= 0) return
    this.lastModelUsage = { inputTokens, conversationMessageCount }
  }

  async prepare(input: PrepareTurnContextInput): Promise<{
    context: ReturnType<AgentContextBuilder['build']>
    snapshot: AgentTurnSnapshotDraft
    rebuild: () => ReturnType<AgentContextBuilder['build']>
  }> {
    const build = (): ReturnType<AgentContextBuilder['build']> => this.options.contextBuilder.build({
      runId: this.options.runId,
      goal: input.goal,
      userInstructions: input.userInstructions,
      memoryContext: input.memoryContext,
      snapshot: input.host,
      route: input.route,
      conversation: input.conversation,
      observations: input.observations.slice(-20),
      modelTools: input.registrations.map((item) => item.modelTool),
      activeToolNames: input.registrations.map((item) => item.catalog.name),
      contextWindowBudget: this.options.models.primary.limits.contextWindow,
      maxOutputTokens: this.options.models.primary.settings.maxOutputTokens,
      workingSummary: input.workingSummary,
      lastModelUsage: this.lastModelUsage,
    })
    let context = build()
    if (context.compacted && await this.options.compactor.compact(input.turn, input.workingSummary)) {
      this.lastModelUsage = undefined
      context = build()
    }
    emitAgentContextEvents(input.turn, context, input.workingSummary?.version, this.options.emit)
    const snapshot = buildAgentTurnSnapshotDraft({
      runId: this.options.runId,
      threadId: this.options.threadId,
      turn: input.turn,
      host: input.host,
      models: this.options.models,
      registrations: input.registrations,
      artifactRefs: input.artifactRefs,
      approvalMode: input.approvalMode,
    })
    await this.options.savePoints.save('before_model', snapshot)
    return { context, snapshot, rebuild: build }
  }
}
