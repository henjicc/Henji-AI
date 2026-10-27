import { expect, it } from 'vitest'
import { VirtualScheduler } from './virtualClock'

const tick = (): Promise<void> => new Promise(resolve => setImmediate(resolve))

it('只在推进时走：按到期先后、同时到期按登记顺序触发，触发时读到各自的到期时刻', async () => {
  const clock = new VirtualScheduler(100)
  const seen: Array<[string, number]> = []
  clock.setTimer(() => seen.push(['b', clock.now]), 50, [], false)
  clock.setTimer(() => seen.push(['a', clock.now]), 20, [], false)
  clock.setTimer(() => seen.push(['c', clock.now]), 50, [], false)
  await tick()
  expect(seen).toEqual([])
  expect(await clock.advanceTo(140, tick)).toBe(1)
  expect(seen).toEqual([['a', 120]])
  expect(clock.now).toBe(140)
  await clock.advanceTo(150, tick)
  expect(seen).toEqual([['a', 120], ['b', 150], ['c', 150]])
})

it('定时器里新登记的、在目标时刻之前到期的也在同一次推进里触发；两次触发之间先让出一个任务', async () => {
  const clock = new VirtualScheduler(0)
  const order: string[] = []
  clock.setTimer(() => {
    order.push('outer')
    void Promise.resolve().then(() => order.push('outer-microtask'))
    clock.setTimer(() => order.push('inner'), 5, [], false)
  }, 10, [], false)
  clock.setTimer(() => order.push('sibling'), 10, [], false)
  await clock.advanceTo(20, tick)
  expect(order).toEqual(['outer', 'outer-microtask', 'sibling', 'inner'])
})

it('间隔定时器按固定节拍重复，可清掉；深层嵌套的 0 毫秒定时器按 4 毫秒', async () => {
  const clock = new VirtualScheduler(0)
  const at: number[] = []
  const id = clock.setTimer(() => at.push(clock.now), 30, [], true)
  await clock.advanceTo(100, tick)
  expect(at).toEqual([30, 60, 90])
  clock.clearTimer(id)
  await clock.advanceTo(200, tick)
  expect(at).toEqual([30, 60, 90])

  const nested: number[] = []
  const again = (): void => { nested.push(clock.now); if (nested.length < 8) clock.setTimer(again, 0, [], false) }
  clock.setTimer(again, 0, [], false)
  await clock.advanceTo(300, tick)
  // 前 4 层 0 毫秒，第 5 层起每层 4 毫秒（Chromium 的嵌套定时器下限）
  expect(nested.map(t => t - 200)).toEqual([0, 0, 0, 0, 4, 8, 12, 16])
})

it('动画帧在推进时刻一次跑完先前登记的回调，帧内新登记的留到下一帧', async () => {
  const clock = new VirtualScheduler(0)
  const frames: Array<[string, number]> = []
  clock.requestFrame(time => { frames.push(['a', time]); clock.requestFrame(next => frames.push(['a2', next])) })
  const cancelled = clock.requestFrame(() => frames.push(['x', 0]))
  clock.cancelFrame(cancelled)
  await clock.advanceTo(16.5, tick)
  expect(await clock.runFrame(tick)).toBe(1)
  expect(frames).toEqual([['a', 16.5]])
  await clock.advanceTo(33, tick)
  await clock.runFrame(tick)
  expect(frames).toEqual([['a', 16.5], ['a2', 33]])
})

it('定时器抛错不打断时钟，交给页面的错误处理；字符串处理器按全局脚本执行', async () => {
  const errors: unknown[] = []
  const clock = new VirtualScheduler(0, error => errors.push(error))
  const ran: string[] = []
  clock.setTimer(() => { throw new Error('boom') }, 1, [], false)
  clock.setTimer((...args: unknown[]) => ran.push(String(args.join('+'))), 2, ['x', 'y'], false)
  ;(globalThis as Record<string, unknown>).__virtualClockTest = 0
  clock.setTimer('globalThis.__virtualClockTest = 7', 3, [], false)
  await clock.advanceTo(10, tick)
  expect((errors[0] as Error).message).toBe('boom')
  expect(ran).toEqual(['x+y'])
  expect((globalThis as Record<string, unknown>).__virtualClockTest).toBe(7)
  expect(clock.nextDue()).toBe(Infinity)
})
