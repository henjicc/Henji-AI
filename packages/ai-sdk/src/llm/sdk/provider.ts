import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createOpenAI } from '@ai-sdk/openai'
import type { FetchFunction } from '@ai-sdk/provider-utils'
import type { LanguageModel } from 'ai'

import { fetchProvider } from '../../providers/provider-fetch'
import type { Transport } from '../../runtime'
import type { ModelStepInput, ModelStepUsage } from '../modelStep'
import {
  applyProviderRequestBodyQuirks,
  resolveProviderExtraAuthHeaders,
} from '../providerProtocol'
import { applyProviderReasoningRequestBody } from '../providerReasoningRequest'
import { resolveOpenAiCompatibleEndpoint, resolvePpioChatEndpoint } from '../streaming'
import {
  modelStepProviderAdapters,
  type ModelStepHttpCaptureRequest,
  type ModelStepHttpCaptureResponse,
  type ModelStepHttpTrace,
  type ModelStepProviderAdapter,
} from './providerAdapter'
import { getLlmEndpointProfileFamily, resolveLlmEndpointIdentity } from '../endpointProfiles'
// `ModelStepHttpTrace` 不在这里重新导出——`./providerAdapter` 是它的唯一定义处，
// 由 `sdk/index.ts` 的桶文件统一 `export * from './providerAdapter'`。这里再导出一次会与
// 桶文件里的 `export * from './providerAdapter'` 产生同名重复导出（TS 报 "has already
// exported a member"）。消费方需要这个类型时从 `@henjicc/ai-sdk` 包根拿即可，不需要从
// `provider.ts` 专门再导出一份。

/**
 * 任务 4.2 从应用侧 LLM 执行层迁入 SDK。
 *
 * `createTraceFetch` 原来在捕获 HTTP 请求/响应时立即调用痕迹AI 助手侧的
 * `sanitizeAgentTraceHttpRequest`/`sanitizeAgentTraceHttpResponse` 做脱敏。这里改成只捕获
 * 原始值——脱敏只应该在"数据即将被持久化/展示"的那一刻做一次，而下游
 * `electron/main/services/llm/sdk/trace.ts`（留在痕迹AI，见重要记录.md 记录 014）的
 * `buildModelStepTraceDetail` 本来就会对 `httpTrace.request`/`.response` 再脱敏一遍——
 * 原实现因此对同一份数据脱敏了两次。去掉这里的脱敏调用后：
 * 1. 脱敏只发生一次（在真正落盘前），行为不变；
 * 2. SDK 不再需要依赖痕迹AI 应用侧的脱敏实现，满足 SDK 不能 `@/` 引用的约束。
 *
 * 任务 4.3 把 Vercel AI SDK 模型步的 fetch 接到统一的 `fetchProvider` 网络入口。
 * `transport` 作为第 4 个可选参数追加，前三个位置参数保持不变，因此痕迹AI utility 子进程的
 * 既有调用无需改签名；公共 `runModelStep` 路径会始终显式传入宿主 `Transport`。只有直接调用
 * `createModelStepLanguageModel` 且没有传 Transport 的 Electron 兼容路径才退回全局 fetch，
 * 该退回仍然经过 `fetchProvider` 的安全预连接策略，不再另写一套网络判断。
 */

interface DeepSeekUsage {
  prompt_cache_hit_tokens?: unknown
  prompt_cache_miss_tokens?: unknown
  prompt_tokens?: unknown
}

function stripProtocolEndpoint(endpoint: string): string {
  return endpoint.replace(/\/(?:chat\/completions|responses)\/?$/, '')
}

export function resolveModelStepBaseUrl(input: Pick<ModelStepInput, 'providerId' | 'providerFamilyId' | 'endpointProfile' | 'credentialId' | 'adapter' | 'apiProtocol' | 'baseUrl'>): string {
  const protocol = input.apiProtocol ?? 'openai-compatible'
  const identityWithoutBaseUrl = resolveLlmEndpointIdentity({ ...input, baseUrl: undefined })
  const family = getLlmEndpointProfileFamily(identityWithoutBaseUrl.providerFamilyId)
  const profile = family?.profiles.find(item => item.id === identityWithoutBaseUrl.endpointProfile)
  const suppliedBaseUrl = input.baseUrl ? stripProtocolEndpoint(input.baseUrl.replace(/\/+$/, '')) : undefined
  const profileBaseUrl = profile ? stripProtocolEndpoint(profile.baseUrl.replace(/\/+$/, '')) : undefined
  const selectedProtocolBaseUrl = profile?.protocolBaseUrls?.[protocol]
    ? stripProtocolEndpoint(profile.protocolBaseUrls[protocol].replace(/\/+$/, ''))
    : undefined
  const hasExplicitBaseUrlOverride = Boolean(
    suppliedBaseUrl
    && suppliedBaseUrl !== profileBaseUrl
    && suppliedBaseUrl !== selectedProtocolBaseUrl
  )
  const identity = hasExplicitBaseUrlOverride
    ? identityWithoutBaseUrl
    : resolveLlmEndpointIdentity(input)
  const normalizedInput = {
    ...input,
    providerId: identity.providerFamilyId,
    baseUrl: hasExplicitBaseUrlOverride
      ? suppliedBaseUrl
      : selectedProtocolBaseUrl
        ? selectedProtocolBaseUrl
      : identity.baseUrl ? stripProtocolEndpoint(identity.baseUrl.replace(/\/+$/, '')) : undefined,
  }
  if (protocol === 'openai-responses') {
    const baseUrl = normalizedInput.baseUrl
      ?? (identity.providerFamilyId === 'openai' ? 'https://api.openai.com/v1' : undefined)
    if (!baseUrl) throw new Error('[llm_base_url_required] Responses API requires an explicit baseUrl')
    return baseUrl
  }
  const endpoint = identity.providerFamilyId === 'ppio'
    ? resolvePpioChatEndpoint(normalizedInput.baseUrl)
    : resolveOpenAiCompatibleEndpoint({
        providerId: normalizedInput.providerId,
        modelId: 'placeholder',
        adapter: normalizedInput.adapter,
        baseUrl: normalizedInput.baseUrl,
        messages: [],
      })
  return stripProtocolEndpoint(endpoint)
}

function createOpenAiCompatibleLanguageModel(
  input: ModelStepInput,
  apiKey: string,
  httpTrace?: ModelStepHttpTrace,
  transport?: Transport
): LanguageModel {
  const adapter = input.adapter?.trim().toLowerCase()
  const identity = resolveLlmEndpointIdentity(input)
  const reasoning = input.reasoning
  const provider = createOpenAICompatible({
    name: 'openai-compatible',
    apiKey,
    headers: resolveProviderExtraAuthHeaders(identity.providerFamilyId, apiKey),
    baseURL: resolveModelStepBaseUrl(input),
    includeUsage: input.capabilities.usage,
    supportsStructuredOutputs: usesNativeJsonSchema(input),
    fetch: createModelStepFetch(identity.providerFamilyId, httpTrace, transport, {
      captureHttp: httpTrace?.captureHttp === true,
      captureDeepSeekUsage: adapter === 'deepseek',
    }),
    // 两类差异叠加：各供应商的思考参数写法，以及各家对请求体字段的自有要求。
    transformRequestBody: (body) => applyProviderRequestBodyQuirks(
      identity.providerFamilyId,
      input.capabilities.reasoning
        ? applyProviderReasoningRequestBody(identity.providerFamilyId, adapter, body, reasoning)
        : body,
    ),
  })
  return provider.chatModel(input.modelId)
}

const openAiCompatibleAdapter: ModelStepProviderAdapter = {
  protocol: 'openai-compatible',
  // 当前 AI SDK 转换器支持图片与内联 wav/mp3，不支持视频文件。
  supportedInputModalities: ['image', 'audio'],
  createLanguageModel: createOpenAiCompatibleLanguageModel,
}
function createOpenAiResponsesLanguageModel(
  input: ModelStepInput,
  apiKey: string,
  httpTrace?: ModelStepHttpTrace,
  transport?: Transport
): LanguageModel {
  const identity = resolveLlmEndpointIdentity(input)
  const adapter = input.adapter?.trim().toLowerCase()
  const provider = createOpenAI({
    name: 'openai',
    apiKey,
    headers: resolveProviderExtraAuthHeaders(identity.providerFamilyId, apiKey),
    baseURL: resolveModelStepBaseUrl(input),
    fetch: createModelStepFetch(identity.providerFamilyId, httpTrace, transport, {
      captureHttp: httpTrace?.captureHttp === true,
      captureDeepSeekUsage: adapter === 'deepseek',
      transformRequestBody: body => applyProviderRequestBodyQuirks(
        identity.providerFamilyId,
        input.capabilities.reasoning
          ? applyProviderReasoningRequestBody(identity.providerFamilyId, adapter, body, input.reasoning)
          : body,
      ),
    }),
  })
  return provider.responses(input.modelId)
}

const openAiResponsesAdapter: ModelStepProviderAdapter = {
  protocol: 'openai-responses',
  supportedInputModalities: ['image', 'audio'],
  createLanguageModel: createOpenAiResponsesLanguageModel,
}

let builtInAdaptersInitialized = false

function ensureOpenAiCompatibleAdapterInitialized(): void {
  if (builtInAdaptersInitialized) return
  modelStepProviderAdapters.register(openAiCompatibleAdapter)
  modelStepProviderAdapters.register(openAiResponsesAdapter)
  builtInAdaptersInitialized = true
}

/**
 * 显式解析模型步 adapter，并在首次使用时惰性装入内置 openai-compatible 实现。
 * 不在模块加载阶段注册，确保发布包可以如实声明 `sideEffects: false`。
 */
export function resolveModelStepProviderAdapter(
  protocol: ModelStepProviderAdapter['protocol']
): ModelStepProviderAdapter {
  ensureOpenAiCompatibleAdapterInitialized()
  return modelStepProviderAdapters.resolve(protocol)
}

export function createModelStepLanguageModel(
  input: ModelStepInput,
  apiKey: string,
  httpTrace?: ModelStepHttpTrace,
  transport?: Transport
): LanguageModel {
  const protocol = input.apiProtocol ?? 'openai-compatible'
  const adapter = resolveModelStepProviderAdapter(protocol)
  modelStepProviderAdapters.assertInputModalities(protocol, input)
  return adapter.createLanguageModel(input, apiKey, httpTrace, transport)
}

function createModelStepFetch(
  providerId: string,
  trace: ModelStepHttpTrace | undefined,
  transport: Transport | undefined,
  options: {
    captureHttp: boolean
    captureDeepSeekUsage: boolean
    transformRequestBody?: (body: Record<string, unknown>) => Record<string, unknown>
  }
): FetchFunction {
  return async (input, init) => {
    try {
      const request = applyFetchRequestBodyTransform(
        await normalizeFetchRequest(input, init),
        options.transformRequestBody,
      )
      if (options.captureHttp && trace) {
        trace.request = await buildTraceRequest(request.url, request.init)
      }
      const response = await fetchProvider(providerId, request.url, request.init ?? {}, {
        transport: transport ?? globalFetchTransport(),
        retryPreconnectOnce: true,
      })
      if (options.captureHttp && trace) {
        const responseTrace: ModelStepHttpCaptureResponse = {
          status: response.status,
          statusText: response.statusText,
          headers: headersToRecord(response.headers),
        }
        if (!response.ok) {
          try {
            const body = await response.clone().text()
            responseTrace.errorBody = body.slice(0, 64 * 1024)
          } catch {
            // 某些供应商的错误响应无法克隆，不影响原请求返回。
          }
        }
        trace.response = responseTrace
      }
      if (options.captureDeepSeekUsage && response.ok && trace) {
        trace.usageCapture = captureDeepSeekUsage(response).then((usage) => {
          if (usage) trace.deepSeekUsage = usage
        }).catch(() => undefined)
      }
      return response
    } catch (error) {
      if (options.captureHttp && trace) {
        trace.response = {
          errorBody: error instanceof Error ? error.message : String(error),
        }
      }
      throw error
    }
  }
}

function applyFetchRequestBodyTransform(
  request: { url: string; init?: RequestInit },
  transform: ((body: Record<string, unknown>) => Record<string, unknown>) | undefined
): { url: string; init?: RequestInit } {
  if (!transform || typeof request.init?.body !== 'string') return request
  try {
    const parsed = JSON.parse(request.init.body) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return request
    return {
      ...request,
      init: { ...request.init, body: JSON.stringify(transform(parsed as Record<string, unknown>)) },
    }
  } catch {
    return request
  }
}

function globalFetchTransport(): Transport {
  if (typeof globalThis.fetch !== 'function') {
    throw new Error('[TRANSPORT_REQUIRED] createModelStepLanguageModel requires a Transport in this runtime')
  }
  return { fetch: (url, init) => globalThis.fetch(url, init) }
}

async function normalizeFetchRequest(
  input: FetchInput,
  init?: FetchInit
): Promise<{ url: string; init?: RequestInit }> {
  if (!isRequest(input)) return { url: String(input), init }
  if (init) return { url: input.url, init }
  const method = input.method || 'GET'
  const body = method === 'GET' || method === 'HEAD'
    ? undefined
    : await input.clone().arrayBuffer()
  return {
    url: input.url,
    init: {
      method,
      headers: input.headers,
      body,
      signal: input.signal,
    },
  }
}

async function buildTraceRequest(
  input: FetchInput,
  init?: FetchInit
): Promise<ModelStepHttpCaptureRequest> {
  const requestHeaders = init?.headers ?? (isRequest(input) ? input.headers : undefined)
  let body: unknown = null
  if (typeof init?.body === 'string') {
    body = parseBody(init.body)
  } else if (isRequest(input) && init?.body === undefined) {
    try {
      body = parseBody(await input.clone().text())
    } catch {
      body = null
    }
  } else if (init?.body !== undefined && init.body !== null) {
    body = String(init.body)
  }
  return {
    method: init?.method ?? (isRequest(input) ? input.method : 'GET'),
    url: isRequest(input) ? input.url : String(input),
    headers: headersToRecord(requestHeaders),
    body,
  }
}

function headersToRecord(headers: unknown): Record<string, string> {
  if (!headers) return {}
  if (headers instanceof Headers) {
    // `Headers.entries()`/`[Symbol.iterator]` 需要 `DOM.Iterable` lib，SDK 的 tsconfig
    // 刻意只含 `["ES2022", "DOM"]`（见 tsconfig.json 顶部注释），不额外引入。`forEach` 是
    // 基础 `Headers` 接口自带的常规方法，不依赖迭代协议，三个目标运行时都能用。
    const record: Record<string, string> = {}
    headers.forEach((value, key) => { record[key] = value })
    return record
  }
  if (Array.isArray(headers)) return Object.fromEntries(headers.map((entry) => [String(entry[0]), String(entry[1])]))
  if (typeof headers === 'object') return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key, String(value)])
  )
  return {}
}

function parseBody(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

type FetchInput = Parameters<FetchFunction>[0]
type FetchInit = Parameters<FetchFunction>[1]

function isRequest(value: FetchInput): value is Request {
  return typeof value === 'object' && value !== null && 'url' in value && 'clone' in value
}

export function usesNativeJsonSchema(input: Pick<ModelStepInput, 'capabilities'>): boolean {
  return input.capabilities.structuredOutputMode === 'schema'
}

function toNonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : null
}

/** 将 DeepSeek 独有的缓存用量字段规范成统一的模型步骤统计。 */
export function applyDeepSeekUsage(
  usage: ModelStepUsage,
  rawUsage: DeepSeekUsage | undefined
): ModelStepUsage {
  if (!rawUsage) return usage
  const cacheReadTokens = toNonNegativeInteger(rawUsage.prompt_cache_hit_tokens)
  const inputNoCacheTokens = toNonNegativeInteger(rawUsage.prompt_cache_miss_tokens)
  const promptTokens = toNonNegativeInteger(rawUsage.prompt_tokens)
  if (cacheReadTokens === null && inputNoCacheTokens === null && promptTokens === null) return usage
  return {
    ...usage,
    inputTokens: promptTokens ?? usage.inputTokens ?? (
      cacheReadTokens !== null && inputNoCacheTokens !== null ? cacheReadTokens + inputNoCacheTokens : null
    ),
    inputNoCacheTokens: inputNoCacheTokens ?? usage.inputNoCacheTokens,
    cacheReadTokens: cacheReadTokens ?? usage.cacheReadTokens,
  }
}

async function captureDeepSeekUsage(response: Response): Promise<DeepSeekUsage | undefined> {
  const body = response.clone().body
  if (!body) return undefined
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  let usage: DeepSeekUsage | undefined
  let completed = false
  try {
    while (!completed) {
      const next = await reader.read()
      if (next.done) {
        completed = true
        continue
      }
      pending += decoder.decode(next.value, { stream: true })
      const lines = pending.split(/\r?\n/)
      pending = lines.pop() ?? ''
      for (const line of lines) {
        const parsed = parseSseUsage(line)
        if (parsed) usage = parsed
      }
    }
    const final = pending + decoder.decode()
    const parsed = parseSseUsage(final)
    return parsed ?? usage
  } finally {
    reader.releaseLock()
  }
}

function parseSseUsage(line: string): DeepSeekUsage | undefined {
  const data = line.trim().replace(/^data:\s*/, '')
  if (!data || data === '[DONE]') return undefined
  try {
    const value = JSON.parse(data) as { usage?: DeepSeekUsage }
    return value.usage
  } catch {
    return undefined
  }
}
