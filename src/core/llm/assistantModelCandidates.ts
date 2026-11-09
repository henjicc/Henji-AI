import type { LlmConfigState, LlmModelConfig, LlmProviderConfig } from '@henjicc/ai-sdk'

/** 能当助手的模型：供应商与模型都启用，能读文本、能调用工具；主进程解析助手模型与输入框底栏共用这一份 */
export function assistantModelCandidates(config: Pick<LlmConfigState, 'models' | 'providers'>): Array<{ model: LlmModelConfig; provider: LlmProviderConfig }> {
  return config.models.flatMap(model => {
    const provider = config.providers.find(item => item.providerId === model.providerId && item.enabled)
    return provider && model.enabled && model.capabilities.text && model.capabilities.toolCall ? [{ model, provider }] : []
  })
}
