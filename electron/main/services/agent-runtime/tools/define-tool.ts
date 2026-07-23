import type { AgentToolDefinition } from './types'

export function defineAgentTool<TInput, TOutput>(
  definition: AgentToolDefinition<TInput, TOutput>
): AgentToolDefinition<TInput, TOutput> {
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(definition.name)) {
    throw new Error(`无效工具名称：${definition.name}`)
  }
  if (definition.risk === 'R4') {
    throw new Error(`禁止注册 R4 工具：${definition.name}`)
  }
  if (definition.timeoutMs < 1 || definition.timeoutMs > 10 * 60 * 1_000) {
    throw new Error(`工具超时配置无效：${definition.name}`)
  }
  if (
    definition.maxCallsPerRun !== undefined
    && (!Number.isInteger(definition.maxCallsPerRun) || definition.maxCallsPerRun < 1)
  ) {
    throw new Error(`工具单次运行调用上限无效：${definition.name}`)
  }
  if (!definition.readOnly && definition.retryPolicy.maxRetries > 0 && !definition.idempotent) {
    throw new Error(`非幂等写工具不能自动重试：${definition.name}`)
  }
  return definition
}
