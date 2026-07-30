import type {
  FrontendToolOperation,
  HostCommandResult,
  HostScopeRevisions,
} from '../../../../../../src/core/assistant/hostContracts'
import type { AgentToolDefinition } from '../types'

export type FrontendToolInvoker = (
  operation: FrontendToolOperation,
  context: { runId: string; toolCallId: string; signal: AbortSignal }
) => Promise<HostCommandResult>

export function eraseToolDefinition<TInput, TOutput>(
  definition: AgentToolDefinition<TInput, TOutput>
): AgentToolDefinition {
  return definition as unknown as AgentToolDefinition
}

export function requireFrontendSuccess(result: HostCommandResult): Record<string, unknown> {
  if (result.ok) return {
    ...result.data,
    revision: result.resultingRevision,
    scopeRevisions: result.resultingScopeRevisions,
  }
  const error = new Error(`[${result.error.code}] ${result.error.message}`)
  error.name = result.error.recoverable ? 'RetryableHostCommandError' : 'HostCommandError'
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
