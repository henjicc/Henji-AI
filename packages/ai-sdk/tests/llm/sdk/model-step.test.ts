import { describe, expect, it, vi } from 'vitest'
import { simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'

import type { ModelStepInput } from '../../../src/llm/modelStep'
import {
  buildModelStepProviderOptions,
  executeModelStepWithModel,
  normalizeModelToolMessagePairs,
} from '../../../src/llm/sdk/modelStep'
import {
  applyDeepSeekUsage,
  resolveModelStepBaseUrl,
  usesNativeJsonSchema,
} from '../../../src/llm/sdk/provider'

const usage = {
  inputTokens: { total: 11, noCache: 7, cacheRead: 4, cacheWrite: 0 },
  outputTokens: { total: 5, text: 3, reasoning: 2 },
}

function createInput(patch: Partial<ModelStepInput> = {}): ModelStepInput {
  return {
    requestId: 'request-1',
    runId: 'run-1',
    stepId: 'step-1',
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
      toolCall: true,
      parallelTools: false,
      structuredOutputMode: 'schema',
      reasoning: true,
      sampling: true,
      usage: true,
    },
    ...patch,
  }
}

describe('executeModelStepWithModel', () => {
  it('单次流调用返回文本、思考、真实 usage 与 response messages', async () => {
    const model = new MockLanguageModelV3({
      doStream: {
        stream: simulateReadableStream({ chunks: [
          { type: 'text-start', id: 'text-1' },
          { type: 'text-delta', id: 'text-1', delta: '完成' },
          { type: 'text-end', id: 'text-1' },
          { type: 'reasoning-start', id: 'reasoning-1' },
          { type: 'reasoning-delta', id: 'reasoning-1', delta: '思考' },
          { type: 'reasoning-end', id: 'reasoning-1' },
          { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
        ] }),
      },
    })
    const events: string[] = []
    const result = await executeModelStepWithModel(createInput(), model, event => events.push(event.type), new AbortController().signal)

    expect(model.doStreamCalls).toHaveLength(1)
    expect(result.text).toBe('完成')
    expect(result.reasoningText).toBe('思考')
    expect(result.usage).toMatchObject({ inputTokens: 11, cacheReadTokens: 4, reasoningTokens: 2, totalTokens: 16 })
    expect(result.responseMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'assistant',
        content: expect.arrayContaining([
          expect.objectContaining({ type: 'reasoning', text: '思考' }),
          expect.objectContaining({ type: 'text', text: '完成' }),
        ]),
      }),
    ]))
    expect(events).toEqual(['TextDelta', 'ReasoningDelta'])
  })

  it('仅在价格目录存在时计算 knownCostUsd，未知价格保持 null', async () => {
    const model = new MockLanguageModelV3({
      doStream: { stream: simulateReadableStream({ chunks: [
        { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
      ] }) },
    })
    const priced = await executeModelStepWithModel(createInput({
      pricing: {
        currency: 'USD',
        inputPerMillionTokens: 1,
        outputPerMillionTokens: 2,
        cacheReadPerMillionTokens: 0.5,
      },
    }), model, () => undefined, new AbortController().signal)
    expect(priced.usage.knownCostUsd).toBe(0.000019)

    const unpricedModel = new MockLanguageModelV3({
      doStream: { stream: simulateReadableStream({ chunks: [
        { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
      ] }) },
    })
    const unknown = await executeModelStepWithModel(
      createInput(), unpricedModel, () => undefined, new AbortController().signal
    )
    expect(unknown.usage.knownCostUsd).toBeNull()
  })

  it('系统规则通过 SDK system 选项传递且不触发 system message 警告', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const model = new MockLanguageModelV3({
      doStream: {
        stream: simulateReadableStream({ chunks: [
          { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
        ] }),
      },
    })

    await executeModelStepWithModel(
      createInput({ system: '只遵循可信系统规则。' }),
      model,
      () => undefined,
      new AbortController().signal
    )

    expect(warning).not.toHaveBeenCalled()
    expect(model.doStreamCalls[0].prompt[0]).toMatchObject({ role: 'system' })
    warning.mockRestore()
  })

  it('工具只返回调用意图且不会在 SDK 内执行', async () => {
    const model = new MockLanguageModelV3({
      doStream: {
        stream: simulateReadableStream({ chunks: [
          { type: 'tool-call', toolCallId: 'call-1', toolName: 'read_context', input: '{"scope":"canvas"}' },
          { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage },
        ] }),
      },
    })
    const result = await executeModelStepWithModel(createInput({
      tools: [{
        name: 'read_context',
        inputSchema: { type: 'object', properties: { scope: { type: 'string' } }, required: ['scope'] },
      }],
    }), model, () => undefined, new AbortController().signal)

    expect(model.doStreamCalls).toHaveLength(1)
    expect(result.finishReason).toBe('tool-calls')
    expect(result.toolCalls).toEqual([{ toolCallId: 'call-1', toolName: 'read_context', input: { scope: 'canvas' }, dynamic: false }])
  })

  it('通过 Output.object 返回结构化对象', async () => {
    const model = new MockLanguageModelV3({
      doStream: {
        stream: simulateReadableStream({ chunks: [
          { type: 'text-start', id: 'text-1' },
          { type: 'text-delta', id: 'text-1', delta: '{"ok":true}' },
          { type: 'text-end', id: 'text-1' },
          { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
        ] }),
      },
    })
    const result = await executeModelStepWithModel(createInput({
      output: {
        mode: 'object',
        schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
      },
    }), model, () => undefined, new AbortController().signal)

    expect(result.structuredOutput).toEqual({ ok: true })
  })

  it('按能力裁剪工具、结构化输出与采样参数', async () => {
    const model = new MockLanguageModelV3({
      doStream: {
        stream: simulateReadableStream({ chunks: [
          { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
        ] }),
      },
    })
    await executeModelStepWithModel(createInput({
      capabilities: {
        image: false,
        video: false,
        audio: false,
        streaming: true,
        toolCall: false,
        parallelTools: false,
        structuredOutputMode: 'none',
        reasoning: false,
        sampling: false,
        usage: true,
      },
      settings: { temperature: 0.8, topP: 0.9 },
    }), model, () => undefined, new AbortController().signal)

    const call = model.doStreamCalls[0]
    expect(call.tools).toBeUndefined()
    expect(call.temperature).toBeUndefined()
    expect(call.topP).toBeUndefined()
    expect(call.responseFormat?.type).toBe('text')
  })

  it('模型未声明图片能力时在发起请求前阻断', async () => {
    const model = new MockLanguageModelV3({
      doStream: { stream: simulateReadableStream({ chunks: [] }) },
    })
    await expect(executeModelStepWithModel(createInput({
      messages: [{ role: 'user', content: [{ type: 'image', image: 'https://example.com/a.png' }] }],
    }), model, () => undefined, new AbortController().signal)).rejects.toThrow('[unsupported_input_modality]')
    expect(model.doStreamCalls).toHaveLength(0)
  })
})

describe('normalizeModelToolMessagePairs', () => {
  it('移除没有 assistant tool-call 前置消息的孤立工具结果', () => {
    expect(normalizeModelToolMessagePairs([
      { role: 'user', content: '继续' },
      {
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: 'orphan-call',
          toolName: 'read_state',
          output: { type: 'json', value: { ok: false } },
        }],
      },
    ])).toEqual([{ role: 'user', content: '继续' }])
  })

  it('完整保留配对的工具调用与结果', () => {
    const messages = [
      {
        role: 'assistant' as const,
        content: [{
          type: 'tool-call',
          toolCallId: 'call-1',
          toolName: 'read_state',
          input: {},
        }],
      },
      {
        role: 'tool' as const,
        content: [{
          type: 'tool-result',
          toolCallId: 'call-1',
          toolName: 'read_state',
          output: { type: 'json', value: { ok: true } },
        }],
      },
    ]
    expect(normalizeModelToolMessagePairs(messages)).toEqual(messages)
  })
})

describe('resolveModelStepBaseUrl', () => {
  it('复用兼容端点规则并去掉 chat/completions', () => {
    expect(resolveModelStepBaseUrl(createInput({ providerId: 'ppio', baseUrl: 'https://api.ppio.com/openai' })))
      .toBe('https://api.ppio.com/openai/v1')
    expect(resolveModelStepBaseUrl(createInput({ providerId: 'custom', baseUrl: 'https://example.com/v1/chat/completions' })))
      .toBe('https://example.com/v1')
  })

  it('Responses 使用协议端点，并为智谱国内模型切到独立 API 前缀', () => {
    expect(resolveModelStepBaseUrl(createInput({
      providerId: 'deepseek', adapter: 'deepseek', apiProtocol: 'openai-responses',
      baseUrl: 'https://api.deepseek.com/responses',
    }))).toBe('https://api.deepseek.com')
    expect(resolveModelStepBaseUrl(createInput({
      providerId: 'bigmodel', providerFamilyId: 'bigmodel', endpointProfile: 'cn', credentialId: 'bigmodel',
      apiProtocol: 'openai-responses', baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    }))).toBe('https://open.bigmodel.cn/api/v1')
  })

  it('显式修改区域预设地址后优先使用覆盖地址', () => {
    expect(resolveModelStepBaseUrl(createInput({
      providerId: 'bigmodel', providerFamilyId: 'bigmodel', endpointProfile: 'cn', credentialId: 'bigmodel',
      apiProtocol: 'openai-responses', baseUrl: 'https://proxy.example.com/v1',
    }))).toBe('https://proxy.example.com/v1')
  })

  it('思考参数不再走 providerOptions，只透传调用方显式给的选项', () => {
    // 思考参数改由 applyProviderReasoningRequestBody 在 transformRequestBody 里按供应商翻译，
    // 与原生流式路径共用（见 providerReasoningRequest.test.ts）。
    expect(buildModelStepProviderOptions(createInput({
      adapter: 'openai',
      reasoning: { enabled: true, effort: 'xhigh' },
    }))).toBeUndefined()
    expect(buildModelStepProviderOptions(createInput({
      providerOptions: { openaiCompatible: { serviceTier: 'priority' } },
    }))).toMatchObject({
      openaiCompatible: { serviceTier: 'priority' },
    })
    expect(buildModelStepProviderOptions(createInput({ apiProtocol: 'openai-responses' })))
      .toEqual({ openai: { store: false } })
  })

  it('DeepSeek 思考模式不发送不会生效的采样参数', async () => {
    const model = new MockLanguageModelV3({
      doStream: {
        stream: simulateReadableStream({ chunks: [
          { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
        ] }),
      },
    })
    await executeModelStepWithModel(createInput({
      adapter: 'deepseek',
      reasoning: { enabled: true, effort: 'high' },
      settings: { temperature: 0.8, topP: 0.9 },
    }), model, () => undefined, new AbortController().signal)
    expect(model.doStreamCalls[0].temperature).toBeUndefined()
    expect(model.doStreamCalls[0].topP).toBeUndefined()
  })

  it('合并 DeepSeek 返回的缓存命中用量', () => {
    expect(applyDeepSeekUsage({
      inputTokens: null,
      inputNoCacheTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      outputTokens: 10,
      textTokens: 10,
      reasoningTokens: 0,
      totalTokens: 110,
    }, {
      prompt_cache_hit_tokens: 80,
      prompt_cache_miss_tokens: 20,
      prompt_tokens: 100,
    })).toMatchObject({
      inputTokens: 100,
      inputNoCacheTokens: 20,
      cacheReadTokens: 80,
    })
  })

  it('仅 schema 模式启用 Provider 原生 JSON Schema', () => {
    expect(usesNativeJsonSchema(createInput({
      capabilities: { ...createInput().capabilities, structuredOutputMode: 'json' },
    }))).toBe(false)
    expect(usesNativeJsonSchema(createInput({
      capabilities: { ...createInput().capabilities, structuredOutputMode: 'schema' },
    }))).toBe(true)
  })
})
