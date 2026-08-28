import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  cancelTask,
  clearCancelFlag,
  registerAbortController,
  type RuntimeContext,
} from '../../../src/runtime'
import { cancelModelStepTask, classifyModelStepError, runModelStep } from '../../../src/llm/sdk/runtime'
import type { ModelStepInput } from '../../../src/llm/modelStep'

const responsesFixture = JSON.parse(readFileSync(
  path.resolve(__dirname, '../../fixtures/llm/openai-responses-text.json'),
  'utf8',
)) as { events: Array<Record<string, unknown>> }

function responsesInput(patch: Partial<ModelStepInput> = {}): ModelStepInput {
  return {
    requestId: 'responses-request',
    runId: 'responses-run',
    stepId: 'responses-step',
    providerId: 'deepseek',
    modelId: 'deepseek-v4-pro',
    adapter: 'deepseek',
    apiProtocol: 'openai-responses',
    baseUrl: 'https://api.deepseek.com',
    messages: [{ role: 'user', content: '测试' }],
    output: { mode: 'text' },
    capabilities: {
      image: false, video: false, audio: false, streaming: true, toolCall: false,
      parallelTools: false, structuredOutputMode: 'none', reasoning: true, sampling: true, usage: true,
    },
    reasoning: { enabled: true, effort: 'high' },
    settings: { maxRetries: 0 },
    ...patch,
  }
}

describe('classifyModelStepError', () => {
  it('把显式取消归一化为 task_cancelled', () => {
    const controller = new AbortController()
    registerAbortController('llm', 'request-cancel', controller)
    cancelTask('llm', 'request-cancel')
    expect(classifyModelStepError('request-cancel', new Error('network closed')).message)
      .toContain('[task_cancelled]')
    clearCancelFlag('llm', 'request-cancel')
  })

  it('保留既有错误码并为未知错误分类', () => {
    expect(classifyModelStepError('request-1', new Error('[api_key_missing] missing')).message)
      .toBe('[api_key_missing] missing')
    expect(classifyModelStepError('request-2', new Error('boom')).message)
      .toBe('[model_step_failed] boom')
  })

  it('Vercel 模型步经宿主 Transport 发流式请求', async () => {
    const fetch = vi.fn(async () => new Response([
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,"model":"test-model","choices":[{"index":0,"delta":{"role":"assistant","content":"完成"},"finish_reason":null}]}',
      '',
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":1,"model":"test-model","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n'), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }))
    const runtime: RuntimeContext = {
      transport: { fetch },
      credentials: { get: () => 'test-key' },
      media: {
        read: async () => ({
          bytes: new Uint8Array(),
          mimeType: 'application/octet-stream',
          filename: 'unused',
        }),
      },
    }
    const input = {
      requestId: 'transport-request',
      runId: 'transport-run',
      stepId: 'transport-step',
      providerId: 'test-provider',
      modelId: 'test-model',
      baseUrl: 'https://example.com/v1',
      messages: [{ role: 'user', content: '测试' }],
      output: { mode: 'text' },
      capabilities: {
        image: false,
        video: false,
        audio: false,
        streaming: true,
        toolCall: false,
        parallelTools: false,
        structuredOutputMode: 'none',
        reasoning: false,
        sampling: true,
        usage: true,
      },
      settings: { maxRetries: 0 },
    } as ModelStepInput

    await expect(runModelStep(input, () => undefined, runtime)).resolves.toMatchObject({
      text: '完成',
      finishReason: 'stop',
    })
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch.mock.calls[0]?.[0]).toBe('https://example.com/v1/chat/completions')
  })

  it('Responses 协议发送 /responses、关闭服务端存储并解析标准事件流', async () => {
    const fetch = vi.fn(async () => new Response(
      `${responsesFixture.events.map(event => `data: ${JSON.stringify(event)}`).join('\n\n')}\n\n`,
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ))
    const runtime: RuntimeContext = {
      transport: { fetch },
      credentials: { get: () => 'responses-key' },
      media: { read: async () => { throw new Error('fixture does not read media') } },
    }
    const input = responsesInput()

    await expect(runModelStep(input, () => undefined, runtime)).resolves.toMatchObject({
      text: '完成',
      finishReason: 'stop',
      usage: { inputTokens: 3, cacheReadTokens: 1, outputTokens: 2, totalTokens: 5 },
    })
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch.mock.calls[0]?.[0]).toBe('https://api.deepseek.com/responses')
    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as Record<string, unknown>
    expect(body).toMatchObject({
      model: 'deepseek-v4-pro',
      stream: true,
      store: false,
      thinking: { type: 'enabled' },
      reasoning_effort: 'high',
    })
    expect(body).not.toHaveProperty('messages')
    expect(body).toHaveProperty('input')
  })

  it('Responses 的 response.failed 不会被当成半成功结果', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const failed = {
      type: 'response.failed',
      sequence_number: 2,
      response: {
        error: { code: 'invalid_request', message: 'fixture failed' },
        incomplete_details: null,
        usage: null,
        reasoning: null,
        service_tier: null,
      },
    }
    const runtime: RuntimeContext = {
      transport: { fetch: async () => new Response(`data: ${JSON.stringify(failed)}\n\n`, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }) },
      credentials: { get: () => 'responses-key' },
      media: { read: async () => { throw new Error('fixture does not read media') } },
    }
    await expect(runModelStep(responsesInput({ requestId: 'responses-failed' }), () => undefined, runtime))
      .rejects.toThrow(/fixture failed|provider/)
    consoleError.mockRestore()
  })

  it('Responses 工具调用保持助手既有 ToolCall 契约', async () => {
    const events = [
      { type: 'response.created', response: { id: 'resp_tool', created_at: 1, model: 'deepseek-v4-pro', service_tier: null } },
      {
        type: 'response.output_item.added', output_index: 0,
        item: { type: 'function_call', id: 'item_tool', call_id: 'call_tool', name: 'lookup', arguments: '' },
      },
      { type: 'response.function_call_arguments.delta', item_id: 'item_tool', output_index: 0, delta: '{"q":"fixture"}' },
      {
        type: 'response.output_item.done', output_index: 0,
        item: {
          type: 'function_call', id: 'item_tool', call_id: 'call_tool', name: 'lookup',
          arguments: '{"q":"fixture"}', status: 'completed',
        },
      },
      {
        type: 'response.completed',
        response: {
          incomplete_details: null,
          usage: { input_tokens: 4, output_tokens: 2 },
          reasoning: null,
          service_tier: null,
        },
      },
    ]
    const runtime: RuntimeContext = {
      transport: { fetch: async () => new Response(
        `${events.map(event => `data: ${JSON.stringify(event)}`).join('\n\n')}\n\n`,
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      ) },
      credentials: { get: () => 'responses-key' },
      media: { read: async () => { throw new Error('fixture does not read media') } },
    }
    const input = responsesInput({
      capabilities: { ...responsesInput().capabilities, toolCall: true },
      tools: [{ name: 'lookup', inputSchema: { type: 'object', properties: { q: { type: 'string' } } } }],
    })
    await expect(runModelStep(input, () => undefined, runtime)).resolves.toMatchObject({
      finishReason: 'tool-calls',
      toolCalls: [{ toolCallId: 'call_tool', toolName: 'lookup', input: { q: 'fixture' } }],
    })
  })

  it('取消 Responses 请求会传递 AbortSignal 并统一成 task_cancelled', async () => {
    let aborted = false
    const fetch = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        aborted = true
        reject(new DOMException('aborted', 'AbortError'))
      }, { once: true })
    }))
    const runtime: RuntimeContext = {
      transport: { fetch },
      credentials: { get: () => 'responses-key' },
      media: { read: async () => { throw new Error('fixture does not read media') } },
    }
    const promise = runModelStep(responsesInput({ requestId: 'responses-cancelled' }), () => undefined, runtime)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    cancelModelStepTask('responses-cancelled')
    await expect(promise).rejects.toThrow('MODEL_STEP_CANCELLED')
    expect(aborted).toBe(true)
  })
})
