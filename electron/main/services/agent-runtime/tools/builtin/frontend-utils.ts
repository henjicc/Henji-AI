import type {
  FrontendToolOperation,
  ApplicationCapabilityResult,
  HostScopeRevisions,
} from '../../../../../../src/core/assistant/hostContracts'
import type { AgentToolDefinition } from '../types'

export type FrontendToolInvoker = (
  operation: FrontendToolOperation,
  context: { runId: string; toolCallId: string; signal: AbortSignal }
) => Promise<ApplicationCapabilityResult>

export function eraseToolDefinition<TInput, TOutput>(
  definition: AgentToolDefinition<TInput, TOutput>
): AgentToolDefinition {
  return definition as unknown as AgentToolDefinition
}

export function requireFrontendSuccess(result: ApplicationCapabilityResult): Record<string, unknown> {
  // 渲染层能力注册中心已经按照各自 output schema 决定是否包含 revision。
  // 这里再次统一追加会让 list_generation_history 这类严格只读输出在网关校验时失败。
  if (result.ok) return result.data
  const error = new Error(`[${result.error.code}] ${result.error.message}`)
  error.name = result.error.recoverable ? 'RetryableFrontendCapabilityError' : 'FrontendCapabilityError'
  throw error
}

export function expectedRevision(
  revisions: HostScopeRevisions | undefined,
  scopes: Array<keyof HostScopeRevisions>
): Record<string, number> | undefined {
  if (!revisions) return undefined
  return Object.fromEntries(scopes.flatMap((scope) => {
    const value = revisions[scope]
    return typeof value === 'number' ? [[String(scope), value]] : []
  }))
}
