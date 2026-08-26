export type ApiKeyProvider = 'ppio' | 'fal' | 'modelscope' | 'kie' | 'apimart' | 'bailian' | 'volcengine' | 'grsai'
export type UploadProvider = 'fal' | 'kie'

export type ProviderLink = {
  id: string
  url: string
  guide?: boolean
}

export type ApiKeyProviderMeta = {
  id: ApiKeyProvider
  links: ProviderLink[]
}

export type UploadProviderMeta = {
  id: UploadProvider
}

export const API_KEY_PROVIDERS: ApiKeyProviderMeta[] = [
  {
    id: 'ppio',
    links: [
      { id: 'register', url: 'https://ppio.com/user/register?invited_by=WGY0DZ', guide: true },
      { id: 'keys', url: 'https://ppio.com/settings/key-management' }
    ]
  },
  {
    id: 'fal',
    links: [
      { id: 'home', url: 'https://fal.ai/' },
      { id: 'console', url: 'https://fal.ai/dashboard/keys', guide: true }
    ]
  },
  {
    id: 'modelscope',
    links: [
      { id: 'home', url: 'https://www.modelscope.cn/' },
      { id: 'docs', url: 'https://modelscope.cn/docs/model-service/API-Inference/limits' },
      { id: 'token', url: 'https://modelscope.cn/my/myaccesstoken', guide: true }
    ]
  },
  {
    id: 'kie',
    links: [
      { id: 'home', url: 'https://kie.ai?ref=eef20ef0b0595cad227d45b29c635f6c', guide: true },
      { id: 'keys', url: 'https://kie.ai/zh-CN/api-key' }
    ]
  },
  {
    id: 'apimart',
    links: [
      { id: 'register', url: 'https://apimart.ai/register?aff=cGPOZd', guide: true },
      { id: 'keys', url: 'https://apimart.ai/dashboard/api-keys' },
      { id: 'docs', url: 'https://docs.apimart.ai/' }
    ]
  },
  {
    id: 'bailian',
    links: [
      { id: 'home', url: 'https://bailian.console.aliyun.com/' },
      { id: 'keys', url: 'https://bailian.console.aliyun.com/?apiKey=1#/api-key', guide: true },
      { id: 'docs', url: 'https://help.aliyun.com/zh/model-studio/' }
    ]
  },
  {
    id: 'volcengine',
    links: [
      { id: 'home', url: 'https://console.volcengine.com/ark/' },
      { id: 'keys', url: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey', guide: true },
      { id: 'docs', url: 'https://api.volcengine.com/api-docs/view?action=ImageGenerations&serviceCode=ark&version=2024-01-01' }
    ]
  },
  {
    id: 'grsai',
    links: [
      { id: 'home', url: 'https://grsai.ai/' },
      { id: 'keys', url: 'https://grsai.ai/zh/dashboard/api-keys', guide: true },
      { id: 'docs', url: 'https://qmy27nhsd9.apifox.cn/452392911e0' }
    ]
  }
]

export function getApiKeyProviderGuideLink(providerId: ApiKeyProvider): ProviderLink | undefined {
  const provider = API_KEY_PROVIDERS.find((item) => item.id === providerId)
  return provider?.links.find((link) => link.guide) ?? provider?.links[0]
}

export const UPLOAD_PROVIDERS: UploadProviderMeta[] = [
  { id: 'kie' },
  { id: 'fal' }
]
