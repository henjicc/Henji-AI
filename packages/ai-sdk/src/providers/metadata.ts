/** SDK 内置供应商的公开入口；不参与模型请求或宿主网络白名单。 */
export interface ProviderMetadata {
  providerId: string
  displayName: string
  /** 面向用户的供应商入口；存在项目邀请链接时优先使用邀请链接。 */
  websiteUrl: string
  /** 创建或管理 API Key 的官方入口。 */
  apiKeyUrl: string
  websiteUrlKind: 'official' | 'referral'
  /** 该供应商资料在 SDK 包内的相对路径。 */
  docs: string
}

export interface ProviderMetadataLookupOptions {
  /** 同一供应商存在地区站点时用于选择对应入口。 */
  endpointProfile?: string
}

export const PROVIDER_METADATA: readonly ProviderMetadata[] = [
  {
    providerId: 'apimart',
    displayName: 'APIMart',
    websiteUrl: 'https://apimart.ai/register?aff=cGPOZd',
    apiKeyUrl: 'https://apimart.ai/keys',
    websiteUrlKind: 'referral',
    docs: 'docs/model-adaptation/供应商/APIMart.md',
  },
  {
    providerId: 'bailian',
    displayName: '阿里云百炼',
    websiteUrl: 'https://www.aliyun.com/product/bailian',
    apiKeyUrl: 'https://bailian.console.aliyun.com/?apiKey=1#/api-key',
    websiteUrlKind: 'official',
    docs: 'docs/model-adaptation/供应商/百炼.md',
  },
  {
    providerId: 'bigmodel',
    displayName: '智谱 GLM（中国大陆）',
    websiteUrl: 'https://open.bigmodel.cn/',
    apiKeyUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
    websiteUrlKind: 'official',
    docs: 'docs/llm-adaptation/供应商/智谱GLM.md',
  },
  {
    providerId: 'bigmodel-global',
    displayName: 'Z.AI GLM（Global）',
    websiteUrl: 'https://z.ai/',
    apiKeyUrl: 'https://z.ai/manage-apikey/apikey-list',
    websiteUrlKind: 'official',
    docs: 'docs/llm-adaptation/供应商/智谱GLM.md',
  },
  {
    providerId: 'deepseek',
    displayName: 'DeepSeek',
    websiteUrl: 'https://www.deepseek.com/',
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
    websiteUrlKind: 'official',
    docs: 'docs/llm-adaptation/供应商/DeepSeek.md',
  },
  {
    providerId: 'fal',
    displayName: 'Fal',
    websiteUrl: 'https://fal.ai/',
    apiKeyUrl: 'https://fal.ai/dashboard/keys',
    websiteUrlKind: 'official',
    docs: 'docs/model-adaptation/供应商/Fal.md',
  },
  {
    providerId: 'groq',
    displayName: 'GroqCloud',
    websiteUrl: 'https://groq.com/',
    apiKeyUrl: 'https://console.groq.com/keys',
    websiteUrlKind: 'official',
    docs: 'docs/model-adaptation/供应商/Groq.md',
  },
  {
    providerId: 'grsai',
    displayName: 'Grsai',
    websiteUrl: 'https://grsai.ai/',
    apiKeyUrl: 'https://grsai.ai/zh/dashboard/api-keys',
    websiteUrlKind: 'official',
    docs: 'docs/model-adaptation/供应商/Grsai.md',
  },
  {
    providerId: 'kie',
    displayName: 'KIE',
    websiteUrl: 'https://kie.ai?ref=eef20ef0b0595cad227d45b29c635f6c',
    apiKeyUrl: 'https://kie.ai/api-key',
    websiteUrlKind: 'referral',
    docs: 'docs/model-adaptation/供应商/KIE.md',
  },
  {
    providerId: 'kimi',
    displayName: 'Kimi（月之暗面）',
    websiteUrl: 'https://platform.kimi.com/',
    apiKeyUrl: 'https://platform.kimi.com/console/api-keys',
    websiteUrlKind: 'official',
    docs: 'docs/llm-adaptation/供应商/Kimi.md',
  },
  {
    providerId: 'minimax',
    displayName: 'MiniMax',
    websiteUrl: 'https://platform.minimaxi.com/',
    apiKeyUrl: 'https://platform.minimaxi.com/console/access?tab=api-keys',
    websiteUrlKind: 'official',
    docs: 'docs/llm-adaptation/供应商/MiniMax.md',
  },
  {
    providerId: 'mimo',
    displayName: '小米 MiMo',
    websiteUrl: 'https://mimo.mi.com/',
    apiKeyUrl: 'https://platform.xiaomimimo.com/console/api-keys',
    websiteUrlKind: 'official',
    docs: 'docs/llm-adaptation/供应商/小米MiMo.md',
  },
  {
    providerId: 'modelscope',
    displayName: '魔搭',
    websiteUrl: 'https://www.modelscope.cn/',
    apiKeyUrl: 'https://modelscope.cn/my/myaccesstoken',
    websiteUrlKind: 'official',
    docs: 'docs/model-adaptation/供应商/魔搭.md',
  },
  {
    providerId: 'ppio',
    displayName: '派欧云',
    websiteUrl: 'https://ppio.com/user/register?invited_by=WGY0DZ',
    apiKeyUrl: 'https://ppio.com/settings/key-management',
    websiteUrlKind: 'referral',
    docs: 'docs/model-adaptation/供应商/派欧云.md',
  },
  {
    providerId: 'volcengine',
    displayName: '火山引擎（豆包）',
    websiteUrl: 'https://www.volcengine.com/product/ark',
    apiKeyUrl: 'https://console.volcengine.com/ark/region:cn-beijing/apiKey',
    websiteUrlKind: 'official',
    docs: 'docs/model-adaptation/供应商/火山引擎.md',
  },
]

/**
 * 按 providerId 获取公开入口。BigModel 可用 `endpointProfile: 'global'` 取得 Z.AI 地址。
 * 未登记的自定义供应商返回 `null`，调用方不应猜测其官网或密钥地址。
 */
export function findProviderMetadata(
  providerId: string,
  options: ProviderMetadataLookupOptions = {}
): ProviderMetadata | null {
  const normalized = providerId.trim().toLowerCase()
  const resolvedId = normalized === 'bigmodel' && options.endpointProfile?.trim().toLowerCase() === 'global'
    ? 'bigmodel-global'
    : normalized
  return PROVIDER_METADATA.find(provider => provider.providerId === resolvedId) ?? null
}

