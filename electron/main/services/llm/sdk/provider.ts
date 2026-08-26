import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { FetchFunction } from '@ai-sdk/provider-utils'
import type { LanguageModel } from 'ai'

import {
  sanitizeAgentTraceHeaders,
  sanitizeAgentTraceHttpRequest,
  sanitizeAgentTraceHttpResponse,
  sanitizeAgentTraceUrl,
} from '../../../../../src/core/assistant/traceSanitize'
import type { AgentTraceHttpRequest, AgentTraceHttpResponse } from '../../../../../src/core/assistant/trace'
import type { ModelStepInput, ModelStepUsage } from '../../../../../src/core/llm/modelStep'
import {
  applyProviderRequestBodyQuirks,
  resolveProviderExtraAuthHeaders,
} from '../../../../../src/core/llm/providerProtocol'
import { applyProviderReasoningRequestBody } from '../../../../../src/core/llm/providerReasoningRequest'
import { resolveOpenAiCompatibleEndpoint, resolvePpioChatEndpoint } from '../streaming'
import {
  modelStepProviderAdapters,
  type ModelStepHttpTrace,
  type ModelStepProviderAdapter,
} from './provider-adapter'
export type { ModelStepHttpTrace } from './provider-adapter'

interface DeepSeekUsage {
  prompt_cache_hit_tokens?: unknown
  prompt_cache_miss_tokens?: unknown
  prompt_tokens?: unknown
}

function stripChatCompletions(endpoint: string): string {
  return endpoint.replace(/\/chat\/completions\/?$/, '')
}


export function resolveModelStepBaseUrl(input: Pick<ModelStepInput, 'providerId' | 'adapter' | 'baseUrl'>): string {
  const normalizedInput = {
    ...input,
    baseUrl: input.baseUrl ? stripChatCompletions(input.baseUrl.replace(/\/+$/, '')) : undefined,
  }
  const endpoint = input.providerId.trim().toLowerCase() === 'ppio'
    ? resolvePpioChatEndpoint(normalizedInput.baseUrl)
    : resolveOpenAiCompatibleEndpoint({
        providerId: normalizedInput.providerId,
        modelId: 'placeholder',
        adapter: normalizedInput.adapter,
        baseUrl: normalizedInput.baseUrl,
        messages: [],
      })
  return stripChatCompletions(endpoint)
}

function createOpenAiCompatibleLanguageModel(
  input: ModelStepInput,
  apiKey: string,
  httpTrace?: ModelStepHttpTrace
): LanguageModel {
  const adapter = input.adapter?.trim().toLowerCase()
  const reasoning = input.reasoning
  const provider = createOpenAICompatible({
    name: 'openai-compatible',
    apiKey,
    headers: resolveProviderExtraAuthHeaders(input.providerId, apiKey),
    baseURL: resolveModelStepBaseUrl(input),
    includeUsage: input.capabilities.usage,
    supportsStructuredOutputs: usesNativeJsonSchema(input),
    fetch: httpTrace && (httpTrace.captureHttp || adapter === 'deepseek')
      ? createTraceFetch(httpTrace, {
          captureHttp: httpTrace.captureHttp === true,
          captureDeepSeekUsage: adapter === 'deepseek',
        })
      : undefined,
    // 两类差异叠加：各供应商的思考参数写法，以及各家对请求体字段的自有要求。
    transformRequestBody: (body) => applyProviderRequestBodyQuirks(
      input.providerId,
      input.capabilities.reasoning
        ? applyProviderReasoningRequestBody(input.providerId, adapter, body, reasoning)
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
modelStepProviderAdapters.register(openAiCompatibleAdapter)

export function createModelStepLanguageModel(
  input: ModelStepInput,
  apiKey: string,
  httpTrace?: ModelStepHttpTrace
): LanguageModel {
  const protocol = input.apiProtocol ?? 'openai-compatible'
  modelStepProviderAdapters.assertInputModalities(protocol, input)
  return modelStepProviderAdapters.resolve(protocol).createLanguageModel(input, apiKey, httpTrace)
}

function createTraceFetch(
  trace: ModelStepHttpTrace,
  options: { captureHttp: boolean; captureDeepSeekUsage: boolean }
): FetchFunction {
  return async (input, init) => {
    if (options.captureHttp) {
      const request = await buildTraceRequest(input, init)
      trace.request = sanitizeAgentTraceHttpRequest(request)
    }
    try {
      const response = await globalThis.fetch(input, init)
      if (options.captureHttp) {
        const responseTrace: AgentTraceHttpResponse = {
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
        trace.response = sanitizeAgentTraceHttpResponse(responseTrace)
      }
      if (options.captureDeepSeekUsage && response.ok) {
        trace.usageCapture = captureDeepSeekUsage(response).then((usage) => {
          if (usage) trace.deepSeekUsage = usage
        }).catch(() => undefined)
      }
      return response
    } catch (error) {
      if (options.captureHttp) {
        trace.response = {
          errorBody: error instanceof Error ? error.message : String(error),
        }
      }
      throw error
    }
  }
}

async function buildTraceRequest(
  input: FetchInput,
  init?: FetchInit
): Promise<AgentTraceHttpRequest> {
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
    url: sanitizeAgentTraceUrl(isRequest(input) ? input.url : String(input)),
    headers: sanitizeAgentTraceHeaders(headersToRecord(requestHeaders)),
    body,
  }
}

function headersToRecord(headers: unknown): Record<string, string> {
  if (!headers) return {}
  if (headers instanceof Headers) return Object.fromEntries(headers.entries())
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

