import { describe, expect, it, vi } from 'vitest'
import { SourceDecodeStripeCache } from './source-decode-stripes'

describe('源解码条带缓存', () => {
  it('冷源并发去重，一个调用者取消不取消其他消费者', async () => {
    const cache = new SourceDecodeStripeCache()
    let finish!: (value: Buffer) => void
    const decode = vi.fn(() => new Promise<Buffer>(resolve => { finish = resolve }))
    const controller = new AbortController()
    const first = cache.read('source:row', 4, decode, controller.signal)
    const second = cache.read('source:row', 4, decode)
    controller.abort()
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    finish(Buffer.from([1, 2, 3, 4]))
    expect(await second).toEqual(Buffer.from([1, 2, 3, 4]))
    expect(await cache.read('source:row', 4, decode)).toEqual(Buffer.from([1, 2, 3, 4]))
    expect(decode).toHaveBeenCalledOnce()
  })

  it('缓存与在途解码共同占预算，超过预算退回区域解码而不拒绝源图', async () => {
    const cache = new SourceDecodeStripeCache()
    const bytes = 16 * 1024 * 1024
    const pending: Array<(value: Buffer) => void> = []
    const decode = vi.fn(() => new Promise<Buffer>(resolve => pending.push(resolve)))
    const first = cache.read('row0', bytes, decode)
    const second = cache.read('row1', bytes, decode)
    expect(await cache.read('row2', bytes, decode)).toBeNull()
    expect(await cache.read('wide', bytes + 1, decode)).toBeNull()
    pending.forEach(resolve => resolve(Buffer.alloc(bytes)))
    await Promise.all([first, second])
    expect(decode).toHaveBeenCalledTimes(2)
    const third = vi.fn(async () => Buffer.alloc(bytes))
    await cache.read('row2', bytes, third)
    expect(third).toHaveBeenCalledOnce()
  })

  it('解码失败释放在途预算，可重试；损坏尺寸不进入缓存', async () => {
    const cache = new SourceDecodeStripeCache()
    await expect(cache.read('failed', 4, async () => { throw new Error('decode failed') })).rejects.toThrow('decode failed')
    await expect(cache.read('failed', 4, async () => Buffer.alloc(3))).rejects.toThrow('incompatible')
    expect(await cache.read('failed', 4, async () => Buffer.alloc(4))).toEqual(Buffer.alloc(4))
  })
})
