import type { AgentModelStepExecutor } from '../runner/types'

/** 既有调度测试的 LLM 边界夹具；策略语义另由定向测试和 L-C 验证。 */
export function withTaskPolicyModel(execute: AgentModelStepExecutor): AgentModelStepExecutor {
  return async (input, emit) => {
    if (!input.stepId.startsWith('task-policy:')) return execute(input, emit)
    const payload = JSON.parse(String(input.messages[0].content)) as { messages: Array<{ messageId: string; content: string }> }
    return {
      requestId: input.requestId, runId: input.runId, stepId: input.stepId,
      providerId: input.providerId, modelId: input.modelId,
      text: '', reasoningText: '', toolCalls: [], responseMessages: [], finishReason: 'stop',
      structuredOutput: { intent: 'modify', forbiddenEffects: [], navigationRequested: false, clarification: '',
        sources: payload.messages.map((message) => ({ messageId: message.messageId, quote: message.content.slice(0, 2_000) })) },
      usage: { inputTokens: 0, inputNoCacheTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
        outputTokens: 0, textTokens: 0, reasoningTokens: 0, totalTokens: 0 },
      providerMetadataSummary: {}, warnings: [], elapsedMs: 0,
    }
  }
}
