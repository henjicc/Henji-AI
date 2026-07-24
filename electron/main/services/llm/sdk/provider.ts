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
import type { ModelStepInput } from '../../../../../src/core/llm/modelStep'
import { resolveOpenAiCompatibleEndpoint, resolvePpioChatEndpoint } from '../streaming'

export interface ModelStepHttpTrace {
  request?: AgentTraceHttpRequest
  response?: AgentTraceHttpResponse
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

export function createModelStepLanguageModel(
  input: ModelStepInput,
  apiKey: string,
  httpTrace?: ModelStepHttpTrace
): LanguageModel {
  const adapter = input.adapter?.trim().toLowerCase()
  const reasoning = input.reasoning
  const provider = createOpenAICompatible({
    name: 'openai-compatible',
    apiKey,
    baseURL: resolveModelStepBaseUrl(input),
    includeUsage: input.capabilities.usage,
    supportsStructuredOutputs: usesNativeJsonSchema(input),
    fetch: httpTrace ? createTraceFetch(httpTrace) : undefined,
    transformRequestBody: adapter === 'deepseek' && input.capabilities.reasoning && reasoning
      ? body => applyModelStepProviderNativeOptions(body, reasoning.enabled)
      : undefined,
  })
  return provider.chatModel(input.modelId)
}

function createTraceFetch(trace: ModelStepHttpTrace): FetchFunction {
  return async (input, init) => {
    const request = await buildTraceRequest(input, init)
    trace.request = sanitizeAgentTraceHttpRequest(request)
    try {
      const response = await globalThis.fetch(input, init)
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
      return response
    } catch (error) {
      trace.response = {
        errorBody: error instanceof Error ? error.message : String(error),
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

export function applyModelStepProviderNativeOptions(
  body: Record<string, unknown>,
  reasoningEnabled: boolean
): Record<string, unknown> {
  return { ...body, reasoning: reasoningEnabled }
}
