import { describe, expect, it, vi } from 'vitest'

import {
  parseModelProviderError,
  type RuntimeContext,
  type Tracer,
} from '../../src/runtime'
import {
  runLlmChatStream,
  type LlmChatRequestDto,
} from '../../src/llm'

const request: LlmChatRequestDto = {
  requestId: 'chat-request',
  providerId: 'openai',
  modelId: 'test-model',
  baseUrl: 'https://example.com/v1',
  messages: [{ role: 'user', content: '测试' }],
}

function createRuntime(fetch: RuntimeContext['transport']['fetch'], tracer?: Tracer): RuntimeContext {
  return {
    transport: { fetch },
    credentials: { get: () => 'test-key' },
    media: {
      read: async () => ({
        bytes: new Uint8Array(),
        mimeType: 'application/octet-stream',
        filename: 'unused',
      }),
    },
    tracer,
  }
}

describe('runLlmChatStream 公共运行时抽象', () => {
  it('流式请求经统一 Transport，且通过公共 Tracer 记录 span', async () => {
    const fetch = vi.fn(async () => new Response([
      'data: {"choices":[{"delta":{"content":"完成"}}]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n'), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }))
    const traceEvents: string[] = []
    const tracer: Tracer = {
      startSpan: (name) => {
        traceEvents.push(`start:${name}`)
        return { end: (error) => traceEvents.push(error ? `failed:${name}` : `end:${name}`) }
      },
    }
    const emitted: string[] = []

    await expect(runLlmChatStream(
      request,
      request.requestId ?? 'missing',
      (event) => emitted.push(event.type),
      createRuntime(fetch, tracer)
    )).resolves.toMatchObject({ providerId: 'openai', modelId: 'test-model', outputChars: 2 })

    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch.mock.calls[0]?.[0]).toBe('https://example.com/v1/chat/completions')
    expect(emitted).toEqual(['Token'])
    expect(traceEvents).toEqual(['start:llm.chat', 'end:llm.chat'])
  })

  it('错误 Key 的 401 响应归一化为可解析的鉴权错误且不重试', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      error: { code: 'invalid_api_key', message: 'Invalid API key' },
    }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    }))

    let caught: unknown
    try {
      await runLlmChatStream(
        request,
        request.requestId ?? 'missing',
        () => undefined,
        createRuntime(fetch)
      )
    } catch (error) {
      caught = error
    }

    expect(parseModelProviderError(caught)).toMatchObject({
      code: 'invalid_api_key',
      category: 'authentication',
      retryable: false,
      providerId: 'openai',
      modelId: 'test-model',
    })
    expect(fetch).toHaveBeenCalledOnce()
  })
})
