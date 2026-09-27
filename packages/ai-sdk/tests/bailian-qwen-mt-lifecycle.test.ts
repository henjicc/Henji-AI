import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createCapabilityClient } from '../src/capabilities'
import type { TranslationEvent } from '../src/capabilities/translation'
import { createBailianQwenMtTranslationModule, type BailianQwenMtModelId } from '../src/capabilities/translation/bailian'

const fixture = JSON.parse(readFileSync(resolve(__dirname,
  'fixtures/bailian-translation/official-qwen-mt-examples.json'), 'utf8')) as {
    nonStreaming: Record<string, unknown>
    streaming: { flash: Record<string, unknown>[]; plus: Record<string, unknown>[] }
  }
const frame = (value: unknown): string => `data: ${JSON.stringify(value)}\n\n`
const final = (content = '', finish_reason: unknown = 'stop'): Record<string, unknown> => ({
  choices: [{ delta: { content }, finish_reason }],
})

function setup(wire: string, options: {
  modelId?: BailianQwenMtModelId; open?: boolean; json?: unknown; status?: number
  byteChunks?: boolean; onEvent?: (event: TranslationEvent) => void; source?: string
} = {}) {
  const cancel = vi.fn()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value
      if (wire) {
        const bytes = new TextEncoder().encode(wire)
        if (options.byteChunks) for (const byte of bytes) value.enqueue(Uint8Array.of(byte))
        else value.enqueue(bytes)
      }
      if (!options.open) value.close()
    }, cancel,
  })
  const events: TranslationEvent[] = []
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const module = createBailianQwenMtTranslationModule(options.modelId ?? 'qwen-mt-flash')
  const client = createCapabilityClient({ modules: [module], runtime: {
    transport: { fetch: async () => options.json === undefined
      ? new Response(body) : new Response(JSON.stringify(options.json), { status: options.status ?? 200 }) },
    credentials: { get: async () => 'fixture-secret' },
    media: { read: async () => { throw new Error('unused') } }, logger,
  } })
  const execute = (signal?: AbortSignal) => client.execute(module.descriptor.id, {
    source: options.source ?? 'private-source', targetLanguage: 'English',
    ...(options.json === undefined ? {} : { options: { stream: false } }),
  }, { signal, onEvent: event => { events.push(event); options.onEvent?.(event) } })
  return { execute, client, body, controller, events, logger, cancel }
}

describe('Qwen-MT 完成语义与读取生命周期', () => {
  it.each(['flash', 'plus'] as const)('%s 官方空首帧、重复结束与用量帧可正常完成', async name => {
    const chunks = fixture.streaming[name]
    const run = setup(chunks.map(frame).join(''), {
      modelId: name === 'plus' ? 'qwen-mt-plus' : 'qwen-mt-flash',
    })
    const result = await run.execute()
    expect(result.translations[0].text).toBe(name === 'plus'
      ? 'I didn’t laugh after watching this video.' : "I didn't")
    expect(result.usage?.totalTokens).toBe(65)
    expect(run.events.filter(event => event.type === 'item')).toHaveLength(1)
    expect(run.body.locked).toBe(false)
    await run.client.dispose()
  })

  it.each(['', 'data: [DONE]\n\n', `data: ${JSON.stringify(final())}`])(
    '缺少可分发最终结果时不能把部分译文判为成功：%s', async ending => {
      const run = setup(frame(fixture.streaming.flash[1]) + ending)
      await expect(run.execute()).rejects.toMatchObject({ code: 'provider_response_invalid', details: {
        modelId: 'qwen-mt-flash', protocol: 'qwen-mt-sse', stage: 'completion',
      } })
      expect(run.events.some(event => event.type === 'item' || event.type === 'completed')).toBe(false)
      expect(run.body.locked).toBe(false)
      await run.client.dispose()
    }
  )

  it.each([
    frame({ error: { message: 'private-source fixture-secret' } }),
    'event: error\ndata: {"message":"private-source fixture-secret"}\n\n',
  ])('服务端错误不能被后续正常结束掩盖，诊断不带原始 message', async error => {
    const run = setup(error + frame(final()) + 'data: [DONE]\n\n', { open: true, modelId: 'qwen-mt-lite' })
    let failure: unknown
    try { await run.execute() } catch (caught) { failure = caught }
    expect(failure).toMatchObject({ code: 'provider_task_failed', details: {
      modelId: 'qwen-mt-lite', protocol: 'qwen-mt-sse', stage: 'parse',
    } })
    expect(String(failure)).not.toMatch(/private-source|fixture-secret/)
    expect(JSON.stringify(run.logger.error.mock.calls)).not.toMatch(/private-source|fixture-secret/)
    expect(run.cancel).toHaveBeenCalledOnce()
    expect(run.body.locked).toBe(false)
    await run.client.dispose()
  })

  it.each([
    {}, { choices: [] }, { choices: [{ finish_reason: 'stop' }] },
    { choices: [{ delta: { content: 42 }, finish_reason: 'stop' }] }, final('', 'future-reason'),
  ])('无效已知结果不作为空状态跳过：%j', async value => {
    const run = setup(frame(value) + frame(final('valid')) + 'data: [DONE]\n\n', { open: true })
    await expect(run.execute()).rejects.toMatchObject({ code: 'provider_response_invalid' })
    expect(run.cancel).toHaveBeenCalledOnce()
    await run.client.dispose()
  })

  it('未知具名通知不提供完成依据，也不阻止后续合法译文', async () => {
    const notice = 'event: future.notice\ndata: {"extension":true}\n\n'
    const incomplete = setup(notice)
    await expect(incomplete.execute()).rejects.toMatchObject({ code: 'provider_response_invalid' })
    const complete = setup(notice + frame(final('done')) + 'data: [DONE]\n\n', { open: true })
    await expect(complete.execute()).resolves.toMatchObject({ translations: [{ text: 'done' }] })
    expect(complete.cancel).toHaveBeenCalledOnce()
    expect(complete.body.locked).toBe(false)
    await incomplete.client.dispose()
    await complete.client.dispose()
  })

  it('最终结果之后的新内容不能改写已完成译文', async () => {
    const run = setup(frame(final('done')) + frame(final('extra')))
    await expect(run.execute()).rejects.toMatchObject({ code: 'provider_response_invalid' })
    await run.client.dispose()
  })

  it.each([true, false])('长度截断不能当作完整译文交付（stream=%s）', async stream => {
    const run = setup(frame(final('partial', 'length')), stream ? {} : { json: {
      ...fixture.nonStreaming, choices: [{ message: { content: 'partial' }, finish_reason: 'length' }],
    } })
    await expect(run.execute()).rejects.toMatchObject({ code: 'provider_task_failed', details: { finishReason: 'length' } })
    expect(run.events.some(event => event.type === 'item' || event.type === 'completed')).toBe(false)
    await run.client.dispose()
  })

  it('取消停滞读取不会在失败之前发出成功事件', async () => {
    const run = setup('', { open: true })
    const abort = new AbortController()
    const result = run.execute(abort.signal)
    await vi.waitFor(() => expect(run.body.locked).toBe(true))
    abort.abort()
    await expect(result).rejects.toMatchObject({ code: 'cancelled' })
    expect(run.cancel).toHaveBeenCalledOnce()
    expect(run.body.locked).toBe(false)
    expect(run.events.some(event => event.type === 'item' || event.type === 'completed')).toBe(false)
    await run.client.dispose()
  })

  it('异常断流保留读取阶段并释放锁，不暴露 transport 原文', async () => {
    const run = setup('', { open: true })
    const result = run.execute()
    await vi.waitFor(() => expect(run.body.locked).toBe(true))
    run.controller.error(new Error('private-source fixture-secret'))
    await expect(result).rejects.toMatchObject({ code: 'provider_response_invalid', details: { stage: 'read' } })
    expect(run.body.locked).toBe(false)
    expect(JSON.stringify(run.logger.error.mock.calls)).not.toMatch(/private-source|fixture-secret/)
    await run.client.dispose()
  })

  it.each(['\n', '\r\n', '\r'])('合法 SSE 换行在任意字节拆分后仍能完成：%j', async separator => {
    const wire = (frame(final('你好🙂')) + 'data: [DONE]\n\n').replaceAll('\n', separator)
    const run = setup(wire, { byteChunks: true })
    await expect(run.execute()).resolves.toMatchObject({ translations: [{ text: '你好🙂' }] })
    await run.client.dispose()
  })

  it.each(['started', 'item'] as const)('空输入在 %s 回调取消后不会继续发完成事件', async type => {
    const abort = new AbortController()
    const run = setup('', { source: '', onEvent: event => { if (event.type === type) abort.abort() } })
    await expect(run.execute(abort.signal)).rejects.toMatchObject({ code: 'cancelled' })
    expect(run.events.some(event => event.type === 'completed')).toBe(false)
    await run.client.dispose()
  })

  it('回调异常会取消流，释放锁并保留回调阶段', async () => {
    const run = setup(frame(final('value')), { open: true, onEvent: event => {
      if (event.type === 'delta') throw new Error('private-source fixture-secret')
    } })
    await expect(run.execute()).rejects.toMatchObject({ code: 'capability_execution_failed', details: { stage: 'callback' } })
    expect(run.cancel).toHaveBeenCalledOnce()
    expect(run.body.locked).toBe(false)
    expect(JSON.stringify(run.logger.error.mock.calls)).not.toMatch(/private-source|fixture-secret/)
    await run.client.dispose()
  })

  it.each([200, 429])('JSON 服务错误不依赖 code 存在，HTTP=%s 诊断脱敏', async status => {
    const run = setup('', { status, modelId: 'qwen-mt-plus', json: {
      error: { message: 'private-source fixture-secret' },
    } })
    await expect(run.execute()).rejects.toMatchObject({
      code: status === 200 ? 'provider_task_failed' : 'provider_rate_limited',
      details: { modelId: 'qwen-mt-plus', protocol: 'qwen-mt-json', stage: status === 200 ? 'parse' : 'http' },
    })
    expect(JSON.stringify(run.logger.error.mock.calls)).not.toMatch(/private-source|fixture-secret/)
    await run.client.dispose()
  })

  it('非流式结果缺少结束原因时不返回完整译文', async () => {
    const run = setup('', { json: { choices: [{ message: { content: 'partial' } }] } })
    await expect(run.execute()).rejects.toMatchObject({ code: 'provider_response_invalid' })
    await run.client.dispose()
  })
})
