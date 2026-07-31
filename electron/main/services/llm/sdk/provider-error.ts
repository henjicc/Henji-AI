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

function errorRecord(error: unknown): ErrorRecord {
  return error && typeof error === 'object' ? error as ErrorRecord : {}
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

function providerCode(record: ErrorRecord): string {
  const data = nestedRecord(record.data)
  const dataError = nestedRecord(data.error)
  const responseBody = jsonRecord(record.responseBody)
  const responseError = nestedRecord(responseBody.error)
  return stringValue(record.code)
    ?? stringValue(data.code)
    ?? stringValue(dataError.code)
    ?? stringValue(responseError.code)
    ?? 'PROVIDER_ERROR'
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

function categoryFor(status: number | null, code: string, error: unknown): ModelProviderErrorCategory {
  const normalizedCode = code.toLowerCase()
  if (error instanceof Error && error.name === 'AbortError') return 'cancelled'
  if (normalizedCode.includes('context_length') || normalizedCode.includes('context_window')) {
    return 'context_overflow'
  }
  if (status === 401 || status === 403) return 'authentication'
  if (status === 402 || normalizedCode.includes('billing')) return 'billing'
  if (status === 429 && normalizedCode.includes('quota')) return 'quota'
  if (status === 429) return 'rate_limit'
  if (status !== null && status >= 500) return 'server'
  if (status === 400 || status === 404 || status === 405 || status === 422) return 'invalid_request'
  if (['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'UND_ERR_CONNECT_TIMEOUT']
    .includes(code.toUpperCase())) return 'network'
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
  const record = errorRecord(error)
  const status = statusValue(record)
  const code = providerCode(record)
  const category = categoryFor(status, code, error)
  return new ProviderModelStepError({
    code,
    category,
    status,
    retryable: ['network', 'rate_limit', 'server'].includes(category),
    retryAfterMs: retryAfterMs(record),
    providerId: input.providerId,
    modelId: input.modelId,
    requestId: input.requestId,
    message: safeMessage(category, providerMessage(record)),
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
