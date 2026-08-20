export type ApiKeyProvider = 'ppio' | 'fal' | 'modelscope' | 'kie' | 'apimart'
export type UploadProvider = 'fal' | 'kie'

export type ProviderLink = {
  id: string
  url: string
  highlight?: boolean
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
      { id: 'register', url: 'https://ppio.com/user/register?invited_by=WGY0DZ' },
      { id: 'keys', url: 'https://ppio.com/settings/key-management' }
    ]
  },
  {
    id: 'fal',
    links: [
      { id: 'home', url: 'https://fal.ai/', highlight: true },
      { id: 'console', url: 'https://fal.ai/dashboard/keys' }
    ]
  },
  {
    id: 'modelscope',
    links: [
      { id: 'home', url: 'https://www.modelscope.cn/' },
      { id: 'docs', url: 'https://modelscope.cn/docs/model-service/API-Inference/limits' },
      { id: 'token', url: 'https://modelscope.cn/my/myaccesstoken' }
    ]
  },
  {
    id: 'kie',
    links: [
      { id: 'home', url: 'https://kie.ai?ref=eef20ef0b0595cad227d45b29c635f6c' },
      { id: 'keys', url: 'https://kie.ai/zh-CN/api-key' }
    ]
  },
  {
    id: 'apimart',
    links: [
      { id: 'home', url: 'https://apimart.ai/' },
      { id: 'keys', url: 'https://apimart.ai/dashboard/api-keys' },
      { id: 'docs', url: 'https://docs.apimart.ai/' }
    ]
  }
]

export const UPLOAD_PROVIDERS: UploadProviderMeta[] = [
  { id: 'kie' },
  { id: 'fal' }
]
