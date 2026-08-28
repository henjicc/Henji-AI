/**
 * LLM 区域/租户端点身份。
 *
 * providerId 是宿主可命名的配置实例，providerFamilyId 才决定协议差异；credentialId
 * 独立决定凭据槽。三者不可互相推断，避免区域化实例把一个区域密钥带到另一区端点。
 */
export interface LlmEndpointIdentity {
  providerId: string
  providerFamilyId?: string
  endpointProfile?: string
  credentialId?: string
  baseUrl?: string
}

export interface ResolvedLlmEndpointIdentity {
  providerId: string
  providerFamilyId: string
  endpointProfile?: string
  credentialId: string
  baseUrl?: string
}

export interface LlmEndpointProfile {
  id: string
  displayName: string
  baseUrl: string
  apiKeyUrl: string
  defaultCredentialId: string
  modelIds: readonly string[]
  docs: string
}

export interface LlmEndpointProfileFamily {
  providerFamilyId: string
  defaultProfile: string
  profiles: readonly LlmEndpointProfile[]
}

import { BIGMODEL_ENDPOINT_PROFILE_FAMILY } from './bigmodel/profiles'

const PROFILE_FAMILIES = new Map<string, LlmEndpointProfileFamily>([
  [BIGMODEL_ENDPOINT_PROFILE_FAMILY.providerFamilyId, BIGMODEL_ENDPOINT_PROFILE_FAMILY],
])

export function registerLlmEndpointProfileFamily(family: LlmEndpointProfileFamily): void {
  const familyId = normalizeId(family.providerFamilyId, 'providerFamilyId')
  if (PROFILE_FAMILIES.has(familyId)) {
    throw new Error(`[llm_endpoint_profile_conflict] provider family "${familyId}" is already registered`)
  }
  const ids = new Set<string>()
  const credentials = new Set<string>()
  for (const profile of family.profiles) {
    const id = normalizeId(profile.id, 'endpointProfile')
    const credentialId = normalizeId(profile.defaultCredentialId, 'credentialId')
    if (ids.has(id)) {
      throw new Error(`[llm_endpoint_profile_conflict] ${familyId} endpoint profile "${id}" is duplicated`)
    }
    if (credentials.has(credentialId)) {
      throw new Error(`[llm_credential_scope_conflict] ${familyId} endpoint profiles must not share credential "${credentialId}"`)
    }
    ids.add(id)
    credentials.add(credentialId)
  }
  if (!ids.has(family.defaultProfile)) {
    throw new Error(`[llm_endpoint_profile_invalid] ${familyId} default profile "${family.defaultProfile}" is not registered`)
  }
  PROFILE_FAMILIES.set(familyId, family)
}

export function getLlmEndpointProfileFamily(providerFamilyId: string): LlmEndpointProfileFamily | null {
  return PROFILE_FAMILIES.get(providerFamilyId.trim().toLowerCase()) ?? null
}

export function resolveLlmEndpointIdentity(input: LlmEndpointIdentity): ResolvedLlmEndpointIdentity {
  const providerId = normalizeId(input.providerId, 'providerId')
  // `bigmodel-global` 是 SDK 生成的稳定实例 id；即使宿主旧 schema 暂时漏存新增字段，也不能
  // 把它退化成任意 OpenAI 兼容供应商，从而绕开 Global 端点/凭据隔离。
  const inferredBigmodelProfile = providerId === 'bigmodel-global' ? 'global' : undefined
  const providerFamilyId = normalizeId(
    input.providerFamilyId ?? (inferredBigmodelProfile ? 'bigmodel' : providerId),
    'providerFamilyId'
  )
  const family = PROFILE_FAMILIES.get(providerFamilyId)
  if (!family) {
    return {
      providerId,
      providerFamilyId,
      endpointProfile: input.endpointProfile,
      credentialId: normalizeId(input.credentialId ?? providerId, 'credentialId'),
      baseUrl: input.baseUrl,
    }
  }

  const profileId = input.endpointProfile?.trim().toLowerCase() || inferredBigmodelProfile || family.defaultProfile
  const profile = family.profiles.find(item => item.id === profileId)
  if (!profile) {
    throw new Error(`[llm_endpoint_profile_unknown] provider family "${providerFamilyId}" has no endpoint profile "${profileId}"`)
  }
  const credentialId = normalizeId(input.credentialId ?? profile.defaultCredentialId, 'credentialId')
  if (credentialId !== profile.defaultCredentialId) {
    throw new Error(`[llm_credential_scope_mismatch] endpoint profile "${providerFamilyId}/${profile.id}" requires credential "${profile.defaultCredentialId}", received "${credentialId}"`)
  }
  const suppliedBaseUrl = input.baseUrl?.trim().replace(/\/+$/, '')
  const profileBaseUrl = profile.baseUrl.replace(/\/+$/, '')
  if (suppliedBaseUrl && suppliedBaseUrl !== profileBaseUrl) {
    throw new Error(`[llm_endpoint_profile_mismatch] endpoint profile "${providerFamilyId}/${profile.id}" requires baseUrl "${profileBaseUrl}"`)
  }
  return {
    providerId,
    providerFamilyId,
    endpointProfile: profile.id,
    credentialId,
    baseUrl: profileBaseUrl,
  }
}

function normalizeId(value: string, field: string): string {
  const normalized = value.trim().toLowerCase()
  if (!normalized) throw new Error(`[llm_endpoint_identity_invalid] ${field} must not be empty`)
  return normalized
}
