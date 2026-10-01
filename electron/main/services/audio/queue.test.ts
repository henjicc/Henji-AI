import { describe, expect, it, vi } from 'vitest'
import { AudioWaveformQueue } from './queue'

const result = { peak: [0.5], rms: [0.25], durationSeconds: 1 }
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

describe('shared bounded waveform queue/cache', () => {
  it('deduplicates consumers, cancels individually, and copies both cached and fresh values', async () => {
    const queue = new AudioWaveformQueue()
    const close = deferred<typeof result>()
    const task = vi.fn(() => close.promise)
    const controller = new AbortController()
    const a = queue.run('source', task, controller.signal)
    const b = queue.run('source', task)
    controller.abort()
    await expect(a).rejects.toMatchObject({ name: 'AbortError' })
    expect(task).toHaveBeenCalledTimes(1)
    close.resolve(result)
    const value = await b
    value.peak[0] = 100
    const cached = await queue.run('source', task)
    expect(cached.peak).toEqual([0.5])
    cached.peak[0] = 200
    expect((await queue.run('source', task)).peak).toEqual([0.5])
    await queue.dispose()
  })
  it('holds two permits through native close, removes queued cancellation, and caps pending at32', async () => {
    const queue = new AudioWaveformQueue()
    const first = deferred<typeof result>(); const second = deferred<typeof result>()
    const c1 = new AbortController(); const c2 = new AbortController()
    const a = queue.run('a', () => first.promise, c1.signal)
    const b = queue.run('b', () => second.promise, c2.signal)
    const pending = new AbortController()
    const never = vi.fn(async () => result)
    const queued = queue.run('cancel', never, pending.signal)
    pending.abort(); await expect(queued).rejects.toMatchObject({ name: 'AbortError' })
    const waiting = Array.from({ length: 32 }, (_, index) => queue.run(`q${index}`, async () => result))
    expect(() => queue.run('overflow', async () => result)).toThrow('排队已满')
    c1.abort(); c2.abort()
    await expect(a).rejects.toMatchObject({ name: 'AbortError' })
    await expect(b).rejects.toMatchObject({ name: 'AbortError' })
    expect(queue.statistics).toMatchObject({ active: 2, queued: 32 })
    expect(never).not.toHaveBeenCalled()
    first.resolve(result); second.resolve(result)
    await Promise.all(waiting)
    await queue.dispose()
    expect(queue.statistics).toMatchObject({ active: 0, queued: 0, cacheBytes: 0 })
  })
  it('enforces byte-accounted LRU and disposal waits for the cancelled native close barrier', async () => {
    const queue = new AudioWaveformQueue(550)
    const task = vi.fn(async () => result)
    await queue.run('a', task); await queue.run('b', task)
    expect(queue.statistics.cacheBytes).toBeLessThanOrEqual(550)
    expect(queue.statistics.cacheEntries).toBe(1)
    await queue.run('a', task); expect(task).toHaveBeenCalledTimes(3)
    const close = deferred<typeof result>()
    const active = queue.run('native', () => close.promise)
    const rejected = expect(active).rejects.toMatchObject({ name: 'AbortError' })
    const disposed = queue.dispose()
    let closed = false
    void disposed.then(() => { closed = true })
    await Promise.resolve(); expect(closed).toBe(false)
    close.resolve(result); await rejected; await disposed
    expect(queue.statistics).toMatchObject({ active: 0, queued: 0, cacheBytes: 0 })
  })
  it('waits for an aborted native task whose key was reused by a new consumer', async () => {
    const queue = new AudioWaveformQueue()
    const oldClose = deferred<typeof result>(); const newClose = deferred<typeof result>()
    const cancel = new AbortController()
    const old = queue.run('same', () => oldClose.promise, cancel.signal)
    await Promise.resolve(); cancel.abort()
    await expect(old).rejects.toMatchObject({ name: 'AbortError' })
    const next = queue.run('same', () => newClose.promise).catch(error => error)
    await Promise.resolve()
    let ended = false
    const disposed = queue.dispose().then(() => { ended = true })
    expect(await next).toMatchObject({ name: 'AbortError' })
    newClose.resolve(result); await Promise.resolve(); await Promise.resolve()
    expect(ended).toBe(false)
    oldClose.resolve(result); await disposed
    expect(queue.statistics).toMatchObject({ active: 0, queued: 0, cacheBytes: 0 })
  })
})
