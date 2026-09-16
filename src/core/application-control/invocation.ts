import type { ApplicationCallerGrant } from './callerContext'
import type { ApplicationObservedEffect } from './observedEffect'

/** 仅可信宿主构建，授权不属于能力参数。 */
export interface ApplicationInvocationContext {
  readonly callerGrant: ApplicationCallerGrant
  readonly requestId: string
  readonly operationId?: string
  readonly target?: { kind: string; id: string }
  readonly signal: AbortSignal
}

export interface ApplicationResult<T = Record<string, unknown>> {
  ok: boolean
  data?: T
  error?: { code: string; message: string; recoverable?: boolean; details?: unknown }
  executionState?: 'prepared' | 'executing' | 'completed' | 'not_executed' | 'rolled_back' | 'partial' | 'unknown' | 'not_found'
  persistence?: { state: 'saved' | 'dirty' | 'not_required' | 'unknown'; recovery?: unknown }
  observedEffects?: ApplicationObservedEffect[]
  taskRef?: { kind: string; id: string }
  recovery?: unknown
  [key: string]: unknown
}

export function applicationFailure(message: string): ApplicationResult {
  const separator = message.indexOf(':')
  const code = separator > 0 && /^[A-Z_]+$/.test(message.slice(0, separator)) ? message.slice(0, separator) : 'APPLICATION_CALL_FAILED'
  return { ok: false, error: { code, message, recoverable: true } }
}
