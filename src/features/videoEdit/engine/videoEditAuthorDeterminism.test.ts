import { TEXT_LAYOUT_OBSERVER, observeTextLayouts, type TextLayoutObserverGlobal } from '@/core/videoEdit/textDrawObservation'
import { expect, it } from 'vitest'
import type { AuthorFrameInfo, AuthorModule } from './videoEditAuthorModule'
import { deterministicAuthorModule, importAuthorDeterministic } from './videoEditAuthorDeterminism'

const info = (time: number): AuthorFrameInfo => ({ time, frameDuration: 1 / 30, clip: { time, duration: 2 } })
const ctx = {} as OffscreenCanvasRenderingContext2D

it('作者入口里的随机数与时钟只由入口和时刻决定：同一帧重复渲染得到同一串数，换帧才变；离开作者代码立即恢复', () => {
  const seen: Array<[string, number, number, number]> = []
  const effect = deterministicAuthorModule({
    name: '随机星点',
    layers: () => [
      { id: 'stars', draw: (_ctx, time) => { seen.push(['draw', Math.random(), Date.now(), performance.now()]); void time } },
      { draw: () => seen.push(['second', Math.random(), 0, 0]), bounds: [0, 0, 10, 10], pose: () => ({ x: Math.random() }) },
    ],
  })
  const frame = (time: number) => {
    seen.length = 0
    const list = effect.layers!({}, 100, 100, {}, info(time))
    list.forEach(layer => layer.draw(ctx, time))
    return { values: [...seen], pose: list[1].pose!(time) }
  }
  const first = frame(1.5)
  expect(frame(1.5)).toEqual(first)
  expect(first.values[0].slice(2)).toEqual([1500, 1500])
  // 不同图层各有自己的序列，不因画的先后互相影响。
  expect(first.values[0][1]).not.toBe(first.values[1][1])
  expect(frame(1.5 + 1 / 30).values[0][1]).not.toBe(first.values[0][1])
  const outside = Math.random
  expect(outside()).not.toBe(outside())
  expect(Object.hasOwn(performance, 'now')).toBe(false)
  expect(Date.now()).toBeGreaterThan(1_700_000_000_000)
})

it('作者的方法仍以原对象为 this，冻结的常量图层也能包装，dispose 调到原模块', () => {
  const background = Object.freeze({ draw(this: { color: string }) { calls.push(this.color) }, color: 'ink' })
  const calls: string[] = []
  const source: AuthorModule & { disposed?: boolean } = { name: '背景', layers: () => [background], dispose() { this.disposed = true } }
  const effect = deterministicAuthorModule(source)
  effect.layers!({}, 1, 1, {}, info(0))[0].draw(ctx, 0)
  void effect.dispose?.()
  expect(calls).toEqual(['ink'])
  expect(source.disposed).toBe(true)
})

it('作者代码抛错时也恢复原来的随机数与时钟', () => {
  const random = Math.random
  const effect = deterministicAuthorModule({ name: '出错', draw: () => { throw new Error('作者错误') } })
  expect(() => effect.draw!(ctx, 0, {}, 1, 1, {}, info(0))).toThrow('作者错误')
  expect(Math.random).toBe(random)
})

it('模块顶层代码的随机数每次加载都相同，加载完恢复', async () => {
  const random = Math.random
  const load = () => importAuthorDeterministic(async () => [Math.random(), Math.random()])
  const [first, second] = await Promise.all([load(), load()])
  expect(second).toEqual(first)
  expect(Math.random).toBe(random)
})

it('模块顶层布局按串行 import 分配归属，并排绘制使用自己的观察作用域', async () => {
  const host = globalThis as TextLayoutObserverGlobal, first: string[] = [], second: string[] = [], frame: string[] = []
  const emit = (id: string) => host[TEXT_LAYOUT_OBSERVER]?.(id)
  const one = importAuthorDeterministic(async () => {
    emit('module-one')
    await Promise.resolve()
    observeTextLayouts(id => frame.push(id), () => emit('frame'))
    emit('module-one-after-await')
  }, id => first.push(id))
  const two = importAuthorDeterministic(async () => { emit('module-two') }, id => second.push(id))
  await Promise.all([one, two])
  expect(first).toEqual(['module-one', 'module-one-after-await'])
  expect(second).toEqual(['module-two']); expect(frame).toEqual(['frame'])
  expect(host[TEXT_LAYOUT_OBSERVER]).toBeUndefined()
  await expect(importAuthorDeterministic(async () => { throw new Error('模块失败') }, id => first.push(id))).rejects.toThrow('模块失败')
  expect(host[TEXT_LAYOUT_OBSERVER]).toBeUndefined()
})
