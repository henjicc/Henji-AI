import { describe, expect, it, vi } from 'vitest'
import { simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'

import type { ModelStepInput } from '../../../../../src/core/llm/modelStep'
import { buildModelStepProviderOptions, executeModelStepWithModel } from './model-step'
import {
  applyDeepSeekUsage,
  applyModelStepProviderNativeOptions,
  resolveModelStepBaseUrl,
  usesNativeJsonSchema,
} from './provider'

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
})

describe('resolveModelStepBaseUrl', () => {
  it('复用兼容端点规则并去掉 chat/completions', () => {
    expect(resolveModelStepBaseUrl(createInput({ providerId: 'ppio', baseUrl: 'https://api.ppio.com/openai' })))
      .toBe('https://api.ppio.com/openai/v1')
    expect(resolveModelStepBaseUrl(createInput({ providerId: 'custom', baseUrl: 'https://example.com/v1/chat/completions' })))
      .toBe('https://example.com/v1')
  })

  it('按 Provider 映射原生 reasoning 参数且受能力表约束', () => {
    const supported = createInput({
      adapter: 'openai',
      reasoning: { enabled: true, effort: 'xhigh' },
    })
    expect(buildModelStepProviderOptions(supported)).toMatchObject({
      openaiCompatible: { reasoningEffort: 'xhigh' },
    })
    expect(buildModelStepProviderOptions(createInput({
      ...supported,
      capabilities: { ...supported.capabilities, reasoning: false },
    }))).toBeUndefined()
    expect(applyModelStepProviderNativeOptions({ model: 'deepseek-v4' }, {
      enabled: true,
      effort: 'xhigh',
    })).toEqual({
      model: 'deepseek-v4',
      thinking: { type: 'enabled' },
      reasoning_effort: 'max',
    })
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
