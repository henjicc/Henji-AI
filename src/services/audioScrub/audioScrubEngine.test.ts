import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AudioScrubEngine, audioScrubWantedBlocks, type AudioScrubSource } from './audioScrubEngine'

vi.mock('@/core/logging', () => ({ createLogger: () => ({ debug: vi.fn(), warn: vi.fn() }) }))

type Message = { type: string; index?: number; key?: number; position?: number; frames?: number; quantum?: number; at?: number; planes?: Float32Array[] }
class FakeNode {
  static created: FakeNode[] = []
  messages: Message[] = []
  port = { postMessage: (message: Message) => { this.messages.push(message) }, onmessage: null as ((event: { data: object }) => void) | null }
  connect = vi.fn()
  disconnect = vi.fn()
  constructor(readonly context: object, readonly name: string) { FakeNode.created.push(this) }
  emit(data: object) { this.port.onmessage?.({ data }) }
}
function context() {
  let load!: () => void
  const ready = new Promise<void>(resolve => { load = resolve })
  return { value: { audioWorklet: { addModule: vi.fn(() => ready) }, sampleRate: 48000 } as unknown as BaseAudioContext, load }
}
function source(frames = 48000 * 10, delays: Array<(start: number, count: number) => Promise<void>> = []) {
  const reads: Array<{ start: number; frames: number; resolve: () => void; reject: (error: Error) => void }> = []
  const value: AudioScrubSource = {
    sampleRate: 48000, channels: 2, frames,
    read: (start, count) => new Promise((resolve, reject) => {
      void delays
      reads.push({ start, frames: count, resolve: () => resolve([Float32Array.from({ length: count }, (_, i) => start + i), new Float32Array(count)]), reject })
    }),
  }
  return { value, reads }
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

beforeEach(() => { FakeNode.created = []; vi.stubGlobal('AudioWorkletNode', FakeNode) })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('处理器加载完成前的配置与拖动按顺序排队，接上后一次送出；读块从目标位置开始', async () => {
  const engine = new AudioScrubEngine()
  const { value: ctx, load } = context()
  const { value, reads } = source()
  engine.setSource(value)
  engine.attach({ context: ctx, destination: {} as AudioNode })
  engine.rest(2)
  engine.move(2.01, { quantum: 1 / 30, at: 123 })
  expect(FakeNode.created).toHaveLength(0)
  // 先读指针所在的那一块（第 8 块，2.0–2.25 秒），且只读一块：第一声不等更大的混音
  expect(reads.map(read => [read.start, read.frames])).toEqual([[8 * 12000, 12000]])
  load(); await flush()
  const node = FakeNode.created[0]
  expect(node.name).toBe('henji-audio-scrub')
  expect(node.connect).toHaveBeenCalled()
  expect(node.messages.map(message => message.type)).toEqual(['config', 'rest', 'move'])
  expect(node.messages[2]).toMatchObject({ position: 2.01 * 48000, quantum: 1600, at: 123 })
  reads[0].resolve(); await flush()
  const block = node.messages.find(message => message.type === 'block')!
  expect(block).toMatchObject({ index: 8, key: node.messages[0].key })
  expect(block.planes![0][0]).toBe(8 * 12000)
  expect(block.planes![0]).toHaveLength(12000)
})

it('沿运动方向合并相邻缺块为一次读取，按并发上限排队；读头报到哪里就往哪里补', async () => {
  const engine = new AudioScrubEngine()
  const { value: ctx, load } = context()
  const { value, reads } = source()
  engine.attach({ context: ctx, destination: {} as AudioNode }); load(); await flush()
  engine.setSource(value)
  engine.move(1)
  expect(reads).toHaveLength(1)
  reads[0].resolve(); await flush()
  // 第二次起沿前进方向把相邻缺块成串读（静止时往前备两块）
  expect(reads[1]).toMatchObject({ start: 5 * 12000, frames: 2 * 12000 })
  const node = FakeNode.created[0]
  node.emit({ type: 'head', position: 6 * 48000, speed: -1 })
  reads[1].resolve(); await flush()
  expect(reads.slice(2).map(read => read.start / 12000)).toEqual([22])
  expect(audioScrubWantedBlocks(24 * 12000, 24 * 12000, -2, 12000, 100, 0.03).slice(0, 4)).toEqual([24, 23, 22, 21])
})

it('换来源后旧读取的结果作废；读取失败报错并在稍后重试；被淘汰的块会重新读', async () => {
  const errors: unknown[] = []
  const engine = new AudioScrubEngine({ onError: error => errors.push(error) })
  const { value: ctx, load } = context()
  const first = source(), second = source()
  engine.attach({ context: ctx, destination: {} as AudioNode }); load(); await flush()
  const node = FakeNode.created[0]
  engine.setSource(first.value)
  engine.move(1)
  engine.setSource(second.value)
  engine.move(1)
  first.reads[0].resolve(); await flush()
  expect(node.messages.filter(message => message.type === 'block')).toHaveLength(0)
  second.reads[0].reject(new Error('混音失败')); await flush()
  expect(errors).toEqual([new Error('混音失败')])
  // 失败的块暂不重试，先把其他缺块读完
  expect(second.reads[1].start).toBe(5 * 12000)
  for (let index = 1; index < second.reads.length; index++) { second.reads[index].resolve(); await flush() }
  expect(second.reads.slice(1).every(read => read.start !== 4 * 12000)).toBe(true)
  const pending = second.reads.length
  const now = performance.now()
  vi.spyOn(performance, 'now').mockReturnValue(now + 600)
  engine.move(1.001)
  expect(second.reads).toHaveLength(pending + 1)
  expect(second.reads.at(-1)!.start).toBe(4 * 12000)
  second.reads.at(-1)!.resolve(); await flush()
  const loaded = second.reads.length
  node.emit({ type: 'evicted', indices: [4] })
  node.emit({ type: 'miss', index: 4 })
  expect(second.reads.length).toBe(loaded + 1)
})

it('停止只在试听时发消息；换设备重建处理器并重新配置', async () => {
  const engine = new AudioScrubEngine()
  const a = context(), b = context()
  const { value } = source()
  engine.setSource(value)
  engine.attach({ context: a.value, destination: {} as AudioNode }); a.load(); await flush()
  const node = FakeNode.created[0]
  engine.stop()
  expect(node.messages.map(message => message.type)).toEqual(['config'])
  engine.step(1)
  engine.stop()
  expect(node.messages.map(message => message.type)).toEqual(['config', 'step', 'stop'])
  expect(node.messages[1]).toMatchObject({ position: 48000, frames: 4800 })
  engine.attach({ context: b.value, destination: {} as AudioNode }); b.load(); await flush()
  expect(node.disconnect).toHaveBeenCalled()
  expect(FakeNode.created[1].messages[0]).toMatchObject({ type: 'config', key: expect.any(Number) })
  expect(FakeNode.created[1].messages[0].key).not.toBe(node.messages[0].key)
})
