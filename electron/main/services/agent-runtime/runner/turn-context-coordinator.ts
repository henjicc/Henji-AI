import type { HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import type { AgentMemoryContextEntry } from '../../../../../src/core/assistant/memory'
import type { AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import type { AgentWorkingSummary } from '../../../../../src/core/assistant/workingContext'
import type { ModelStepMessage, ModelStepUsage } from '../../../../../src/core/llm/modelStep'
import type { AgentTurnSnapshotDraft } from '../../../../../src/core/assistant/turn'
import type { AssistantSkillMetadata } from '../../../../../src/core/assistant/skills'
import { listEnabledAssistantSkills } from '../../assistant/skills/registry'
import { AgentContextBuilder } from '../context/builder'
import type { AgentRouteDecision } from '../context/types'
import type { AgentToolRegistration } from '../tools/types'
import type { AgentConversationCompactor } from './conversation-compactor'
import { emitAgentContextEvents } from './context-events'
import type { AgentRuntimeModelSet } from './models'
import type { AgentSavePointCoordinator } from './save-point-coordinator'
import { AgentStopPolicyExceededError } from './budget'
import { buildAgentTurnSnapshotDraft } from './turn-snapshot'

interface TurnContextCoordinatorOptions {
  runId: string
  threadId: string
  models: AgentRuntimeModelSet
  contextBuilder: AgentContextBuilder
  compactor: AgentConversationCompactor
  savePoints: AgentSavePointCoordinator
  emit: Parameters<typeof emitAgentContextEvents>[3]
  /** 按工具名解析历史投影；与 runner-results.toolMessage 共用同一份，保证先裁再判。 */
  resolveHistoryProjection?: (toolName: string) => ((output: unknown) => unknown) | undefined
}

interface PrepareTurnContextInput {
  turn: number
  goal: string
  userInstructions?: string
  memoryContext: AgentMemoryContextEntry[]
  host: HostContextSnapshot
  route: AgentRouteDecision
  getConversation: () => ModelStepMessage[]
  observations: AgentToolObservation[]
  registrations: AgentToolRegistration[]
  protectedToolNames?: string[]
  workingSummary?: AgentWorkingSummary
  artifactRefs: string[]
  approvalMode: 'ask' | 'assistant_decides' | 'full_access'
}

export class AgentTurnContextCoordinator {
  private lastModelUsage: {
    inputTokens: number
    conversationMessageCount: number
    cacheReadTokens?: number | null
    cacheWriteTokens?: number | null
    inputNoCacheTokens?: number | null
  } | undefined

  /** 每次运行只扫一次技能目录，之后各轮复用；本运行期间新装的技能下次运行才生效。 */
  private skills: AssistantSkillMetadata[] | null = null

  constructor(private readonly options: TurnContextCoordinatorOptions) {}

  private async ensureSkills(): Promise<AssistantSkillMetadata[]> {
    if (this.skills === null) this.skills = await listEnabledAssistantSkills()
    return this.skills
  }

  recordModelInputUsage(usage: ModelStepUsage, conversationMessageCount: number): void {
    if (usage.inputTokens === null || usage.inputTokens <= 0) return
    this.lastModelUsage = {
      inputTokens: usage.inputTokens,
      conversationMessageCount,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      inputNoCacheTokens: usage.inputNoCacheTokens,
    }
  }

  async prepare(input: PrepareTurnContextInput): Promise<{
    context: ReturnType<AgentContextBuilder['build']>
    snapshot: AgentTurnSnapshotDraft
    rebuild: (host?: HostContextSnapshot) => ReturnType<AgentContextBuilder['build']>
  }> {
    const skills = await this.ensureSkills()
    const build = (host: HostContextSnapshot = input.host): ReturnType<AgentContextBuilder['build']> => this.options.contextBuilder.build({
      runId: this.options.runId,
      goal: input.goal,
      userInstructions: input.userInstructions,
      memoryContext: input.memoryContext,
      skills,
      snapshot: host,
      route: input.route,
      conversation: input.getConversation(),
      observations: input.observations.slice(-20),
      modelTools: input.registrations.map((item) => item.modelTool),
      activeToolNames: input.registrations.map((item) => item.catalog.name),
      protectedToolNames: input.protectedToolNames,
      contextWindowBudget: this.options.models.primary.limits.contextWindow,
      // 与 runner-results.toolMessage 用同一把尺子：先裁再判，否则同一份结果一边内联一边卸载。
      resolveHistoryProjection: this.options.resolveHistoryProjection,
      maxOutputTokens: this.options.models.primary.settings.maxOutputTokens,
      workingSummary: input.workingSummary,
      lastModelUsage: this.lastModelUsage,
    })
    let context = build()
    if (context.compacted) {
      const semantic = await this.options.compactor.compact(input.turn, input.workingSummary)
      if (!semantic) this.options.compactor.compactDeterministically(input.workingSummary)
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
    if (context.contextPressure === 'hard') {
      throw new AgentStopPolicyExceededError(
        'MAX_CONTEXT_WINDOW',
        '上下文在强制语义压缩后仍高于 80% 安全线，已保存检查点并转入下一段执行'
      )
    }
    return { context, snapshot, rebuild: build }
  }
}

