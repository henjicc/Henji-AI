import { findProviderMetadata, type ProviderMetadata } from '@henjicc/ai-sdk'

export type ApiKeyProvider = 'ppio' | 'fal' | 'modelscope' | 'kie' | 'apimart' | 'bailian' | 'volcengine' | 'grsai'
export type UploadProvider = 'fal' | 'kie'

export type ApiKeyProviderMeta = {
  id: ApiKeyProvider
  websiteUrl: ProviderMetadata['websiteUrl']
  apiKeyUrl: ProviderMetadata['apiKeyUrl']
}

export type UploadProviderMeta = {
  id: UploadProvider
}

const API_KEY_PROVIDER_IDS: readonly ApiKeyProvider[] = [
  'ppio', 'fal', 'modelscope', 'kie', 'apimart', 'bailian', 'volcengine', 'grsai',
]

export const API_KEY_PROVIDERS: ApiKeyProviderMeta[] = API_KEY_PROVIDER_IDS.map((id) => {
  const metadata = findProviderMetadata(id)
  if (!metadata) throw new Error(`[provider_metadata_missing] provider "${id}" is not registered in SDK`)
  return { id, websiteUrl: metadata.websiteUrl, apiKeyUrl: metadata.apiKeyUrl }
})

export const UPLOAD_PROVIDERS: UploadProviderMeta[] = [
  { id: 'kie' },
  { id: 'fal' }
]
