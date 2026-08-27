import { describe, expect, it, vi } from 'vitest'

import {
  cancelLlmChatTask,
  parseModelProviderError,
  runLlmChatStream,
  type LlmChatRequestDto,
  type RuntimeContext,
} from '../../src/llm/streaming/index'

const request: LlmChatRequestDto = {
  requestId: 'uxp-stream-fixture',
  providerId: 'openai',
  modelId: 'fixture-model',
  baseUrl: 'https://fixture.invalid/v1',
  messages: [{ role: 'user', content: '你好' }],
}

function runtime(fetch: RuntimeContext['transport']['fetch']): RuntimeContext {
  return {
    transport: { fetch },
    credentials: { get: async () => 'fixture-key' },
    media: { read: async () => { throw new Error('fixture does not read media') } },
  }
}

function utf8ChunkedResponse(): Response {
  const source = [
    'data: {"choices":[{"delta":{"reasoning_content":"思考"},"finish_reason":null}]}',
    '',
    'data: {"choices":[{"delta":{"content":"完成✅"},"finish_reason":null}]}',
    '',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":4,"total_tokens":7,"prompt_tokens_details":{"cached_tokens":1},"completion_tokens_details":{"reasoning_tokens":2}}}',
    '',
    'data: [DONE]',
    '',
  ].join('\n')
  const bytes = new TextEncoder().encode(source)
  const multiByteStart = bytes.findIndex((value, index) => value === 0xe6 && bytes[index + 1] === 0x80)
  const cuts = [multiByteStart + 1, multiByteStart + 2, multiByteStart + 13, bytes.length]
  let offset = 0
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const cut of cuts) {
        controller.enqueue(bytes.slice(offset, cut))
        offset = cut
      }
      controller.close()
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

describe('@henjicc/ai-sdk/llm/streaming', () => {
  it('跨 UTF-8 与 SSE chunk 保留 reasoning、text、usage、stop 和 DONE', async () => {
    const fetch = vi.fn(async () => utf8ChunkedResponse())
    const events: Array<{ type: string; data: unknown }> = []

    const outcome = await runLlmChatStream(
      request,
      request.requestId ?? 'missing',
      (event) => events.push(event),
      runtime(fetch)
    )

    expect(fetch).toHaveBeenCalledOnce()
    expect(events).toEqual([
      { type: 'ReasoningToken', data: '思考' },
      { type: 'Token', data: '完成✅' },
    ])
    expect(outcome).toMatchObject({
      output: '完成✅',
      reasoningOutput: '思考',
      finishReason: 'stop',
      usage: {
        inputTokens: 3,
        outputTokens: 4,
        reasoningTokens: 2,
        cacheReadTokens: 1,
        cacheWriteTokens: null,
        totalTokens: 7,
      },
    })
  })

  it('取消同一 taskId 会中止 Transport 且归一为 task_cancelled', async () => {
    let requestStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => { requestStarted = resolve })
    const fetch = vi.fn(async (_url: string, init?: RequestInit): Promise<Response> => {
      requestStarted?.()
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        }, { once: true })
      })
    })

    const running = runLlmChatStream(
      { ...request, requestId: 'uxp-abort-fixture' },
      'uxp-abort-fixture',
      () => undefined,
      runtime(fetch)
    )
    await started
    cancelLlmChatTask('uxp-abort-fixture')

    await expect(running).rejects.toThrow('[task_cancelled] LLM task cancelled: uxp-abort-fixture')
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('供应商 HTTP 错误保持旧 provider_error wire format', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      error: { code: 'invalid_api_key', message: 'Invalid API key' },
    }), { status: 401, headers: { 'content-type': 'application/json' } }))

    let caught: unknown
    try {
      await runLlmChatStream(request, 'uxp-provider-error', () => undefined, runtime(fetch))
    } catch (error) {
      caught = error
    }
    expect(parseModelProviderError(caught)).toMatchObject({
      code: 'invalid_api_key',
      category: 'authentication',
      providerId: 'openai',
      modelId: 'fixture-model',
    })
  })
})
