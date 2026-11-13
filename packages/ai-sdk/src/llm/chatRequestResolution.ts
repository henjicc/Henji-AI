import { createLlmCapabilitiesForModel } from './defaults'
import { resolveLlmEndpointIdentity } from './endpointProfiles'
import { findLlmModelCatalogEntry, modelSupportsLlmApiProtocol } from './modelCatalog'
import type { LlmApiProtocol } from './providerProtocolCore'
import { findLlmProviderPreset, resolvePresetModelApiProtocol } from './providerPresets'
import { resolveCustomLlmBaseUrl } from './protocolEndpoints'
import type { LlmChatRequestDto } from './chatTypes'

export interface ResolvedLlmChatRequest {
  request: LlmChatRequestDto
  protocol: LlmApiProtocol
}

function hasChatOnlyContent(request: LlmChatRequestDto): boolean {
  return request.messages.some(message => Array.isArray(message.content)
    && message.content.some(part => part.type !== 'text' && part.type !== 'image_url' && part.type !== 'file'))
}

/**
 * 补全一次对话请求。供应商有内置预设、模型在内置目录里时，SDK 按目录与预设的 modelCapabilities 补上能力，
 * 调用方传的字段优先（宿主允许用户手动改能力）；未登记的只用调用方传入的能力。
 * 同一个模型经不同平台接入时能力可能不同，平台差异由预设的 modelCapabilities 覆盖，所以要求两者都在。
 *
 * 协议：调用方显式指定的照办；否则按预设选择，但自定义地址（代理、中转）、带视频或音频内容的请求留在
 * Chat Completions：前者无从得知是否支持 Responses，后者 Responses 没有对应内容块。
 */
export function resolveLlmChatRequest(request: LlmChatRequestDto): ResolvedLlmChatRequest {
  const identity = resolveLlmEndpointIdentity(request)
  const preset = findLlmProviderPreset(identity.providerFamilyId)
  const entry = preset ? findLlmModelCatalogEntry(request.modelId, preset.providerId) : null
  const capabilities = preset && entry
    ? { ...createLlmCapabilitiesForModel(request.modelId, preset.providerId), ...preset.modelCapabilities?.[request.modelId], ...request.capabilities }
    : request.capabilities
  const autoProtocol = preset && !hasChatOnlyContent(request) && !resolveCustomLlmBaseUrl(request)
    ? resolvePresetModelApiProtocol(preset, request.modelId, identity.endpointProfile)
    : 'openai-compatible'
  const protocol = request.apiProtocol ?? autoProtocol
  if (protocol === 'openai-responses' && entry && !modelSupportsLlmApiProtocol(entry, 'openai-responses')) {
    throw Object.assign(new Error(`Model "${request.modelId}" is not known to support the Responses API.`), {
      code: 'RESPONSES_UNSUPPORTED', statusCode: 400,
    })
  }
  return { request: { ...request, capabilities }, protocol }
}
