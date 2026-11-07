import {
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_DEEPSEEK_PROVIDER_ID,
  DEFAULT_PPIO_BASE_URL,
  DEFAULT_PPIO_PROVIDER_ID,
  createLlmCapabilitiesForModel,
} from './defaults'
import { findLlmModelCatalogEntry, modelSupportsLlmApiProtocol } from './modelCatalog'
import { GROQ_PROVIDER_PRESET } from './groq/preset'
import { SILICONFLOW_PROVIDER_PRESET } from './siliconflow/preset'
import { createBigmodelProvider } from './bigmodel/preset'
import { BIGMODEL_ENDPOINT_PROFILE_FAMILY } from './bigmodel/profiles'
import type { LlmApiProtocol } from './providerProtocol'
import { tokenListPrice, tokenPrice, type TokenListPricing } from '../pricing/tokenPricing'
import type { LlmCapabilities, LlmModelConfig, LlmProviderConfig, LlmReasoningEffort } from './types'
import { findProviderMetadata } from '../providers/metadata'

function providerMetadata(providerId: string): NonNullable<ReturnType<typeof findProviderMetadata>> {
  const metadata = findProviderMetadata(providerId)
  if (!metadata) throw new Error(`[provider_metadata_missing] provider "${providerId}" is not registered`)
  return metadata
}

/**
 * 内置供应商预设。
 *
 * 供应商本身仍然是用户自建的（本项目不像生成模型那样把供应商写成固定枚举），预设只是把
 * `docs/llm-adaptation/供应商/*.md` 里核对过的 Base URL、思考参数默认值和推荐模型打包好，
 * 让"添加一个火山引擎"从"自己去翻文档抄 URL、再逐个勾能力"变成选一下。
 *
 * 选了预设之后所有字段仍可改——预设是起点不是约束。
 */
export interface LlmProviderPreset {
  providerId: string
  displayName: string
  adapter: string
  apiProtocol: LlmApiProtocol
  /** 官方 Base URL；与账号或工作区绑定、无法给出通用值时留空，改用 `baseUrlHint` 指路 */
  baseUrl: string
  baseUrlHint?: string
  reasoning: { enabled: boolean; effort: LlmReasoningEffort }
  /** 思考模式能否由用户关闭；模型侧写死始终思考的记 false，设置页会隐藏该下拉 */
  reasoningConfigurable: boolean
  /** 添加该供应商时一并建好的推荐模型，能力按内置目录自动标注 */
  modelIds: readonly string[]
  /** 托管供应商已核验的能力覆盖；不能把原厂能力无条件套给聚合接口。 */
  modelCapabilities?: Readonly<Record<string, Partial<LlmCapabilities>>>
  /** 这家供应商已确认可走 Responses 的具体模型；未列出的模型继续走 Chat Completions。 */
  responsesModelIds?: readonly string[]
  /** 这家供应商对推荐模型公布的按量标准价，出处写在 docs 指向的资料里；没查到的模型不登记。 */
  modelPricing?: Readonly<Record<string, TokenListPricing>>
  websiteUrl: string
  apiKeyUrl: string
  /** 该预设的资料出处，仓库内相对路径 */
  docs: string
  note?: string
}

const DEEPSEEK_PEAK_HOURS = '北京时间工作日 09:00–12:00、14:00–18:00'

export const LLM_PROVIDER_PRESETS: readonly LlmProviderPreset[] = [
  GROQ_PROVIDER_PRESET,
  SILICONFLOW_PROVIDER_PRESET,
  {
    providerId: DEFAULT_PPIO_PROVIDER_ID,
    displayName: '派欧云',
    adapter: 'openai',
    apiProtocol: 'openai-compatible',
    baseUrl: DEFAULT_PPIO_BASE_URL,
    reasoning: { enabled: false, effort: 'high' },
    reasoningConfigurable: false,
    // 2026-11-07 按派欧云模型列表核对；已过时的条目在建模型时自动跳过。
    modelIds: [
      'deepseek/deepseek-v4-pro',
      'deepseek/deepseek-v4.1-flash',
      'moonshotai/kimi-k3.1-pro',
      'moonshotai/kimi-k3',
      'zai-org/glm-5.3',
      'xiaomimimo/mimo-v2.6-pro',
      'minimax/minimax-m3.1-flash',
      'moonshotai/kimi-k2.6',
    ],
    // 模型详情页刊例价；页面只显示当前时段的实际价，DeepSeek V4.1 Flash 的高峰价在“查看其他时段刊例价”里。
    // Kimi 另计缓存写入（K3.1 Pro 5 分钟 13、K3 5 分钟 20 元/百万），不在这里登记。
    modelPricing: {
      'deepseek/deepseek-v4-pro': tokenListPrice('CNY', 9, 27, 3),
      'deepseek/deepseek-v4.1-flash': { ...tokenListPrice('CNY', 2, 8, 0.04), offPeak: { ...tokenPrice(1, 4, 0.02), peakHours: DEEPSEEK_PEAK_HOURS } },
      'moonshotai/kimi-k3.1-pro': tokenListPrice('CNY', 13, 68, 1.3),
      'moonshotai/kimi-k3': tokenListPrice('CNY', 20, 100, 2),
      'zai-org/glm-5.3': tokenListPrice('CNY', 8, 28, 2),
      'xiaomimimo/mimo-v2.6-pro': tokenListPrice('CNY', 3, 6, 0.025),
      'minimax/minimax-m3.1-flash': tokenListPrice('CNY', 1, 4, 0.1),
      'moonshotai/kimi-k2.6': tokenListPrice('CNY', 6.5, 27, 1.1),
    },
    websiteUrl: providerMetadata(DEFAULT_PPIO_PROVIDER_ID).websiteUrl,
    apiKeyUrl: providerMetadata(DEFAULT_PPIO_PROVIDER_ID).apiKeyUrl,
    docs: 'docs/llm-adaptation/README.md',
    note: '聚合网关，模型 ID 带厂商前缀；留空密钥时会复用主生成设置里的派欧云密钥。',
  },
  {
    providerId: DEFAULT_DEEPSEEK_PROVIDER_ID,
    displayName: 'DeepSeek',
    adapter: 'deepseek',
    apiProtocol: 'openai-compatible',
    baseUrl: DEFAULT_DEEPSEEK_BASE_URL,
    reasoning: { enabled: true, effort: 'high' },
    reasoningConfigurable: true,
    modelIds: ['deepseek-flash', 'deepseek-v4-pro'],
    responsesModelIds: ['deepseek-flash', 'deepseek-v4-pro'],
    // 官方价格页按北京时间工作日高峰 / 其余闲时两档计价（高峰不含法定节假日）。
    modelPricing: {
      'deepseek-flash': { ...tokenListPrice('CNY', 2, 8, 0.04), offPeak: { ...tokenPrice(1, 4, 0.02), peakHours: DEEPSEEK_PEAK_HOURS } },
      'deepseek-v4-pro': { ...tokenListPrice('CNY', 9, 27, 0.3), offPeak: { ...tokenPrice(4.5, 13.5, 0.15), peakHours: DEEPSEEK_PEAK_HOURS } },
    },
    websiteUrl: providerMetadata(DEFAULT_DEEPSEEK_PROVIDER_ID).websiteUrl,
    apiKeyUrl: providerMetadata(DEFAULT_DEEPSEEK_PROVIDER_ID).apiKeyUrl,
    docs: 'docs/llm-adaptation/供应商/DeepSeek.md',
  },
  {
    providerId: 'volcengine',
    displayName: '火山引擎（豆包）',
    adapter: 'openai',
    apiProtocol: 'openai-compatible',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    reasoning: { enabled: true, effort: 'high' },
    reasoningConfigurable: true,
    modelIds: [
      'doubao-seed-evolving', 'doubao-seed-2-1-pro-260915', 'doubao-seed-2-1-lite-260915', 'doubao-seed-2-1-turbo-260628',
      'doubao-seed-2-0-lite-260428', 'doubao-seed-2-0-mini-260428', 'doubao-seed-character-260628',
      'deepseek-v4-1-flash-261017', 'deepseek-v4-1-flash-economy-261017', 'deepseek-v4-pro-ga-260813', 'deepseek-v4-flash-ga-260731',
      'kimi-k3-1-pro-261024', 'glm-5-3-flash-260828', 'glm-5-2-260617',
    ],
    // 方舟说明 250615 以后的大模型默认支持 Responses；托管的第三方模型未逐个核实字段兼容，留在 Chat。
    responsesModelIds: [
      'doubao-seed-evolving', 'doubao-seed-2-1-pro-260915', 'doubao-seed-2-1-lite-260915', 'doubao-seed-2-1-turbo-260628',
      'doubao-seed-2-0-lite-260428', 'doubao-seed-2-0-mini-260428', 'doubao-seed-character-260628',
    ],
    // 常规在线推理价；分档按单次请求输入长度落档（官方单位为千 token）。音频输入另有单价，不在这里展开。
    modelPricing: {
      'doubao-seed-evolving': tokenListPrice('CNY', 6, 30, 1.2),
      'doubao-seed-2-1-pro-260915': tokenListPrice('CNY', 6, 30, 1.2),
      'doubao-seed-2-1-lite-260915': tokenListPrice('CNY', 0.8, 2.7, 0.16),
      'doubao-seed-2-1-turbo-260628': tokenListPrice('CNY', 3, 15, 0.6),
      'doubao-seed-2-0-lite-260428': { ...tokenListPrice('CNY', 0.6, 3.6, 0.12), tiers: [{ ...tokenPrice(0.9, 5.4, 0.18), aboveInputTokens: 32_000 }, { ...tokenPrice(1.8, 10.8, 0.36), aboveInputTokens: 128_000 }] },
      'doubao-seed-2-0-mini-260428': { ...tokenListPrice('CNY', 0.2, 2, 0.04), tiers: [{ ...tokenPrice(0.4, 4, 0.08), aboveInputTokens: 32_000 }, { ...tokenPrice(0.8, 8, 0.16), aboveInputTokens: 128_000 }] },
      'doubao-seed-character-260628': { ...tokenListPrice('CNY', 0.8, 2, 0.16), tiers: [{ ...tokenPrice(1.2, 6, 0.16), aboveInputTokens: 32_000 }] },
      'deepseek-v4-1-flash-261017': { ...tokenListPrice('CNY', 2, 8, 0.04), offPeak: { ...tokenPrice(1, 4, 0.02), peakHours: DEEPSEEK_PEAK_HOURS } },
      'deepseek-v4-1-flash-economy-261017': { ...tokenListPrice('CNY', 1.6, 6.4, 0.032), offPeak: { ...tokenPrice(0.8, 3.2, 0.016), peakHours: DEEPSEEK_PEAK_HOURS } },
      'deepseek-v4-pro-ga-260813': tokenListPrice('CNY', 9, 27, 0.3),
      'deepseek-v4-flash-ga-260731': tokenListPrice('CNY', 3, 9, 0.1),
      'kimi-k3-1-pro-261024': tokenListPrice('CNY', 13, 68, 1.3),
      'glm-5-3-flash-260828': tokenListPrice('CNY', 0.8, 2.8, 0.23),
      'glm-5-2-260617': tokenListPrice('CNY', 8, 28, 2),
    },
    websiteUrl: providerMetadata('volcengine').websiteUrl,
    apiKeyUrl: providerMetadata('volcengine').apiKeyUrl,
    docs: 'docs/llm-adaptation/供应商/火山引擎.md',
    note: 'Base URL 与区域相关，其他区域的地址在方舟控制台查看；联网搜索等内置工具只在 Responses API 可用。',
  },
  {
    providerId: 'kimi',
    displayName: 'Kimi（月之暗面）',
    adapter: 'openai',
    apiProtocol: 'openai-compatible',
    baseUrl: 'https://api.moonshot.cn/v1',
    // K3 系列始终思考、无法关闭，只能调强度，所以不给"关闭"这个选项。
    reasoning: { enabled: true, effort: 'max' },
    reasoningConfigurable: true,
    modelIds: ['kimi-k3.1-pro', 'kimi-k3.1-pro-highspeed', 'kimi-k3'],
    // 原厂 K3 系列：采样参数固定、必须省略；结构化输出支持 json_schema 且可与思考同用。
    // 视频只收 Files API 上传后的 ms://<file-id>，SDK 没有这条上传链路，所以不声明视频。
    modelCapabilities: Object.fromEntries(['kimi-k3.1-pro', 'kimi-k3.1-pro-highspeed', 'kimi-k3'].map(modelId => [modelId, {
      image: true, video: false, audio: false,
      structuredOutputMode: 'schema' as const, structuredOutputWithReasoning: true, sampling: false,
      contextWindow: 1_048_576, maxOutputTokens: 131_072,
    }])),
    // 缓存写入按存放时长另计（5 分钟与输入同价、1 小时翻倍），不在这里登记；不按上下文长度分档。
    modelPricing: {
      'kimi-k3.1-pro': tokenListPrice('CNY', 13, 68, 1.3),
      'kimi-k3.1-pro-highspeed': tokenListPrice('CNY', 26, 136, 1.3),
      'kimi-k3': tokenListPrice('CNY', 20, 100, 2),
    },
    websiteUrl: providerMetadata('kimi').websiteUrl,
    apiKeyUrl: providerMetadata('kimi').apiKeyUrl,
    docs: 'docs/llm-adaptation/供应商/Kimi.md',
    note: '文档站是 platform.kimi.com，但接口域名仍是 moonshot.cn，不要混用；K3 系列需要充值后才能调用。K3.1 Pro Highspeed 速度约为 K3.1 Pro 的 2～3 倍。K3 系列思考无法关闭，思考模式选「关闭」时按最低强度发送。',
  },
  {
    providerId: 'bigmodel',
    displayName: '智谱 GLM',
    adapter: 'openai',
    apiProtocol: 'openai-compatible',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    reasoning: { enabled: true, effort: 'max' },
    reasoningConfigurable: true,
    modelIds: ['glm-5.3', 'glm-5v-turbo', 'glm-5.3-flash', 'glm-5.3-flashx'],
    responsesModelIds: ['glm-5.3'],
    // 中国大陆标准价（划线前价格，不含限时折扣）。
    modelPricing: {
      'glm-5.3': tokenListPrice('CNY', 8, 28, 2),
      'glm-5v-turbo': { ...tokenListPrice('CNY', 5, 22, 1.2), tiers: [{ ...tokenPrice(7, 26, 1.8), aboveInputTokens: 32_000 }] },
      'glm-5.3-flash': tokenListPrice('CNY', 0.8, 2.8, 0.23),
      'glm-5.3-flashx': tokenListPrice('CNY', 2, 7, 0.57),
    },
    websiteUrl: providerMetadata('bigmodel').websiteUrl,
    apiKeyUrl: providerMetadata('bigmodel').apiKeyUrl,
    docs: 'docs/llm-adaptation/供应商/智谱GLM.md',
    note: '默认是中国大陆端点；Global 必须创建独立 endpoint profile 与凭据槽，不会跨区复用或回退密钥。',
  },
  {
    providerId: 'mimo',
    displayName: '小米 MiMo',
    adapter: 'openai',
    apiProtocol: 'openai-compatible',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    reasoning: { enabled: true, effort: 'high' },
    reasoningConfigurable: true,
    modelIds: ['mimo-v2.6-pro', 'mimo-v2.6-flash'],
    responsesModelIds: ['mimo-v2.6-pro', 'mimo-v2.6-flash', 'mimo-v2.6-pro-ultraspeed'],
    modelPricing: {
      'mimo-v2.6-pro': tokenListPrice('CNY', 3, 6, 0.025),
      'mimo-v2.6-flash': tokenListPrice('CNY', 1, 2, 0.02),
    },
    websiteUrl: providerMetadata('mimo').websiteUrl,
    apiKeyUrl: providerMetadata('mimo').apiKeyUrl,
    docs: 'docs/llm-adaptation/供应商/小米MiMo.md',
    note: '2.5 系列将于北京时间 2026-10-21 10:00 下线；已有模型选择保持不变，请主动迁移到 2.6。UltraSpeed 需要另行开通。',
  },
  {
    providerId: 'minimax',
    displayName: 'MiniMax',
    adapter: 'openai',
    apiProtocol: 'openai-compatible',
    // 官方国内接口域名已改为 minimax.cn（旧域名 minimaxi.com 仍可用）。
    baseUrl: 'https://api.minimax.cn/v1',
    reasoning: { enabled: true, effort: 'high' },
    reasoningConfigurable: true,
    modelIds: ['MiniMax-M3.1-Flash', 'MiniMax-M3'],
    responsesModelIds: ['MiniMax-M3'],
    // 原厂 M3.1 Flash 收图片与视频；思考无法关闭；temperature / top_p 被固定，不下发；
    // 官方没写结构化输出与最大输出长度，保持未声明。
    modelCapabilities: {
      'MiniMax-M3.1-Flash': {
        image: true, video: true, audio: false,
        structuredOutputMode: 'none', sampling: false, contextWindow: 1_000_000, maxOutputTokens: null,
      },
    },
    // M3 按输入长度两档；官方标注“永久五折”，按折后价登记。
    modelPricing: {
      'MiniMax-M3.1-Flash': tokenListPrice('CNY', 1, 4, 0.1),
      'MiniMax-M3': { ...tokenListPrice('CNY', 2.1, 8.4, 0.42), tiers: [{ ...tokenPrice(4.2, 16.8, 0.84), aboveInputTokens: 512_000 }] },
    },
    websiteUrl: providerMetadata('minimax').websiteUrl,
    apiKeyUrl: providerMetadata('minimax').apiKeyUrl,
    docs: 'docs/llm-adaptation/供应商/MiniMax.md',
  },
  {
    providerId: 'bailian',
    displayName: '阿里云百炼（Qwen）',
    adapter: 'openai',
    apiProtocol: 'openai-compatible',
    // 百炼的兼容接口地址带工作区 ID 和地域，没有可以写死的通用值。
    baseUrl: '',
    baseUrlHint: '形如 https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1，在百炼控制台模型页的「查看代码」里复制当前值。',
    reasoning: { enabled: true, effort: 'high' },
    reasoningConfigurable: true,
    modelIds: [
      'qwen3.8-max', 'qwen3.8-flash', 'qwen3.7-plus',
      'deepseek-v4.1-flash', 'deepseek-v4-pro-0813', 'kimi-k3.1-pro', 'kimi-k3', 'glm-5.3',
      'MiniMax/MiniMax-M3.1-Flash', 'xiaomi/mimo-v2.6-pro-ultraspeed', 'stepfun/step-5-preview',
    ],
    // 百炼 Responses 支持清单里的模型；kimi-k3 虽在清单里，但原厂 Kimi 不支持 Responses，目录按模型登记协议，留在 Chat。
    responsesModelIds: ['qwen3.8-max', 'qwen3.8-flash', 'qwen3.7-plus', 'deepseek-v4.1-flash', 'deepseek-v4-pro-0813', 'glm-5.3'],
    // 华北2（北京）原价；DeepSeek 按忙时（北京时间 08:00–22:00）/ 闲时两档。计费页没有单列缓存价的不登记。
    modelPricing: {
      'qwen3.8-max': tokenListPrice('CNY', 12, 36),
      'qwen3.8-flash': tokenListPrice('CNY', 0.8, 2.7),
      'qwen3.7-plus': { ...tokenListPrice('CNY', 2, 8), tiers: [{ ...tokenPrice(6, 24), aboveInputTokens: 256_000 }] },
      'deepseek-v4.1-flash': { ...tokenListPrice('CNY', 2, 8), offPeak: { ...tokenPrice(1, 4), peakHours: '北京时间 08:00–22:00' } },
      'deepseek-v4-pro-0813': { ...tokenListPrice('CNY', 9, 27), offPeak: { ...tokenPrice(4.5, 13.5), peakHours: '北京时间 08:00–22:00' } },
      'kimi-k3.1-pro': tokenListPrice('CNY', 13, 68, 1.3),
      'kimi-k3': tokenListPrice('CNY', 20, 100),
      'glm-5.3': tokenListPrice('CNY', 8, 28),
      'MiniMax/MiniMax-M3.1-Flash': tokenListPrice('CNY', 1, 4),
      'xiaomi/mimo-v2.6-pro-ultraspeed': tokenListPrice('CNY', 30, 60),
      'stepfun/step-5-preview': tokenListPrice('CNY', 7, 20),
    },
    websiteUrl: providerMetadata('bailian').websiteUrl,
    apiKeyUrl: providerMetadata('bailian').apiKeyUrl,
    docs: 'docs/llm-adaptation/供应商/百炼Qwen.md',
    note: 'qwen3.8-max 走 Chat 时必须用多模态消息格式，纯文本也要写成内容块数组。三方直供模型的 Model ID 带厂商前缀（如 MiniMax/MiniMax-M3.1-Flash）。',
  },
]

export function findLlmProviderPreset(providerId: string): LlmProviderPreset | null {
  const normalized = providerId.trim().toLowerCase()
  return LLM_PROVIDER_PRESETS.find(preset => preset.providerId === normalized) ?? null
}

export function resolvePresetModelApiProtocol(
  preset: LlmProviderPreset,
  modelId: string,
  endpointProfile?: string
): LlmApiProtocol {
  if (preset.providerId === 'bigmodel' && (endpointProfile ?? 'cn') !== 'cn') {
    return 'openai-compatible'
  }
  const modelEntry = findLlmModelCatalogEntry(modelId, preset.providerId)
  const normalizedModelId = modelEntry?.id ?? modelId.trim().toLowerCase()
  // 带厂商前缀的是平台上的另一条渠道（如百炼 ZHIPU/GLM-5.3 与 glm-5.3），Responses 支持要按原写法单独确认。
  const routed = (value: string): boolean => value.includes('/')
  const supportsResponses = preset.responsesModelIds?.some(candidate => (
    routed(candidate) || routed(modelId)
      ? candidate.trim().toLowerCase() === modelId.trim().toLowerCase()
      : (findLlmModelCatalogEntry(candidate, preset.providerId)?.id ?? candidate.trim().toLowerCase()) === normalizedModelId
  )) === true
  return supportsResponses && modelEntry && modelSupportsLlmApiProtocol(modelEntry, 'openai-responses')
    ? 'openai-responses'
    : 'openai-compatible'
}

export function createProviderFromPreset(
  preset: LlmProviderPreset,
  options: { endpointProfile?: string; providerId?: string; lifecycle?: 'builtin' | 'user' } = {}
): LlmProviderConfig {
  if (preset.providerId === 'bigmodel') {
    const endpointProfile = options.endpointProfile
    if (endpointProfile !== undefined && endpointProfile !== 'cn' && endpointProfile !== 'global') {
      throw new Error(`[llm_endpoint_profile_unknown] bigmodel endpoint profile "${endpointProfile}" is unavailable`)
    }
    return createBigmodelProvider({
      endpointProfile,
      providerId: options.providerId,
      lifecycle: options.lifecycle,
    })
  }
  return {
    providerId: options.providerId ?? preset.providerId,
    ...(preset.providerId === 'siliconflow' ? { providerFamilyId: preset.providerId } : {}),
    credentialId: options.providerId ?? preset.providerId,
    setup: {
      kind: 'preset',
      presetId: preset.providerId,
      lifecycle: options.lifecycle ?? 'user',
    },
    displayName: preset.displayName,
    adapter: preset.adapter,
    apiProtocol: preset.apiProtocol,
    baseUrl: preset.baseUrl || undefined,
    reasoning: { ...preset.reasoning },
    reasoningConfigurable: preset.reasoningConfigurable,
    enabled: true,
  }
}

/** 预设推荐模型；能力全部按内置目录标注，目录里没有的退回纯文本默认值。 */
export function createModelsFromPreset(
  preset: LlmProviderPreset,
  provider: LlmProviderConfig
): LlmModelConfig[] {
  const modelIds = preset.providerId === 'bigmodel'
    ? BIGMODEL_ENDPOINT_PROFILE_FAMILY.profiles.find(profile => profile.id === (provider.endpointProfile ?? 'cn'))?.modelIds
    : preset.modelIds
  if (!modelIds) {
    throw new Error(`[llm_endpoint_profile_unknown] bigmodel endpoint profile "${provider.endpointProfile}" is unavailable`)
  }
  return modelIds.flatMap((modelId) => {
    const entry = findLlmModelCatalogEntry(modelId, preset.providerId)
    if (entry?.deprecated) return []
    return [{
      providerId: provider.providerId,
      providerFamilyId: provider.providerFamilyId,
      endpointProfile: provider.endpointProfile,
      credentialId: provider.credentialId,
      modelId,
      displayName: entry?.displayName ?? modelId,
      adapter: provider.adapter,
      apiProtocol: resolvePresetModelApiProtocol(preset, modelId, provider.endpointProfile),
      baseUrl: provider.baseUrl,
      capabilities: { ...createLlmCapabilitiesForModel(modelId, preset.providerId), ...preset.modelCapabilities?.[modelId] },
      catalogId: entry?.id,
      enabled: true,
    }]
  })
}
