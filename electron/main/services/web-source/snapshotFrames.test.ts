import type { OffscreenSharedTexture } from 'electron'
import { afterEach, expect, it, vi } from 'vitest'
import { WebSnapshotFrames, WebSnapshotMiss } from './snapshotFrames'

afterEach(() => { vi.useRealTimers() })

function textures(): { identity: Map<OffscreenSharedTexture, string>; texture(id: string): OffscreenSharedTexture } {
  const identity = new Map<OffscreenSharedTexture, string>()
  return { identity, texture: id => { const value = { release: vi.fn() } as unknown as OffscreenSharedTexture; identity.set(value, id); return value } }
}

it('乱序按画面身份对号，合并帧允许补取，迟到及关闭中的纹理只归还一次', async () => {
  vi.useFakeTimers()
  const { identity, texture } = textures()
  const frames = new WebSnapshotFrames(async value => identity.get(value))
  const first = frames.expect('first'), second = frames.expect('second'), third = frames.expect('third')
  const missing = expect(second.frame).rejects.toBeInstanceOf(WebSnapshotMiss)
  const c = texture('third'), a = texture('first')
  frames.accept(c); frames.accept(a)
  expect(await third.frame).toBe(c); expect(await first.frame).toBe(a)
  await vi.advanceTimersByTimeAsync(50); await missing
  const late = texture('second'); frames.accept(late)
  expect(late.release).toHaveBeenCalledOnce()
  // 只剩一幅在等、更早的都已结清：直接领取，不读身份。
  const retry = frames.expect('second-retry'), b = texture('second-retry')
  frames.accept(b); expect(await retry.frame).toBe(b)
  const closing = frames.expect('closing'), next = frames.expect('next')
  const rejected = Promise.all([expect(closing.frame).rejects.toThrow('失效'), expect(next.frame).rejects.toThrow('失效')])
  const duringClose = texture('closing'); frames.accept(duringClose); frames.close()
  await rejected; await Promise.resolve()
  expect(duringClose.release).toHaveBeenCalledOnce()
  expect(frames.metrics).toMatchObject({ matched: 2, direct: 1, missed: 1, reordered: 1 })
})

it('取消的快照纹理仍在路上时，下一幅即使单独等待也要读身份，不把旧画面交给它', async () => {
  const { identity, texture } = textures()
  const frames = new WebSnapshotFrames(async value => identity.get(value))
  const cancelled = frames.expect('cancelled')
  cancelled.cancel()
  await expect(cancelled.frame).rejects.toThrow('取消')
  const current = frames.expect('current')
  const old = texture('cancelled'), fresh = texture('current')
  frames.accept(old); frames.accept(fresh)
  expect(await current.frame).toBe(fresh)
  await vi.waitFor(() => expect(old.release).toHaveBeenCalledOnce())
  expect(frames.metrics).toMatchObject({ matched: 1, direct: 0, stale: 1 })
})

it('读身份失败时在途各幅按合并补取并通知页面改回串行', async () => {
  const broken = vi.fn()
  const frames = new WebSnapshotFrames(async () => { throw new Error('读回窗口已关闭') }, broken)
  const first = frames.expect('first'), second = frames.expect('second')
  const texture = { release: vi.fn() } as unknown as OffscreenSharedTexture
  frames.accept(texture)
  await expect(first.frame).rejects.toBeInstanceOf(WebSnapshotMiss)
  await expect(second.frame).rejects.toBeInstanceOf(WebSnapshotMiss)
  expect(texture.release).toHaveBeenCalledOnce()
  expect(broken).toHaveBeenCalledOnce()
})
