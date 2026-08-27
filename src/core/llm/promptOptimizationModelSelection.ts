import type { LlmConfigState, LlmModelConfig, PromptOptimizationProfile } from '@henjicc/ai-sdk'

/**
 * 提示词优化的模型选择策略。
 *
 * 这里只做纯计算：判断哪些模型可用、按什么顺序挑一个。密钥状态由调用方查好后传进来
 * （`configuredProviderIds`），避免核心逻辑依赖 IPC，也让选择规则可以直接被测试覆盖。
 *
 * 规则：
 * 1. 可用模型 = 供应商已启用且已配置密钥 + 模型本身已启用
 * 2. 优先选第一个支持视觉输入的模型（提示词优化可能要带图片或视频），没有则退回第一个可用模型
 * 3. 一个可用模型都没有时返回 null，由调用方决定留空并引导用户去配置
 */
export interface PromptOptimizationModelSource {
  providers: LlmConfigState['providers']
  models: LlmConfigState['models']
  /** 已配置密钥的供应商 id；`undefined` 表示密钥状态未知，此时不按密钥过滤 */
  configuredProviderIds?: readonly string[]
}

export type PromptOptimizationModelReference = Pick<PromptOptimizationProfile, 'providerId' | 'modelId'>

export function supportsPromptOptimizationVisionInput(model: LlmModelConfig): boolean {
  return model.capabilities.image === true || model.capabilities.video === true
}

export function listPromptOptimizationModelCandidates(
  source: PromptOptimizationModelSource,
  providerId?: string,
): LlmModelConfig[] {
  const configuredProviderIds = source.configuredProviderIds
    ? new Set(source.configuredProviderIds)
    : null
  const usableProviderIds = new Set(
    source.providers
      .filter((provider) => (
        provider.enabled
        && (configuredProviderIds === null || configuredProviderIds.has(provider.providerId))
      ))
      .map((provider) => provider.providerId),
  )
  const scopedProviderId = providerId?.trim()
  return source.models.filter((model) => (
    model.enabled
    && usableProviderIds.has(model.providerId)
    && (!scopedProviderId || model.providerId === scopedProviderId)
  ))
}

export function selectPromptOptimizationModel(
  source: PromptOptimizationModelSource,
  providerId?: string,
): LlmModelConfig | null {
  const candidates = listPromptOptimizationModelCandidates(source, providerId)
  if (candidates.length === 0) return null
  return candidates.find(supportsPromptOptimizationVisionInput) ?? candidates[0]
}

export function findPromptOptimizationModel(
  source: PromptOptimizationModelSource,
  reference: PromptOptimizationModelReference,
): LlmModelConfig | null {
  const providerId = reference.providerId.trim()
  const modelId = reference.modelId.trim()
  if (!providerId || !modelId) return null
  return listPromptOptimizationModelCandidates(source, providerId)
    .find((model) => model.modelId === modelId)
    ?? null
}

export function buildPromptOptimizationCapabilities(
  model: LlmModelConfig | null | undefined,
): PromptOptimizationProfile['capabilities'] {
  return {
    text: true,
    image: model?.capabilities.image === true,
    video: model?.capabilities.video === true,
  }
}

/**
 * 方案指向的模型仍然可用时原样返回（用户的显式选择优先，不因为它不支持视觉就替换）；
 * 只有指向空值或已经不可用时才按策略重新选一个。选不出来则保持原样，由调用方引导用户配置。
 */
export function applyPromptOptimizationModelSelection(
  profile: PromptOptimizationProfile,
  source: PromptOptimizationModelSource,
): PromptOptimizationProfile {
  if (findPromptOptimizationModel(source, profile)) return profile
  const model = selectPromptOptimizationModel(source)
  if (!model) return profile
  return {
    ...profile,
    providerId: model.providerId,
    modelId: model.modelId,
    capabilities: buildPromptOptimizationCapabilities(model),
  }
}
