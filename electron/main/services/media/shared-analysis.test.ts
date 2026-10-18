import { expect, it, vi } from 'vitest'
import { SharedMediaAnalysis } from './shared-analysis'

it('同键共享工作，重复进度函数仍按调用方隔离，返回值互不污染', async () => {
  const shared = new SharedMediaAnalysis<{ values: number[] }>()
  let finish!: () => void; let report!: (value: number) => void
  const run = vi.fn(async (_signal: AbortSignal, progress: (value: number) => void) => { report = progress; await new Promise<void>(resolve => { finish = resolve }); return { values: [1] } })
  const firstController = new AbortController(); const progress = vi.fn()
  const first = shared.run('a', run, firstController.signal, progress).catch(error => error)
  const second = shared.run('a', run, new AbortController().signal, progress)
  await vi.waitFor(() => expect(run).toHaveBeenCalledOnce())
  firstController.abort(); const before = progress.mock.calls.length; report(.5)
  expect(progress.mock.calls.length).toBe(before + 1)
  finish(); expect(await first).toBeInstanceOf(Error); expect(await second).toEqual({ values: [1] })
  const left = shared.run('b', async () => ({ values: [1] }), new AbortController().signal, () => undefined)
  const right = shared.run('b', async () => ({ values: [2] }), new AbortController().signal, () => undefined)
  const results = await Promise.all([left, right]); results[0].values.push(9)
  expect(results[1]).toEqual({ values: [1] })
})

it('最后一位取消后仍等待原任务收尾，不超售槽位；失败后释放', async () => {
  const shared = new SharedMediaAnalysis<number>()
  let finish!: () => void
  const controller = new AbortController()
  const first = shared.run('a', async signal => { await new Promise<void>(resolve => { finish = resolve }); signal.throwIfAborted(); return 1 }, controller.signal, () => undefined).catch(error => error)
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  controller.abort()
  expect(() => shared.run('a', async () => 1, new AbortController().signal, () => undefined)).toThrow('正在取消')
  const second = shared.run('b', async () => 2, new AbortController().signal, () => undefined)
  expect(() => shared.run('c', async () => 3, new AbortController().signal, () => undefined)).toThrow('两段')
  finish(); await first; await second
  await vi.waitFor(async () => { expect(await shared.run('c', async () => 3, new AbortController().signal, () => undefined)).toBe(3) })
})

it('一个消费者的进度异常不破坏其他消费者', async () => {
  const shared = new SharedMediaAnalysis<number>()
  let finish!: () => void; let report!: (value: number) => void
  const operation = async (_signal: AbortSignal, progress: (value: number) => void): Promise<number> => { report = progress; await new Promise<void>(resolve => { finish = resolve }); return 7 }
  const first = shared.run('a', operation, new AbortController().signal, value => { if (value > 0) throw new Error('订阅已关闭') }).catch(error => error)
  const second = shared.run('a', operation, new AbortController().signal, () => undefined)
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  report(.5); finish()
  expect(await first).toMatchObject({ message: '订阅已关闭' }); expect(await second).toBe(7)
})
