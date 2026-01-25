export type ApiKeyProvider = 'ppio' | 'fal' | 'modelscope' | 'kie' | 'bizyair'
export type UploadProvider = 'fal' | 'kie' | 'bizyair'

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
      { id: 'register', url: 'https://ppio.com/user/register?invited_by=MLBDS6' },
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
      { id: 'home', url: 'https://kie.ai/zh-CN' },
      { id: 'keys', url: 'https://kie.ai/zh-CN/api-key' }
    ]
  },
  {
    id: 'bizyair',
    links: [
      { id: 'home', url: 'https://bizyair.cn/' },
      { id: 'keys', url: 'https://bizyair.cn/user/api-key' }
    ]
  }
]

export const UPLOAD_PROVIDERS: UploadProviderMeta[] = [
  { id: 'bizyair' },
  { id: 'kie' },
  { id: 'fal' }
]
