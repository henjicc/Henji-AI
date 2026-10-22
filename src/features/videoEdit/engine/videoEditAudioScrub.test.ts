import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { VideoEditAudioScrubber } from './videoEditAudioScrub'

vi.mock('@/core/logging', () => ({ createLogger: () => ({ debug: vi.fn(), warn: vi.fn() }) }))
beforeEach(() => { vi.useFakeTimers(); vi.spyOn(performance, 'now').mockImplementation(() => Date.now()) })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

function harness() {
  const gains: Array<{ gain: { setValueAtTime: ReturnType<typeof vi.fn>; linearRampToValueAtTime: ReturnType<typeof vi.fn>; cancelAndHoldAtTime: ReturnType<typeof vi.fn> }; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = []
  const nodes: Array<{ start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = []
  const context = { sampleRate: 48000, currentTime: 1,
    createGain: () => { const gain = { gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), cancelAndHoldAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() }; gains.push(gain); return gain },
    createBufferSource: () => { const node = { start: vi.fn(), stop: vi.fn(), connect: vi.fn(), disconnect: vi.fn() }; nodes.push(node); return node },
  }
  const pending: Array<{ from: number; duration: number; resolve: (buffer: AudioBuffer) => void }> = []
  const prepare = vi.fn(async () => ({ context: context as unknown as BaseAudioContext, destination: {} as AudioNode }))
  const mix = vi.fn((from: number, duration: number) => new Promise<AudioBuffer>(resolve => pending.push({ from, duration, resolve })))
  const onError = vi.fn()
  const scrubber = new VideoEditAudioScrubber()
  const request = (seconds: number, fps = 30) => scrubber.request({ seconds, fps, endTime: 10, prepare, mix, isCurrent: () => true, onError })
  const resolve = async (index: number) => { pending[index].resolve({ duration: pending[index].duration } as AudioBuffer); await vi.advanceTimersByTimeAsync(0) }
  return { scrubber, request, resolve, prepare, pending, nodes, gains, context, onError }
}

it('每帧一次、至少间隔40ms、只播放最新位置；停住后不循环发声', async () => {
  const h = harness()
  h.request(1); await vi.advanceTimersByTimeAsync(0); await h.resolve(0)
  expect(h.pending[0]).toMatchObject({ from: 1, duration: .08 })
  h.request(1.001); h.request(2); h.request(3)
  await vi.advanceTimersByTimeAsync(39); expect(h.pending).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(1); expect(h.pending[1].from).toBe(3)
  await h.resolve(1); await vi.advanceTimersByTimeAsync(500)
  expect(h.nodes).toHaveLength(2); expect(h.pending).toHaveLength(2)
})

it('混音在途时合并新位置，过期段不响，往回拖仍从新位置向前播', async () => {
  const h = harness()
  h.request(3); await vi.advanceTimersByTimeAsync(0)
  h.request(2); h.request(1); await h.resolve(0); await vi.advanceTimersByTimeAsync(1)
  expect(h.nodes).toHaveLength(0); expect(h.pending.map(x => x.from)).toEqual([3, 1])
  await h.resolve(1)
  expect(h.nodes[0].start).toHaveBeenCalledWith(1, 0, .08)
})

it('两端5ms包络，重叠段保持当前值再交叉淡化；低帧率至少覆盖一帧', async () => {
  const h = harness(); h.request(1, 10); await vi.advanceTimersByTimeAsync(0); await h.resolve(0)
  expect(h.pending[0].duration).toBe(.1)
  const first = h.gains[0].gain
  expect(first.setValueAtTime).toHaveBeenCalledWith(0, 1)
  expect(first.linearRampToValueAtTime).toHaveBeenCalledWith(1, 1.005)
  expect(first.linearRampToValueAtTime).toHaveBeenCalledWith(0, 1.1)
  await vi.advanceTimersByTimeAsync(40); h.context.currentTime = 1.04
  h.request(2); await vi.advanceTimersByTimeAsync(0); await h.resolve(1)
  expect(first.cancelAndHoldAtTime).toHaveBeenCalledWith(1.04)
  expect(first.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 1.045)
  expect(h.nodes[0].stop).toHaveBeenCalledWith(1.045)
  expect(h.gains[1].gain.setValueAtTime).toHaveBeenCalledWith(0, 1.04)
  expect(h.gains[1].gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, 1.045)
})

it('停止或resume迟到不能出声，旧结果不阻止下一次手势', async () => {
  const h = harness(); let ready!: () => void
  h.prepare.mockImplementationOnce(() => new Promise(resolve => { ready = () => resolve({ context: h.context as unknown as BaseAudioContext, destination: {} as AudioNode }) }))
  h.request(1); await vi.advanceTimersByTimeAsync(0); h.scrubber.stop(); ready()
  await vi.advanceTimersByTimeAsync(0); expect(h.pending).toHaveLength(0)
  h.request(1); await vi.advanceTimersByTimeAsync(0); h.scrubber.stop(); await h.resolve(0)
  expect(h.nodes).toHaveLength(0); expect(h.onError).not.toHaveBeenCalled()
})

it('慢混音扩大为附近500ms缓存，窗口内向前或向后擦洗不再等待混音，停止清空旧内容', async () => {
  const h = harness()
  h.request(1); await vi.advanceTimersByTimeAsync(0); await vi.advanceTimersByTimeAsync(30); await h.resolve(0)
  h.request(2); await vi.advanceTimersByTimeAsync(40)
  expect(h.pending[1]).toMatchObject({ from: 1.85, duration: .5 })
  await h.resolve(1)
  h.request(2.1); await vi.advanceTimersByTimeAsync(40)
  expect(h.pending).toHaveLength(2); expect(h.nodes).toHaveLength(3)
  expect(h.nodes[2].start).toHaveBeenCalledWith(1, .25, .08)
  h.request(2.05); await vi.advanceTimersByTimeAsync(40)
  expect(h.pending).toHaveLength(2)
  h.scrubber.stop(); h.request(2.1); await vi.advanceTimersByTimeAsync(40)
  expect(h.pending).toHaveLength(3)
})
