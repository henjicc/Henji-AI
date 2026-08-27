/**
 * 不依赖 schema 库的供应商错误值与序列化内核。
 *
 * UXP 的原生 LLM 流式入口只需要稳定错误协议，不能因此把 Zod 的 JIT 实现带进 bundle。
 * `errors.ts` 继续在兼容入口导出 Zod schema；两条路径共用这里唯一的错误类与 wire format。
 */
export type ModelProviderErrorCategory =
  | 'network'
  | 'rate_limit'
  | 'server'
  | 'quota'
  | 'billing'
  | 'authentication'
  | 'invalid_request'
  | 'context_overflow'
  | 'content_filter'
  | 'cancelled'
  | 'unknown'

export interface ModelProviderError {
  code: string
  category: ModelProviderErrorCategory
  status: number | null
  retryable: boolean
  retryAfterMs: number | null
  providerId: string
  modelId: string
  requestId: string
  message: string
}

export interface ProviderErrorContext {
  providerId: string
  modelId: string
  requestId: string
}

const ERROR_MARKER = '[provider_error]'
const CATEGORIES = new Set<ModelProviderErrorCategory>([
  'network',
  'rate_limit',
  'server',
  'quota',
  'billing',
  'authentication',
  'invalid_request',
  'context_overflow',
  'content_filter',
  'cancelled',
  'unknown',
])

function isNonEmptyString(value: unknown, maxLength?: number): value is string {
  return typeof value === 'string' && value.length > 0 && (maxLength === undefined || value.length <= maxLength)
}

function isNullableInteger(value: unknown, minimum: number, maximum?: number): value is number | null {
  return value === null || (
    typeof value === 'number'
    && Number.isInteger(value)
    && value >= minimum
    && (maximum === undefined || value <= maximum)
  )
}

function parseDetails(value: unknown): ModelProviderError | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const details = value as Record<string, unknown>
  if (!isNonEmptyString(details.code, 200)) return null
  if (typeof details.category !== 'string' || !CATEGORIES.has(details.category as ModelProviderErrorCategory)) return null
  if (!isNullableInteger(details.status, 100, 599)) return null
  if (typeof details.retryable !== 'boolean') return null
  if (!isNullableInteger(details.retryAfterMs, 0)) return null
  if (!isNonEmptyString(details.providerId)) return null
  if (!isNonEmptyString(details.modelId)) return null
  if (!isNonEmptyString(details.requestId)) return null
  if (!isNonEmptyString(details.message, 1_000)) return null
  if (Object.keys(details).some((key) => ![
    'code', 'category', 'status', 'retryable', 'retryAfterMs',
    'providerId', 'modelId', 'requestId', 'message',
  ].includes(key))) return null
  return details as unknown as ModelProviderError
}

function requireDetails(value: unknown): ModelProviderError {
  const details = parseDetails(value)
  if (!details) throw new Error('Invalid model provider error details')
  return details
}

export function serializeModelProviderError(error: ModelProviderError): string {
  return `${ERROR_MARKER}${JSON.stringify(requireDetails(error))}`
}

export function parseModelProviderError(value: unknown): ModelProviderError | null {
  const message = value instanceof Error ? value.message : typeof value === 'string' ? value : ''
  const markerIndex = message.indexOf(ERROR_MARKER)
  if (markerIndex < 0) return null
  try {
    return parseDetails(JSON.parse(message.slice(markerIndex + ERROR_MARKER.length)) as unknown)
  } catch {
    return null
  }
}

export class ProviderModelStepError extends Error {
  readonly details: ModelProviderError
  readonly code: string
  readonly category: ModelProviderErrorCategory

  constructor(details: ModelProviderError, options?: { cause?: unknown }) {
    const validated = requireDetails(details)
    super(serializeModelProviderError(validated), options)
    this.name = 'ProviderModelStepError'
    this.details = validated
    this.code = validated.code
    this.category = validated.category
  }
}
