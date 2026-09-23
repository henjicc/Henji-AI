import { describe, expect, it, vi } from 'vitest'
import fixture from '../fixtures/llm/chat-stream-lifecycle.json'
import { runLlmChatStream, parseModelProviderError, type RuntimeContext } from '../../src/llm/streaming/index'

const request = {
  providerId: 'openai', modelId: 'fixture-model',
  messages: [{ role: 'user' as const, content: 'fixture' }],
}
const sse = (value: unknown): string => `data: ${JSON.stringify(value)}\n\n`
const done = 'data: [DONE]\n\n'

function setup(source: string, open = false, providerId = 'openai') {
  const cancel = vi.fn()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value
      value.enqueue(new TextEncoder().encode(source))
      if (!open) value.close()
    },
    cancel,
  })
  const fetch = vi.fn(async () => new Response(body))
  const runtime: RuntimeContext = {
    transport: { fetch }, credentials: { get: async () => 'fixture-credential' },
    media: { read: async () => { throw new Error('unused') } },
  }
  const completed = vi.fn()
  const emit = vi.fn()
  const run = (signal?: AbortSignal, timeoutMs?: number) => runLlmChatStream({ ...request, providerId }, 'lifecycle', emit, runtime,
    { onCompleted: completed }, { signal, timeoutMs })
  return { run, body, controller, cancel, completed, emit, fetch }
}

describe('Chat SSE lifecycle (official field-table fixture + synthetic-negative mutations)', () => {
  it('保留空角色通知、连续文本、空 final、usage；DONE 主动释放仍打开的流', async () => {
    const test = setup(': heartbeat\n\n' + sse(fixture.role) + sse(fixture.partial)
      + sse(fixture.partial) + sse(fixture.final) + sse(fixture.usage) + done, true)
    await expect(test.run()).resolves.toMatchObject({ output: 'Hello Hello ', finishReason: 'stop', usage: { totalTokens: 5 } })
    expect(test.completed).toHaveBeenCalledOnce()
    expect(test.emit).toHaveBeenCalledTimes(2)
    expect(test.cancel).toHaveBeenCalledOnce()
    expect(test.body.locked).toBe(false)
  })

  it('有效 final 后 EOF 可以完成，不依赖非空文本', async () => {
    const test = setup(sse(fixture.role) + sse(fixture.final))
    await expect(test.run()).resolves.toMatchObject({ output: '', finishReason: 'stop' })
    expect(test.body.locked).toBe(false)
  })

  it.each([
    ['empty EOF', '', 'STREAM_INCOMPLETE'],
    ['partial EOF', sse(fixture.partial), 'STREAM_INCOMPLETE'],
    ['partial DONE', sse(fixture.partial) + done, 'STREAM_INCOMPLETE'],
    ['usage only', sse(fixture.usage) + done, 'STREAM_INCOMPLETE'],
    ['missing choices', sse({ unexpected: true }) + done, 'INVALID_STREAM_RESPONSE'],
    ['missing delta', sse({ choices: [{ finish_reason: 'stop' }] }) + done, 'INVALID_STREAM_RESPONSE'],
    ['bad content', sse({ choices: [{ delta: { content: 42 }, finish_reason: 'stop' }] }), 'INVALID_STREAM_RESPONSE'],
    ['bad finish', sse({ choices: [{ delta: {}, finish_reason: false }] }), 'INVALID_STREAM_RESPONSE'],
    ['malformed JSON', 'data: {"secret":"private-content",\n\n', 'INVALID_STREAM_RESPONSE'],
    ['incomplete SSE final', sse(fixture.partial) + sse(fixture.final).trimEnd(), 'STREAM_INCOMPLETE'],
    ['error envelope', sse(fixture.partial) + sse(fixture.error), 'server_error'],
    ['named error', 'event: error\n' + sse(fixture.error.error), 'server_error'],
    ['error after final', sse(fixture.final) + sse(fixture.error), 'server_error'],
    ['content after final', sse(fixture.final) + sse(fixture.partial), 'INVALID_STREAM_RESPONSE'],
  ])('%s 不得完成且释放读取器', async (_name, source, code) => {
    const test = setup(source)
    const error = await test.run().catch(value => value)
    expect(error).toBeInstanceOf(Error)
    expect(parseModelProviderError(error)).toMatchObject({ code, providerId: 'openai', modelId: 'fixture-model' })
    expect(error).toMatchObject({ details: { protocol: 'openai-chat-sse', modelId: 'fixture-model' } })
    expect(JSON.stringify(error)).not.toContain('private-content')
    expect(JSON.stringify(error)).not.toContain('synthetic private content')
    expect(test.completed).not.toHaveBeenCalled()
    expect(test.body.locked).toBe(false)
    expect(test.fetch).toHaveBeenCalledOnce()
  })

  it('未知命名通知不制造完成，也不阻断后续合法完成', async () => {
    const extension = 'event: provider.metadata\n' + sse({ future: true })
    await expect(setup(extension + sse(fixture.final) + done).run()).resolves.toMatchObject({ finishReason: 'stop' })
    const error = await setup(extension + done).run().catch(value => value)
    expect(parseModelProviderError(error)?.code).toBe('STREAM_INCOMPLETE')
  })

  it.each(['\r', '\r\n', '\n'])('接受官方 SSE 换行 %j', async (newline) => {
    const test = setup((sse(fixture.partial) + sse(fixture.final) + done).replaceAll('\n', newline))
    await expect(test.run()).resolves.toMatchObject({ output: 'Hello ', finishReason: 'stop' })
  })

  it('智谱缺省 choices 状态通知可继续，但不能代替 final 或容忍错类型', async () => {
    const status = sse({ id: 'fixture-status' })
    await expect(setup(status + sse(fixture.final) + done, false, 'bigmodel').run()).resolves.toMatchObject({ finishReason: 'stop' })
    const incomplete = await setup(status + done, false, 'bigmodel').run().catch(value => value)
    expect(parseModelProviderError(incomplete)?.code).toBe('STREAM_INCOMPLETE')
    const malformed = await setup(sse({ choices: {} }), false, 'bigmodel').run().catch(value => value)
    expect(parseModelProviderError(malformed)?.code).toBe('INVALID_STREAM_RESPONSE')
  })

  it('超时会中断等待中的 reader，保持 timeout 错误且释放资源', async () => {
    const test = setup(sse(fixture.role), true)
    const error = await test.run(undefined, 20).catch(value => value)
    expect(parseModelProviderError(error)?.code).toBe('MODEL_REQUEST_TIMEOUT')
    expect(test.cancel).toHaveBeenCalledOnce()
    expect(test.body.locked).toBe(false)
    expect(test.completed).not.toHaveBeenCalled()
  })

  it('解析错误立即取消尚未关闭的流', async () => {
    const test = setup(sse(fixture.error), true)
    await expect(test.run()).rejects.toThrow()
    expect(test.cancel).toHaveBeenCalledOnce()
    expect(test.body.locked).toBe(false)
  })

  it('取消能够终止不响应 signal 的宿主读取器，且不调用 completed', async () => {
    const test = setup(sse(fixture.partial), true)
    const controller = new AbortController()
    test.emit.mockImplementation(() => controller.abort())
    await expect(test.run(controller.signal)).rejects.toThrow('[task_cancelled]')
    expect(test.cancel).toHaveBeenCalledOnce()
    expect(test.body.locked).toBe(false)
    expect(test.completed).not.toHaveBeenCalled()
  })

  it('异常断连保留失败，回收锁且不完成', async () => {
    const test = setup(sse(fixture.partial), true)
    test.emit.mockImplementation(() => test.controller.error(new Error('synthetic disconnect')))
    await expect(test.run()).rejects.toThrow()
    expect(test.body.locked).toBe(false)
    expect(test.completed).not.toHaveBeenCalled()
  })
})
