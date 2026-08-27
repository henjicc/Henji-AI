import { llmGetProviderKeyStatus } from '@/commands/llmRuntime'
import { createLogger } from '@/core/logging'
import {
  applyPromptOptimizationModelSelection,
  listPromptOptimizationModelCandidates,
  type PromptOptimizationModelSource,
} from '@/core/llm/promptOptimizationModelSelection'
import type { LlmConfigState, PromptOptimizationProfile } from '@henjicc/ai-sdk'
import { isDesktopRuntime } from '@/platform/runtime'
import { llmConfigService } from './LlmConfigService'

const logger = createLogger('services.llm.promptOptimizationReadiness')

/**
 * 把「哪些供应商配了密钥」这一份运行时事实接到纯选择策略上，并给调用方一个明确的可用性结论。
 *
 * 放在服务层而不是按钮组件里，是因为这套判断在没有生成页时依然成立：任何要用大语言模型
 * 优化提示词的入口都需要同一套「选哪个模型 / 缺什么配置」的答案。
 */
export interface PromptOptimizationModelResolution {
  config: LlmConfigState
  configuredProviderIds?: readonly string[]
}

export type PromptOptimizationReadiness =
  /** 可以直接发起优化；`profile` 可能是自动补选模型后的新对象 */
  | { status: 'ready'; config: LlmConfigState; profile: PromptOptimizationProfile }
  /** 一个大语言模型供应商密钥都没配 */
  | { status: 'missing-provider-key' }
  /** 密钥已配，但没有可用模型可以落到优化方案上 */
  | { status: 'missing-model' }

/** 返回已配置密钥的供应商 id；`undefined` 表示无法判断（非桌面运行时或查询失败），此时不按密钥过滤 */
export async function loadConfiguredLlmProviderIds(
  config: LlmConfigState,
): Promise<string[] | undefined> {
  if (!isDesktopRuntime()) return undefined
  const providerIds = config.providers.map((provider) => provider.providerId)
  if (providerIds.length === 0) return []
  try {
    const statuses = await llmGetProviderKeyStatus(providerIds)
    return statuses.filter((status) => status.configured).map((status) => status.providerId)
  } catch (error) {
    logger.error('读取大语言模型密钥状态失败', error, {
      event: 'prompt_optimization.provider_key_status.failed',
    })
    return undefined
  }
}

export async function createPromptOptimizationModelSource(
  config: LlmConfigState,
): Promise<PromptOptimizationModelSource> {
  return {
    providers: config.providers,
    models: config.models,
    configuredProviderIds: await loadConfiguredLlmProviderIds(config),
  }
}

function applySelectionToConfig(
  config: LlmConfigState,
  source: PromptOptimizationModelSource,
): LlmConfigState | null {
  let changed = false
  const promptProfiles = config.promptProfiles.map((profile) => {
    const nextProfile = applyPromptOptimizationModelSelection(profile, source)
    if (nextProfile !== profile) changed = true
    return nextProfile
  })
  return changed ? { ...config, promptProfiles } : null
}

/**
 * 给所有还没有可用模型的优化方案补上自动选择结果并落盘，让配置面板打开时看到的就是实际会用的模型。
 * 没有可补的内容时不写盘。
 */
export async function ensurePromptOptimizationModelSelection(
  config: LlmConfigState,
): Promise<PromptOptimizationModelResolution> {
  const source = await createPromptOptimizationModelSource(config)
  const nextConfig = applySelectionToConfig(config, source)
  if (!nextConfig) {
    return { config, configuredProviderIds: source.configuredProviderIds }
  }
  try {
    await llmConfigService.saveConfig(nextConfig)
  } catch (error) {
    logger.error('保存提示词优化模型自动选择结果失败', error, {
      event: 'prompt_optimization.model_selection.save_failed',
    })
  }
  return { config: nextConfig, configuredProviderIds: source.configuredProviderIds }
}

export async function resolvePromptOptimizationReadiness(
  config: LlmConfigState | null,
  profile: PromptOptimizationProfile | null,
): Promise<PromptOptimizationReadiness> {
  if (!config) return { status: 'missing-model' }
  const source = await createPromptOptimizationModelSource(config)
  const candidates = listPromptOptimizationModelCandidates(source)

  if (candidates.length === 0) {
    return source.configuredProviderIds?.length === 0
      ? { status: 'missing-provider-key' }
      : { status: 'missing-model' }
  }
  if (!profile) return { status: 'missing-model' }

  const nextProfile = applyPromptOptimizationModelSelection(profile, source)
  if (nextProfile === profile) {
    return { status: 'ready', config, profile }
  }

  const nextConfig: LlmConfigState = {
    ...config,
    promptProfiles: config.promptProfiles.map((item) => (
      item.id === nextProfile.id ? nextProfile : item
    )),
  }
  try {
    await llmConfigService.saveConfig(nextConfig)
  } catch (error) {
    logger.error('保存提示词优化模型自动选择结果失败', error, {
      event: 'prompt_optimization.model_selection.save_failed',
    })
  }
  return { status: 'ready', config: nextConfig, profile: nextProfile }
}
