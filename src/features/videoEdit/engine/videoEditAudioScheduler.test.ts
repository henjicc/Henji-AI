import { expect, it, vi } from 'vitest'
import { VideoEditAudioScheduler, type VideoEditAudioPump } from './videoEditAudioScheduler'

class FakeNode {
  buffer: { duration: number } | null = null
  started?: { when: number; offset: number }
  stopped: number | undefined
  disconnected = 0
  onended: (() => void) | null = null
  connect = vi.fn()
  start(when: number, offset: number): void { this.started = { when, offset } }
  stop(when: number): void { this.stopped = when }
  disconnect(): void { this.disconnected++ }
}

function harness() {
  const nodes: FakeNode[] = []
  const gains: Array<{ gain: { value: number; setValueAtTime: ReturnType<typeof vi.fn>; linearRampToValueAtTime: ReturnType<typeof vi.fn>; cancelAndHoldAtTime: ReturnType<typeof vi.fn> }; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = []
  const context = { sampleRate: 48000, currentTime: 10, createGain: () => {
    const node = { gain: { value: 1, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), cancelAndHoldAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() }
    gains.push(node); return node
  }, createBufferSource: () => { const node = new FakeNode(); nodes.push(node); return node } }
  const mixes: Array<{ from: number; duration: number; resolve: (buffer: AudioBuffer) => void; reject: (error: Error) => void }> = []
  const errors: unknown[] = []
  let current = true
  const pump = (timelineTime: number, overrides: Partial<VideoEditAudioPump> = {}): VideoEditAudioPump => ({
    context: context as unknown as BaseAudioContext, destination: {} as AudioNode, origin: 10.1 - 2, timelineTime, endTime: 3.2,
    mix: (from, duration) => new Promise((resolve, reject) => mixes.push({ from, duration, resolve, reject })),
    isCurrent: () => current, onError: error => errors.push(error), ...overrides,
  })
  return { nodes, gains, context, mixes, errors, pump, setCurrent: (value: boolean) => { current = value } }
}
const buffer = (duration: number) => ({ duration }) as AudioBuffer
const settle = async (): Promise<void> => { for (let index = 0; index < 5; index++) await Promise.resolve() }

it('停止保留当前包络，5ms 后才停节点，结束事件释放旧总线且不影响新运行', async () => {
  const h = harness(); const scheduler = new VideoEditAudioScheduler()
  scheduler.start(2); scheduler.pump(h.pump(2)); h.mixes[0].resolve(buffer(.5)); await settle()
  expect(h.gains[0].gain.setValueAtTime).toHaveBeenCalledWith(0, 10.1)
  expect(h.gains[0].gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, 10.105)
  h.context.currentTime = 10.102; scheduler.stop()
  expect(h.gains[0].gain.cancelAndHoldAtTime).toHaveBeenCalledWith(10.102)
  expect(h.gains[0].gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, expect.closeTo(10.107, 9))
  expect(h.nodes[0].stopped).toBeCloseTo(10.107, 9); expect(h.nodes[0].disconnected).toBe(0)
  scheduler.start(2); scheduler.pump(h.pump(2)); h.mixes[1].resolve(buffer(.5)); await settle()
  h.nodes[0].onended?.()
  expect(h.gains[0].disconnect).toHaveBeenCalledOnce(); expect(h.gains[1].disconnect).not.toHaveBeenCalled()
})

it('非整数帧率起点仍以整数采样帧连续排块，迟到块从整数偏移淡入', async () => {
  const h = harness(); const scheduler = new VideoEditAudioScheduler(); const from = 7 * 1001 / 30000
  scheduler.start(from)
  scheduler.pump(h.pump(from, { origin: 10, endTime: 5 })); h.mixes[0].resolve(buffer(.5)); await settle()
  scheduler.pump(h.pump(from + .2, { origin: 10.000001, endTime: 5 })); h.mixes[1].resolve(buffer(.5)); await settle()
  expect(h.mixes[1].from * 48000 - h.mixes[0].from * 48000).toBe(24000)
  expect(h.nodes[1].started!.when - h.nodes[0].started!.when).toBe(.5)
  scheduler.pump(h.pump(from + .8, { origin: 10, endTime: 5 }))
  h.context.currentTime = 11.3; h.mixes[2].resolve(buffer(.5)); await settle()
  expect(h.nodes[2].started!.offset * 48000).toBeCloseTo(Math.round(h.nodes[2].started!.offset * 48000), 9)
  expect(h.gains[1].gain.setValueAtTime).toHaveBeenCalledWith(0, 11.3)
  expect(h.gains[1].gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, expect.closeTo(11.305, 9))
})

it('停止后旧混音的 finally 不会释放新请求的在途锁', async () => {
  const h = harness(); const scheduler = new VideoEditAudioScheduler()
  scheduler.start(0); scheduler.pump(h.pump(0)); scheduler.stop()
  scheduler.start(1); scheduler.pump(h.pump(1))
  h.mixes[0].resolve(buffer(.5)); await settle()
  scheduler.pump(h.pump(2))
  expect(h.mixes).toHaveLength(2); expect(h.nodes).toHaveLength(0)
})

it('按 0.5 秒块、提前 0.4 秒、一次一块地请求，块放在音频时钟 origin + from 处，结尾截短', async () => {
  const { nodes, mixes, pump } = harness()
  const scheduler = new VideoEditAudioScheduler()
  scheduler.start(2)
  scheduler.pump(pump(2)); scheduler.pump(pump(2))
  expect(mixes.map(mix => [mix.from, mix.duration])).toEqual([[2, .5]])
  mixes[0].resolve(buffer(.5)); await settle()
  expect(nodes[0].started).toEqual({ when: 10.1, offset: 0 })
  scheduler.pump(pump(2.05)); expect(mixes).toHaveLength(1)
  scheduler.pump(pump(2.11)); expect(mixes.map(mix => mix.from)).toEqual([2, 2.5])
  mixes[1].resolve(buffer(.5)); await settle()
  scheduler.pump(pump(2.7)); expect(mixes.at(-1)).toMatchObject({ from: 3, duration: expect.closeTo(.2, 9) })
  mixes[2].resolve(buffer(.2)); await settle()
  scheduler.pump(pump(3.1)); expect(mixes).toHaveLength(3)
})

it('迟到的块从中途开始保持同步，整块都已过去时不播放', async () => {
  const { nodes, context, mixes, pump } = harness()
  const scheduler = new VideoEditAudioScheduler()
  scheduler.start(2); scheduler.pump(pump(2))
  context.currentTime = 10.3; mixes[0].resolve(buffer(.5)); await settle()
  expect(nodes[0].started).toEqual({ when: 10.3, offset: expect.closeTo(.2, 9) })
  scheduler.pump(pump(2.5))
  context.currentTime = 11.2; mixes[1].resolve(buffer(.5)); await settle()
  expect(nodes).toHaveLength(1)
})

it('停止时静音已放的块、丢弃仍在混音的块；过期的失败不报告，当前播放的失败报告', async () => {
  const { nodes, mixes, errors, pump, setCurrent } = harness()
  const scheduler = new VideoEditAudioScheduler()
  scheduler.start(2); scheduler.pump(pump(2))
  mixes[0].resolve(buffer(.5)); await settle()
  scheduler.pump(pump(2.2))
  scheduler.stop()
  expect(nodes[0].stopped).toBe(10.005); expect(nodes[0].disconnected).toBe(0)
  mixes[1].resolve(buffer(.5)); await settle()
  expect(nodes).toHaveLength(1)
  scheduler.start(0); scheduler.pump(pump(0))
  mixes[2].reject(new Error('声音读取失败')); await settle()
  expect(errors).toHaveLength(1)
  scheduler.pump(pump(0.2)); setCurrent(false)
  mixes[3].reject(new Error('过期')); await settle()
  expect(errors).toHaveLength(1)
})
