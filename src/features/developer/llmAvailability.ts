import { LLM_PROVIDER_PRESETS } from '@henjicc/ai-sdk'
import { llmGetProviderKeyStatus } from '@/commands/llmRuntime'
import { llmConfigService } from '@/services/llm'
import { fetchOpenAiCompatibleModels } from '@/services/llm/llmDiscoveryService'

export interface LlmAvailability {
  /** `${providerId}:${modelId}` → 供应商的模型列表里有没有这个模型 */
  listed: ReadonlyMap<string, boolean>
  /** 读不到模型列表的供应商与原因（没配密钥的不读） */
  errors: ReadonlyMap<string, string>
}

export const llmAvailabilityKey = (providerId: string, modelId: string): string => `${providerId}:${modelId}`

/**
 * 用已配密钥读各供应商的模型列表（不收费），核对预设推荐的模型是否还在：下架或改名的模型会从列表里消失。
 * 只读设置里已经建好、配了密钥的供应商。
 */
export async function checkLlmAvailability(): Promise<LlmAvailability> {
  const config = await llmConfigService.getConfig()
  const credentialOf = (provider: (typeof config.providers)[number]): string => provider.credentialId ?? provider.providerId
  const statuses = await llmGetProviderKeyStatus(config.providers.map(credentialOf))
  const configured = new Set(statuses.filter((item) => item.configured).map((item) => item.credentialId))
  const listed = new Map<string, boolean>()
  const errors = new Map<string, string>()
  for (const preset of LLM_PROVIDER_PRESETS) {
    const provider = config.providers.find((item) => item.providerId === preset.providerId && configured.has(credentialOf(item)))
    if (!provider) continue
    try {
      const available = new Set((await fetchOpenAiCompatibleModels(provider)).map((item) => item.modelId.toLowerCase()))
      for (const modelId of preset.modelIds) listed.set(llmAvailabilityKey(preset.providerId, modelId), available.has(modelId.toLowerCase()))
    } catch (error) {
      errors.set(preset.providerId, error instanceof Error ? error.message : String(error))
    }
  }
  return { listed, errors }
}
