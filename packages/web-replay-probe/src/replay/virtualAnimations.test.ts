import { afterAll, beforeAll, expect, it } from 'vitest'

/** Just enough of the Web Animations API to drive: accessors on the prototype, like the browser's. */
class FakeAnimation {
  _rate = 1
  _time: number | null = 0
  _paused = false
  finished = 0
  events: string[] = []
  timeline = null
  constructor(public endTime: number) {}
  get playbackRate(): number { return this._rate }
  set playbackRate(value: number) { this._rate = value }
  get currentTime(): number | null { return this._time }
  set currentTime(value: number | null) { this._time = value }
  get playState(): string { return this._paused ? 'paused' : this.finished ? 'finished' : 'running' }
  get effect(): { getComputedTiming(): { endTime: number } } { return { getComputedTiming: () => ({ endTime: this.endTime }) } }
  finish(): void { this.finished += 1; this._time = this.endTime; this.events.push(`finish@rate${this._rate}`) }
  reverse(): void { this._rate = -this._rate }
  play(): void { this._paused = false }
  pause(): void { this._paused = true }
  updatePlaybackRate(value: number): void { this._rate = value }
}

let VirtualAnimations: typeof import('./virtualClock').VirtualAnimations
const globals = globalThis as Record<string, unknown>
beforeAll(async () => {
  globals.Animation = FakeAnimation
  ;({ VirtualAnimations } = await import('./virtualClock'))
})
afterAll(() => { delete globals.Animation })

function setup(animations: FakeAnimation[]): { driver: InstanceType<typeof VirtualAnimations>; clock: { now: number } } {
  const clock = { now: 1000 }
  const root = { getAnimations: () => animations as unknown as Animation[] }
  const driver = new VirtualAnimations(() => clock.now, root as unknown as DocumentOrShadowRoot)
  return { driver, clock }
}

it('接管后浏览器速率为 0，页面看到的仍是原速率；每帧按页面时间寻到位置', () => {
  const a = new FakeAnimation(300)
  a._time = 10
  const { driver, clock } = setup([a])
  expect(driver.scan()).toBe(1)
  expect(a._rate).toBe(0)
  expect((a as unknown as Animation).playbackRate).toBe(1)
  clock.now += 100
  driver.advance()
  expect(a._time).toBe(110)
  ;(a as unknown as Animation).playbackRate = 2
  clock.now += 50
  driver.advance()
  expect(a._time).toBe(210)
  expect(a._rate).toBe(0)
})

it('页面时间走到结尾时把速率还给浏览器再 finish，由浏览器自己发结束事件', () => {
  const a = new FakeAnimation(100)
  const { driver, clock } = setup([a])
  driver.scan()
  clock.now += 99
  driver.advance()
  expect(a.finished).toBe(0)
  clock.now += 5
  driver.advance()
  expect(a.events).toEqual(['finish@rate1'])
  expect(driver.running).toBe(0)
  // 结束后同一个对象不会再被当成新动画接管
  expect(driver.scan()).toBe(0)
})

it('页面暂停的动画不走；页面改 currentTime 从改后的位置接着走；无限动画一直走', () => {
  const paused = new FakeAnimation(1000)
  const endless = new FakeAnimation(Infinity)
  const { driver, clock } = setup([paused, endless])
  driver.scan()
  paused.pause()
  clock.now += 100
  driver.advance()
  expect(paused._time).toBe(0)
  paused.play()
  ;(paused as unknown as Animation).currentTime = 500
  clock.now += 100
  driver.advance()
  expect(paused._time).toBe(600)
  clock.now += 1e6
  driver.advance()
  expect(endless._time).toBe(1e6 + 200)
  expect(endless.finished).toBe(0)
})
