import { expect, it, vi } from 'vitest'
import type { VideoDecoderLifecycleEvent } from '../video-decoder/client'
import { WebCacheLocks, type WebCacheLockService } from './locks'

function fake(): { service: WebCacheLockService; exit: () => void } {
  const listeners = new Set<(event: VideoDecoderLifecycleEvent) => void>()
  return { service: {
    ensureStarted: vi.fn(async () => ({} as Awaited<ReturnType<WebCacheLockService['ensureStarted']>>)),
    onLifecycle: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    webCacheLock: vi.fn(async () => ({ acquired: true })), webCacheUnlock: vi.fn(async () => ({ released: true })),
    webCacheCommit: vi.fn(async () => undefined), webCacheRollback: vi.fn(async () => undefined),
    webCachePrepare: vi.fn(async () => undefined),
    webCacheDiscard: vi.fn(async () => ({ removed: true })),
  }, exit: () => { for (const listener of listeners) listener({ type: 'exited', pid: 1 }) } }
}

it('取消迟到获取仍按同 token 释放；争用中取消不启动生产者', async () => {
  const { service } = fake(), locks = new WebCacheLocks(service), controller = new AbortController(), work = vi.fn()
  let acquired!: (value: { acquired: boolean }) => void
  vi.mocked(service.webCacheLock).mockImplementationOnce(() => new Promise(resolve => { acquired = resolve }))
  const pending = expect(locks.withSegmentLock('same', work, controller.signal)).rejects.toThrow('cancel')
  await vi.waitFor(() => expect(acquired).toBeDefined())
  controller.abort(new Error('cancel')); acquired({ acquired: true }); await pending
  expect(work).not.toHaveBeenCalled()
  expect(service.webCacheUnlock).toHaveBeenCalledWith(...vi.mocked(service.webCacheLock).mock.calls[0])
  const waiting = new AbortController()
  vi.mocked(service.webCacheLock).mockResolvedValue({ acquired: false })
  const next = expect(locks.withSegmentLock('same', work, waiting.signal)).rejects.toThrow()
  await vi.waitFor(() => expect(vi.mocked(service.webCacheLock).mock.calls.length).toBeGreaterThanOrEqual(2))
  waiting.abort(); await next
  expect(work).not.toHaveBeenCalled()
  expect(service.webCacheUnlock).toHaveBeenCalledTimes(1)
})

it('持锁进程退出使在途工作失效，禁止旧租约提交、回滚或释放新代次', async () => {
  const { service, exit } = fake(), locks = new WebCacheLocks(service)
  await expect(locks.withSegmentLock('same', async lease => {
    exit()
    expect(lease.signal.aborted).toBe(true)
    await expect(lease.commit('tmp', 'ready')).rejects.toThrow('进程已退出')
    await expect(lease.rollback()).rejects.toThrow('进程已退出')
    await expect(lease.prepare('ready')).rejects.toThrow('进程已退出')
  })).rejects.toThrow('进程已退出')
  expect(service.webCacheCommit).not.toHaveBeenCalled()
  expect(service.webCacheRollback).not.toHaveBeenCalled()
  expect(service.webCachePrepare).not.toHaveBeenCalled()
  expect(service.webCacheUnlock).not.toHaveBeenCalled()
})

it('获取超时后的清理仍发送原租约，已取得的锁在提交异常后释放', async () => {
  const { service } = fake(), locks = new WebCacheLocks(service)
  vi.mocked(service.webCacheLock).mockRejectedValueOnce(new Error('timeout'))
  await expect(locks.withSegmentLock('same', vi.fn())).rejects.toThrow('timeout')
  expect(service.webCacheUnlock).toHaveBeenCalledWith(...vi.mocked(service.webCacheLock).mock.calls[0])
  vi.mocked(service.webCacheCommit).mockRejectedValueOnce(new Error('disk'))
  await expect(locks.withSegmentLock('same', async lease => { await lease.commit('tmp', 'ready') })).rejects.toThrow('disk')
  expect(service.webCacheUnlock).toHaveBeenCalledTimes(2)
})
