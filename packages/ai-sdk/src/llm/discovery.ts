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
  max_tokens?: unknown
  max_output_tokens?: unknown
  output_token_limit?: unknown
  outputTokenLimit?: unknown
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
      item.inputTokenLimit
    ),
    maxOutputTokens: optionalPositiveInteger(
      item.max_output_tokens,
      item.output_token_limit,
      item.outputTokenLimit,
      item.max_tokens
    ),
  }
}

export async function discoverModels(
  providerId: string,
  baseUrl: string,
  runtime: RuntimeContext
): Promise<DiscoveredModelItem[]> {
  const apiKey = await runtime.credentials.get('llm', providerId)
  const url = resolveModelsEndpoint(baseUrl)
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
    Object.assign(headers, resolveProviderExtraAuthHeaders(providerId, apiKey))
  }

  const response = await runtime.transport.fetch(url, { method: 'GET', headers })
  if (!response.ok) throw new Error(`获取模型列表失败: ${response.status}`)
  const data = await response.json() as { data?: RawDiscoveredModel[] }
  return (data.data ?? [])
    .map(parseDiscoveredModel)
    .filter((item): item is DiscoveredModelItem => item !== null)
}

function resolveModelsEndpoint(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  return normalized.endsWith('/v1') ? `${normalized}/models` : `${normalized}/v1/models`
}
