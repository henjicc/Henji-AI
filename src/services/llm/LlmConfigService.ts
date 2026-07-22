import { createLogger } from '@/core/logging'
import {
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_DEEPSEEK_MODEL_ID,
  DEFAULT_DEEPSEEK_PROVIDER_ID,
  DEFAULT_PPIO_BASE_URL,
  DEFAULT_PPIO_MODEL_ID,
  DEFAULT_PPIO_PROVIDER_ID,
  DEFAULT_PROMPT_PROFILE_ID,
  createBuiltInLlmModels,
  createBuiltInLlmProviders,
  createDefaultProviderReasoning,
  createDefaultLlmConfig,
} from '@/core/llm/defaults'
import { normalizePromptOptimizationProfileDocuments } from '@/core/llm/promptOptimization'
import { LLM_CONFIG_CHANGED_EVENT } from '@/core/llm/events'
import type {
  LlmCapabilities,
  LlmConfigState,
  LlmModelConfig,
  LlmProviderConfig,
  LlmReasoningConfig,
  LlmReasoningEffort,
  PromptOptimizationProfile,
} from '@/core/llm/types'
import { readJsonFromAppData, writeJsonToAppData } from '@/utils/save'

const logger = createLogger('services.llm.LlmConfigService')
const LLM_CONFIG_FILE = 'llm-config.json'

function normalizeBaseUrl(baseUrl?: string): string | undefined {
  const trimmed = baseUrl?.trim()
  return trimmed ? trimmed.replace(/\/+$/, '') : undefined
}

function normalizeAdapter(adapter: string, providerId: string): string {
  const normalized = adapter.trim().toLowerCase()
  if (providerId.trim().toLowerCase() === DEFAULT_DEEPSEEK_PROVIDER_ID) {
    return DEFAULT_DEEPSEEK_PROVIDER_ID
  }
  return normalized || 'openai'
}

function resolveProviderBaseUrl(provider: LlmProviderConfig): string | undefined {
  const normalized = normalizeBaseUrl(provider.baseUrl)
  if (provider.providerId.trim().toLowerCase() === DEFAULT_DEEPSEEK_PROVIDER_ID) {
    return normalized ?? DEFAULT_DEEPSEEK_BASE_URL
  }
  if (provider.providerId.trim().toLowerCase() === DEFAULT_PPIO_PROVIDER_ID) {
    return normalized ?? DEFAULT_PPIO_BASE_URL
  }
  return normalized
}

function normalizeCapabilities(capabilities?: Partial<LlmCapabilities>): LlmCapabilities {
  return {
    text: capabilities?.text !== false,
    image: capabilities?.image === true,
    video: capabilities?.video === true,
    audio: capabilities?.audio === true,
    streaming: capabilities?.streaming !== false,
    toolCall: capabilities?.toolCall === true,
    jsonOutput: capabilities?.jsonOutput === true,
  }
}

function normalizeReasoningEffort(value?: string): LlmReasoningEffort | null {
  if (value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh' || value === 'max') {
    return value
  }
  return null
}

function normalizeReasoningConfig(
  reasoning: Partial<LlmReasoningConfig> | undefined,
  adapter: string
): LlmReasoningConfig {
  const defaults = createDefaultProviderReasoning(adapter)
  return {
    enabled: reasoning?.enabled ?? defaults.enabled,
    effort: normalizeReasoningEffort(reasoning?.effort) ?? defaults.effort,
  }
}

function normalizeProvider(provider: LlmProviderConfig): LlmProviderConfig {
  const adapter = normalizeAdapter(provider.adapter, provider.providerId)
  return {
    ...provider,
    providerId: provider.providerId.trim(),
    displayName: provider.displayName.trim(),
    adapter,
    baseUrl: resolveProviderBaseUrl(provider),
    reasoning: normalizeReasoningConfig(provider.reasoning, adapter),
    reasoningConfigurable: provider.reasoningConfigurable !== false,
    enabled: provider.enabled !== false,
  }
}

function normalizeModel(model: LlmModelConfig, providers: LlmProviderConfig[]): LlmModelConfig {
  const provider = providers.find(item => item.providerId === model.providerId)
  const adapter = provider?.adapter ?? model.adapter
  const baseUrl = normalizeBaseUrl(model.baseUrl) ?? provider?.baseUrl
  return {
    ...model,
    providerId: model.providerId.trim(),
    modelId: model.modelId.trim(),
    displayName: model.displayName.trim(),
    adapter: normalizeAdapter(adapter, model.providerId),
    baseUrl,
    capabilities: normalizeCapabilities(model.capabilities),
    enabled: model.enabled !== false,
  }
}

function normalizeProfile(profile: PromptOptimizationProfile): PromptOptimizationProfile {
  return normalizePromptOptimizationProfileDocuments({
    ...profile,
    enabled: profile.enabled !== false,
    isDefault: profile.isDefault === true,
    capabilities: {
      text: profile.capabilities?.text !== false,
      image: profile.capabilities?.image === true,
      video: profile.capabilities?.video === true,
    },
  })
}

function resolveSelectedPromptProfileId(
  selectedPromptProfileId: string | undefined,
  promptProfiles: PromptOptimizationProfile[]
): string | undefined {
  const trimmed = selectedPromptProfileId?.trim()
  if (trimmed && promptProfiles.some(profile => profile.id === trimmed)) {
    return trimmed
  }
  return promptProfiles[0]?.id
}

function normalizeConfig(input: Partial<LlmConfigState> | null): LlmConfigState {
  const defaults = createDefaultLlmConfig()
  if (!input) return defaults

  const providers = ensureBuiltInProviders(
    (input.providers?.length ? input.providers : defaults.providers).map(normalizeProvider)
  )
  const models = ensureBuiltInModels(
    (input.models?.length ? input.models : defaults.models).map(model => normalizeModel(model, providers)),
    providers
  )
  const promptProfiles = (input.promptProfiles ?? defaults.promptProfiles)
    .map(normalizeProfile)
    .map(profile => {
      const pointsToDeprecatedDefault = profile.providerId === 'openai' && profile.modelId === 'gpt-4o-mini'
      const pointsToDeprecatedDeepSeek = profile.providerId === DEFAULT_DEEPSEEK_PROVIDER_ID
        && ['deepseek-chat', 'deepseek-reasoner'].includes(profile.modelId)
      if (pointsToDeprecatedDefault || pointsToDeprecatedDeepSeek) {
        return {
          ...profile,
          providerId: DEFAULT_PPIO_PROVIDER_ID,
          modelId: DEFAULT_PPIO_MODEL_ID,
        }
      }
      const isOldBuiltInDefault = profile.id === DEFAULT_PROMPT_PROFILE_ID
        && profile.providerId === DEFAULT_DEEPSEEK_PROVIDER_ID
        && profile.modelId === DEFAULT_DEEPSEEK_MODEL_ID
      if (isOldBuiltInDefault) {
        return {
          ...profile,
          providerId: DEFAULT_PPIO_PROVIDER_ID,
          modelId: DEFAULT_PPIO_MODEL_ID,
        }
      }
      return profile
    })
  if (!promptProfiles.some(profile => profile.isDefault && profile.enabled)) {
    const firstEnabled = promptProfiles.find(profile => profile.enabled)
    if (firstEnabled) {
      firstEnabled.isDefault = true
    }
  }

  return {
    providers,
    models,
    promptProfiles: promptProfiles.length ? promptProfiles : defaults.promptProfiles,
    selectedPromptProfileId: resolveSelectedPromptProfileId(
      input.selectedPromptProfileId,
      promptProfiles.length ? promptProfiles : defaults.promptProfiles
    ),
    tools: input.tools ?? defaults.tools,
    policy: input.policy ?? defaults.policy,
    memory: input.memory ?? defaults.memory,
  }
}

function emitConfigChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(LLM_CONFIG_CHANGED_EVENT))
}

function ensureBuiltInProviders(providers: LlmProviderConfig[]): LlmProviderConfig[] {
  const builtIns = createBuiltInLlmProviders()
  const nextProviders = [...providers]

  builtIns.forEach((builtIn) => {
    const index = nextProviders.findIndex(provider => provider.providerId === builtIn.providerId)
    if (index < 0) {
      nextProviders.push(builtIn)
      return
    }
    nextProviders[index] = {
      ...builtIn,
      ...nextProviders[index],
      adapter: builtIn.providerId === DEFAULT_DEEPSEEK_PROVIDER_ID
        ? DEFAULT_DEEPSEEK_PROVIDER_ID
        : nextProviders[index].adapter || builtIn.adapter,
      baseUrl: nextProviders[index].baseUrl ?? builtIn.baseUrl,
      reasoningConfigurable: nextProviders[index].reasoningConfigurable ?? builtIn.reasoningConfigurable,
    }
  })

  return nextProviders
}

function ensureBuiltInModels(models: LlmModelConfig[], providers: LlmProviderConfig[]): LlmModelConfig[] {
  const defaults = createBuiltInLlmModels()
  const withoutDeprecated = models.filter(model => !(
    model.providerId === DEFAULT_DEEPSEEK_PROVIDER_ID
    && ['deepseek-chat', 'deepseek-reasoner'].includes(model.modelId)
  ))
  const nextModels = [...withoutDeprecated]
  defaults.forEach(defaultModel => {
    const exists = nextModels.some(model => (
      model.providerId === defaultModel.providerId && model.modelId === defaultModel.modelId
    ))
    if (!exists) {
      nextModels.push(defaultModel)
    }
  })
  return nextModels.map(model => normalizeModel(model, providers))
}

export class LlmConfigService {
  async getConfig(): Promise<LlmConfigState> {
    const stored = await readJsonFromAppData<Partial<LlmConfigState>>(LLM_CONFIG_FILE)
    return normalizeConfig(stored)
  }

  async saveConfig(config: LlmConfigState): Promise<void> {
    const nextConfig = normalizeConfig(config)
    await writeJsonToAppData(LLM_CONFIG_FILE, nextConfig)
    emitConfigChanged()
  }

  async getDefaultPromptProfile(): Promise<PromptOptimizationProfile | null> {
    const config = await this.getConfig()
    return config.promptProfiles.find(profile => profile.enabled && profile.isDefault)
      ?? config.promptProfiles.find(profile => profile.enabled)
      ?? null
  }

  async upsertPromptProfile(profile: PromptOptimizationProfile): Promise<LlmConfigState> {
    const config = await this.getConfig()
    const now = new Date().toISOString()
    const nextProfile = normalizeProfile({
      ...profile,
      updatedAt: now,
      createdAt: profile.createdAt || now,
    })
    const nextProfiles = config.promptProfiles.filter(item => item.id !== nextProfile.id)
    if (nextProfile.isDefault) {
      nextProfiles.forEach(item => { item.isDefault = false })
    }
    nextProfiles.push(nextProfile)
    const nextConfig = { ...config, promptProfiles: nextProfiles }
    await this.saveConfig(nextConfig)
    return nextConfig
  }

  async deletePromptProfile(profileId: string): Promise<LlmConfigState> {
    const config = await this.getConfig()
    const nextProfiles = config.promptProfiles.filter(profile => profile.id !== profileId)
    const nextConfig = normalizeConfig({ ...config, promptProfiles: nextProfiles })
    await this.saveConfig(nextConfig)
    return nextConfig
  }

  async setDefaultPromptProfile(profileId: string): Promise<LlmConfigState> {
    const config = await this.getConfig()
    const nextProfiles = config.promptProfiles.map(profile => ({
      ...profile,
      isDefault: profile.id === profileId,
    }))
    const nextConfig = normalizeConfig({ ...config, promptProfiles: nextProfiles })
    await this.saveConfig(nextConfig)
    return nextConfig
  }

  async upsertProvider(provider: LlmProviderConfig): Promise<LlmConfigState> {
    const config = await this.getConfig()
    const nextProvider = normalizeProvider(provider)
    const nextProviders = config.providers.filter(item => item.providerId !== nextProvider.providerId)
    nextProviders.push(nextProvider)
    const nextConfig = normalizeConfig({ ...config, providers: nextProviders })
    await this.saveConfig(nextConfig)
    return nextConfig
  }

  async upsertModel(model: LlmModelConfig): Promise<LlmConfigState> {
    const config = await this.getConfig()
    const nextModel = normalizeModel(model, config.providers)
    const nextModels = config.models.filter(item => !(item.providerId === nextModel.providerId && item.modelId === nextModel.modelId))
    nextModels.push(nextModel)
    const nextConfig = normalizeConfig({ ...config, models: nextModels })
    await this.saveConfig(nextConfig)
    return nextConfig
  }

  async setProviderEnabled(providerId: string, enabled: boolean): Promise<LlmConfigState> {
    const config = await this.getConfig()
    const nextProviders = config.providers.map(provider => (
      provider.providerId === providerId
        ? { ...provider, enabled }
        : provider
    ))
    const nextConfig = normalizeConfig({ ...config, providers: nextProviders })
    await this.saveConfig(nextConfig)
    return nextConfig
  }

  async setModelEnabled(providerId: string, modelId: string, enabled: boolean): Promise<LlmConfigState> {
    const config = await this.getConfig()
    const nextModels = config.models.map(model => (
      model.providerId === providerId && model.modelId === modelId
        ? { ...model, enabled }
        : model
    ))
    const nextConfig = normalizeConfig({ ...config, models: nextModels })
    await this.saveConfig(nextConfig)
    return nextConfig
  }

  async deleteModel(providerId: string, modelId: string): Promise<LlmConfigState> {
    const config = await this.getConfig()
    const nextModels = config.models.filter(model => !(model.providerId === providerId && model.modelId === modelId))
    const nextConfig = normalizeConfig({ ...config, models: nextModels })
    await this.saveConfig(nextConfig)
    return nextConfig
  }
}

let instance: LlmConfigService | null = null

export function getLlmConfigService(): LlmConfigService {
  if (!instance) {
    instance = new LlmConfigService()
  }
  return instance
}

export const llmConfigService = getLlmConfigService()

export function getErrorMessage(error: DynamicValue): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  logger.error('[LlmConfigService] Unknown error', error)
  return 'Unknown error'
}
