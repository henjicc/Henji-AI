import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  cancelLlmChatTask,
  parseModelProviderError,
  runLlmChatStream,
  type LlmChatRequestDto,
  type RuntimeContext,
} from '../../src/llm/streaming/index'

const structuredFixture = JSON.parse(readFileSync(
  path.resolve(__dirname, '../fixtures/llm/openai-chat-structured-stream.json'),
  'utf8',
)) as {
  request: { response_format: Record<string, unknown> }
  events: Array<Record<string, unknown>>
  rejection: Record<string, unknown>
}

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

function fixtureSseResponse(): Response {
  const source = [
    ...structuredFixture.events.flatMap(event => [`data: ${JSON.stringify(event)}`, '']),
    'data: [DONE]',
    '',
  ].join('\n')
  const bytes = new TextEncoder().encode(source)
  const midpoint = Math.floor(bytes.length / 2)
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, midpoint))
      controller.enqueue(bytes.slice(midpoint))
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
      truncated: false,
    })
  })

  it('最终 HTTP 请求体包含结构化输出、思考和输出上限，hook 修改不会替代正式构建', async () => {
    let sentBody: Record<string, unknown> | undefined
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      return fixtureSseResponse()
    })
    const schemaConfig = structuredFixture.request.response_format as {
      json_schema: { name: string; schema: Record<string, unknown>; strict: boolean }
    }

    const outcome = await runLlmChatStream({
      ...request,
      capabilities: {
        reasoning: true,
        structuredOutputMode: 'schema',
        structuredOutputWithReasoning: true,
        maxOutputTokens: 32_000,
      },
      reasoning: { enabled: true, effort: 'high' },
      structuredOutput: {
        type: 'json_schema',
        name: schemaConfig.json_schema.name,
        schema: schemaConfig.json_schema.schema,
        strict: schemaConfig.json_schema.strict,
      },
      maxOutputTokens: 24_000,
    }, 'structured-stream', () => undefined, runtime(fetch), {
      onRequestBuilt(info) {
        info.requestPayload.max_tokens = 1
        info.requestPayload.response_format = { type: 'text' }
      },
    })

    expect(sentBody).toMatchObject({
      response_format: structuredFixture.request.response_format,
      reasoning_effort: 'high',
      max_completion_tokens: 24_000,
    })
    expect(outcome).toMatchObject({
      output: '{"segments":[{"text":"完成"}]}',
      reasoningOutput: '整理',
      finishReason: 'stop',
      truncated: false,
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

  it('外部 AbortSignal 会中止 Transport，且无需设置请求总时限', async () => {
    const controller = new AbortController()
    let requestStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => { requestStarted = resolve })
    const fetch = vi.fn(async (_url: string, init?: RequestInit): Promise<Response> => {
      requestStarted?.()
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
          once: true,
        })
      })
    })

    const running = runLlmChatStream(
      { ...request, requestId: 'external-abort-fixture' },
      'external-abort-fixture',
      () => undefined,
      runtime(fetch),
      {},
      { signal: controller.signal }
    )
    await started
    controller.abort()

    await expect(running).rejects.toThrow('[task_cancelled] LLM task cancelled: external-abort-fixture')
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

  it('服务端拒绝 response_format 时保留供应商错误码与可行动信息', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(structuredFixture.rejection), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    }))

    let caught: unknown
    try {
      await runLlmChatStream(request, 'structured-rejected', () => undefined, runtime(fetch))
    } catch (error) {
      caught = error
    }
    expect(parseModelProviderError(caught)).toMatchObject({
      code: 'unsupported_response_format',
      category: 'invalid_request',
      status: 400,
    })
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toContain('does not support response_format')
  })

  it('finish_reason=length 明确标记输出被 token 上限截断', async () => {
    const fetch = vi.fn(async () => new Response([
      'data: {"choices":[{"delta":{"content":"未完"},"finish_reason":null}]}',
      '',
      'data: {"choices":[{"delta":{},"finish_reason":"length"}]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n'), { status: 200, headers: { 'content-type': 'text/event-stream' } }))

    await expect(runLlmChatStream(
      { ...request, maxOutputTokens: 32 },
      'truncated-output',
      () => undefined,
      runtime(fetch)
    )).resolves.toMatchObject({ output: '未完', finishReason: 'length', truncated: true })
  })

  it('不支持的结构化输出组合返回可解析错误码且不会发送请求', async () => {
    const fetch = vi.fn(async () => fixtureSseResponse())
    let caught: unknown
    try {
      await runLlmChatStream({
        ...request,
        structuredOutput: { type: 'json_object' },
      }, 'unsupported-structured-output', () => undefined, runtime(fetch))
    } catch (error) {
      caught = error
    }

    expect(parseModelProviderError(caught)).toMatchObject({
      code: 'STRUCTURED_OUTPUT_JSON_OBJECT_UNSUPPORTED',
      category: 'invalid_request',
      status: 400,
    })
    expect(fetch).not.toHaveBeenCalled()
  })
})
