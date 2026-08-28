import { createLogger } from '@/core/logging'
import {
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_DEEPSEEK_PROVIDER_ID,
  DEFAULT_PPIO_BASE_URL,
  DEFAULT_PPIO_PROVIDER_ID,
  DEFAULT_AGENT_PROFILE_ID,
  createBuiltInLlmModels,
  createDefaultProviderReasoning,
  createDefaultLlmConfig,
} from '@/core/llm/defaults'
import { LLM_CONFIG_CHANGED_EVENT } from '@/core/llm/events'
import { applyLlmModelCatalogEntry, findLlmModelCatalogEntry } from '@henjicc/ai-sdk'
import {
  normalizeLlmProviderSetup,
  resolveLlmEndpointIdentity,
} from '@henjicc/ai-sdk'
import type {
  AgentModelCapabilityVerification,
  AgentModelProfile,
  AgentModelReference,
  LlmCapabilities,
  LlmConfigState,
  LlmModelConfig,
  LlmProviderConfig,
  LlmReasoningConfig,
  LlmReasoningEffort,
  PromptOptimizationProfile,
} from '@henjicc/ai-sdk'
import {
  llmCommitProviderSettings,
  llmDeleteProviderSettings,
  llmReadConfig,
  llmWriteConfig,
} from '@/commands/llmRuntime'
import type { LlmCredentialMutationDto, LlmProviderSettingsResultDto } from '@/platform/contracts/llmRuntime'
import {
  normalizePromptProfile,
  normalizePromptProfileWithBuiltInMigration,
  normalizeTextProcessingPromptTemplates,
} from './promptConfigurationNormalization'

const logger = createLogger('services.llm.LlmConfigService')

function normalizeBaseUrl(baseUrl?: string): string | undefined {
  const trimmed = baseUrl?.trim()
  return trimmed ? trimmed.replace(/\/+$/, '') : undefined
}

function normalizeAdapter(adapter: string, providerId: string): string {
  const normalized = adapter.trim().toLowerCase()
  if (providerId.trim().toLowerCase() === DEFAULT_DEEPSEEK_PROVIDER_ID) {
    return DEFAULT_DEEPSEEK_PROVIDER_ID
  }
  /*
   * 存量的 `anthropic` 收敛成 `openai`。
   *
   * 这个选项从来没有对应的运行时实现，选中它发出去的一直是 Chat Completions 请求，
   * 只有设置页预览文案显示成 `/v1/messages`。留着它只会让用户以为自己走的是 Anthropic 协议。
   */
  if (normalized === 'anthropic') return 'openai'
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
  const configuredMode = capabilities?.structuredOutputMode
  const structuredOutputMode = configuredMode === 'json' || configuredMode === 'schema' || configuredMode === 'none'
    ? configuredMode
    : capabilities?.jsonOutput === true ? 'json' : 'none'
  return {
    text: capabilities?.text !== false,
    image: capabilities?.image === true,
    video: capabilities?.video === true,
    audio: capabilities?.audio === true,
    streaming: capabilities?.streaming !== false,
    toolCall: capabilities?.toolCall === true,
    parallelTools: capabilities?.parallelTools === true,
    jsonOutput: capabilities?.jsonOutput === true || structuredOutputMode !== 'none',
    structuredOutputMode,
    reasoning: capabilities?.reasoning === true,
    sampling: capabilities?.sampling !== false,
    contextWindow: typeof capabilities?.contextWindow === 'number' ? capabilities.contextWindow : null,
    maxOutputTokens: typeof capabilities?.maxOutputTokens === 'number' ? capabilities.maxOutputTokens : null,
    usage: capabilities?.usage !== false,
  }
}

function normalizeAgentModelReference(
  reference: AgentModelReference | undefined,
  fallback?: AgentModelReference
): AgentModelReference | undefined {
  const providerId = reference?.providerId?.trim()
  const modelId = reference?.modelId?.trim()
  if (providerId && modelId) return { providerId, modelId }
  return fallback
}

function normalizeVerification(value: AgentModelCapabilityVerification): AgentModelCapabilityVerification {
  return {
    ...value,
    providerId: value.providerId.trim(),
    modelId: value.modelId.trim(),
    checks: Array.isArray(value.checks) ? value.checks : [],
    cost: value.cost?.status === 'known' ? value.cost : { status: 'unknown' },
  }
}

function normalizeAgentProfile(profile: AgentModelProfile, fallback: AgentModelProfile): AgentModelProfile {
  const primary = normalizeAgentModelReference(profile.primary, fallback.primary) ?? fallback.primary
  return {
    ...fallback,
    ...profile,
    id: profile.id?.trim() || DEFAULT_AGENT_PROFILE_ID,
    name: profile.name?.trim() || '智能助手',
    primary,
    router: normalizeAgentModelReference(profile.router),
    summarizer: normalizeAgentModelReference(profile.summarizer),
    fallback: normalizeAgentModelReference(profile.fallback),
    observer: normalizeAgentModelReference(profile.observer),
    settings: {
      timeoutMs: Math.max(1_000, profile.settings?.timeoutMs ?? fallback.settings.timeoutMs),
      maxRetries: Math.min(5, Math.max(0, profile.settings?.maxRetries ?? fallback.settings.maxRetries)),
      maxOutputTokens: Math.max(1, profile.settings?.maxOutputTokens ?? fallback.settings.maxOutputTokens),
      contextWindowBudget: Math.max(1, profile.settings?.contextWindowBudget ?? fallback.settings.contextWindowBudget),
      temperature: profile.settings?.temperature,
    },
    verifications: (profile.verifications ?? []).map(normalizeVerification),
    createdAt: profile.createdAt || fallback.createdAt,
    updatedAt: profile.updatedAt || fallback.updatedAt,
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
  const baseUrl = resolveProviderBaseUrl(provider)
  const normalizedProviderId = provider.providerId.trim().toLowerCase()
  const setup = provider.setup
    ? normalizeLlmProviderSetup(provider.setup)
    : normalizedProviderId === DEFAULT_PPIO_PROVIDER_ID && baseUrl === DEFAULT_PPIO_BASE_URL
      ? { kind: 'preset' as const, presetId: DEFAULT_PPIO_PROVIDER_ID, lifecycle: 'builtin' as const }
      : normalizedProviderId === DEFAULT_DEEPSEEK_PROVIDER_ID && baseUrl === DEFAULT_DEEPSEEK_BASE_URL
        ? { kind: 'preset' as const, presetId: DEFAULT_DEEPSEEK_PROVIDER_ID, lifecycle: 'builtin' as const }
        : { kind: 'custom' as const }
  const identity = resolveLlmEndpointIdentity({ ...provider, baseUrl })
  return {
    ...provider,
    providerId: identity.providerId,
    providerFamilyId: identity.providerFamilyId,
    endpointProfile: identity.endpointProfile,
    credentialId: identity.credentialId,
    setup,
    displayName: provider.displayName.trim(),
    adapter,
    apiProtocol: provider.apiProtocol ?? 'openai-compatible',
    baseUrl: identity.baseUrl,
    reasoning: normalizeReasoningConfig(provider.reasoning, adapter),
    reasoningConfigurable: provider.reasoningConfigurable !== false,
    enabled: provider.enabled !== false,
  }
}

/**
 * 给还没按内置目录标注过的模型补一次标注。
 *
 * 只在 `catalogId` 为空时执行一次并盖上戳：目录是"添加时替用户省掉手工勾选"，不是"每次保存都把
 * 用户改回去"。已经盖过戳的配置一律原样保留，用户后来关掉某项能力的选择必须活下来。
 */
function applyModelCatalogOnce(model: LlmModelConfig): LlmModelConfig {
  if (model.catalogId) return model
  const entry = findLlmModelCatalogEntry(model.modelId)
  if (!entry) return model
  return {
    ...model,
    capabilities: applyLlmModelCatalogEntry(model.capabilities, entry),
    catalogId: entry.id,
  }
}

function normalizeModel(model: LlmModelConfig, providers: LlmProviderConfig[]): LlmModelConfig {
  const provider = providers.find(item => item.providerId === model.providerId)
  const adapter = provider?.adapter ?? model.adapter
  const baseUrl = normalizeBaseUrl(model.baseUrl) ?? provider?.baseUrl
  const withCatalog = applyModelCatalogOnce({ ...model, modelId: model.modelId.trim() })
  return {
    ...withCatalog,
    providerId: model.providerId.trim(),
    providerFamilyId: provider?.providerFamilyId ?? model.providerFamilyId,
    endpointProfile: provider?.endpointProfile ?? model.endpointProfile,
    credentialId: provider?.credentialId ?? model.credentialId ?? model.providerId.trim(),
    displayName: model.displayName.trim(),
    adapter: normalizeAdapter(adapter, model.providerId),
    apiProtocol: model.apiProtocol ?? provider?.apiProtocol ?? 'openai-compatible',
    baseUrl,
    capabilities: normalizeCapabilities(withCatalog.capabilities),
    enabled: model.enabled !== false,
  }
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

export function normalizeLlmConfig(input: Partial<LlmConfigState> | null): LlmConfigState {
  const defaults = createDefaultLlmConfig()
  if (!input) return defaults

  const providers = (input.providers ?? []).map(normalizeProvider)
  const models = removeDeprecatedBuiltInModels(input.models ?? [])
    .map(upgradeBuiltInModelCapabilities)
    .map(model => normalizeModel(model, providers))
  /*
   * 归一化不改写提示词优化方案指向的供应商与模型。
   *
   * 旧实现按「供应商 + 模型 id」硬编码了几条迁移规则，每次保存都会重跑：用户在配置面板把
   * 供应商切到 DeepSeek，自动补选的模型正好命中迁移条件，保存时又被改回派欧云，表现为供应商
   * 根本切不动。指向失效模型的存量方案改由 `promptOptimizationReadiness` 按可用性重新选择。
   */
  const promptProfiles = (input.promptProfiles ?? defaults.promptProfiles)
    .map(normalizePromptProfileWithBuiltInMigration)
  const textProcessingPromptTemplates = normalizeTextProcessingPromptTemplates(input.textProcessingPromptTemplates)
  if (!promptProfiles.some(profile => profile.isDefault && profile.enabled)) {
    const firstEnabled = promptProfiles.find(profile => profile.enabled)
    if (firstEnabled) {
      firstEnabled.isDefault = true
    }
  }
  const defaultAgentProfile = defaults.agentProfiles[0]
  const agentProfiles = (input.agentProfiles?.length ? input.agentProfiles : [defaultAgentProfile])
    .map(profile => normalizeAgentProfile(profile, defaultAgentProfile))
  const selectedAgentProfileId = input.selectedAgentProfileId?.trim()
  const resolvedAgentProfileId = selectedAgentProfileId && agentProfiles.some(profile => profile.id === selectedAgentProfileId)
    ? selectedAgentProfileId
    : agentProfiles[0]?.id

  return {
    providers,
    models,
    promptProfiles: promptProfiles.length ? promptProfiles : defaults.promptProfiles,
    selectedPromptProfileId: resolveSelectedPromptProfileId(
      input.selectedPromptProfileId,
      promptProfiles.length ? promptProfiles : defaults.promptProfiles
    ),
    textProcessingPromptTemplates,
    agentProfiles,
    selectedAgentProfileId: resolvedAgentProfileId,
    tools: input.tools ?? defaults.tools,
    policy: input.policy ?? defaults.policy,
    memory: input.memory ?? defaults.memory,
  }
}

function emitConfigChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(LLM_CONFIG_CHANGED_EVENT))
}

function removeDeprecatedBuiltInModels(models: LlmModelConfig[]): LlmModelConfig[] {
  return models.filter(model => !(
    model.providerId === DEFAULT_DEEPSEEK_PROVIDER_ID
    && ['deepseek-chat', 'deepseek-reasoner'].includes(model.modelId)
  ))
}

function upgradeBuiltInModelCapabilities(model: LlmModelConfig): LlmModelConfig {
  const builtIn = createBuiltInLlmModels().find(item => (
    item.providerId === model.providerId && item.modelId === model.modelId
  ))
  if (!builtIn) return model
  return {
    ...model,
    capabilities: {
      ...model.capabilities,
      contextWindow: builtIn.capabilities.contextWindow ?? model.capabilities.contextWindow,
      maxOutputTokens: builtIn.capabilities.maxOutputTokens ?? model.capabilities.maxOutputTokens,
    },
  }
}

export class LlmConfigService {
  async getConfig(): Promise<LlmConfigState> {
    const stored = await llmReadConfig()
    return normalizeLlmConfig(stored)
  }

  async saveConfig(config: LlmConfigState): Promise<void> {
    const nextConfig = normalizeLlmConfig(config)
    await llmWriteConfig(nextConfig)
    emitConfigChanged()
  }

  async commitProviderSettings(
    provider: LlmProviderConfig,
    seedModels: LlmModelConfig[],
    credential: LlmCredentialMutationDto,
  ): Promise<LlmProviderSettingsResultDto> {
    const baselineConfig = await this.getConfig()
    const normalizedProvider = normalizeProvider(provider)
    const normalizedModels = seedModels.map(model => normalizeModel(model, [normalizedProvider]))
    const result = await llmCommitProviderSettings({
      provider: normalizedProvider,
      seedModels: normalizedModels,
      baselineConfig,
      credential,
    })
    const normalizedResult = { ...result, config: normalizeLlmConfig(result.config) }
    emitConfigChanged()
    return normalizedResult
  }

  async deleteProviderSettings(providerId: string): Promise<LlmProviderSettingsResultDto> {
    const result = await llmDeleteProviderSettings({
      providerId,
      baselineConfig: await this.getConfig(),
    })
    const normalizedResult = { ...result, config: normalizeLlmConfig(result.config) }
    emitConfigChanged()
    return normalizedResult
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
    const nextProfile = normalizePromptProfile({
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
    const nextConfig = normalizeLlmConfig({ ...config, promptProfiles: nextProfiles })
    await this.saveConfig(nextConfig)
    return nextConfig
  }

  async setDefaultPromptProfile(profileId: string): Promise<LlmConfigState> {
    const config = await this.getConfig()
    const nextProfiles = config.promptProfiles.map(profile => ({
      ...profile,
      isDefault: profile.id === profileId,
    }))
    const nextConfig = normalizeLlmConfig({ ...config, promptProfiles: nextProfiles })
    await this.saveConfig(nextConfig)
    return nextConfig
  }

  async upsertProvider(provider: LlmProviderConfig): Promise<LlmConfigState> {
    return (await this.commitProviderSettings(provider, [], { kind: 'unchanged' })).config
  }

  async upsertModel(model: LlmModelConfig): Promise<LlmConfigState> {
    const config = await this.getConfig()
    const nextModel = normalizeModel(model, config.providers)
    const nextModels = config.models.filter(item => !(item.providerId === nextModel.providerId && item.modelId === nextModel.modelId))
    nextModels.push(nextModel)
    const nextConfig = normalizeLlmConfig({ ...config, models: nextModels })
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
    const nextConfig = normalizeLlmConfig({ ...config, providers: nextProviders })
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
    const nextConfig = normalizeLlmConfig({ ...config, models: nextModels })
    await this.saveConfig(nextConfig)
    return nextConfig
  }

  async deleteModel(providerId: string, modelId: string): Promise<LlmConfigState> {
    const config = await this.getConfig()
    const nextModels = config.models.filter(model => !(model.providerId === providerId && model.modelId === modelId))
    const nextConfig = normalizeLlmConfig({ ...config, models: nextModels })
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
