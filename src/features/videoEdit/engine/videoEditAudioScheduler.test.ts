import { expect, it, vi } from 'vitest'
import { VideoEditAudioScheduler, type VideoEditAudioPump } from './videoEditAudioScheduler'

class FakeNode {
  buffer: { duration: number } | null = null
  started?: { when: number; offset: number }
  stopped = false
  disconnected = 0
  onended: (() => void) | null = null
  connect = vi.fn()
  start(when: number, offset: number): void { this.started = { when, offset } }
  stop(): void { this.stopped = true }
  disconnect(): void { this.disconnected++ }
}

function harness() {
  const nodes: FakeNode[] = []
  const context = { currentTime: 10, createBufferSource: () => { const node = new FakeNode(); nodes.push(node); return node } }
  const mixes: Array<{ from: number; duration: number; resolve: (buffer: AudioBuffer) => void; reject: (error: Error) => void }> = []
  const errors: unknown[] = []
  let current = true
  const pump = (timelineTime: number, overrides: Partial<VideoEditAudioPump> = {}): VideoEditAudioPump => ({
    context: context as unknown as BaseAudioContext, destination: {} as AudioNode, origin: 10.1 - 2, timelineTime, endTime: 3.2,
    mix: (from, duration) => new Promise((resolve, reject) => mixes.push({ from, duration, resolve, reject })),
    isCurrent: () => current, onError: error => errors.push(error), ...overrides,
  })
  return { nodes, context, mixes, errors, pump, setCurrent: (value: boolean) => { current = value } }
}
const buffer = (duration: number) => ({ duration }) as AudioBuffer
const settle = async (): Promise<void> => { for (let index = 0; index < 5; index++) await Promise.resolve() }

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
  expect(nodes[1].started).toBeUndefined(); expect(nodes[1].disconnected).toBe(1)
})

it('停止时静音已放的块、丢弃仍在混音的块；过期的失败不报告，当前播放的失败报告', async () => {
  const { nodes, mixes, errors, pump, setCurrent } = harness()
  const scheduler = new VideoEditAudioScheduler()
  scheduler.start(2); scheduler.pump(pump(2))
  mixes[0].resolve(buffer(.5)); await settle()
  scheduler.pump(pump(2.2))
  scheduler.stop()
  expect(nodes[0].stopped).toBe(true)
  mixes[1].resolve(buffer(.5)); await settle()
  expect(nodes).toHaveLength(1)
  scheduler.start(0); scheduler.pump(pump(0))
  mixes[2].reject(new Error('声音读取失败')); await settle()
  expect(errors).toHaveLength(1)
  scheduler.pump(pump(0.2)); setCurrent(false)
  mixes[3].reject(new Error('过期')); await settle()
  expect(errors).toHaveLength(1)
})
