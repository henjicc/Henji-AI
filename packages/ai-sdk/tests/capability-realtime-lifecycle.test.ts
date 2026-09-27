import { describe, expect, it, vi } from 'vitest'
import { createCapabilityClient, type CapabilityExecutionContext, type CapabilityRealtimeModule } from '../src/capabilities'
import { defineSpeechRecognitionDescriptor } from '../src/capabilities/speech-recognition'
import { AiRuntimeError } from '../src/runtime/AiRuntimeError'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  void promise.catch(() => undefined)
  return { promise, resolve, reject }
}

function setup(observable = true) {
  const terminal = deferred<string>()
  const finishing = deferred<string>()
  const close = vi.fn(async () => undefined)
  const send = vi.fn(async (_value: string) => undefined)
  const finish = vi.fn(async () => await finishing.promise)
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const spanEnd = vi.fn()
  let context!: CapabilityExecutionContext<never>
  const module: CapabilityRealtimeModule<void, string, never, string> = {
    descriptor: defineSpeechRecognitionDescriptor({
      id: 'fixture.lifecycle', source: { kind: 'external', namespace: '@test/lifecycle' }, realtime: true,
    }),
    open: async (_input, ctx) => {
      context = ctx
      return { send, finish, close, ...(observable ? { result: terminal.promise } : {}) }
    },
  }
  const client = createCapabilityClient({
    runtime: {
      transport: { fetch: async () => { throw new Error('unused') } },
      credentials: { get: async () => undefined },
      media: { read: async () => { throw new Error('unused') } },
      logger, tracer: { startSpan: () => ({ end: spanEnd }) },
    }, realtimeModules: [module],
  })
  const open = (timeoutMs?: number) => client.openSession<void, string, never, string>(module.descriptor.id, undefined,
    { requestId: 'reused-id', timeoutMs })
  return { client, open, terminal, finishing, close, send, finish, logger, spanEnd, signal: () => context.signal }
}

describe('共享实时会话终止契约', () => {
  it('后台失败可观察、回收注册项且保持首个错误，不必等用户 finish', async () => {
    const test = setup()
    const session = await test.open()
    const error = new AiRuntimeError('provider_task_failed', 'fixture failure')
    test.terminal.reject(error)
    await expect(session.result).rejects.toBe(error)
    await expect(session.send('audio')).rejects.toBe(error)
    await expect(session.finish()).rejects.toBe(error)
    expect(test.close).toHaveBeenCalledOnce()
    expect(test.logger.error).toHaveBeenCalledOnce()
    expect(test.spanEnd).toHaveBeenCalledOnce()
    expect(test.spanEnd).toHaveBeenCalledWith(error)
    await expect(test.open()).resolves.toMatchObject({ requestId: 'reused-id' })
    await test.client.dispose()
  })

  it('旧驱动无需 result 也能正常 finish，移除内部取消监听且关闭一次', async () => {
    const test = setup(false)
    const session = await test.open()
    const remove = vi.spyOn(test.signal(), 'removeEventListener')
    const first = session.finish()
    expect(session.finish()).toBe(first)
    test.finishing.resolve('final')
    await expect(first).resolves.toBe('final')
    await expect(session.result).resolves.toBe('final')
    await session.close()
    expect(test.close).toHaveBeenCalledOnce()
    expect(test.spanEnd).toHaveBeenCalledOnce()
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
  })

  it('finish 等待期间超时，超时不能降级为取消或一直等待', async () => {
    const test = setup(false)
    const session = await test.open(10)
    await expect(session.finish()).rejects.toMatchObject({ code: 'timeout' })
    await expect(session.result).rejects.toMatchObject({ code: 'timeout' })
    expect(test.close).toHaveBeenCalledOnce()
    expect(test.logger.error).toHaveBeenCalledOnce()
  })

  it('关闭可终止仍等待的 finish；迟到结果不能再次完成或重复记日志', async () => {
    const test = setup(false)
    const session = await test.open()
    const finishing = session.finish()
    void finishing.catch(() => undefined)
    await Promise.resolve()
    expect(test.finish).toHaveBeenCalledOnce()
    await session.close()
    await expect(finishing).rejects.toMatchObject({ code: 'realtime_session_closed' })
    test.finishing.resolve('late final')
    await Promise.resolve()
    await Promise.resolve()
    expect(test.close).toHaveBeenCalledOnce()
    expect(test.spanEnd).toHaveBeenCalledOnce()
    expect(test.logger.info.mock.calls.filter(call => call[1]?.event === 'capability.session.completed')).toHaveLength(0)
  })

  it('取消与驱动失败竞争时收尾一次，清理失败不覆盖取消且无后台未处理拒绝', async () => {
    const test = setup()
    test.close.mockRejectedValue(new Error('synthetic close failure'))
    const session = await test.open()
    const pending = session.finish()
    void pending.catch(() => undefined)
    await Promise.resolve()
    expect(test.finish).toHaveBeenCalledOnce()
    test.client.cancel(session.requestId)
    test.terminal.reject(new Error('late failure'))
    test.finishing.reject(new Error('late finish failure'))
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' })
    expect(test.close).toHaveBeenCalledOnce()
    expect(test.logger.error).toHaveBeenCalledOnce()
    expect(test.logger.error).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      context: expect.objectContaining({ cleanupErrorCode: 'capability_execution_failed' }),
    }))
    expect(test.spanEnd).toHaveBeenCalledOnce()
    await test.client.dispose()
  })

  it('成功结果后的 close 失败仍暴露失败，不能发共享 completed', async () => {
    const test = setup()
    test.close.mockRejectedValue(new AiRuntimeError('cleanup_failed', 'fixture cleanup failure'))
    const session = await test.open()
    test.terminal.resolve('final')
    await expect(session.result).rejects.toMatchObject({ code: 'cleanup_failed' })
    expect(test.logger.error).toHaveBeenCalledOnce()
    expect(test.logger.info.mock.calls.filter(call => call[1]?.event === 'capability.session.completed')).toHaveLength(0)
  })

  it('send 的输入校验失败可以恢复，不被共享层一律当终止失败', async () => {
    const test = setup()
    test.send.mockRejectedValueOnce(new AiRuntimeError('invalid_audio_chunk', 'fixture invalid input'))
    const session = await test.open()
    await expect(session.send('bad')).rejects.toMatchObject({ code: 'invalid_audio_chunk' })
    await session.send('valid')
    expect(test.close).not.toHaveBeenCalled()
    test.finishing.resolve('final')
    await expect(session.finish()).resolves.toBe('final')
  })

  it('取消也会结算不响应关闭的旧驱动 send，不遗留调用方等待', async () => {
    const test = setup(false)
    test.send.mockImplementation(async () => await new Promise<void>(() => undefined))
    const session = await test.open()
    const pending = session.send('audio')
    void pending.catch(() => undefined)
    await Promise.resolve()
    expect(test.send).toHaveBeenCalledOnce()
    test.client.cancel(session.requestId)
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' })
    await expect(session.result).rejects.toMatchObject({ code: 'cancelled' })
    expect(test.close).toHaveBeenCalledOnce()
  })
})
