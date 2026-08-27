import { z } from 'zod'

export class AiRuntimeError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(`[${code}] ${message}`)
    this.name = 'AiRuntimeError'
    this.code = code
  }
}

export function cancelledError(requestId: string): AiRuntimeError {
  return new AiRuntimeError('cancelled', `Task cancelled: ${requestId}`)
}

export const modelProviderErrorCategorySchema = z.enum([
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
export type ModelProviderErrorCategory = z.infer<typeof modelProviderErrorCategorySchema>

export const modelProviderErrorSchema = z.object({
  code: z.string().min(1).max(200),
  category: modelProviderErrorCategorySchema,
  status: z.number().int().min(100).max(599).nullable(),
  retryable: z.boolean(),
  retryAfterMs: z.number().int().nonnegative().nullable(),
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  requestId: z.string().min(1),
  message: z.string().min(1).max(1_000),
}).strict()
export type ModelProviderError = z.infer<typeof modelProviderErrorSchema>

const ERROR_MARKER = '[provider_error]'

export function serializeModelProviderError(error: ModelProviderError): string {
  return `${ERROR_MARKER}${JSON.stringify(modelProviderErrorSchema.parse(error))}`
}

export function parseModelProviderError(value: unknown): ModelProviderError | null {
  const message = value instanceof Error ? value.message : typeof value === 'string' ? value : ''
  const markerIndex = message.indexOf(ERROR_MARKER)
  if (markerIndex < 0) return null
  try {
    const parsed = JSON.parse(message.slice(markerIndex + ERROR_MARKER.length)) as unknown
    const result = modelProviderErrorSchema.safeParse(parsed)
    return result.success ? result.data : null
  } catch {
    return null
  }
}

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

export interface ProviderErrorContext {
  providerId: string
  modelId: string
  requestId: string
}
