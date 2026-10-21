import { beforeAll, describe, expect, it } from 'vitest'
import type { SignalsmithStretchModule } from 'signalsmith-stretch'
import { VIDEO_EDIT_STRETCH_BLOCK, VideoEditTimeStretcher } from './videoEditTimeStretch'

beforeAll(() => { (globalThis as { self?: unknown }).self ??= { location: { href: 'file:///' } } })
const RATE = 48000

/** 只记账的替身：延迟固定，process 记录送入的样本数。 */
function ledgerModule(): SignalsmithStretchModule & { consumed: number[] } {
  const memory = new Int8Array(64 * 1024 * 1024)
  const consumed: number[] = []
  return {
    HEAP8: memory, consumed,
    _presetDefault() {}, _presetCheaper() {}, _configure() {}, _reset() {}, _inputLatency: () => 2880, _outputLatency: () => 2880,
    _blockSamples: () => 5760, _intervalSamples: () => 1440, _setBuffers: () => 1024, _setTransposeFactor() {}, _setTransposeSemitones() {},
    _setFormantFactor() {}, _setFormantSemitones() {}, _setFormantBase() {}, _seek() {}, _process: (input: number) => { consumed.push(input) }, _flush() {},
  }
}

describe('拉伸器闭环纠偏', () => {
  it('非整数速度跑 2 小时（约 33 万块）：送入位置始终等于映射目标，累计漂移小于 1 个音频块', () => {
    const module = ledgerModule()
    const stretcher = VideoEditTimeStretcher.fromModule(module, 1, RATE)
    // 每个输出样本走 1.37 个源样本外加缓慢起伏的速度：取整误差每块都有，不纠偏会线性累积。
    const inputAt = (sample: number): number => 1.37 * sample + 300 * Math.sin(sample / RATE / 7)
    const total = RATE * 7200
    let worst = 0
    for (let first = 0; first < total; first += 4801) {
      const length = Math.min(4801, total - first)
      stretcher.render(first, length, inputAt, () => {}, () => 1, () => {})
      const end = Math.ceil((first + length) / VIDEO_EDIT_STRETCH_BLOCK) * VIDEO_EDIT_STRETCH_BLOCK
      const ideal = inputAt(end + 2880) + 2880
      worst = Math.max(worst, Math.abs(stretcher.inputPosition - ideal))
    }
    expect(module.consumed.length).toBeGreaterThan(300_000)
    expect(worst).toBeLessThanOrEqual(0.5)
    expect(worst).toBeLessThan(VIDEO_EDIT_STRETCH_BLOCK)
  })
  it('请求不连续时在所在网格块重新定位；连续请求不重新定位', () => {
    const module = ledgerModule(); let seeks = 0
    module._seek = () => { seeks++ }
    const stretcher = VideoEditTimeStretcher.fromModule(module, 1, RATE)
    const inputAt = (sample: number): number => sample * .5
    stretcher.render(1000, 3000, inputAt, () => {}, () => 1, () => {})
    stretcher.render(4000, 3000, inputAt, () => {}, () => 1, () => {})
    expect(seeks).toBe(1)
    stretcher.render(48_000, 100, inputAt, () => {}, () => 1, () => {})
    expect(seeks).toBe(2)
  })
})

describe('Signalsmith Stretch 实际引擎', () => {
  /** 1 kHz 短音包在源 2/4/6 秒，440 Hz 稳态在 7–9 秒。 */
  const source = new Float32Array(RATE * 10)
  for (const t of [2, 4, 6]) for (let i = 0; i < 480; i++) source[t * RATE + i] = Math.sin(2 * Math.PI * 1000 * i / RATE) * Math.sin(Math.PI * i / 480)
  for (let i = 7 * RATE; i < 9 * RATE; i++) source[i] = .5 * Math.sin(2 * Math.PI * 440 * i / RATE)
  const read = (from: number, count: number, planes: Float32Array[]): void => { for (let i = 0; i < count; i++) planes[0][i] = source[from + i] ?? 0 }
  it.each([0.5, 1.5, 2])('%s 倍保持音调：音包落在映射位置（误差 < 0.5 ms），稳态电平不变', async speed => {
    const stretcher = await VideoEditTimeStretcher.create(1, RATE)
    const total = Math.round(10 / speed * RATE); const out = new Float32Array(total)
    for (let first = 0; first < total; first += 4096) stretcher.render(first, Math.min(4096, total - first), sample => sample * speed, read, () => 1, (sample, _channel, value) => { out[sample] = value })
    for (const t of [2, 4, 6]) {
      const expected = (t * RATE + 240) / speed
      let best = 0; let at = 0
      for (let i = Math.round(expected - 4000); i < expected + 4000; i++) { let energy = 0; for (let j = -120; j < 120; j++) energy += out[i + j] ** 2; if (energy > best) { best = energy; at = i } }
      expect(Math.abs(at - expected)).toBeLessThan(24)
    }
    let power = 0; const from = Math.round(7.5 / speed * RATE); const to = Math.round(8.5 / speed * RATE)
    for (let i = from; i < to; i++) power += out[i] ** 2
    expect(20 * Math.log10(Math.sqrt(power / (to - from)) / (.5 / Math.SQRT2))).toBeCloseTo(0, 0)
  })
})
