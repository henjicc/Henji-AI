import { describe, expect, it, vi } from 'vitest'
import type { ImageEditorV3PyramidDescriptor } from '@/platform/contracts/imageEditorV3'
import { ImageEditorSourcePyramidCacheV3 } from './imageEditorSourcePyramidsV3'

function descriptor(width = 200): ImageEditorV3PyramidDescriptor {
  return { tileSize: 512, levels: [{ mip: 0, width, height: 100, columns: 1, rows: 1 }] }
}
function deferred() {
  let resolve!: (value: ImageEditorV3PyramidDescriptor) => void
  const promise = new Promise<ImageEditorV3PyramidDescriptor>((done) => { resolve = done })
  return { promise, resolve }
}
const request = { requestId: 'test', resourceRef: `sha256:${'a'.repeat(64)}` as const }

describe('图片源金字塔共享缓存', () => {
  it('CPU、GPU、预热对同一资源只读一次，十个独立源串行准入', async () => {
    let active = 0
    let maximum = 0
    const reader = vi.fn(async () => {
      maximum = Math.max(maximum, ++active)
      await Promise.resolve()
      active -= 1
      return descriptor()
    })
    const cache = new ImageEditorSourcePyramidCacheV3(reader)
    const reads = Array.from({ length: 10 }, (_, index) => ({
      requestId: `test-${index}`, resourceRef: `sha256:${index.toString(16).repeat(64)}` as const,
    }))
    await Promise.all(reads.flatMap((entry) => [cache.read(entry), cache.read(entry), cache.read(entry)]))
    expect(reader).toHaveBeenCalledTimes(10)
    expect(maximum).toBe(1)
    await cache.read(reads[0])
    expect(reader).toHaveBeenCalledTimes(10)
  })

  it('单个调用取消不取消其他读者；返回值不能污染共享缓存', async () => {
    const pending = deferred()
    const reader = vi.fn(() => pending.promise)
    const cache = new ImageEditorSourcePyramidCacheV3(reader)
    const controller = new AbortController()
    const first = cache.read(request, controller.signal)
    const second = cache.read(request)
    controller.abort()
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    pending.resolve(descriptor())
    const value = await second
    value.levels[0].width = 999
    expect((await cache.read(request)).levels[0].width).toBe(200)
    expect(reader).toHaveBeenCalledOnce()
  })

  it('全部取消后新读者重新读取，旧异步完成不得覆盖新读者或写入缓存', async () => {
    const old = deferred()
    const reader = vi.fn().mockImplementationOnce(() => old.promise).mockResolvedValue(descriptor(300))
    const cache = new ImageEditorSourcePyramidCacheV3(reader)
    const controller = new AbortController()
    const first = cache.read(request, controller.signal)
    await vi.waitFor(() => expect(reader).toHaveBeenCalledOnce())
    controller.abort()
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    const second = cache.read(request)
    old.resolve(descriptor(100))
    expect((await second).levels[0].width).toBe(300)
    expect((await cache.read(request)).levels[0].width).toBe(300)
    expect(reader).toHaveBeenCalledTimes(2)
  })
})
