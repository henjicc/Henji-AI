import { getLlmEndpointProfileFamily, resolveLlmEndpointIdentity } from './endpointProfiles'
import { findLlmProviderPreset, LLM_PROVIDER_PRESETS } from './providerPresets'
import type { LlmProviderConfig, LlmProviderSetup } from './types'

export const LLM_API_KEY_URL_MAX_LENGTH = 2_048

export function normalizeLlmApiKeyManagementUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('[llm_api_key_url_invalid] API key management URL must not be empty')
  if (trimmed.length > LLM_API_KEY_URL_MAX_LENGTH) {
    throw new Error(`[llm_api_key_url_invalid] API key management URL exceeds ${LLM_API_KEY_URL_MAX_LENGTH} characters`)
  }
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error('[llm_api_key_url_invalid] API key management URL must be an absolute HTTP(S) URL')
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`[llm_api_key_url_invalid] unsupported protocol "${parsed.protocol}"; use https:// or http://`)
  }
  if (parsed.username || parsed.password) {
    throw new Error('[llm_api_key_url_invalid] API key management URL must not contain embedded credentials')
  }
  return parsed.toString()
}

export function normalizeLlmProviderSetup(setup: LlmProviderSetup): LlmProviderSetup {
  if (setup.kind === 'custom') {
    if (setup.apiKeyManagementUrl !== undefined && typeof setup.apiKeyManagementUrl !== 'string') {
      throw new Error('[llm_api_key_url_invalid] API key management URL must be a string')
    }
    return {
      kind: 'custom',
      ...(setup.apiKeyManagementUrl
        ? { apiKeyManagementUrl: normalizeLlmApiKeyManagementUrl(setup.apiKeyManagementUrl) }
        : {}),
    }
  }
  if (setup.kind !== 'preset') {
    throw new Error('[llm_provider_setup_invalid] setup kind must be "preset" or "custom"')
  }
  if (typeof setup.presetId !== 'string') {
    throw new Error('[llm_provider_preset_unknown] preset id must be a string')
  }
  if (setup.lifecycle !== 'builtin' && setup.lifecycle !== 'user') {
    throw new Error('[llm_provider_lifecycle_invalid] preset lifecycle must be "builtin" or "user"')
  }
  const presetId = setup.presetId.trim().toLowerCase()
  if (!findLlmProviderPreset(presetId)) {
    throw new Error(
      `[llm_provider_preset_unknown] preset "${presetId || '(empty)'}" is unavailable; choose one of: ${LLM_PROVIDER_PRESETS.map(item => item.providerId).join(', ')}`
    )
  }
  return { kind: 'preset', presetId, lifecycle: setup.lifecycle }
}

/** endpoint profile 官方地址优先，其次 preset，最后才是 custom URL。 */
export function resolveLlmProviderApiKeyUrl(provider: LlmProviderConfig): string | null {
  const identity = resolveLlmEndpointIdentity(provider)
  const family = getLlmEndpointProfileFamily(identity.providerFamilyId)
  const profile = family?.profiles.find(item => item.id === identity.endpointProfile)
  if (profile) return normalizeLlmApiKeyManagementUrl(profile.apiKeyUrl)

  const setup = provider.setup ? normalizeLlmProviderSetup(provider.setup) : undefined
  if (setup?.kind === 'preset') {
    const preset = findLlmProviderPreset(setup.presetId)
    return preset ? normalizeLlmApiKeyManagementUrl(preset.apiKeyUrl) : null
  }
  return setup?.kind === 'custom' && setup.apiKeyManagementUrl
    ? normalizeLlmApiKeyManagementUrl(setup.apiKeyManagementUrl)
    : null
}
