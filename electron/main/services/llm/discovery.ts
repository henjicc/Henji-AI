import { getLlmProviderApiKey } from '../keystore'

export interface DiscoveredModelItem {
  modelId: string
  displayName: string
}

export async function discoverModels(
  providerId: string,
  baseUrl: string
): Promise<DiscoveredModelItem[]> {
  const apiKey = getLlmProviderApiKey(providerId)
  const url = resolveModelsEndpoint(baseUrl)
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`

  const response = await fetch(url, { method: 'GET', headers })
  if (!response.ok) throw new Error(`获取模型列表失败: ${response.status}`)
  const data = await response.json() as { data?: Array<{ id?: string; title?: string; name?: string }> }
  return (data.data ?? [])
    .map(item => {
      const modelId = item.id?.trim()
      if (!modelId) return null
      return { modelId, displayName: item.title?.trim() || item.name?.trim() || modelId }
    })
    .filter((item): item is DiscoveredModelItem => item !== null)
}

function resolveModelsEndpoint(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  return normalized.endsWith('/v1') ? `${normalized}/models` : `${normalized}/v1/models`
}
