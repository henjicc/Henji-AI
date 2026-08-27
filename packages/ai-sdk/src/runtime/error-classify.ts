import {
  AiRuntimeError,
  parseModelProviderError,
  ProviderModelStepError,
  type ModelProviderErrorCategory,
  type ProviderErrorContext,
} from './errors'

type ErrorRecord = Record<string, unknown>

const SAFE_PRECONNECT_RETRY_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'ENETUNREACH',
  'EAI_AGAIN',
  'ENOTFOUND',
  'ECONNREFUSED',
])

const NETWORK_ERROR_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'ETIMEDOUT', 'ENOTFOUND',
  'EPIPE', 'EHOSTUNREACH', 'ENETUNREACH', 'ENETRESET', 'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET', 'UND_ERR_CLOSED', 'UND_ERR_DESTROYED',
])

export type RetryMode = 'safe-preconnect' | 'request' | 'poll-query'

export interface NetworkFailure {
  code: string
  message: string
}

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

function nestedRecord(value: unknown): ErrorRecord {
  return value && typeof value === 'object' ? value as ErrorRecord : {}
}

function jsonRecord(value: unknown): ErrorRecord {
  if (typeof value !== 'string') return nestedRecord(value)
  try {
    return nestedRecord(JSON.parse(value) as unknown)
  } catch {
    return {}
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function statusValue(record: ErrorRecord): number | null {
  const candidate = record.statusCode ?? record.status
  return typeof candidate === 'number' && Number.isInteger(candidate) ? candidate : null
}

function providerCode(record: ErrorRecord): string | null {
  const data = nestedRecord(record.data)
  const dataError = nestedRecord(data.error)
  const responseBody = jsonRecord(record.responseBody)
  const responseError = nestedRecord(responseBody.error)
  return stringValue(record.code)
    ?? stringValue(data.code)
    ?? stringValue(dataError.code)
    ?? stringValue(responseError.code)
}

function providerMessage(record: ErrorRecord): string | null {
  const data = nestedRecord(record.data)
  const dataError = nestedRecord(data.error)
  const responseBody = jsonRecord(record.responseBody)
  const responseError = nestedRecord(responseBody.error)
  const raw = stringValue(dataError.message)
    ?? stringValue(responseError.message)
    ?? stringValue(data.message)
    ?? stringValue(responseBody.message)
    ?? stringValue(record.message)
  if (!raw) return null
  return raw
    .replace(/(?:sk-|key-|token-)[a-z0-9_-]{8,}/gi, '[已隐藏]')
    .replace(/\s+/g, ' ')
    .slice(0, 500)
}

function isTimeoutError(records: ErrorRecord[], code: string): boolean {
  if (['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']
    .includes(code.toUpperCase())) return true
  return records.some((record) => {
    const name = stringValue(record.name)?.toLowerCase() ?? ''
    const message = stringValue(record.message)?.toLowerCase() ?? ''
    return name.includes('timeout') || /(?:timed?\s*out|timeout|deadline exceeded)/i.test(message)
  })
}

function isContentFilterError(code: string, records: ErrorRecord[]): boolean {
  const haystack = [code, ...records.map((record) => providerMessage(record) ?? '')]
    .join(' ')
    .toLowerCase()
  return /content[_\s-]?(?:filter|policy)|moderation|safety[_\s-]?(?:filter|policy)|sensitive[_\s-]?content/.test(haystack)
}

function categoryFor(
  status: number | null,
  code: string,
  records: ErrorRecord[]
): ModelProviderErrorCategory {
  const normalizedCode = code.toLowerCase()
  if (records.some((record) => stringValue(record.name) === 'AbortError')) return 'cancelled'
  if (normalizedCode.includes('context_length') || normalizedCode.includes('context_window')) {
    return 'context_overflow'
  }
  if (isContentFilterError(code, records)) return 'content_filter'
  if (normalizedCode === 'provider_network_error') return 'network'
  if (status === 401 || status === 403) return 'authentication'
  if (status === 402 || normalizedCode.includes('billing')) return 'billing'
  if (status === 429 && normalizedCode.includes('quota')) return 'quota'
  if (status === 429) return 'rate_limit'
  if (status !== null && status >= 500) return 'server'
  if (status === 400 || status === 404 || status === 405 || status === 422) return 'invalid_request'
  if (isTimeoutError(records, code) || NETWORK_ERROR_CODES.has(code.toUpperCase())) return 'network'
  if (records.some((record) => record.isRetryable === true)) return 'network'
  return 'unknown'
}

function headerValue(headers: unknown, name: string): string | null {
  if (headers instanceof Headers) return headers.get(name)
  if (!headers || typeof headers !== 'object') return null
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === name)
  return match ? String(match[1]) : null
}

function retryAfterMs(record: ErrorRecord): number | null {
  const raw = headerValue(record.responseHeaders ?? record.headers, 'retry-after')
  if (!raw) return null
  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000)
  const timestamp = Date.parse(raw)
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : null
}

function safeMessage(category: ModelProviderErrorCategory, detail: string | null = null): string {
  const messages: Record<ModelProviderErrorCategory, string> = {
    network: '模型供应商网络请求失败',
    rate_limit: '模型供应商请求频率受限',
    server: '模型供应商服务暂时不可用',
    quota: '模型供应商额度不足',
    billing: '模型供应商计费状态异常',
    authentication: '模型供应商鉴权失败',
    invalid_request: '模型供应商拒绝了请求参数',
    context_overflow: '模型上下文超过供应商限制',
    content_filter: '模型供应商拒绝了受限内容',
    cancelled: '模型请求已取消',
    unknown: '模型供应商请求失败',
  }
  const summary = messages[category]
  return category === 'invalid_request' && detail ? `${summary}：${detail}` : summary
}

export function normalizeProviderError(
  input: ProviderErrorContext,
  error: unknown
): ProviderModelStepError {
  if (error instanceof ProviderModelStepError) return error
  const records = errorChain(error)
  const status = records.map(statusValue).find((value) => value !== null) ?? null
  const reportedCode = records.map(providerCode).find((value) => value !== null) ?? null
  const timeout = isTimeoutError(records, reportedCode ?? '')
  const code = reportedCode ?? (timeout ? 'MODEL_REQUEST_TIMEOUT' : 'PROVIDER_ERROR')
  const category = categoryFor(status, code, records)
  const detail = records.map(providerMessage).find((value) => value !== null) ?? null
  return new ProviderModelStepError({
    code,
    category,
    status,
    retryable: ['network', 'rate_limit', 'server'].includes(category),
    retryAfterMs: records.map(retryAfterMs).find((value) => value !== null) ?? null,
    providerId: input.providerId,
    modelId: input.modelId,
    requestId: input.requestId,
    message: safeMessage(category, detail),
  }, { cause: error })
}

export function createCredentialError(input: ProviderErrorContext): ProviderModelStepError {
  return new ProviderModelStepError({
    code: 'API_KEY_MISSING', category: 'authentication', status: null, retryable: false,
    retryAfterMs: null, providerId: input.providerId, modelId: input.modelId,
    requestId: input.requestId, message: '模型供应商凭据未配置',
  })
}

export function createCancelledError(input: ProviderErrorContext): ProviderModelStepError {
  return new ProviderModelStepError({
    code: 'MODEL_STEP_CANCELLED', category: 'cancelled', status: null, retryable: false,
    retryAfterMs: null, providerId: input.providerId, modelId: input.modelId,
    requestId: input.requestId, message: '模型请求已取消',
  })
}

export function describeNetworkFailure(error: unknown): NetworkFailure {
  const records = errorChain(error)
  const code = records.map(providerCode).find((value) => value !== null)
    ?? (error instanceof Error ? error.name : 'UNKNOWN_NETWORK_ERROR')
  const message = records.map((record) => stringValue(record.message)).find((value) => value !== null)
    ?? (error instanceof Error ? error.message : String(error))
  return { code, message }
}

export function shouldRetry(error: unknown, mode: RetryMode = 'request'): boolean {
  if (mode === 'safe-preconnect') {
    return SAFE_PRECONNECT_RETRY_CODES.has(describeNetworkFailure(error).code.toUpperCase())
  }
  if (error instanceof ProviderModelStepError) return error.details.retryable
  const structured = parseModelProviderError(error)
  if (structured) return structured.retryable
  if (error instanceof AiRuntimeError) {
    if (mode === 'poll-query') {
      return !['provider_task_failed', 'cancelled'].includes(error.code)
    }
    return ['provider_network_error', 'provider_http_error'].includes(error.code)
  }
  return true
}

export function isAgentSemanticRetryable(error: unknown): boolean {
  return shouldRetry(error, 'request')
}
