import type { AgentToolDefinition } from './types'

export function assertAgentToolDefinition<TInput, TOutput>(
  definition: AgentToolDefinition<TInput, TOutput>
): void {
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(definition.name)) {
    throw new Error(`无效工具名称：${definition.name}`)
  }
  if (definition.risk === 'R4') {
    throw new Error(`禁止注册 R4 工具：${definition.name}`)
  }
  if (definition.side === 'frontend' && !definition.capability) {
    throw new Error(`前端工具必须来自原生应用能力定义：${definition.name}`)
  }
  if (definition.risk === 'R0' && definition.destructive) {
    throw new Error(`R0 工具不能声明为破坏性操作：${definition.name}`)
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
  if (definition.modelVisible === false && !definition.readOnly && !definition.resolveObservedEffects) {
    throw new Error(`内部写工具必须声明强类型 Effect resolver：${definition.name}`)
  }
}

export function defineAgentTool<TInput, TOutput>(
  definition: AgentToolDefinition<TInput, TOutput>
): AgentToolDefinition<TInput, TOutput> {
  assertAgentToolDefinition(definition)
  return definition
}
