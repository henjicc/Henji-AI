import { expect, it } from 'vitest'
import { ReplayRenderQueue } from './renderQueue'

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } {
  let resolve!: () => void, reject!: (error: Error) => void
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

it('同一时间只跑一个，后来的按到达顺序等前一个结束；前一个失败也照样交出位子', async () => {
  const queue = new ReplayRenderQueue()
  const started: string[] = [], ahead: number[] = []
  let running = 0, peak = 0
  const gates = { a: deferred(), b: deferred(), c: deferred() }
  const job = (name: keyof typeof gates) => queue.run(async () => {
    started.push(name); running += 1; peak = Math.max(peak, running)
    try { await gates[name].promise; return name } finally { running -= 1 }
  }, { onQueued: count => ahead.push(count) })
  const a = job('a'), b = job('b'), c = job('c')
  await settle()
  expect(started).toEqual(['a'])
  expect(ahead).toEqual([1, 2])
  expect(queue.size).toBe(3)
  gates.a.reject(new Error('第一段失败'))
  await expect(a).rejects.toThrow('第一段失败')
  await settle()
  expect(started).toEqual(['a', 'b'])
  gates.b.resolve()
  await expect(b).resolves.toBe('b')
  await settle()
  expect(started).toEqual(['a', 'b', 'c'])
  gates.c.resolve()
  await expect(c).resolves.toBe('c')
  expect(peak).toBe(1)
  expect(queue.size).toBe(0)
})

it('排队中取消：直接离开队列、不再开始，后面的照常轮到；已取消的不进队列', async () => {
  const queue = new ReplayRenderQueue()
  const first = deferred()
  const ran: string[] = []
  let cancelled = 0
  const a = queue.run(async () => { ran.push('a'); await first.promise })
  const controller = new AbortController()
  const b = queue.run(async () => { ran.push('b') }, { signal: controller.signal, onCancelled: () => { cancelled += 1 } })
  const c = queue.run(async () => { ran.push('c') })
  await settle()
  controller.abort()
  await expect(b).rejects.toMatchObject({ name: 'AbortError', message: '已取消重演' })
  expect(cancelled).toBe(1)
  expect(queue.size).toBe(2)
  await expect(queue.run(async () => { ran.push('late') }, { signal: AbortSignal.abort() })).rejects.toMatchObject({ name: 'AbortError' })
  first.resolve()
  await a; await c
  expect(ran).toEqual(['a', 'c'])
  // 开始以后再取消不归队列管：交给任务自己按 signal 停下
  controller.abort()
  expect(cancelled).toBe(1)
})
