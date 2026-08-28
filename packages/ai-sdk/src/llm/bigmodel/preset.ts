import { createLlmCapabilitiesForModel } from '../defaults'
import { resolveLlmEndpointIdentity } from '../endpointProfiles'
import type { LlmModelConfig, LlmProviderConfig } from '../types'
import {
  BIGMODEL_ENDPOINT_PROFILE_FAMILY,
  BIGMODEL_PROVIDER_FAMILY_ID,
} from './profiles'

export interface CreateBigmodelProviderOptions {
  endpointProfile?: 'cn' | 'global'
  /** 宿主配置实例 id；默认 cn=bigmodel、global=bigmodel-global。 */
  providerId?: string
  lifecycle?: 'builtin' | 'user'
}

export function createBigmodelProvider(
  options: CreateBigmodelProviderOptions = {}
): LlmProviderConfig {
  const profileId = options.endpointProfile ?? 'cn'
  const providerId = options.providerId ?? (profileId === 'cn' ? 'bigmodel' : 'bigmodel-global')
  const identity = resolveLlmEndpointIdentity({
    providerId,
    providerFamilyId: BIGMODEL_PROVIDER_FAMILY_ID,
    endpointProfile: profileId,
  })
  const profile = BIGMODEL_ENDPOINT_PROFILE_FAMILY.profiles.find(item => item.id === profileId)
  if (!profile) throw new Error(`[llm_endpoint_profile_unknown] bigmodel endpoint profile "${profileId}" is unavailable`)
  return {
    providerId: identity.providerId,
    providerFamilyId: identity.providerFamilyId,
    endpointProfile: identity.endpointProfile,
    credentialId: identity.credentialId,
    setup: {
      kind: 'preset',
      presetId: BIGMODEL_PROVIDER_FAMILY_ID,
      lifecycle: options.lifecycle ?? 'user',
    },
    displayName: profile.displayName,
    adapter: 'openai',
    apiProtocol: 'openai-compatible',
    baseUrl: identity.baseUrl,
    reasoning: { enabled: true, effort: 'max' },
    reasoningConfigurable: true,
    enabled: true,
  }
}

export function createBigmodelModels(provider: LlmProviderConfig): LlmModelConfig[] {
  const identity = resolveLlmEndpointIdentity(provider)
  const profile = BIGMODEL_ENDPOINT_PROFILE_FAMILY.profiles.find(item => item.id === identity.endpointProfile)
  if (!profile) throw new Error('[llm_endpoint_profile_unknown] resolved BigModel endpoint profile is unavailable')
  return profile.modelIds.map(modelId => ({
    providerId: identity.providerId,
    providerFamilyId: identity.providerFamilyId,
    endpointProfile: identity.endpointProfile,
    credentialId: identity.credentialId,
    modelId,
    displayName: modelId === 'glm-5.3-flash' ? 'GLM-5.3-Flash' : modelId,
    adapter: provider.adapter,
    apiProtocol: provider.apiProtocol,
    baseUrl: identity.baseUrl,
    capabilities: createLlmCapabilitiesForModel(modelId),
    catalogId: modelId,
    enabled: true,
  }))
}

export function resolveBigmodelIdentity(input: LlmProviderConfig): ReturnType<typeof resolveLlmEndpointIdentity> {
  return resolveLlmEndpointIdentity(input)
}
