import type { LlmEndpointProfileFamily } from '../endpointProfiles'
import { findProviderMetadata } from '../../providers/metadata'

export const BIGMODEL_PROVIDER_FAMILY_ID = 'bigmodel'
export const BIGMODEL_CN_PROFILE_ID = 'cn'
export const BIGMODEL_GLOBAL_PROFILE_ID = 'global'
export const BIGMODEL_CN_CREDENTIAL_ID = 'bigmodel'
export const BIGMODEL_GLOBAL_CREDENTIAL_ID = 'bigmodel-global'

const BIGMODEL_CN_METADATA = findProviderMetadata(BIGMODEL_PROVIDER_FAMILY_ID)
const BIGMODEL_GLOBAL_METADATA = findProviderMetadata(BIGMODEL_PROVIDER_FAMILY_ID, { endpointProfile: 'global' })
if (!BIGMODEL_CN_METADATA || !BIGMODEL_GLOBAL_METADATA) {
  throw new Error('[provider_metadata_missing] BigModel endpoint metadata is not registered')
}

export interface BigmodelTokenPricing {
  currency: 'CNY' | 'USD'
  inputPerMillionTokens: number
  outputPerMillionTokens: number
  cacheReadPerMillionTokens: number
  promotion?: {
    inputPerMillionTokens: number
    outputPerMillionTokens: number
    cacheReadPerMillionTokens: number
    endsAt?: string
    observedAt: string
  }
}

export const BIGMODEL_ENDPOINT_PROFILE_FAMILY: LlmEndpointProfileFamily = {
  providerFamilyId: BIGMODEL_PROVIDER_FAMILY_ID,
  defaultProfile: BIGMODEL_CN_PROFILE_ID,
  profiles: [
    {
      id: BIGMODEL_CN_PROFILE_ID,
      displayName: '智谱 GLM（中国大陆）',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      protocolBaseUrls: { 'openai-responses': 'https://open.bigmodel.cn/api/v1' },
      websiteUrl: BIGMODEL_CN_METADATA.websiteUrl,
      apiKeyUrl: BIGMODEL_CN_METADATA.apiKeyUrl,
      defaultCredentialId: BIGMODEL_CN_CREDENTIAL_ID,
      modelIds: ['glm-5.3', 'glm-5v-turbo', 'glm-5.3-flash'],
      docs: 'docs/llm-adaptation/供应商/智谱GLM.md',
    },
    {
      id: BIGMODEL_GLOBAL_PROFILE_ID,
      displayName: 'Z.AI GLM（Global）',
      baseUrl: 'https://api.z.ai/api/paas/v4',
      websiteUrl: BIGMODEL_GLOBAL_METADATA.websiteUrl,
      apiKeyUrl: BIGMODEL_GLOBAL_METADATA.apiKeyUrl,
      defaultCredentialId: BIGMODEL_GLOBAL_CREDENTIAL_ID,
      modelIds: ['glm-5.3-flash'],
      docs: 'docs/model-adaptation/GLM-5.3-Flash/GLM-5.3-Flash_智谱.md',
    },
  ],
}

export const BIGMODEL_GLM_5_3_FLASH_PRICING: Readonly<Record<'cn' | 'global', BigmodelTokenPricing>> = {
  cn: {
    currency: 'CNY',
    inputPerMillionTokens: 0.8,
    outputPerMillionTokens: 2.8,
    cacheReadPerMillionTokens: 0.23,
    promotion: {
      inputPerMillionTokens: 0.4,
      outputPerMillionTokens: 1.4,
      cacheReadPerMillionTokens: 0.115,
      observedAt: '2026-08-28',
    },
  },
  global: {
    currency: 'USD',
    inputPerMillionTokens: 0.15,
    outputPerMillionTokens: 0.5,
    cacheReadPerMillionTokens: 0.03,
    promotion: {
      inputPerMillionTokens: 0.075,
      outputPerMillionTokens: 0.25,
      cacheReadPerMillionTokens: 0.015,
      endsAt: '2026-09-09T16:00:00.000Z',
      observedAt: '2026-08-28',
    },
  },
}
