import type { RuntimeContext } from '../runtime'
import { resolveProviderExtraAuthHeaders } from './providerProtocol'

/**
 * 模型发现（列出供应商可用模型）。任务 4.2 从 `electron/main/services/llm/discovery.ts`
 * 迁入。唯一的实质改动：密钥读取从 `getLlmProviderApiKey`（Electron keystore）改为
 * `RuntimeContext.credentials.get('llm', providerId)`，网络请求从全局 `fetch` 改为
 * `RuntimeContext.transport.fetch`。
 */

export interface DiscoveredModelItem {
  modelId: string
  displayName: string
  contextWindow: number | null
  maxOutputTokens: number | null
}

interface RawDiscoveredModel {
  id?: unknown
  title?: unknown
  name?: unknown
  context_size?: unknown
  max_input_tokens?: unknown
  input_token_limit?: unknown
  inputTokenLimit?: unknown
  context_window?: unknown
  max_tokens?: unknown
  max_completion_tokens?: unknown
  max_output_tokens?: unknown
  output_token_limit?: unknown
  outputTokenLimit?: unknown
  active?: unknown
}

export interface DiscoverModelsOptions {
  /** 宿主取消会原样下沉到 Transport.fetch。 */
  signal?: AbortSignal
  /** 正数毫秒；超时中止 Transport.fetch，并抛出不含凭据的安全错误。 */
  timeoutMs?: number
  /** 某些兼容端点允许匿名发现；Groq 等明确要求鉴权的供应商应开启。 */
  requireCredential?: boolean
  /** 只返回供应商声明为 active 的模型；没有 active 字段的兼容响应仍保留。 */
  activeOnly?: boolean
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function optionalPositiveInteger(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed)
  }
  return null
}

export function parseDiscoveredModel(item: RawDiscoveredModel): DiscoveredModelItem | null {
  const modelId = optionalText(item.id)
  if (!modelId) return null
  return {
    modelId,
    displayName: optionalText(item.title) ?? optionalText(item.name) ?? modelId,
    contextWindow: optionalPositiveInteger(
      item.context_size,
      item.max_input_tokens,
      item.input_token_limit,
      item.inputTokenLimit,
      item.context_window
    ),
    maxOutputTokens: optionalPositiveInteger(
      item.max_output_tokens,
      item.output_token_limit,
      item.outputTokenLimit,
      item.max_tokens,
      item.max_completion_tokens
    ),
  }
}

export async function discoverModels(
  providerId: string,
  baseUrl: string,
  runtime: RuntimeContext,
  options: DiscoverModelsOptions = {}
): Promise<DiscoveredModelItem[]> {
  const apiKey = await runtime.credentials.get('llm', providerId)
  if (options.requireCredential && !apiKey) {
    throw new Error(`[api_key_missing] LLM provider "${providerId}" API key is not configured.`)
  }
  const url = resolveModelsEndpoint(baseUrl)
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
    Object.assign(headers, resolveProviderExtraAuthHeaders(providerId, apiKey))
  }

  const deadline = createDiscoveryDeadline(options)
  try {
    const response = await runtime.transport.fetch(url, {
      method: 'GET',
      headers,
      signal: deadline.signal,
    })
    if (!response.ok) throw new Error(`获取模型列表失败: ${response.status}`)
    const data = await response.json() as { data?: RawDiscoveredModel[] }
    return (data.data ?? [])
      .filter(item => !options.activeOnly || item.active !== false)
      .map(parseDiscoveredModel)
      .filter((item): item is DiscoveredModelItem => item !== null)
  } catch (error) {
    if (deadline.didTimeOut()) throw new Error(`获取模型列表超时: ${providerId}`)
    throw error
  } finally {
    deadline.dispose()
  }
}

function resolveModelsEndpoint(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  return normalized.endsWith('/v1') ? `${normalized}/models` : `${normalized}/v1/models`
}

function createDiscoveryDeadline(options: DiscoverModelsOptions): {
  signal: AbortSignal
  didTimeOut: () => boolean
  dispose: () => void
} {
  if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) {
    throw new Error('模型发现 timeoutMs 必须是正有限数')
  }
  const controller = new AbortController()
  const forwardAbort = (): void => controller.abort()
  if (options.signal?.aborted) controller.abort()
  else options.signal?.addEventListener('abort', forwardAbort, { once: true })
  let timedOut = false
  const timer = options.timeoutMs === undefined ? undefined : setTimeout(() => {
    timedOut = true
    controller.abort()
  }, options.timeoutMs)
  return {
    signal: controller.signal,
    didTimeOut: () => timedOut,
    dispose: () => {
      options.signal?.removeEventListener('abort', forwardAbort)
      if (timer !== undefined) clearTimeout(timer)
    },
  }
}
