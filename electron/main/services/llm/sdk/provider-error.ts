import {
  modelProviderErrorSchema,
  serializeModelProviderError,
  type ModelProviderError,
  type ModelProviderErrorCategory,
} from '../../../../../src/core/llm/providerProtocol'
import type { ModelStepInput } from '../../../../../src/core/llm/modelStep'

type ErrorRecord = Record<string, unknown>

export class ProviderModelStepError extends Error {
  readonly details: ModelProviderError
  readonly code: string
  readonly category: ModelProviderErrorCategory

  constructor(details: ModelProviderError, options?: { cause?: unknown }) {
    super(serializeModelProviderError(details), options)
    this.name = 'ProviderModelStepError'
    this.details = modelProviderErrorSchema.parse(details)
    this.code = this.details.code
    this.category = this.details.category
  }
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
  if (!raw) return null
  return raw
    .replace(/(?:sk-|key-|token-)[a-z0-9_-]{8,}/gi, '[已隐藏]')
    .replace(/\s+/g, ' ')
    .slice(0, 500)
}

function isTimeoutError(records: ErrorRecord[], code: string): boolean {
  const timeoutCodes = [
    'ETIMEDOUT',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_BODY_TIMEOUT',
  ]
  if (timeoutCodes.includes(code.toUpperCase())) return true
  return records.some((record) => {
    const name = stringValue(record.name)?.toLowerCase() ?? ''
    const message = stringValue(record.message)?.toLowerCase() ?? ''
    return name.includes('timeout')
      || /(?:timed?\s*out|timeout|deadline exceeded)/i.test(message)
  })
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
  if (status === 401 || status === 403) return 'authentication'
  if (status === 402 || normalizedCode.includes('billing')) return 'billing'
  if (status === 429 && normalizedCode.includes('quota')) return 'quota'
  if (status === 429) return 'rate_limit'
  if (status !== null && status >= 500) return 'server'
  if (status === 400 || status === 404 || status === 405 || status === 422) return 'invalid_request'
  if (isTimeoutError(records, code)) return 'network'
  /*
   * 连接在传输途中断掉，就是网络错误，不是"未知"。
   *
   * `UND_ERR_SOCKET`（undici：对端关闭了 socket）此前落到 unknown，于是被标成
   * retryable: false——最典型的可重试错误被判成不可重试。实测三维场景连续两次真跑都死在
   * 这一条上，整次运行直接判失败，一个 Effect 都没做成。
   *
   * 只列传输层的码：`UND_ERR_INVALID_ARG` 这类是调用方写错了参数，重试多少次都一样。
   */
  if ([
    'ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'ETIMEDOUT', 'ENOTFOUND',
    'EPIPE', 'EHOSTUNREACH', 'ENETUNREACH', 'ENETRESET', 'EAI_AGAIN',
    'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_CLOSED', 'UND_ERR_DESTROYED',
  ].includes(code.toUpperCase())) return 'network'
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

function safeMessage(
  category: ModelProviderErrorCategory,
  detail: string | null = null
): string {
  const messages: Record<ModelProviderErrorCategory, string> = {
    network: '模型供应商网络请求失败',
    rate_limit: '模型供应商请求频率受限',
    server: '模型供应商服务暂时不可用',
    quota: '模型供应商额度不足',
    billing: '模型供应商计费状态异常',
    authentication: '模型供应商鉴权失败',
    invalid_request: '模型供应商拒绝了请求参数',
    context_overflow: '模型上下文超过供应商限制',
    cancelled: '模型请求已取消',
    unknown: '模型供应商请求失败',
  }
  const summary = messages[category]
  return category === 'invalid_request' && detail ? `${summary}：${detail}` : summary
}

export function normalizeProviderError(input: ModelStepInput, error: unknown): ProviderModelStepError {
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

export function createCredentialError(input: ModelStepInput): ProviderModelStepError {
  return new ProviderModelStepError({
    code: 'API_KEY_MISSING',
    category: 'authentication',
    status: null,
    retryable: false,
    retryAfterMs: null,
    providerId: input.providerId,
    modelId: input.modelId,
    requestId: input.requestId,
    message: '模型供应商凭据未配置',
  })
}

export function createCancelledError(input: ModelStepInput): ProviderModelStepError {
  return new ProviderModelStepError({
    code: 'MODEL_STEP_CANCELLED',
    category: 'cancelled',
    status: null,
    retryable: false,
    retryAfterMs: null,
    providerId: input.providerId,
    modelId: input.modelId,
    requestId: input.requestId,
    message: '模型请求已取消',
  })
}
