import type { LlmModelConfig, LlmProviderConfig } from '@henjicc/ai-sdk'
import type { Provider } from '@/config/providers'

export type ProviderCenterCategory =
  | 'image-generation'
  | 'video-generation'
  | 'audio-generation'
  | 'speech-recognition'
  | 'ocr'
  | 'text-generation'

export interface ProviderCenterModelItem {
  id: string
  source: 'generation' | 'llm'
  providerId: string
  modelId: string
  name: string
  category: ProviderCenterCategory
  capabilityIds: string[]
  enabled: boolean
  generationModel?: Provider['models'][number]
  llmModel?: LlmModelConfig
}

export interface ProviderCenterGroup {
  id: string
  canonicalProviderId: string
  displayName: string
  credentialId: string
  generationProvider?: Provider
  llmProvider?: LlmProviderConfig
  llmProviderIds: string[]
  models: ProviderCenterModelItem[]
  enabled: boolean
  isCustom: boolean
}

export interface BuildProviderCenterGroupsInput {
  generationProviders: Provider[]
  llmProviders: LlmProviderConfig[]
  llmModels: LlmModelConfig[]
  hiddenProviders: ReadonlySet<string>
  hiddenModels: ReadonlySet<string>
}

function canonicalLlmProviderId(provider: LlmProviderConfig): string {
  return provider.setup?.kind === 'preset'
    ? provider.setup.presetId
    : provider.providerFamilyId ?? provider.providerId
}

function canMergeWithGeneration(provider: LlmProviderConfig, generationProviderId: string): boolean {
  return provider.setup?.kind === 'preset'
    && canonicalLlmProviderId(provider) === generationProviderId
    && (provider.credentialId ?? provider.providerId) === generationProviderId
}

function generationCategory(model: Provider['models'][number]): ProviderCenterCategory {
  if (model.type === 'image') return 'image-generation'
  if (model.type === 'video') return 'video-generation'
  return 'audio-generation'
}

function generationItems(
  provider: Provider,
  hiddenProviders: ReadonlySet<string>,
  hiddenModels: ReadonlySet<string>,
): ProviderCenterModelItem[] {
  return provider.models.map((model) => {
    const category = generationCategory(model)
    return {
      id: `generation:${provider.id}:${model.id}`,
      source: 'generation',
      providerId: provider.id,
      modelId: model.id,
      name: model.name,
      category,
      capabilityIds: [category],
      enabled: !hiddenProviders.has(provider.id) && !hiddenModels.has(`${provider.id}-${model.id}`),
      generationModel: model,
    }
  })
}

function llmItems(provider: LlmProviderConfig, models: LlmModelConfig[]): ProviderCenterModelItem[] {
  return models
    .filter(model => model.providerId === provider.providerId)
    .map(model => ({
      id: `llm:${provider.providerId}:${model.modelId}`,
      source: 'llm',
      providerId: provider.providerId,
      modelId: model.modelId,
      name: model.displayName,
      category: 'text-generation',
      capabilityIds: ['text-generation'],
      enabled: provider.enabled && model.enabled,
      llmModel: model,
    }))
}

export function buildProviderCenterGroups(input: BuildProviderCenterGroupsInput): ProviderCenterGroup[] {
  const generationIds = new Set(input.generationProviders.map(provider => provider.id))
  const groups = input.generationProviders.map<ProviderCenterGroup>((provider) => {
    const llmProvider = input.llmProviders.find(candidate => canMergeWithGeneration(candidate, provider.id))
    const models = [
      ...generationItems(provider, input.hiddenProviders, input.hiddenModels),
      ...(llmProvider ? llmItems(llmProvider, input.llmModels) : []),
    ]
    return {
      id: `provider:${provider.id}`,
      canonicalProviderId: provider.id,
      displayName: provider.name,
      credentialId: provider.id,
      generationProvider: provider,
      llmProvider,
      llmProviderIds: llmProvider ? [llmProvider.providerId] : [],
      models,
      // 供应商只要还有一种能力在用，就应显示为启用；不能因为 LLM 被停用，就把仍在使用的
      // 生成模型供应商标成“整体停用”。用户主动切总开关时，调用方会同时更新两侧。
      enabled: !input.hiddenProviders.has(provider.id) || llmProvider?.enabled === true,
      isCustom: false,
    }
  })

  for (const provider of input.llmProviders) {
    const canonicalId = canonicalLlmProviderId(provider)
    if (generationIds.has(canonicalId) && canMergeWithGeneration(provider, canonicalId)) continue
    groups.push({
      id: `llm:${provider.providerId}`,
      canonicalProviderId: canonicalId,
      displayName: provider.displayName,
      credentialId: provider.credentialId ?? provider.providerId,
      llmProvider: provider,
      llmProviderIds: [provider.providerId],
      models: llmItems(provider, input.llmModels),
      enabled: provider.enabled,
      isCustom: provider.setup?.kind === 'custom',
    })
  }

  return groups
}

export function countProviderCategories(models: readonly ProviderCenterModelItem[]): Record<string, number> {
  return models.reduce<Record<string, number>>((counts, model) => {
    counts[model.category] = (counts[model.category] ?? 0) + 1
    return counts
  }, {})
}

export function migrateLegacyTypeVisibility(
  providers: readonly Provider[],
  hiddenTypes: ReadonlySet<string>,
  hiddenModels: ReadonlySet<string>,
): Set<string> {
  const migrated = new Set(hiddenModels)
  if (hiddenTypes.size === 0) return migrated
  for (const provider of providers) {
    for (const model of provider.models) {
      if (hiddenTypes.has(model.type)) migrated.add(`${provider.id}-${model.id}`)
    }
  }
  return migrated
}
