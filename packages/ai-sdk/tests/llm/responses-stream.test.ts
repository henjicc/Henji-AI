import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  discoverModels,
  runLlmChatStream,
  type LlmChatRequestDto,
  type RuntimeContext,
} from '../../src/llm/streaming/index'

type Fixture = { events: Array<Record<string, unknown>> }

function fixture(name: string): Fixture {
  return JSON.parse(readFileSync(path.resolve(__dirname, `../fixtures/llm/${name}`), 'utf8')) as Fixture
}

/** 把事件拆成两块发送，覆盖跨 chunk 的 UTF-8 与 SSE 边界。 */
function sse(events: Array<Record<string, unknown>>, tail = ''): Response {
  const bytes = new TextEncoder().encode(events.map(event => `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`).join('') + tail)
  const midpoint = Math.floor(bytes.length / 2) + 1
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, midpoint))
      controller.enqueue(bytes.slice(midpoint))
      controller.close()
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

interface Sent { url: string; body: Record<string, unknown> }

function runtime(respond: () => Response, sent: Sent[] = []): RuntimeContext {
  return {
    transport: {
      fetch: vi.fn(async (url: string, init?: RequestInit) => {
        sent.push({ url, body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {} })
        return respond()
      }),
    },
    credentials: { get: async () => 'fixture-key' },
    media: { read: async () => { throw new Error('fixture does not read media') } },
  }
}

const custom: LlmChatRequestDto = {
  requestId: 'responses-fixture',
  providerId: 'openai',
  modelId: 'fixture-model',
  baseUrl: 'https://fixture.invalid/v1',
  apiProtocol: 'openai-responses',
  messages: [{ role: 'system', content: '简洁' }, { role: 'user', content: '你好' }],
}

describe('轻量入口 Responses 协议', () => {
  it('官方文本事件解析出正文与用量，请求体为无状态 Responses 形状', async () => {
    const sent: Sent[] = []
    const events: unknown[] = []
    const outcome = await runLlmChatStream(custom, 'responses-text', event => events.push(event), runtime(() => sse(fixture('openai-responses-text.json').events), sent))
    expect(sent[0].url).toBe('https://fixture.invalid/v1/responses')
    expect(sent[0].body).toEqual({
      model: 'fixture-model',
      input: [{ role: 'system', content: '简洁' }, { role: 'user', content: '你好' }],
      stream: true,
      store: false,
    })
    expect(events).toEqual([{ type: 'Token', data: '完成' }])
    expect(outcome).toMatchObject({
      output: '完成', finishReason: 'stop', truncated: false,
      usage: { inputTokens: 3, outputTokens: 2, cacheReadTokens: 1, reasoningTokens: 0 },
    })
  })

  it('函数调用按 output_index 累积参数，思考摘要进入 reasoning，结束原因为 tool_calls', async () => {
    const sent: Sent[] = []
    const outcome = await runLlmChatStream({
      ...custom,
      tools: [{ type: 'function', function: { name: 'get_weather', parameters: { type: 'object' } } }],
    }, 'responses-tools', () => undefined, runtime(() => sse(fixture('openai-responses-function-call.json').events), sent))
    expect(sent[0].body.tools).toEqual([{ type: 'function', name: 'get_weather', parameters: { type: 'object' } }])
    expect(outcome).toMatchObject({
      reasoningOutput: '查天气',
      finishReason: 'tool_calls',
      toolCalls: [{ index: 1, id: 'call_1234xyz', type: 'function', function: { name: 'get_weather', arguments: '{"location":"Paris, France"}' } }],
      usage: { inputTokens: 20, outputTokens: 12, reasoningTokens: 5, cacheReadTokens: 4 },
    })
  })

  it('incomplete 以 incomplete_details.reason 为结束原因并标记截断', async () => {
    const outcome = await runLlmChatStream(custom, 'responses-incomplete', () => undefined, runtime(() => sse([
      { type: 'response.output_text.delta', delta: '半' },
      { type: 'response.incomplete', response: { incomplete_details: { reason: 'max_output_tokens' } } },
    ])))
    expect(outcome).toMatchObject({ output: '半', finishReason: 'max_output_tokens', truncated: true })
  })

  it('reasoning_text 原文思考（DeepSeek、MiMo、智谱、百炼、MiniMax 用这一种）进入 reasoning', async () => {
    const events: unknown[] = []
    const outcome = await runLlmChatStream(custom, 'responses-reasoning-text', event => events.push(event), runtime(() => sse(fixture('mimo-responses.json').events)))
    expect(events[0]).toEqual({ type: 'ReasoningToken', data: '分析' })
    expect(outcome).toMatchObject({ reasoningOutput: '分析', finishReason: 'stop' })
  })

  it('failed 事件与缺少终止事件都按失败处理', async () => {
    await expect(runLlmChatStream(custom, 'responses-failed', () => undefined, runtime(() => sse([
      { type: 'response.failed', response: { error: { code: 'server_error', message: 'x' } } },
    ])))).rejects.toThrow('"code":"server_error"')
    await expect(runLlmChatStream(custom, 'responses-error', () => undefined, runtime(() => sse([
      { type: 'error', code: 'rate_limit_exceeded', message: 'x' },
    ])))).rejects.toThrow('"code":"rate_limit_exceeded"')
    await expect(runLlmChatStream(custom, 'responses-truncated', () => undefined, runtime(() => sse([
      { type: 'response.output_text.delta', delta: '半' },
    ])))).rejects.toThrow('STREAM_INCOMPLETE')
  })

  it('视频内容显式走 Responses 时在发请求前拒绝', async () => {
    const sent: Sent[] = []
    await expect(runLlmChatStream({
      ...custom,
      messages: [{ role: 'user', content: [{ type: 'video_url', videoUrl: { url: 'https://fixture.invalid/a.mp4' } }] }],
    }, 'responses-video', () => undefined, runtime(() => sse([]), sent))).rejects.toThrow('RESPONSES_CONTENT_UNSUPPORTED')
    expect(sent).toHaveLength(0)
  })
})

describe('已登记供应商由 SDK 补全协议、能力与地址', () => {
  it('DeepSeek flash 不传地址与能力：自动走 Responses，思考按 reasoning.effort 发送', async () => {
    const sent: Sent[] = []
    await runLlmChatStream({
      providerId: 'deepseek', modelId: 'deepseek-flash',
      reasoning: { enabled: false }, messages: [{ role: 'user', content: '你好' }],
    }, 'deepseek-auto', () => undefined, runtime(() => sse(fixture('openai-responses-text.json').events), sent))
    expect(sent[0].url).toBe('https://api.deepseek.com/responses')
    expect(sent[0].body.reasoning).toEqual({ effort: 'none' })
  })

  it('显式指定 Chat 时用 Chat 地址；带视频的请求自动选择时也留在 Chat', async () => {
    const chat = (): Response => new Response('data: {"choices":[{"delta":{"content":"好"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { status: 200 })
    const sent: Sent[] = []
    await runLlmChatStream({
      providerId: 'deepseek', modelId: 'deepseek-flash', apiProtocol: 'openai-compatible', messages: [{ role: 'user', content: '你好' }],
    }, 'deepseek-chat', () => undefined, runtime(chat, sent))
    await runLlmChatStream({
      providerId: 'mimo', modelId: 'mimo-v2.6-pro',
      messages: [{ role: 'user', content: [{ type: 'video_url', videoUrl: { url: 'https://fixture.invalid/a.mp4' } }] }],
    }, 'mimo-video', () => undefined, runtime(chat, sent))
    expect(sent.map(item => item.url)).toEqual([
      'https://api.deepseek.com/v1/chat/completions',
      'https://api.xiaomimimo.com/v1/chat/completions',
    ])
  })

  it('能力：未登记模型只用调用方的；已登记模型由 SDK 补全，调用方传的字段优先', async () => {
    const sent: Sent[] = []
    const text = (): Response => sse(fixture('openai-responses-text.json').events)
    await runLlmChatStream({
      ...custom, reasoning: { enabled: true, effort: 'high' }, capabilities: { reasoning: false },
    }, 'custom-caps', () => undefined, runtime(text, sent))
    await runLlmChatStream({
      providerId: 'deepseek', modelId: 'deepseek-flash', reasoning: { enabled: true, effort: 'high' }, capabilities: { reasoning: false },
      messages: [{ role: 'user', content: '你好' }],
    }, 'registered-override', () => undefined, runtime(text, sent))
    await runLlmChatStream({
      providerId: 'deepseek', modelId: 'deepseek-flash', reasoning: { enabled: true, effort: 'high' },
      messages: [{ role: 'user', content: '你好' }],
    }, 'registered-filled', () => undefined, runtime(text, sent))
    expect(sent.map(item => item.body.reasoning)).toEqual([undefined, undefined, { effort: 'high' }])
  })

  it('自定义地址（代理、中转）不自动切 Responses，Responses 地址不补版本段', async () => {
    const chat = (): Response => new Response('data: {"choices":[{"delta":{"content":"好"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { status: 200 })
    const sent: Sent[] = []
    const ask = { providerId: 'deepseek', modelId: 'deepseek-flash', baseUrl: 'https://proxy.invalid', messages: [{ role: 'user' as const, content: '你好' }] }
    await runLlmChatStream(ask, 'proxy-auto', () => undefined, runtime(chat, sent))
    await runLlmChatStream({ ...ask, apiProtocol: 'openai-responses' }, 'proxy-responses', () => undefined, runtime(() => sse(fixture('openai-responses-text.json').events), sent))
    await runLlmChatStream({ ...ask, baseUrl: 'https://api.deepseek.com' }, 'official-explicit', () => undefined, runtime(() => sse(fixture('openai-responses-text.json').events), sent))
    expect(sent.map(item => item.url)).toEqual([
      'https://proxy.invalid/v1/chat/completions',
      'https://proxy.invalid/responses',
      'https://api.deepseek.com/responses',
    ])
  })
})

describe('采样参数', () => {
  const text = (): Response => sse(fixture('openai-responses-text.json').events)

  it('两种协议都发 temperature / top_p', async () => {
    const sent: Sent[] = []
    await runLlmChatStream({ ...custom, temperature: 0.3, topP: 0.9 }, 'sampling-responses', () => undefined, runtime(text, sent))
    expect(sent[0].body).toMatchObject({ temperature: 0.3, top_p: 0.9 })
  })

  it('固定采样的模型与 DeepSeek 开思考时省略，越界值在请求前拒绝', async () => {
    const sent: Sent[] = []
    await runLlmChatStream({
      providerId: 'deepseek', modelId: 'deepseek-flash', temperature: 0.3, reasoning: { enabled: true, effort: 'high' },
      messages: [{ role: 'user', content: '你好' }],
    }, 'sampling-thinking', () => undefined, runtime(text, sent))
    expect(sent[0].body.temperature).toBeUndefined()
    await runLlmChatStream({ ...custom, temperature: 0.3, capabilities: { sampling: false } }, 'sampling-fixed', () => undefined, runtime(text, sent))
    expect(sent[1].body.temperature).toBeUndefined()
    await expect(runLlmChatStream({ ...custom, temperature: 3 }, 'sampling-range', () => undefined, runtime(text, sent))).rejects.toThrow()
    expect(sent).toHaveLength(2)
  })
})

describe('模型发现', () => {
  it('已登记供应商不传地址时用预设地址，自定义地址原样使用', async () => {
    const sent: Sent[] = []
    const list = (): Response => new Response(JSON.stringify({ data: [{ id: 'deepseek-flash' }] }), { status: 200 })
    await expect(discoverModels('deepseek', undefined, runtime(list, sent))).resolves.toEqual([
      { modelId: 'deepseek-flash', displayName: 'deepseek-flash', contextWindow: null, maxOutputTokens: null },
    ])
    await discoverModels('my-gateway', 'https://gateway.invalid/openai/v1', runtime(list, sent))
    expect(sent.map(item => item.url)).toEqual(['https://api.deepseek.com/v1/models', 'https://gateway.invalid/openai/v1/models'])
  })
})

describe('联网搜索', () => {
  const text = (): Response => sse(fixture('openai-responses-text.json').events)
  const chat = (): Response => new Response('data: {"choices":[{"delta":{"content":"好"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { status: 200 })
  const ask = (overrides: Partial<LlmChatRequestDto>): LlmChatRequestDto => ({
    providerId: 'deepseek', modelId: 'deepseek-flash', webSearch: true, messages: [{ role: 'user', content: '今天新闻' }], ...overrides,
  })

  it('按供应商与协议挂官方工具或开关', async () => {
    const sent: Sent[] = []
    await runLlmChatStream(ask({}), 'web-deepseek', () => undefined, runtime(text, sent))
    await runLlmChatStream(ask({ providerId: 'bailian', modelId: 'qwen3.8-flash' }), 'web-bailian', () => undefined, runtime(text, sent))
    await runLlmChatStream(ask({ providerId: 'bailian', modelId: 'qwen3.8-flash', apiProtocol: 'openai-compatible' }), 'web-bailian-chat', () => undefined, runtime(chat, sent))
    await runLlmChatStream(ask({ providerId: 'mimo', modelId: 'mimo-v2.6-pro', apiProtocol: 'openai-compatible' }), 'web-mimo-chat', () => undefined, runtime(chat, sent))
    expect(sent.map(item => [item.url, item.body.tools, item.body.enable_search])).toEqual([
      ['https://api.deepseek.com/responses', [{ type: 'deepseek_web_search' }, { type: 'deepseek_read_url' }], undefined],
      ['https://dashscope.aliyuncs.com/compatible-mode/v1/responses', [{ type: 'web_search' }], undefined],
      ['https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', undefined, true],
      ['https://api.xiaomimimo.com/v1/chat/completions', [{ type: 'web_search' }], undefined],
    ])
  })

  it('不支持的组合、结构化输出与未开启时都不挂', async () => {
    const sent: Sent[] = []
    await runLlmChatStream(ask({ providerId: 'mimo', modelId: 'mimo-v2.6-pro' }), 'web-mimo-responses', () => undefined, runtime(text, sent))
    await runLlmChatStream(ask({ ...custom, providerId: 'my-gateway', adapter: 'openai' }), 'web-gateway', () => undefined, runtime(text, sent))
    await runLlmChatStream(ask({
      capabilities: undefined,
      structuredOutput: { type: 'json_object' },
    }), 'web-structured', () => undefined, runtime(text, sent))
    await runLlmChatStream(ask({ webSearch: undefined }), 'web-off', () => undefined, runtime(text, sent))
    expect(sent.map(item => item.body.tools)).toEqual([undefined, undefined, undefined, undefined])
  })
})

describe('接口地址', () => {
  const text = (): Response => sse(fixture('openai-responses-text.json').events)

  it('百炼按地域选通用域名，派欧云 Responses 补 /v1，智谱 Responses 走独立网关', async () => {
    const sent: Sent[] = []
    const base = { messages: [{ role: 'user' as const, content: '你好' }] }
    await runLlmChatStream({ ...base, providerId: 'bailian', modelId: 'qwen3.8-flash', endpointProfile: 'ap-southeast-1' }, 'url-bailian', () => undefined, runtime(text, sent))
    await runLlmChatStream({ ...base, providerId: 'ppio', modelId: 'deepseek/deepseek-v4.1-flash', apiProtocol: 'openai-responses' }, 'url-ppio', () => undefined, runtime(text, sent))
    await runLlmChatStream({ ...base, providerId: 'bigmodel', modelId: 'glm-5.3' }, 'url-bigmodel', () => undefined, runtime(text, sent))
    expect(sent.map(item => item.url)).toEqual([
      'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/responses',
      'https://api.ppio.com/openai/v1/responses',
      'https://open.bigmodel.cn/api/v1/responses',
    ])
    // 显式传百炼通用域名不算自定义地址，仍按预设自动走 Responses
    await runLlmChatStream({ ...base, providerId: 'bailian', modelId: 'qwen3.8-flash', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' }, 'url-bailian-explicit', () => undefined, runtime(text, sent))
    expect(sent[3].url).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/responses')
    // 德国没有通用域名，必须由调用方传业务空间域名；可改正的提示原样到达调用方
    await expect(runLlmChatStream({ ...base, providerId: 'bailian', modelId: 'qwen3.8-flash', endpointProfile: 'eu-central-1' }, 'url-bailian-eu', () => undefined, runtime(text, sent)))
      .rejects.toThrow('[llm_base_url_required]')
    expect(sent).toHaveLength(4)
  })
})
