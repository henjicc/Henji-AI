import { z } from 'zod'

export const llmApiProtocolSchema = z.enum(['openai-compatible'])
export type LlmApiProtocol = z.infer<typeof llmApiProtocolSchema>

/**
 * 供应商在 OpenAI 协议之上的认证差异，按 providerId 声明。
 *
 * 这里放的是**协议层差异**，不是模型行为差异：请求怎么发才能被对方接受。助手的判断逻辑
 * 一律不许按模型分支，但"这家网关认哪个认证头"没有通用答案，只能如实记下来。
 *
 * mimo（小米）：官方文档的认证头是 `api-key`，而通用实现只发 `Authorization: Bearer`。
 * 两个头同时发是安全的——网关只读它认识的那个——所以这里补发而不是替换，既不依赖对方是否
 * 兼容 Bearer，也不影响其他供应商。
 * 见 https://mimo.mi.com/docs/zh-CN/quick-start/summary/first-api-call
 *
 * 三条发请求的路径（SDK 模型步、原生流式、模型发现）必须共用这一份，否则改了一处漏两处。
 */
const PROVIDER_EXTRA_AUTH_HEADERS: Readonly<Record<string, string>> = {
  mimo: 'api-key',
}

export function resolveProviderExtraAuthHeaders(
  providerId: string,
  apiKey: string
): Record<string, string> {
  const headerName = PROVIDER_EXTRA_AUTH_HEADERS[providerId.trim().toLowerCase()]
  return headerName && apiKey ? { [headerName]: apiKey } : {}
}

/**
 * 供应商对请求体字段的自有要求，按 providerId 声明。
 *
 * mimo：官方文档用 `max_completion_tokens`，而通用 OpenAI 兼容实现发的是 `max_tokens`。
 * 实测发 `max_tokens` 时六项能力探测全部 400 `Invalid request parameters`——**包括最基础的
 * text**，所以不是能力不支持，是请求根本不被接受。
 *
 * 这里改名而不是两个都发：`max_tokens` 既然被判为非法参数，留着它就还是 400。
 */
export function applyProviderRequestBodyQuirks(
  providerId: string,
  body: Record<string, unknown>
): Record<string, unknown> {
  if (providerId.trim().toLowerCase() !== 'mimo') return body
  if (!('max_tokens' in body)) return body
  const { max_tokens: maxTokens, ...rest } = body
  return { ...rest, max_completion_tokens: maxTokens }
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

export function isAgentSemanticRetryable(error: unknown): boolean {
  const structured = parseModelProviderError(error)
  return structured?.retryable ?? true
}
