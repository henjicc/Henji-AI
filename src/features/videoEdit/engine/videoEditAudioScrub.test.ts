import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { requestVideoEditScrub, subscribeVideoEditScrub, VideoEditAudioScrubber, videoEditScrubSource } from './videoEditAudioScrub'

const { engines } = vi.hoisted(() => ({ engines: [] as Array<{ calls: Array<[string, ...unknown[]]>; source?: { read(start: number, frames: number): Promise<Float32Array[]>; sampleRate: number; frames: number }; onError?: (error: unknown) => void }> }))
vi.mock('@/services/audioScrub/audioScrubEngine', () => ({
  AUDIO_SCRUB_STEP_SECONDS: 0.1,
  AudioScrubEngine: class {
    calls: Array<[string, ...unknown[]]> = []
    source?: { read(start: number, frames: number): Promise<Float32Array[]>; sampleRate: number; frames: number }
    onError?: (error: unknown) => void
    constructor(options: { onError?: (error: unknown) => void }) { this.onError = options.onError; engines.push(this) }
    get currentSource() { return this.source }
    attach(output: unknown) { this.calls.push(['attach', output]) }
    setSource(source: this['source']) { this.source = source; this.calls.push(['source']) }
    move(seconds: number, options: unknown) { this.calls.push(['move', seconds, options]) }
    step(seconds: number, duration: number) { this.calls.push(['step', seconds, duration]) }
    stop() { this.calls.push(['stop']) }
  },
}))

beforeEach(() => { engines.length = 0; vi.spyOn(performance, 'now').mockReturnValue(1000) })
afterEach(() => { vi.restoreAllMocks() })

function harness() {
  const output = { context: { sampleRate: 48000 }, destination: {} }
  let current = true
  const prepare = vi.fn(async () => output as never)
  const mix = vi.fn(async (from: number, duration: number) => ({ sampleRate: 48000, numberOfChannels: 2, getChannelData: () => new Float32Array(Math.round(duration * 48000)).fill(from) }) as unknown as AudioBuffer)
  const onError = vi.fn()
  const scrubber = new VideoEditAudioScrubber()
  const request = (seconds: number, extra: object = {}) => scrubber.request({ seconds, fps: 30, endTime: 10, prepare, mix, isCurrent: () => current, onError, ...extra })
  const engine = engines.at(-1)!
  return { scrubber, request, prepare, mix, onError, engine, output, setCurrent: (value: boolean) => { current = value } }
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

it('拖动请求转给共用擦洗引擎：等输出就绪后按原时刻送出，按帧取整长度告诉读头；同一位置不重复', async () => {
  const h = harness()
  h.request(1); h.request(1); h.request(1.0333)
  expect(h.engine.calls).toEqual([])
  await flush()
  expect(h.engine.calls.map(([name]) => name)).toEqual(['attach', 'source', 'move', 'move'])
  expect(h.engine.calls[2]).toEqual(['move', 1, { quantum: 1 / 30, at: 1000 }])
  // 声音来源按块调用剪辑混音（秒），返回各声道
  const planes = await h.engine.source!.read(48000, 4800)
  expect(h.mix).toHaveBeenCalledWith(1, 0.1)
  expect(planes).toHaveLength(2)
  // 已有输出时立即发声，不等设备确认
  h.scrubber.stop()
  h.request(2)
  expect(h.engine.calls.at(-1)).toEqual(['move', 2, expect.anything()])
})

it('经 requestVideoEditScrub 派发的单步按单步播放一小段原速声音（至少一帧）', async () => {
  const h = harness()
  const off = subscribeVideoEditScrub('p', intent => h.request(intent.seconds))
  requestVideoEditScrub('p', { scope: 'program', seconds: 3 })
  await flush()
  expect(h.engine.calls.find(([name]) => name === 'step')).toEqual(['step', 3, 0.1])
  h.request(3.5, { mode: 'step', fps: 5 })
  expect(h.engine.calls.at(-1)).toEqual(['step', 3.5, 0.2])
  off()
})

it('新手势时上一份声音仍有效就沿用；文档变了（旧请求不再有效）就换来源', async () => {
  const h = harness()
  h.request(1); await flush()
  const first = h.engine.source
  h.scrubber.stop()
  h.request(2); await flush()
  expect(h.engine.source).toBe(first)
  h.scrubber.stop()
  h.setCurrent(false)
  h.request(3); await flush()
  expect(h.engine.source).not.toBe(first)
})

it('混音失败交给当前请求报错；设备准备被中止不算失败；采样率不同就按混音采样率重取', async () => {
  const h = harness()
  h.request(1); await flush()
  h.engine.onError?.(new Error('混音失败'))
  expect(h.onError).toHaveBeenCalledWith(new Error('混音失败'))
  h.mix.mockResolvedValueOnce({ sampleRate: 44100, numberOfChannels: 2, getChannelData: () => new Float32Array(10) } as unknown as AudioBuffer)
  await h.engine.source!.read(0, 4800).catch(error => h.engine.onError?.(error))
  expect(h.onError).toHaveBeenCalledTimes(1)
  h.request(1.5)
  expect(h.engine.source!.sampleRate).toBe(44100)
  const aborted = harness()
  aborted.prepare.mockRejectedValueOnce(new DOMException('已关闭', 'AbortError'))
  aborted.request(1); await flush()
  expect(aborted.onError).not.toHaveBeenCalled()
})

it('剪辑混音来源：总长按采样帧，读取换算成秒', async () => {
  const mix = vi.fn(async () => ({ sampleRate: 48000, numberOfChannels: 1, getChannelData: () => new Float32Array(3) }) as unknown as AudioBuffer)
  const source = videoEditScrubSource(48000, 2.5, mix)
  expect(source.frames).toBe(120000)
  await source.read(24000, 2400)
  expect(mix).toHaveBeenCalledWith(0.5, 0.05)
})
