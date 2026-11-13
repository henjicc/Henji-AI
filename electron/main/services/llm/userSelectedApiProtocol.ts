import type { LlmApiProtocol, LlmChatRequestDto, LlmConfigState } from '@henjicc/ai-sdk'

/**
 * 用户在设置里亲手选的协议：预设供应商只认连接设置里的覆盖（其余 apiProtocol 是按预设推导写回的，
 * 交给 SDK 自动选择，带视频、音频的请求才能留在 Chat）；自定义供应商保存的协议就是用户选的。
 */
export function userSelectedApiProtocol(config: LlmConfigState | null, request: Pick<LlmChatRequestDto, 'providerId' | 'modelId'>): LlmApiProtocol | undefined {
  const provider = config?.providers.find(item => item.providerId === request.providerId)
  if (!provider) return undefined
  if (provider.setup?.kind === 'preset') return provider.setup.connectionOverrides?.apiProtocol
  const model = config?.models.find(item => item.providerId === request.providerId && item.modelId === request.modelId)
  return model?.apiProtocol ?? provider.apiProtocol
}
