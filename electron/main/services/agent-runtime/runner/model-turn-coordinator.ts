import type { AgentEventInput } from '../../../../../src/core/assistant/events'
import type { HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import type { ModelStepResult } from '../../../../../src/core/llm/modelStep'
import { createMainLogger } from '../../logging'
import type { AgentContextBuilder } from '../context/builder'
import {
  buildPrimaryModelTraceMetadata,
  runPrimaryAgentModelStep,
  runRouterModelClassification,
} from './model-execution'
import type { AgentRuntimeModelSet } from './models'
import type { AgentModelStepExecutor } from './types'

const logger = createMainLogger('main.agent_runtime')

interface AgentModelTurnCoordinatorOptions {
  runId: string
  models: AgentRuntimeModelSet
  runModelStep: AgentModelStepExecutor
  recordUsage: (usage: ModelStepResult['usage']) => void
  emit: (event: AgentEventInput) => void
  setCurrentModelRequestId: (requestId: string | null) => void
  setCurrentStepId: (stepId: string | null) => void
  throwIfCancelled: () => void
}

export class AgentModelTurnCoordinator {
  constructor(private readonly options: AgentModelTurnCoordinatorOptions) {}

  async classify(goal: string, snapshot: HostContextSnapshot, signal: AbortSignal): Promise<unknown> {
    this.options.throwIfCancelled()
    const requestId = `${this.options.runId}:router:${snapshot.revision}`
    this.options.setCurrentModelRequestId(requestId)
    try {
      const result = await runRouterModelClassification({
        runId: this.options.runId,
        goal,
        snapshot,
        model: this.options.models.router,
        runModelStep: this.options.runModelStep,
        signal,
      })
      this.options.recordUsage(result.usage)
      return result.decision
    } finally {
      this.options.setCurrentModelRequestId(null)
    }
  }

  async runPrimary(
    turn: number,
    context: ReturnType<AgentContextBuilder['build']>,
    attempt?: 'overflow-retry'
  ): Promise<ModelStepResult> {
    const stepId = attempt ? `step-${turn}-${attempt}` : `step-${turn}`
    this.options.setCurrentModelRequestId(`${this.options.runId}:${stepId}`)
    this.options.setCurrentStepId(stepId)
    this.options.emit({
      type: 'ModelStarted', stepId, turn,
      providerId: this.options.models.primary.providerId,
      modelId: this.options.models.primary.modelId,
    })
    try {
      const result = await runPrimaryAgentModelStep({
        runId: this.options.runId,
        turn,
        stepId,
        model: this.options.models.primary,
        system: context.system,
        messages: context.messages,
        tools: context.tools,
        trace: buildPrimaryModelTraceMetadata(turn, context, this.options.models.primary),
        runModelStep: this.options.runModelStep,
        onTextDelta: (text) => this.options.emit({ type: 'ModelDelta', stepId, text }),
      })
      this.options.throwIfCancelled()
      this.options.recordUsage(result.usage)
      logger.debug('Agent 上下文估算与实际用量已校准', {
        event: 'agent_context.usage.calibrated',
        requestId: this.options.runId,
        taskId: stepId,
        modelId: this.options.models.primary.modelId,
        providerId: this.options.models.primary.providerId,
        context: {
          estimatedTokens: context.estimatedTokens,
          actualInputTokens: result.usage.inputTokens,
          estimateRatio: result.usage.inputTokens && result.usage.inputTokens > 0
            ? Number((context.estimatedTokens / result.usage.inputTokens).toFixed(3))
            : null,
        },
      })
      const displayText = result.text.trim()
      this.options.emit({
        type: 'ModelCompleted', stepId, finishReason: result.finishReason,
        toolCallCount: result.toolCalls.length,
        ...(displayText ? { displayText: displayText.slice(0, 2_000) } : {}),
        usage: result.usage,
      })
      return result
    } finally {
      this.options.setCurrentModelRequestId(null)
      this.options.setCurrentStepId(null)
    }
  }
}
