import { expect, it, vi } from 'vitest'
import type { GpuDevice } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { resolveAuthorEffects } from '@/core/videoEdit/authorEffects'
import { VideoEditAuthorEffects } from './videoEditAuthorEffects'

vi.mock('./videoEditBuiltinEffectsGpu', () => ({ VideoEditBuiltinEffectsGpu: class {
  encodePlan = vi.fn(async () => {})
  releaseIdle = vi.fn()
  abandon = vi.fn()
  dispose = vi.fn()
} }))

it('动态效果按尺寸复用工作纹理，覆写前撤销缓存资格，缩放和删层回收资源', async () => {
  const allocate = vi.fn(() => ({ createView: () => ({}), destroy: vi.fn() }))
  const release = vi.fn((texture: ReturnType<typeof allocate>) => texture.destroy())
  const chain = new VideoEditAuthorEffects({ createSampler: () => ({}) } as unknown as GpuDevice, { allocate, release })
  const input = { createView: () => ({}), destroy: vi.fn() }
  const context = { referenceSize: { width: 100, height: 50 }, contentBounds: { x: 0, y: 0, width: 20, height: 10 }, rasterScale: 1, rasterOrigin: [0, 0] as const, quality: 'interactive' as const }
  const begin = () => chain.begin({} as ReturnType<GpuDevice['createCommandEncoder']>)
  const encode = (amount: number, width = 64) => chain.encode('title', input, width, 32, [{ ...resolveAuthorEffects([{ id: 'black_white' }])[0], amount }], context, {}, 'same-pixels', { radius: 0, lens: false }, () => {}, 0)
  try {
    begin(); const first = await encode(.2); chain.commit()
    begin(); const next = await encode(.3); chain.commit()
    expect(next.picture).toBe(first.picture)
    const allocations = allocate.mock.calls.length
    for (const amount of [.4, .5, .6, .7, .8]) { begin(); await encode(amount); chain.commit() }
    expect(allocate).toHaveBeenCalledTimes(allocations)
    begin(); const committed = await encode(.8); chain.commit()
    begin(); await encode(.1); chain.abandon()
    begin(); expect((await encode(.8)).picture).toBe(committed.picture); chain.commit()
    for (let width = 65; width <= 90; width++) {
      begin(); await encode(.1, width); chain.abandon()
      // 只保留当前工作区，连续不同尺寸弃帧不积累资源。
      expect(allocate.mock.calls.length - release.mock.calls.length).toBe(2)
    }
    begin(); await encode(.9, 128); chain.commit()
    begin(); chain.commit()
    begin(); chain.commit()
    expect(release).toHaveBeenCalledTimes(allocate.mock.calls.length)
    for (const result of allocate.mock.results) expect(result.value.destroy).toHaveBeenCalledTimes(1)
  } finally { chain.dispose() }
  expect(input.destroy).not.toHaveBeenCalled()
})
