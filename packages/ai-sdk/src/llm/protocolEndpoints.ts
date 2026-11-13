import { getLlmEndpointProfileFamily, resolveLlmEndpointIdentity, type LlmEndpointIdentity } from './endpointProfiles'
import type { LlmApiProtocol } from './providerProtocolCore'
import { findLlmProviderPreset } from './providerPresets'

/**
 * 按协议解析 LLM 请求地址，模型步与轻量流式入口共用这一份。
 *
 * 地址来源依次是：调用方显式传入的自定义地址 → 端点配置里该协议的独立网关（如智谱 Responses 走 /api/v1）
 * → 端点配置的默认地址 → 供应商预设的官方地址 → 百炼按 endpointProfile（地域，缺省 cn-beijing）选通用域名。显式传入且与端点配置不同的地址视为自定义地址（代理、自建网关），
 * 按原样使用，不再与端点配置校验。
 */
export interface LlmProtocolEndpointInput extends LlmEndpointIdentity {
  adapter?: string
}

const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const PPIO_DEFAULT_BASE_URL = 'https://api.ppio.com/openai'
/** 派欧云 Responses 只在 /openai/v1 下（Chat 的根地址 /openai 会自动补 /v1） */
const PPIO_RESPONSES_BASE_URL = 'https://api.ppio.com/openai/v1'

/**
 * 百炼不带业务空间 ID 的地域通用域名（所有业务空间的密钥都能用；密钥与模型按地域独立，不能跨地域混用）。
 * 官方推荐的业务空间域名需要 WorkspaceId，只能由调用方传 baseUrl；德国、日本没有通用域名。
 * 通用域名自 2026-09-30 起不再支持新特性，现有能力照常可用。见 docs/llm-adaptation/供应商/百炼Qwen.md。
 */
const BAILIAN_REGION_BASE_URLS: Readonly<Record<string, string>> = {
  'cn-beijing': 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  'ap-southeast-1': 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  'us-east-1': 'https://dashscope-us.aliyuncs.com/compatible-mode/v1',
  'cn-hongkong': 'https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1',
}

function resolveBailianRegionBaseUrl(region: string | undefined): string {
  const key = region?.trim().toLowerCase() || 'cn-beijing'
  const base = BAILIAN_REGION_BASE_URLS[key]
  if (!base) {
    throw new Error(`[llm_base_url_required] 百炼地域 "${key}" 没有通用域名，请传入业务空间域名 baseUrl（https://{WorkspaceId}.${key}.maas.aliyuncs.com/compatible-mode/v1）。`)
  }
  return base
}

function stripProtocolPath(endpoint: string): string {
  return endpoint.replace(/\/+$/, '').replace(/\/(?:chat\/completions|responses)\/?$/, '')
}

function resolveEndpointProfile(input: LlmProtocolEndpointInput) {
  const identityWithoutBaseUrl = resolveLlmEndpointIdentity({ ...input, baseUrl: undefined })
  const family = getLlmEndpointProfileFamily(identityWithoutBaseUrl.providerFamilyId)
  return family?.profiles.find(item => item.id === identityWithoutBaseUrl.endpointProfile)
}

/**
 * 调用方传入的自定义地址（代理、自建网关、未登记供应商）；与端点配置或供应商预设的官方地址相同时视为未自定义。
 * 自定义地址能接哪些协议无从得知，协议自动选择据此退回 Chat Completions。
 */
export function resolveCustomLlmBaseUrl(input: LlmProtocolEndpointInput): string | undefined {
  const supplied = input.baseUrl?.trim() ? stripProtocolPath(input.baseUrl.trim()) : undefined
  if (!supplied) return undefined
  const profile = resolveEndpointProfile(input)
  const official = [
    profile?.baseUrl,
    ...Object.values(profile?.protocolBaseUrls ?? {}),
    findLlmProviderPreset(input.providerFamilyId ?? input.providerId)?.baseUrl,
    ...((input.providerFamilyId ?? input.providerId).trim().toLowerCase() === 'bailian' ? Object.values(BAILIAN_REGION_BASE_URLS) : []),
  ].filter((value): value is string => Boolean(value)).map(stripProtocolPath)
  return official.includes(supplied) ? undefined : supplied
}

/** 返回不含 /chat/completions 或 /responses 的协议根地址；无法确定时抛出可改正的错误。 */
export function resolveLlmProtocolBaseUrl(input: LlmProtocolEndpointInput, protocol: LlmApiProtocol): string {
  const customBaseUrl = resolveCustomLlmBaseUrl(input)
  if (customBaseUrl) return customBaseUrl
  const profile = resolveEndpointProfile(input)
  const protocolBaseUrl = profile?.protocolBaseUrls?.[protocol] ? stripProtocolPath(profile.protocolBaseUrls[protocol]) : undefined
  const identity = resolveLlmEndpointIdentity(input)
  const familyId = identity.providerFamilyId
  const adapter = input.adapter?.trim().toLowerCase()
  const presetBaseUrl = findLlmProviderPreset(familyId)?.baseUrl || (adapter ? findLlmProviderPreset(adapter)?.baseUrl : undefined)
  const base = protocolBaseUrl
    ?? (identity.baseUrl ? stripProtocolPath(identity.baseUrl) : undefined)
    ?? (presetBaseUrl ? stripProtocolPath(presetBaseUrl) : undefined)
    ?? (familyId === 'openai' || adapter === 'openai' ? OPENAI_DEFAULT_BASE_URL : undefined)
    ?? (familyId === 'ppio' ? PPIO_DEFAULT_BASE_URL : undefined)
    ?? (familyId === 'bailian' ? resolveBailianRegionBaseUrl(input.endpointProfile) : undefined)
  if (!base) throw new Error(`[llm_base_url_required] LLM provider "${input.providerId}" requires baseUrl.`)
  return base
}

/** Chat Completions 完整地址：根地址以 /vN 结尾时直接接 /chat/completions，否则补 /v1。 */
export function resolveLlmChatCompletionsEndpoint(input: LlmProtocolEndpointInput): string {
  const base = resolveLlmProtocolBaseUrl(input, 'openai-compatible')
  return /\/v\d+$/.test(base) ? `${base}/chat/completions` : `${base}/v1/chat/completions`
}

/**
 * Responses 完整地址：根地址之后直接接 /responses，不补版本段（DeepSeek 官方为 https://api.deepseek.com/responses，
 * 自建网关按原厂路径挂在根上）。派欧云默认地址例外，它的 Responses 只在 /openai/v1 下。
 */
export function resolveLlmResponsesEndpoint(input: LlmProtocolEndpointInput): string {
  const base = resolveLlmProtocolBaseUrl(input, 'openai-responses')
  return `${base === PPIO_DEFAULT_BASE_URL ? PPIO_RESPONSES_BASE_URL : base}/responses`
}
