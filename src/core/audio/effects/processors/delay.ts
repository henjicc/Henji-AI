import type { VideoEditBuiltinParams } from '../../../videoEdit/builtinEffects'
import { audioBiquadCoefficients, biquadSample, DelayBuffer, delayGlide, flushDenormal, SmoothedValue, type AudioProcessor, type Coefficients } from './shared'

/**
 * 延迟类效果：回声（带反馈与反馈路径低通，可左右交替）、单次延迟（左右可不同，用于对齐与哈斯效应）。
 * 延迟时间改变时滑向新值（`delayGlide`），拖动参数不跳读指针；静止时按整样本读，回声与延迟声是原声的精确副本。
 * 回声量、反馈、混合量逐样本平滑，拖动不爆音。
 * 这里的延迟是效果本身的声音，不是预判：不声明 latency，输出仍与画面对齐。
 */

/** 回声最长延迟（秒，参数上限 2000 毫秒）。 */
const ECHO_MAX_SECONDS = 2
export class Echo implements AudioProcessor {
  readonly latency = 0
  private readonly lines: DelayBuffer[]
  private readonly glide: SmoothedValue
  private readonly feedback: SmoothedValue; private readonly mix: SmoothedValue
  private readonly tone: Float64Array
  private toneFilter: Coefficients = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 }
  private toneFrequency = 0
  private pingPong = false
  private readonly echoes: Float64Array
  constructor(private readonly rate: number, channels: number) {
    this.lines = Array.from({ length: channels }, () => new DelayBuffer(Math.ceil(rate * ECHO_MAX_SECONDS) + 2))
    this.glide = delayGlide(rate); this.feedback = new SmoothedValue(rate); this.mix = new SmoothedValue(rate)
    this.tone = new Float64Array(channels * 2)
    this.echoes = new Float64Array(channels)
  }
  update(params: VideoEditBuiltinParams): void {
    this.glide.set(Math.max(1, Math.round((params.delay as number) / 1000 * this.rate)))
    this.feedback.set((params.feedback as number) / 100); this.mix.set((params.mix as number) / 100); this.pingPong = params.ping_pong as boolean
    const tone = params.tone as number
    if (tone !== this.toneFrequency) { this.toneFilter = audioBiquadCoefficients({ kind: 'lowpass', frequency: tone, q: Math.SQRT1_2 }, this.rate); this.toneFrequency = tone }
  }
  process(channels: Float32Array[], length: number): void {
    const count = channels.length; const pingPong = this.pingPong && count === 2
    for (let index = 0; index < length; index++) {
      // 先读出 delay 个样本之前写入的回声（最近一次写入是上一个样本），再写入本样本的“原声 + 反馈”。
      const delay = this.glide.next() - 1; const feedback = this.feedback.next(); const mix = this.mix.next()
      for (let channel = 0; channel < count; channel++) this.echoes[channel] = this.lines[channel].linear(delay)
      if (pingPong) {
        // 左右交替：原声（左右平均）进左声道延迟线，左声道的回声反馈进右声道、右声道的反馈回左声道。
        const left = biquadSample(this.toneFilter, this.tone, 0, this.echoes[0]); const right = biquadSample(this.toneFilter, this.tone, 2, this.echoes[1])
        this.lines[0].write(flushDenormal((channels[0][index] + channels[1][index]) / 2 + feedback * right))
        this.lines[1].write(flushDenormal(feedback * left))
      } else {
        for (let channel = 0; channel < count; channel++) {
          const recirculated = biquadSample(this.toneFilter, this.tone, channel * 2, this.echoes[channel])
          this.lines[channel].write(flushDenormal(channels[channel][index] + feedback * recirculated))
        }
      }
      for (let channel = 0; channel < count; channel++) channels[channel][index] += mix * this.echoes[channel]
    }
  }
}

/** 单次延迟最长延迟（秒，参数上限 1000 毫秒）。 */
const DELAY_MAX_SECONDS = 1
export class StereoDelay implements AudioProcessor {
  readonly latency = 0
  private readonly lines: DelayBuffer[]
  private readonly glides: SmoothedValue[]
  private readonly mix: SmoothedValue
  constructor(private readonly rate: number, channels: number) {
    this.lines = Array.from({ length: channels }, () => new DelayBuffer(Math.ceil(rate * DELAY_MAX_SECONDS) + 2))
    this.glides = Array.from({ length: channels }, () => delayGlide(rate))
    this.mix = new SmoothedValue(rate)
  }
  update(params: VideoEditBuiltinParams): void {
    // 整样本延迟（48 kHz 下精度约 0.02 毫秒）：读出的是原声的精确副本，不经插值滤波。单声道只用左声道延迟。
    const samples = (milliseconds: number): number => Math.round(milliseconds / 1000 * this.rate)
    this.glides.forEach((glide, channel) => glide.set(samples((channel === 1 ? params.right_delay : params.left_delay) as number)))
    this.mix.set((params.mix as number) / 100)
  }
  process(channels: Float32Array[], length: number): void {
    for (let index = 0; index < length; index++) {
      const mix = this.mix.next()
      for (let channel = 0; channel < channels.length; channel++) {
        const data = channels[channel]; const line = this.lines[channel]
        const input = data[index]
        line.write(input)
        const delay = this.glides[channel].next()
        if (delay === 0) continue
        const delayed = line.linear(delay)
        data[index] = mix === 1 ? delayed : input * (1 - mix) + delayed * mix
      }
    }
  }
}
