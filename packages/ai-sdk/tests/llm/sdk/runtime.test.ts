import { describe, expect, it, vi } from 'vitest'

import {
  cancelTask,
  clearCancelFlag,
  registerAbortController,
  type RuntimeContext,
} from '../../../src/runtime'
import { classifyModelStepError, runModelStep } from '../../../src/llm/sdk/runtime'
import type { ModelStepInput } from '../../../src/llm/modelStep'

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
})
