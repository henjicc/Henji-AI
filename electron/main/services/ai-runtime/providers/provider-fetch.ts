import { AiRuntimeError } from '../errors'

const SAFE_PRECONNECT_RETRY_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'ENETUNREACH',
  'EAI_AGAIN',
  'ENOTFOUND',
  'ECONNREFUSED',
])

interface NetworkFailure {
  code: string
  message: string
}

function readErrorField(error: unknown, field: 'code' | 'message'): string | null {
  if (!error || typeof error !== 'object') return null
  const value = (error as Record<string, unknown>)[field]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readCause(error: unknown): unknown {
  if (!error || typeof error !== 'object') return null
  return (error as Record<string, unknown>).cause
}

export function describeNetworkFailure(error: unknown): NetworkFailure {
  let current: unknown = error
  let message = error instanceof Error ? error.message : String(error)
  for (let depth = 0; depth < 4 && current; depth += 1) {
    const code = readErrorField(current, 'code')
    const causeMessage = readErrorField(current, 'message')
    if (causeMessage) message = causeMessage
    if (code) return { code, message }
    current = readCause(current)
  }
  return { code: error instanceof Error ? error.name : 'UNKNOWN_NETWORK_ERROR', message }
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted)
    || (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'))
}

export async function fetchProvider(
  provider: string,
  endpoint: string,
  init: RequestInit,
  options: { retryPreconnectOnce: boolean }
): Promise<Response> {
  try {
    return await fetch(endpoint, init)
  } catch (error) {
    if (isAbort(error, init.signal ?? undefined)) throw error
    const failure = describeNetworkFailure(error)
    if (options.retryPreconnectOnce && SAFE_PRECONNECT_RETRY_CODES.has(failure.code)) {
      await new Promise<void>((resolve) => setTimeout(resolve, 250))
      try {
        return await fetch(endpoint, init)
      } catch (retryError) {
        if (isAbort(retryError, init.signal ?? undefined)) throw retryError
        const retryFailure = describeNetworkFailure(retryError)
        throw new AiRuntimeError(
          'provider_network_error',
          `${provider} 网络连接失败（${retryFailure.code}），请检查网络后重试`
        )
      }
    }
    throw new AiRuntimeError(
      'provider_network_error',
      `${provider} 网络请求失败（${failure.code}），请检查网络后重试`
    )
  }
}
