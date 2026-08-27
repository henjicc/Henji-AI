import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import {
  GROQ_BASE_URL,
  GROQ_DEFAULT_MODEL_CONFIG,
  GROQ_DEFAULT_MODEL_ID,
  GROQ_PROVIDER_ID,
  GROQ_PROVIDER_PRESET,
  createGroqChatRequest,
  discoverGroqModels,
  runGroqChatStream,
} from '../../src/llm/groq'
import { buildOpenAiCompatiblePayload } from '../../src/llm/streaming'
import { createLlmCapabilitiesForModel } from '../../src/llm/defaults'
import { parseModelProviderError } from '../../src/runtime'
import { normalizeProviderError } from '../../src/runtime/error-classify'
import type { RuntimeContext } from '../../src/runtime'

interface ModelsFixture {
  response: unknown
  expected: {
    modelId: string
    contextWindow: number
    maxOutputTokens: null
  }
}

interface StreamFixture {
  stream: string[]
  expected: {
    reasoning: string
    content: string
    finishReason: string
    inputTokens: number
    outputTokens: number
    reasoningTokens: number
    totalTokens: number
  }
}

interface ErrorFixture {
  status: number
  response: unknown
  expected: { category: string; status: number; retryable: boolean }
}

const FIXTURE_ROOT = path.resolve(__dirname, '../fixtures/groq')

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(path.join(FIXTURE_ROOT, name), 'utf8')) as T
}

function runtime(fetch: RuntimeContext['transport']['fetch'], credential = 'credential-placeholder'): RuntimeContext {
  return {
    transport: { fetch },
    credentials: { get: async () => credential },
    media: { read: async () => { throw new Error('Groq LLM fixture does not read media') } },
  }
}

function sseResponse(lines: string[]): Response {
  return new Response(`${lines.join('\n\n')}\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

describe('@henjicc/ai-sdk/llm/groq', () => {
  it('公开稳定坐标、默认模型与能力目录，并与 xAI Grok 分离', () => {
    expect(GROQ_PROVIDER_ID).toBe('groq')
    expect(GROQ_PROVIDER_ID).not.toBe('grok')
    expect(GROQ_BASE_URL).toBe('https://api.groq.com/openai/v1')
    expect(GROQ_DEFAULT_MODEL_ID).toBe('openai/gpt-oss-20b')
    expect(GROQ_PROVIDER_PRESET).toMatchObject({
      providerId: 'groq',
      modelIds: ['openai/gpt-oss-20b'],
      reasoning: { enabled: true, effort: 'medium' },
    })
    const catalogCapabilities = createLlmCapabilitiesForModel(GROQ_DEFAULT_MODEL_ID)
    expect(catalogCapabilities).toMatchObject({
      text: true,
      image: false,
      toolCall: true,
      structuredOutputMode: 'json',
      reasoning: true,
      contextWindow: 131_072,
      maxOutputTokens: 65_536,
    })
    expect(GROQ_DEFAULT_MODEL_CONFIG).toMatchObject({
      providerId: 'groq',
      modelId: GROQ_DEFAULT_MODEL_ID,
      capabilities: catalogCapabilities,
    })
  })

  it('请求构建复用共享内核并落实 Groq 的推理与字段限制', () => {
    const request = createGroqChatRequest({
      messages: [{ role: 'user', name: 'unsupported-name', content: 'hello' }],
      reasoning: { enabled: true, effort: 'xhigh' },
      capabilities: { reasoning: true },
      policy: { max_tokens: 256 },
    })
    const payload = buildOpenAiCompatiblePayload(request)
    expect(request).toMatchObject({
      providerId: 'groq',
      modelId: 'openai/gpt-oss-20b',
      adapter: 'openai',
      baseUrl: GROQ_BASE_URL,
    })
    expect(payload).toMatchObject({
      max_completion_tokens: 256,
      reasoning_effort: 'high',
      include_reasoning: true,
      messages: [{ role: 'user', content: 'hello' }],
    })
    expect(payload).not.toHaveProperty('max_tokens')
    expect(payload).not.toHaveProperty('reasoning_format')
  })

  it('流式 fixture 保留 reasoning、usage、finish 和答案，且使用官方端点与鉴权', async () => {
    const data = fixture<StreamFixture>('chat-stream-success.json')
    const fetch = vi.fn(async () => sseResponse(data.stream))
    const events: Array<{ type: string; data: unknown }> = []

    const outcome = await runGroqChatStream({
      messages: [{ role: 'user', content: 'fixture prompt' }],
      reasoning: { enabled: true, effort: 'medium' },
      capabilities: { reasoning: true },
      policy: { max_tokens: 256 },
    }, 'groq-stream', event => events.push(event), runtime(fetch))

    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch.mock.calls[0]?.[0]).toBe(`${GROQ_BASE_URL}/chat/completions`)
    const init = fetch.mock.calls[0]?.[1]
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer credential-placeholder')
    const sent = JSON.parse(String(init?.body)) as Record<string, unknown>
    expect(sent).toMatchObject({
      model: GROQ_DEFAULT_MODEL_ID,
      max_completion_tokens: 256,
      reasoning_effort: 'medium',
      include_reasoning: true,
    })
    expect(outcome).toMatchObject({
      output: data.expected.content,
      reasoningOutput: data.expected.reasoning,
      finishReason: data.expected.finishReason,
      usage: {
        inputTokens: data.expected.inputTokens,
        outputTokens: data.expected.outputTokens,
        reasoningTokens: data.expected.reasoningTokens,
        totalTokens: data.expected.totalTokens,
      },
    })
    expect(events).toEqual([
      { type: 'ReasoningToken', data: data.expected.reasoning },
      { type: 'Token', data: data.expected.content },
    ])
  })

  it('模型发现只返回 active 模型，读取 Groq 字段并下沉 AbortSignal', async () => {
    const data = fixture<ModelsFixture>('models-list-success.json')
    const fetch = vi.fn(async () => new Response(JSON.stringify(data.response), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))

    const models = await discoverGroqModels(runtime(fetch), { timeoutMs: 1_000 })

    expect(models).toEqual([{
      modelId: data.expected.modelId,
      displayName: data.expected.modelId,
      contextWindow: data.expected.contextWindow,
      maxOutputTokens: data.expected.maxOutputTokens,
    }])
    expect(fetch.mock.calls[0]?.[0]).toBe(`${GROQ_BASE_URL}/models`)
    const init = fetch.mock.calls[0]?.[1]
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer credential-placeholder')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('模型发现要求凭据，超时会中止请求且不泄漏凭据', async () => {
    const fetchWithoutKey = vi.fn(async () => new Response('{}'))
    await expect(discoverGroqModels(runtime(fetchWithoutKey, '')))
      .rejects.toThrow('[api_key_missing]')
    expect(fetchWithoutKey).not.toHaveBeenCalled()

    const blockingFetch = vi.fn(async (_url: string, init?: RequestInit): Promise<Response> => (
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
          once: true,
        })
      })
    ))
    await expect(discoverGroqModels(runtime(blockingFetch), { timeoutMs: 5 }))
      .rejects.toThrow('获取模型列表超时: groq')
  })

  it('官方错误体按共享协议归一且不泄漏凭据', async () => {
    const data = fixture<ErrorFixture>('chat-error.json')
    const fetch = vi.fn(async () => new Response(JSON.stringify(data.response), {
      status: data.status,
      headers: { 'content-type': 'application/json' },
    }))
    let caught: unknown
    try {
      await runGroqChatStream({ messages: [{ role: 'user', content: 'fixture prompt' }] },
        'groq-error', () => undefined, runtime(fetch))
    } catch (error) {
      caught = error
    }
    expect(parseModelProviderError(caught)).toMatchObject(data.expected)
    expect(String(caught)).not.toContain('credential-placeholder')
  })

  it('Groq 特有 498 容量不足可重试，499 归一为取消，413 不重试', () => {
    const context = { providerId: 'groq', modelId: GROQ_DEFAULT_MODEL_ID, requestId: 'groq-status' }
    const normalized = (statusCode: number) => normalizeProviderError(context, Object.assign(
      new Error(`LLM HTTP ${statusCode}`),
      { statusCode, responseBody: JSON.stringify({ error: { type: 'fixture' } }) }
    )).details
    expect(normalized(498)).toMatchObject({ category: 'server', retryable: true, status: 498 })
    expect(normalized(499)).toMatchObject({ category: 'cancelled', retryable: false, status: 499 })
    expect(normalized(413)).toMatchObject({ category: 'invalid_request', retryable: false, status: 413 })
  })

  it('外部 Abort 与 timeout 都中止同一共享 Transport；超时保留独立错误分类', async () => {
    const blockingFetch = vi.fn(async (_url: string, init?: RequestInit): Promise<Response> => {
      if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError')
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
          once: true,
        })
      })
    })
    const controller = new AbortController()
    const aborted = runGroqChatStream(
      { messages: [{ role: 'user', content: 'abort fixture' }] },
      'groq-abort',
      () => undefined,
      runtime(blockingFetch),
      { signal: controller.signal }
    )
    controller.abort()
    await expect(aborted).rejects.toThrow('[task_cancelled]')

    let timeoutError: unknown
    try {
      await runGroqChatStream(
        { messages: [{ role: 'user', content: 'timeout fixture' }] },
        'groq-timeout',
        () => undefined,
        runtime(blockingFetch),
        { timeoutMs: 5 }
      )
    } catch (error) {
      timeoutError = error
    }
    expect(parseModelProviderError(timeoutError)).toMatchObject({
      code: 'MODEL_REQUEST_TIMEOUT',
      category: 'network',
      retryable: true,
      providerId: 'groq',
      modelId: GROQ_DEFAULT_MODEL_ID,
    })
  })
})
