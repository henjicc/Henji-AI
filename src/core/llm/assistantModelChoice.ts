import type { AgentModelReference, LlmConfigState, LlmProviderConfig, LlmReasoningConfig } from '@henjicc/ai-sdk'

import { createDefaultProviderReasoning } from './defaults'

/**
 * 助手用哪个模型、想多深：设置页与助手输入框共用这一份读写。
 * 模型写进当前助手方案的主模型；思考档位存在模型所在供应商上（运行时与能力验证都读它）。
 */
export const ASSISTANT_REASONING_MODES = ['off', 'low', 'medium', 'high', 'max'] as const
export type AssistantReasoningMode = typeof ASSISTANT_REASONING_MODES[number]

export function assistantProfile(config: LlmConfigState) {
  return config.agentProfiles.find(item => item.id === config.selectedAgentProfileId) ?? config.agentProfiles[0]
}

export { assistantModelCandidates } from './assistantModelCandidates'

/** 供应商没存思考配置时用适配器的默认档 */
export function providerReasoning(provider: Pick<LlmProviderConfig, 'reasoning' | 'adapter'>): LlmReasoningConfig {
  return provider.reasoning ?? createDefaultProviderReasoning(provider.adapter)
}

export function withAssistantPrimaryModel(config: LlmConfigState, reference: AgentModelReference): LlmConfigState {
  const profile = assistantProfile(config)
  if (!profile) return config
  const next = { ...profile, primary: reference, updatedAt: new Date().toISOString() }
  return { ...config, agentProfiles: config.agentProfiles.map(item => item.id === profile.id ? next : item) }
}

/** 模型不支持思考或供应商不让调时返回 null，界面不给这个选项 */
export function readReasoningMode(config: LlmConfigState, reference: AgentModelReference | undefined): AssistantReasoningMode | null {
  if (!reference) return null
  const model = config.models.find(item => item.providerId === reference.providerId && item.modelId === reference.modelId)
  const provider = config.providers.find(item => item.providerId === reference.providerId && item.enabled)
  if (!model?.capabilities.reasoning || !provider || provider.reasoningConfigurable === false) return null
  const reasoning = providerReasoning(provider)
  return !reasoning.enabled ? 'off' : reasoning.effort === 'xhigh' ? 'max' : reasoning.effort
}

export function withReasoningMode(config: LlmConfigState, providerId: string, mode: AssistantReasoningMode): LlmConfigState {
  return { ...config, providers: config.providers.map(provider => {
    if (provider.providerId !== providerId) return provider
    const current = providerReasoning(provider)
    // 关闭时保留原档位，再打开回到用户上次选的强度
    const reasoning: LlmReasoningConfig = mode === 'off' ? { ...current, enabled: false } : { enabled: true, effort: mode }
    return { ...provider, reasoning }
  }) }
}
