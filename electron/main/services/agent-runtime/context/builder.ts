import { createMainLogger } from '../../logging'
import type { ModelStepMessage } from '../../../../../src/core/llm/modelStep'
import {
  AGENT_CONTEXT_RESERVE_TOKENS,
  AGENT_KEEP_RECENT_TOKENS,
  compactConversationMessages,
  estimateModelMessagesTokens,
} from './compaction'
import { AGENT_ACTIVE_TOOL_LIMIT } from '../../../../../src/core/assistant/toolBudget'
import { AgentArtifactStore } from './offload'
import { selectContextLayers } from './layer-budget'
import {
  buildAgentContextLayers,
  stableSystemPrompt,
  updateToolContractLayer,
} from './prompt-layers'
import type {
  AgentContextArtifact,
  AgentContextBuildInput,
  AgentContextBuildResult,
} from './types'

const logger = createMainLogger('main.agent_context')
export function resolveContextCompactionThreshold(
  contextWindow: number,
  _maxOutputTokens = 0
): number {
  const reserve = contextWindow > AGENT_CONTEXT_RESERVE_TOKENS + 2_000
    ? AGENT_CONTEXT_RESERVE_TOKENS
    : Math.floor(contextWindow * 0.2)
  return Math.max(2_000, contextWindow - reserve)
}

function withoutSystemMessages(messages: ModelStepMessage[]): ModelStepMessage[] {
  return messages.filter((message) => message.role !== 'system')
}

export class AgentContextBuilder {
  constructor(private readonly artifactStore = new AgentArtifactStore()) {}

  build(input: AgentContextBuildInput): AgentContextBuildResult {
    // 上限只有 toolBudget 一个来源。此前这里写死 8，与激活逻辑各算各的：
    // 激活挑够 16 个存进保存点，构建器又砍回 8 个发给模型，两边对不上还谁都不报错。
    let activeTools = input.modelTools.slice(0, AGENT_ACTIVE_TOOL_LIMIT)
    let activeToolNames = input.activeToolNames.slice(0, AGENT_ACTIVE_TOOL_LIMIT)
    const baseConversation = withoutSystemMessages(input.conversation)
    const { layers, offloaded } = buildAgentContextLayers(
      input,
      activeToolNames,
      this.artifactStore
    )
    const toolsJson = (): string => JSON.stringify(activeTools)
    const fullLayerMessages = selectContextLayers(layers, input.contextWindowBudget).messages
    const fullyEstimatedTokens = estimateModelMessagesTokens(
      [{ role: 'system', content: stableSystemPrompt }, ...fullLayerMessages, ...baseConversation],
      toolsJson()
    )
    const usageBaseline = input.lastModelUsage
    const beforeCompactionTokens = usageBaseline
      && usageBaseline.inputTokens > 0
      && usageBaseline.conversationMessageCount <= baseConversation.length
      ? usageBaseline.inputTokens + estimateModelMessagesTokens(
          baseConversation.slice(usageBaseline.conversationMessageCount)
        )
      : fullyEstimatedTokens
    const threshold = resolveContextCompactionThreshold(
      input.contextWindowBudget,
      input.maxOutputTokens
    )
    const compacted = beforeCompactionTokens > threshold
    const keepRecentTokens = Math.min(
      AGENT_KEEP_RECENT_TOKENS,
      Math.max(1_000, Math.floor(threshold * 0.75))
    )
    const conversation = compacted
      ? compactConversationMessages(baseConversation, keepRecentTokens, input.workingSummary)
      : baseConversation

    const reservedTokens = estimateModelMessagesTokens(
      [{ role: 'system', content: stableSystemPrompt }, ...conversation],
      toolsJson()
    )
    const layerBudget = Math.max(320, threshold - reservedTokens)
    let effectiveLayers = layers
    let selection = selectContextLayers(effectiveLayers, layerBudget)
    let messages = [...selection.messages, ...conversation]
    let estimatedTokens = estimateModelMessagesTokens(
      [{ role: 'system', content: stableSystemPrompt }, ...messages],
      toolsJson()
    )
    while (estimatedTokens > threshold && activeTools.length > 1) {
      activeTools = activeTools.slice(0, -1)
      activeToolNames = activeToolNames.slice(0, activeTools.length)
      estimatedTokens = estimateModelMessagesTokens(
        [{ role: 'system', content: stableSystemPrompt }, ...messages],
        toolsJson()
      )
    }
    if (activeToolNames.length !== Math.min(input.activeToolNames.length, AGENT_ACTIVE_TOOL_LIMIT)) {
      effectiveLayers = updateToolContractLayer(layers, activeToolNames)
      const finalReserved = estimateModelMessagesTokens(
        [{ role: 'system', content: stableSystemPrompt }, ...conversation],
        toolsJson()
      )
      selection = selectContextLayers(effectiveLayers, Math.max(320, threshold - finalReserved))
      messages = [...selection.messages, ...conversation]
      estimatedTokens = estimateModelMessagesTokens(
        [{ role: 'system', content: stableSystemPrompt }, ...messages],
        toolsJson()
      )
    }
    const compactionReason = compacted
      ? `估算上下文 ${beforeCompactionTokens} tokens 超过阈值 ${threshold}`
      : null

    logger.info('Agent 上下文构建完成', {
      event: 'agent_context.build.completed',
      requestId: input.runId,
      context: {
        snapshotRevision: input.snapshot.revision,
        activeToolCount: activeTools.length,
        estimatedTokens,
        beforeCompactionTokens,
        contextTokenSource: beforeCompactionTokens === fullyEstimatedTokens
          ? 'estimated'
          : 'provider_usage_plus_trailing_estimate',
        contextWindow: input.contextWindowBudget,
        compactionThreshold: threshold,
        maxOutputTokens: input.maxOutputTokens ?? null,
        compacted,
        compactionReason,
        retainedLayers: selection.retainedLayers,
        droppedLayers: selection.droppedLayers,
        offloadedCount: offloaded.length,
        userInstructionsIncluded: Boolean(input.userInstructions),
        memoryCount: input.memoryContext?.length ?? 0,
      },
    })
    return {
      system: stableSystemPrompt,
      messages,
      tools: activeTools,
      activeToolNames,
      estimatedTokens,
      snapshotRevision: input.snapshot.revision,
      compacted,
      beforeCompactionTokens,
      offloaded,
      layerReports: selection.reports,
      retainedLayers: selection.retainedLayers,
      droppedLayers: selection.droppedLayers,
      compactionReason,
    }
  }

  getArtifact(artifactRef: string): AgentContextArtifact | null {
    return this.artifactStore.get(artifactRef)
  }
}
