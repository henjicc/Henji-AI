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
  options: { retryPreconnectOnce: boolean; fallbackEndpoints?: readonly string[] }
): Promise<Response> {
  const endpoints = [endpoint, ...(options.fallbackEndpoints ?? []).filter((value) => value !== endpoint)]
  let lastFailure: NetworkFailure | undefined

  for (let index = 0; index < endpoints.length; index += 1) {
    try {
      return await fetch(endpoints[index], init)
    } catch (error) {
      if (isAbort(error, init.signal ?? undefined)) throw error
      const failure = describeNetworkFailure(error)
      lastFailure = failure
      const isSafePreconnectFailure = SAFE_PRECONNECT_RETRY_CODES.has(failure.code)
      if (isSafePreconnectFailure && index < endpoints.length - 1) continue

      if (options.retryPreconnectOnce && isSafePreconnectFailure) {
        await new Promise<void>((resolve) => setTimeout(resolve, 250))
        try {
          return await fetch(endpoints[index], init)
        } catch (retryError) {
          if (isAbort(retryError, init.signal ?? undefined)) throw retryError
          lastFailure = describeNetworkFailure(retryError)
        }
      }
      break
    }
  }

  const failure = lastFailure ?? { code: 'UNKNOWN_NETWORK_ERROR', message: 'Unknown network failure' }
  throw new AiRuntimeError(
    'provider_network_error',
    `${provider} 网络连接失败（${failure.code}），请检查网络后重试`
  )
}
