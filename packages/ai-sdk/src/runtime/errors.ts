import { z } from 'zod'
export { AiRuntimeError, cancelledError } from './AiRuntimeError'
export {
  parseModelProviderError,
  ProviderModelStepError,
  serializeModelProviderError,
} from './provider-error-core'
export type {
  ModelProviderError,
  ModelProviderErrorCategory,
  ProviderErrorContext,
} from './provider-error-core'

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
