import { resolveLlmEndpointIdentity, resolveModelStepBaseUrl } from '@henjicc/ai-sdk'
import { createProviderSettingsFileStorage } from '../llm/provider-settings-storage'
import { getLlmProviderApiKey } from '../keystore'
import type { EmbeddedAgentModel } from '../../../../src/core/assistant/embeddedAgent'
import type { EmbeddedModel } from './contracts'

async function configuredModels() {
  const config = await createProviderSettingsFileStorage().readConfig()
  return (config?.models ?? []).flatMap((model) => {
    const provider = config?.providers.find((item) => item.providerId === model.providerId && item.enabled)
    return model.enabled && model.capabilities.text && model.capabilities.toolCall && provider ? [{ model, provider }] : []
  })
}
export async function listEmbeddedModels(): Promise<EmbeddedAgentModel[]> {
  return (await configuredModels()).map(({ model, provider }) => ({ providerId: model.providerId, modelId: model.modelId, name: `${model.displayName} · ${provider.displayName}` }))
}
export async function resolveEmbeddedModel(selection: { providerId: string; modelId: string }): Promise<EmbeddedModel> {
  const entry = (await configuredModels()).find(({ model }) => model.providerId === selection.providerId && model.modelId === selection.modelId)
  if (!entry) throw new Error('所选模型已停用或不支持工具调用，请到设置中添加可用模型。')
  const config = { ...entry.provider, ...entry.model }
  const identity = resolveLlmEndpointIdentity(config)
  const apiKey = getLlmProviderApiKey(identity.credentialId)
  if (!apiKey) throw new Error('所选供应商还没有 API Key，请到设置中填写。')
  return { providerId: config.providerId, model: entry.model, baseUrl: resolveModelStepBaseUrl(config),
    api: config.apiProtocol === 'openai-responses' ? 'openai-responses' : 'openai-completions', apiKey }
}
