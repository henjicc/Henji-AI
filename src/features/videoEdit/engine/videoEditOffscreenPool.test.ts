import { afterEach, expect, it, vi } from 'vitest'
import { createVideoEditTestDocument } from '@/core/videoEdit/testFixtures'
import { videoEditComposition } from '@/core/videoEdit/document'
import type { VideoEditRenderSession } from './videoEditRenderSession'
import { VideoEditOffscreenPool } from './videoEditOffscreenPool'

afterEach(() => { vi.useRealTimers() })
function fixture() {
  const source = createVideoEditTestDocument('pool')
  const document = videoEditComposition(source, source.sequences[0].id)
  const session = { replaceContent: vi.fn().mockResolvedValue(undefined), dispose: vi.fn().mockResolvedValue(undefined) }
  const create = vi.fn(async () => session as unknown as VideoEditRenderSession)
  const memory = vi.fn(async () => true)
  const pool = new VideoEditOffscreenPool(create, memory)
  return { document, session, create, memory, pool, signal: new AbortController().signal }
}
it('exclusive leases reuse one worker and always replace content before handing it over', async () => {
  const f = fixture(); const first = await f.pool.acquire(f.document, f.signal)
  let secondReady = false
  const second = f.pool.acquire({ ...f.document, id: 'other', revision: 0 }, f.signal).then(value => { secondReady = true; return value })
  await Promise.resolve(); expect(secondReady).toBe(false)
  await first.release(); const next = await second
  expect(first.reused).toBe(false); expect(next.reused).toBe(true)
  expect(f.create).toHaveBeenCalledOnce()
  expect(f.session.replaceContent).toHaveBeenCalledWith(expect.objectContaining({ id: 'other', revision: 0 }))
  await next.release(); await f.pool.dispose(); expect(f.session.dispose).toHaveBeenCalledOnce()
})
it('cancelled waiters never unlock the active owner', async () => {
  const f = fixture(); const first = await f.pool.acquire(f.document, f.signal)
  const controller = new AbortController()
  const wait = f.pool.acquire(f.document, controller.signal)
  const rejected = expect(wait).rejects.toThrow(); controller.abort(); await rejected
  let ready = false
  const next = f.pool.acquire(f.document, f.signal).then(value => { ready = true; return value })
  await Promise.resolve(); expect(ready).toBe(false)
  await first.release(); await (await next).release(); await f.pool.dispose()
})
it('failed or aborted active work retires the worker before the next lease', async () => {
  const f = fixture(); const first = await f.pool.acquire(f.document, f.signal)
  await first.release(true); await first.release(true)
  const next = await f.pool.acquire(f.document, f.signal)
  expect(next.reused).toBe(false); expect(f.create).toHaveBeenCalledTimes(2)
  await next.release(); await f.pool.dispose()
})
it('idle timeout and memory pressure reclaim speculative resources, never an active lease', async () => {
  vi.useFakeTimers()
  const f = fixture(); const first = await f.pool.acquire(f.document, f.signal)
  await vi.advanceTimersByTimeAsync(60_000); expect(f.session.dispose).not.toHaveBeenCalled()
  await first.release(); await vi.advanceTimersByTimeAsync(60_000)
  expect(f.session.dispose).toHaveBeenCalledOnce()
  const next = await f.pool.acquire(f.document, f.signal); await next.release()
  f.memory.mockResolvedValue(false); await vi.advanceTimersByTimeAsync(5000)
  expect(f.session.dispose).toHaveBeenCalledTimes(2)
  await f.pool.dispose(); expect(vi.getTimerCount()).toBe(0)
})

it('空闲回收尚未完成时先等待释放旧设备，再创建新会话', async () => {
  vi.useFakeTimers()
  const f = fixture(); const lease = await f.pool.acquire(f.document, f.signal)
  let finish!: () => void
  f.session.dispose.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  await lease.release(); await vi.advanceTimersByTimeAsync(60_000)
  const next = f.pool.acquire(f.document, f.signal)
  await Promise.resolve(); expect(f.create).toHaveBeenCalledOnce()
  finish(); await (await next).release(); await f.pool.dispose()
})
it('替换文档卡住时中止会销毁旧 Worker，后续请求重新建立', async () => {
  const f = fixture(); await (await f.pool.acquire(f.document, f.signal)).release()
  f.session.replaceContent.mockImplementationOnce(() => new Promise(() => undefined))
  const controller = new AbortController(); const pending = f.pool.acquire(f.document, controller.signal)
  const rejected = expect(pending).rejects.toThrow()
  await vi.waitFor(() => expect(f.session.replaceContent).toHaveBeenCalledOnce())
  controller.abort(); await rejected
  const last = await f.pool.acquire(f.document, f.signal); expect(last.reused).toBe(false)
  await last.release(); await f.pool.dispose()
})
