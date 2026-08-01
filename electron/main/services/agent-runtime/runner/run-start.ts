import type { AgentEventInput } from '../../../../../src/core/assistant/events'
import { createMainLogger } from '../../logging'

const logger = createMainLogger('main.agent_runtime')

interface AgentRunStartInput {
  runId: string
  request: { threadId: string; goal: string; attachments?: Array<{ mediaRef: string }> }
  models: {
    fellBack: boolean
    primary: {
      modelId: string
      providerId: string
      limits: { contextWindow: number; contextWindowSource: string }
      settings: { maxOutputTokens: number }
    }
  }
  emit: (event: AgentEventInput) => void
  transition: (reason?: string) => void
}

export function startAgentRun(input: AgentRunStartInput): void {
  const { primary } = input.models
  input.emit({
    type: 'RunStarted',
    threadId: input.request.threadId,
    goal: input.request.goal,
    attachmentRefs: input.request.attachments?.map(attachment => attachment.mediaRef),
  })
  input.transition(input.models.fellBack ? '主模型不可用，已使用已验证备用模型' : undefined)
  logger.info('Agent 运行开始', {
    event: 'agent_runtime.run.started',
    requestId: input.runId,
    modelId: primary.modelId,
    providerId: primary.providerId,
    context: {
      threadId: input.request.threadId,
      fellBack: input.models.fellBack,
      attachmentCount: input.request.attachments?.length ?? 0,
      contextWindow: primary.limits.contextWindow,
      contextWindowSource: primary.limits.contextWindowSource,
      maxOutputTokens: primary.settings.maxOutputTokens,
    },
  })
}
