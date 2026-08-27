import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { createCapabilityClient } from '../src/capabilities'
import type { TranslationEvent } from '../src/capabilities/translation'
import {
  BAILIAN_QWEN_MT_PRESETS,
  createBailianQwenMtTranslationModule,
  createQwenMtFlashTranslationModule,
  createQwenMtLiteTranslationModule,
  createQwenMtPlusTranslationModule,
  normalizeBailianQwenMtLanguage,
  type BailianQwenMtModelId,
} from '../src/capabilities/translation/bailian'
import type { RuntimeContext } from '../src/runtime'

interface OfficialFixture {
  nonStreaming: Record<string, unknown>
  streaming: {
    flash: Record<string, unknown>[]
    plus: Record<string, unknown>[]
  }
}

const fixture = JSON.parse(readFileSync(resolve(
  __dirname,
  'fixtures/bailian-translation/official-qwen-mt-examples.json'
), 'utf8')) as OfficialFixture

function runtime(
  fetch: RuntimeContext['transport']['fetch'],
  apiKey = 'fixture-secret',
  overrides: Partial<RuntimeContext> = {}
): RuntimeContext {
  return {
    transport: { fetch },
    credentials: { get: async () => apiKey || undefined },
    media: { read: async () => { throw new Error('translation must not read media') } },
    ...overrides,
  }
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function sseResponse(events: readonly Record<string, unknown>[]): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n'
  return streamResponse([new TextEncoder().encode(body)])
}

function streamResponse(chunks: readonly Uint8Array[]): Response {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

describe('百炼 Qwen-MT 翻译模块', () => {
  it('三模型作为独立预设按需创建，不由通用 translation 入口隐式注册', () => {
    expect(Object.values(BAILIAN_QWEN_MT_PRESETS).map((item) => item.modelId)).toEqual([
      'qwen-mt-flash', 'qwen-mt-plus', 'qwen-mt-lite',
    ])
    expect(createQwenMtFlashTranslationModule().descriptor).toMatchObject({
      id: 'bailian.translation.qwen-mt-flash', providerIds: ['bailian'], modelId: 'qwen-mt-flash',
      executionModes: ['request-response', 'event-stream'],
    })
    expect(createQwenMtPlusTranslationModule().descriptor.modelId).toBe('qwen-mt-plus')
    expect(createQwenMtLiteTranslationModule().descriptor.modelId).toBe('qwen-mt-lite')
  })

  it.each<BailianQwenMtModelId>(['qwen-mt-flash', 'qwen-mt-plus', 'qwen-mt-lite'])(
    '%s 请求映射使用官方 OpenAI 兼容字段且不发送未知输出上限',
    async (modelId) => {
      const fetch = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({
        ...fixture.nonStreaming,
        model: modelId,
      }))
      const client = createCapabilityClient({ runtime: runtime(fetch) })
      const module = createBailianQwenMtTranslationModule(modelId, {
        endpoint: 'https://workspace.example.com/compatible-mode/v1/chat/completions',
      })
      client.register(module)
      await client.execute(module.descriptor.id, {
        source: '术语测试', sourceLanguage: 'zh', targetLanguage: 'en',
        terminology: { 术语: 'term' },
        context: 'Software localization',
        options: {
          stream: false,
          translationMemory: [{ source: '保存', target: 'Save' }],
        },
      })

      expect(fetch).toHaveBeenCalledOnce()
      const [url, init] = fetch.mock.calls[0]
      expect(url).toBe('https://workspace.example.com/compatible-mode/v1/chat/completions')
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer fixture-secret' })
      expect(JSON.parse(String(init?.body))).toEqual({
        model: modelId,
        messages: [{ role: 'user', content: '术语测试' }],
        translation_options: {
          source_lang: 'Chinese', target_lang: 'English',
          terms: [{ source: '术语', target: 'term' }],
          tm_list: [{ source: '保存', target: 'Save' }],
          domains: 'Software localization',
        },
        stream: false,
      })
      expect(String(init?.body)).not.toContain('max_tokens')
      await client.dispose()
    }
  )

  it('Say-It 现有语言代码映射到百炼英文语言名，未知扩展值保持开放', () => {
    expect(normalizeBailianQwenMtLanguage('zh')).toBe('Chinese')
    expect(normalizeBailianQwenMtLanguage('zh_tw')).toBe('Traditional Chinese')
    expect(normalizeBailianQwenMtLanguage('en')).toBe('English')
    expect(normalizeBailianQwenMtLanguage('auto')).toBe('auto')
    expect(normalizeBailianQwenMtLanguage('AUTO')).toBe('auto')
    expect(normalizeBailianQwenMtLanguage('Future Language')).toBe('Future Language')
  })

  it('非流式批量结果保留 id、合并 usage，并统一发送 item/completed 事件', async () => {
    const fetch = vi.fn(async () => jsonResponse(fixture.nonStreaming))
    const events: TranslationEvent[] = []
    const client = createCapabilityClient({ runtime: runtime(fetch) })
    const module = createQwenMtPlusTranslationModule({ defaultStream: false })
    client.register(module)
    const output = await client.execute(module.descriptor.id, {
      source: [{ id: 'a', text: '第一句' }, { id: 'b', text: '第二句' }],
      targetLanguage: 'English',
    }, { onEvent: (event) => { events.push(event) } })

    expect(output).toMatchObject({
      translations: [
        { id: 'a', sourceText: '第一句', text: "I didn't laugh after watching this video." },
        { id: 'b', sourceText: '第二句', text: "I didn't laugh after watching this video." },
      ],
      usage: { inputTokens: 106, outputTokens: 18, totalTokens: 124 },
    })
    expect(events.map((event) => event.type)).toEqual(['started', 'item', 'item', 'completed'])
    expect(fetch).toHaveBeenCalledTimes(2)
    await client.dispose()
  })

  it('凭据、结构化日志与 trace 全部来自宿主注入且不记录原文或密钥', async () => {
    const credentials = vi.fn(async () => 'fixture-secret')
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const end = vi.fn()
    const tracer = { startSpan: vi.fn(() => ({ end })) }
    const client = createCapabilityClient({
      runtime: runtime(async () => jsonResponse(fixture.nonStreaming), 'unused', {
        credentials: { get: credentials }, logger, tracer,
      }),
    })
    const module = createQwenMtPlusTranslationModule({ defaultStream: false })
    client.register(module)
    await client.execute(module.descriptor.id, {
      source: '不得进入日志的原文', targetLanguage: 'English',
    }, { requestId: 'qwen-mt-logging' })

    expect(credentials).toHaveBeenCalledWith('translation', 'bailian')
    expect(logger.info).toHaveBeenCalledWith(
      '百炼翻译请求开始',
      expect.objectContaining({ event: 'bailian.translation.request.start', requestId: 'qwen-mt-logging' })
    )
    expect(tracer.startSpan).toHaveBeenCalledWith(
      'bailian.translation.request',
      expect.objectContaining({ providerId: 'bailian', modelId: 'qwen-mt-plus' })
    )
    expect(end).toHaveBeenCalledWith()
    const logged = JSON.stringify(logger.info.mock.calls)
    expect(logged).not.toContain('fixture-secret')
    expect(logged).not.toContain('不得进入日志的原文')
    await client.dispose()
  })

  it('Flash 增量与 Plus 累积流都归一为可追加 delta、完整 item 和 usage', async () => {
    const cases = [
      { create: createQwenMtFlashTranslationModule, chunks: fixture.streaming.flash, expected: "I didn't" },
      { create: createQwenMtPlusTranslationModule, chunks: fixture.streaming.plus, expected: 'I didn’t laugh after watching this video.' },
    ] as const
    for (const testCase of cases) {
      const events: TranslationEvent[] = []
      const client = createCapabilityClient({ runtime: runtime(async () => sseResponse(testCase.chunks)) })
      const module = testCase.create()
      client.register(module)
      const output = await client.execute(module.descriptor.id, {
        source: '看完这个视频我没有笑', targetLanguage: 'English',
      }, { onEvent: async (event) => { events.push(event) } })

      expect(output.translations[0].text).toBe(testCase.expected)
      expect(output.usage).toEqual({ inputTokens: 56, outputTokens: 9, totalTokens: 65 })
      const deltas = events.filter((event): event is Extract<TranslationEvent, { type: 'delta' }> => event.type === 'delta')
      expect(deltas.every((event) => event.mode === 'append')).toBe(true)
      expect(deltas.map((event) => event.text).join('')).toBe(testCase.expected)
      expect(events.at(-2)?.type).toBe('item')
      expect(events.at(-1)?.type).toBe('completed')
      await client.dispose()
    }
  })

  it('Lite SSE 在 UTF-8 多字节字符跨 chunk 时不产生替换字符', async () => {
    const textDecoder = globalThis.TextDecoder
    vi.stubGlobal('TextDecoder', undefined)
    try {
      const event = `data: ${JSON.stringify({
        id: 'utf8', model: 'qwen-mt-lite', choices: [{ delta: { content: '你好🙂' }, finish_reason: 'stop' }],
      })}\n\ndata: [DONE]\n\n`
      const bytes = new TextEncoder().encode(event)
      const splitAt = bytes.findIndex((value, index) => value >= 0x80 && bytes[index + 1] >= 0x80) + 1
      const separatorAt = bytes.findIndex((value, index) => value === 10 && bytes[index + 1] === 10) + 1
      const client = createCapabilityClient({
        runtime: runtime(async () => streamResponse([
          bytes.slice(0, splitAt),
          bytes.slice(splitAt, separatorAt),
          bytes.slice(separatorAt),
        ])),
      })
      const module = createQwenMtLiteTranslationModule()
      client.register(module)
      const output = await client.execute(module.descriptor.id, { source: 'hello', targetLanguage: 'zh' })
      expect(output.translations[0].text).toBe('你好🙂')
      expect(output.translations[0].text).not.toContain('�')
      await client.dispose()
    } finally {
      vi.stubGlobal('TextDecoder', textDecoder)
    }
  })

  it('HTTP 错误、未配置密钥与未知选项归一为稳定可修正错误', async () => {
    const client = createCapabilityClient({ runtime: runtime(async () => jsonResponse({
      error: { code: 'Throttling.RateQuota', message: 'Requests rate limit exceeded' },
    }, 429)) })
    const module = createQwenMtFlashTranslationModule({ defaultStream: false })
    client.register(module)
    await expect(client.execute(module.descriptor.id, {
      source: 'hello', targetLanguage: 'Chinese',
    })).rejects.toMatchObject({ code: 'provider_rate_limited' })
    await expect(client.execute(module.descriptor.id, {
      source: 'hello', targetLanguage: 'Chinese', options: { unknown: true },
    })).rejects.toMatchObject({
      code: 'invalid_translation_option',
      message: expect.stringContaining('supported: stream, translationMemory'),
    })
    await client.dispose()

    const noKey = createCapabilityClient({ runtime: runtime(async () => jsonResponse({}), '') })
    noKey.register(module)
    await expect(noKey.execute(module.descriptor.id, {
      source: 'hello', targetLanguage: 'Chinese',
    })).rejects.toMatchObject({ code: 'api_key_missing' })
    await noKey.dispose()
  })

  it('Abort 与 timeout 都中止宿主 Transport 并由能力 client 收口', async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => await new Promise<Response>((_resolve, reject) => {
      const abort = (): void => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      if (init?.signal?.aborted) abort()
      else init?.signal?.addEventListener('abort', abort, { once: true })
    }))
    const client = createCapabilityClient({ runtime: runtime(fetch) })
    const module = createQwenMtFlashTranslationModule()
    client.register(module)

    const controller = new AbortController()
    const aborted = client.execute(module.descriptor.id, {
      source: 'hello', targetLanguage: 'Chinese',
    }, { requestId: 'qwen-mt-abort', signal: controller.signal })
    controller.abort()
    await expect(aborted).rejects.toMatchObject({ code: 'cancelled' })
    await expect(client.execute(module.descriptor.id, {
      source: 'hello', targetLanguage: 'Chinese',
    }, { requestId: 'qwen-mt-timeout', timeoutMs: 5 })).rejects.toMatchObject({ code: 'timeout' })
    expect(fetch).toHaveBeenCalled()
    await client.dispose()
  })
})
