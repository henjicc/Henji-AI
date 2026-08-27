import { AiRuntimeError } from './AiRuntimeError'

const SAFE_PRECONNECT_RETRY_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'ENETUNREACH',
  'EAI_AGAIN',
  'ENOTFOUND',
  'ECONNREFUSED',
])

export type RetryMode = 'safe-preconnect' | 'request' | 'poll-query'

export interface NetworkFailure {
  code: string
  message: string
}

type ErrorRecord = Record<string, unknown>

function errorChain(error: unknown): ErrorRecord[] {
  const records: ErrorRecord[] = []
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current && typeof current === 'object' && records.length < 4 && !seen.has(current)) {
    seen.add(current)
    const record = current as ErrorRecord
    records.push(record)
    current = record.cause
  }
  return records
}

function providerCode(record: ErrorRecord): string | null {
  for (const key of ['code', 'errorCode', 'type']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

export function describeNetworkFailure(error: unknown): NetworkFailure {
  const records = errorChain(error)
  const code = records.map(providerCode).find((value) => value !== null)
    ?? (error instanceof Error ? error.name : 'UNKNOWN_NETWORK_ERROR')
  const message = records.map((record) => record.message).find(
    (value): value is string => typeof value === 'string' && value.trim().length > 0
  ) ?? (error instanceof Error ? error.message : String(error))
  return { code, message }
}

export function shouldRetry(error: unknown, mode: RetryMode = 'request'): boolean {
  if (mode === 'safe-preconnect') {
    return SAFE_PRECONNECT_RETRY_CODES.has(describeNetworkFailure(error).code.toUpperCase())
  }
  const structuredRetryable = readStructuredRetryable(error)
  if (structuredRetryable !== undefined) return structuredRetryable
  if (error instanceof AiRuntimeError) {
    if (mode === 'poll-query') {
      return !['provider_task_failed', 'cancelled'].includes(error.code)
    }
    return ['provider_network_error', 'provider_http_error'].includes(error.code)
  }
  return true
}

function readStructuredRetryable(error: unknown): boolean | undefined {
  if (error && typeof error === 'object') {
    const details = (error as ErrorRecord).details
    if (details && typeof details === 'object' && typeof (details as ErrorRecord).retryable === 'boolean') {
      return (details as ErrorRecord).retryable as boolean
    }
  }
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const marker = '[provider_error]'
  const markerIndex = message.indexOf(marker)
  if (markerIndex < 0) return undefined
  try {
    const parsed = JSON.parse(message.slice(markerIndex + marker.length)) as unknown
    return parsed && typeof parsed === 'object' && typeof (parsed as ErrorRecord).retryable === 'boolean'
      ? (parsed as ErrorRecord).retryable as boolean
      : undefined
  } catch {
    return undefined
  }
}
