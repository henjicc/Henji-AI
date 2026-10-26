import type { VideoEditBuiltinParams } from '@/core/videoEdit/builtinEffects'
import { DelayBuffer, flushDenormal, Lfo, LFO_SEGMENT, LfoSegments, SmoothedValue, type AudioProcessor } from './shared'

/**
 * 调制类效果：和声、镶边、移相器。低频振荡按片段内位置对齐相位（`Lfo`，由效果链 `locate` 告知位置），
 * 预览与导出、从哪里开始播放都得到同样的调制；立体声时右声道相位领先 90°，声音更宽。
 * 深度、反馈、混合量逐样本平滑（深度突变会让延迟读指针跳动而爆音）。振荡波形按位置对齐的 16 样本分段精确计算、段内插值（`LfoSegments`）。
 * 带反馈的效果把湿声按 √(1 - 反馈²) 缩放：宽带声音的整体电平不随反馈变大，只在共振频率上突出。
 */

const TWO_PI = 2 * Math.PI
/** 立体声右声道的振荡相位偏移（周期数）。 */
const STEREO_PHASE = 0.25
const feedbackNormalization = (feedback: number): number => Math.sqrt(1 - feedback * feedback)

// —— 和声：最多 4 个声部，各自有基础延迟（12/18/24/30 毫秒）与略有不同的振荡速度，延迟在基础值上下摆动 ——
const CHORUS_VOICES = 4
const CHORUS_BASE_MS = [12, 18, 24, 30]
/** 深度 100 时延迟摆动的幅度（毫秒）。 */
const CHORUS_SWING_MS = 4
export class Chorus implements AudioProcessor {
  readonly latency = 0
  private readonly lines: DelayBuffer[]
  private readonly lfos: Lfo[]
  private readonly swing: SmoothedValue; private readonly mix: SmoothedValue
  private voices = 2; private frequency = Number.NaN
  /** 每个声道每个声部的 sin(振荡相位)。 */
  private readonly segments: LfoSegments
  constructor(private readonly rate: number, channels: number) {
    this.segments = new LfoSegments(channels * CHORUS_VOICES)
    const maximum = Math.ceil((CHORUS_BASE_MS[CHORUS_VOICES - 1] + CHORUS_SWING_MS) / 1000 * rate) + 4
    this.lines = Array.from({ length: channels }, () => new DelayBuffer(maximum))
    this.lfos = Array.from({ length: CHORUS_VOICES }, () => new Lfo(rate))
    this.swing = new SmoothedValue(rate); this.mix = new SmoothedValue(rate)
  }
  update(params: VideoEditBuiltinParams): void {
    const rate = params.rate as number
    const voices = Math.min(CHORUS_VOICES, Math.max(1, Math.round(params.voices as number)))
    if (rate !== this.frequency || voices !== this.voices) this.segments.valid = false
    // 各声部速度错开约 11%，避免同步摆动听起来像单纯的颤音。
    this.lfos.forEach((lfo, voice) => lfo.setFrequency(rate * (1 + 0.11 * voice)))
    this.frequency = rate; this.voices = voices
    this.swing.set((params.depth as number) / 100 * CHORUS_SWING_MS / 1000 * this.rate)
    this.mix.set((params.mix as number) / 100)
  }
  locate(sample: number): void { for (const lfo of this.lfos) lfo.locate(sample); this.segments.valid = false }
  process(channels: Float32Array[], length: number): void {
    const voices = this.voices; const scale = this.rate / 1000; const segments = this.segments
    for (let index = 0; index < length; index++) {
      const swing = this.swing.next(); const mix = this.mix.next()
      const step = this.lfos[0].segmentIndex(LFO_SEGMENT)
      if (step === 0 || !segments.valid) {
        for (let channel = 0; channel < channels.length; channel++) for (let voice = 0; voice < voices; voice++) {
          const offset = voice / voices + (channel === 1 ? STEREO_PHASE : 0); const slot = channel * CHORUS_VOICES + voice
          segments.start[slot] = Math.sin(TWO_PI * this.lfos[voice].phase(offset, -step)); segments.end[slot] = Math.sin(TWO_PI * this.lfos[voice].phase(offset, LFO_SEGMENT - step))
        }
        segments.valid = true
      }
      for (let channel = 0; channel < channels.length; channel++) {
        const line = this.lines[channel]; const input = channels[channel][index]
        line.write(input)
        let wet = 0
        for (let voice = 0; voice < voices; voice++) wet += line.hermite(CHORUS_BASE_MS[voice] * scale + swing * segments.at(channel * CHORUS_VOICES + voice, step))
        channels[channel][index] = input * (1 - mix) + wet / voices * mix
      }
      for (const lfo of this.lfos) lfo.advance()
    }
  }
}

// —— 镶边：0.25–5 毫秒的短延迟随振荡扫动，与原声叠加形成梳状滤波；反馈加强共振 ——
const FLANGER_MIN_MS = 0.25
/** 深度 100 时延迟扫动的范围（毫秒）。 */
const FLANGER_SWEEP_MS = 4.75
export class Flanger implements AudioProcessor {
  readonly latency = 0
  private readonly lines: DelayBuffer[]
  private readonly lfo: Lfo
  private readonly sweep: SmoothedValue; private readonly feedback: SmoothedValue; private readonly mix: SmoothedValue
  private readonly minimum: number
  /** 每个声道的 (1 - cos(振荡相位)) / 2。 */
  private readonly segments: LfoSegments
  private frequency = Number.NaN
  constructor(private readonly rate: number, channels: number) {
    this.segments = new LfoSegments(channels)
    this.lines = Array.from({ length: channels }, () => new DelayBuffer(Math.ceil((FLANGER_MIN_MS + FLANGER_SWEEP_MS) / 1000 * rate) + 4))
    this.lfo = new Lfo(rate)
    this.sweep = new SmoothedValue(rate); this.feedback = new SmoothedValue(rate); this.mix = new SmoothedValue(rate)
    this.minimum = FLANGER_MIN_MS / 1000 * rate
  }
  update(params: VideoEditBuiltinParams): void {
    if (params.rate !== this.frequency) { this.segments.valid = false; this.frequency = params.rate as number }
    this.lfo.setFrequency(params.rate as number)
    this.sweep.set((params.depth as number) / 100 * FLANGER_SWEEP_MS / 1000 * this.rate)
    this.feedback.set((params.feedback as number) / 100)
    this.mix.set((params.mix as number) / 100)
  }
  locate(sample: number): void { this.lfo.locate(sample); this.segments.valid = false }
  process(channels: Float32Array[], length: number): void {
    const segments = this.segments
    for (let index = 0; index < length; index++) {
      const sweep = this.sweep.next(); const feedback = this.feedback.next(); const mix = this.mix.next()
      const normalization = feedbackNormalization(feedback)
      const step = this.lfo.segmentIndex(LFO_SEGMENT)
      if (step === 0 || !segments.valid) {
        for (let channel = 0; channel < channels.length; channel++) {
          const offset = channel === 1 ? STEREO_PHASE : 0
          segments.start[channel] = (1 - Math.cos(TWO_PI * this.lfo.phase(offset, -step))) / 2; segments.end[channel] = (1 - Math.cos(TWO_PI * this.lfo.phase(offset, LFO_SEGMENT - step))) / 2
        }
        segments.valid = true
      }
      for (let channel = 0; channel < channels.length; channel++) {
        const line = this.lines[channel]; const input = channels[channel][index]
        // 先读（延迟相对本样本，最近一次写入是上一个样本，故减 1），再写入“原声 + 反馈”。
        const delay = this.minimum + sweep * segments.at(channel, step)
        const tap = line.hermite(delay - 1)
        line.write(flushDenormal(input + feedback * tap))
        channels[channel][index] = input * (1 - mix) + tap * normalization * mix
      }
      this.lfo.advance()
    }
  }
}

// —— 移相器：一串一阶全通，转折频率在 200 Hz 到 200·2^(5×深度) Hz 之间按指数扫动；与原声叠加形成随振荡移动的凹口 ——
const PHASER_MAX_STAGES = 12
const PHASER_MIN_HZ = 200
/** 深度 100 时扫动的倍频程数。 */
const PHASER_OCTAVES = 5
export class Phaser implements AudioProcessor {
  readonly latency = 0
  private readonly state: Float64Array[]
  private readonly last: Float64Array
  private readonly lfo: Lfo
  private readonly octaves: SmoothedValue; private readonly feedback: SmoothedValue; private readonly mix: SmoothedValue
  private stages = 8; private frequency = Number.NaN; private depth = Number.NaN
  /** 每个声道的全通系数（分段两端按当时的扫动范围计算）。 */
  private readonly segments: LfoSegments
  constructor(private readonly rate: number, channels: number) {
    this.segments = new LfoSegments(channels)
    this.state = Array.from({ length: channels }, () => new Float64Array(PHASER_MAX_STAGES))
    this.last = new Float64Array(channels)
    this.lfo = new Lfo(rate)
    this.octaves = new SmoothedValue(rate); this.feedback = new SmoothedValue(rate); this.mix = new SmoothedValue(rate)
  }
  update(params: VideoEditBuiltinParams): void {
    if (params.rate !== this.frequency || params.depth !== this.depth) { this.segments.valid = false; this.frequency = params.rate as number; this.depth = params.depth as number }
    this.lfo.setFrequency(params.rate as number)
    const stages = Math.min(PHASER_MAX_STAGES, Math.max(1, Math.round(Number(params.stages))))
    // 级数变了：多出来的级从零状态开始（它们上次用过的状态早已过时）。
    if (stages !== this.stages) for (const state of this.state) state.fill(0, Math.min(stages, this.stages))
    this.stages = stages
    this.octaves.set((params.depth as number) / 100 * PHASER_OCTAVES)
    this.feedback.set((params.feedback as number) / 100)
    this.mix.set((params.mix as number) / 100)
  }
  locate(sample: number): void { this.lfo.locate(sample); this.segments.valid = false }
  private coefficient(phase: number, octaves: number): number {
    const frequency = Math.min(PHASER_MIN_HZ * 2 ** (octaves * (1 - Math.cos(TWO_PI * phase)) / 2), this.rate * 0.45)
    const w = Math.tan(Math.PI * frequency / this.rate)
    return (w - 1) / (w + 1)
  }
  process(channels: Float32Array[], length: number): void {
    const stages = this.stages; const segments = this.segments
    for (let index = 0; index < length; index++) {
      const octaves = this.octaves.next(); const feedback = this.feedback.next(); const mix = this.mix.next()
      const normalization = feedbackNormalization(feedback)
      const step = this.lfo.segmentIndex(LFO_SEGMENT)
      if (step === 0 || !segments.valid) {
        for (let channel = 0; channel < channels.length; channel++) {
          const offset = channel === 1 ? STEREO_PHASE : 0
          segments.start[channel] = this.coefficient(this.lfo.phase(offset, -step), octaves); segments.end[channel] = this.coefficient(this.lfo.phase(offset, LFO_SEGMENT - step), octaves)
        }
        segments.valid = true
      }
      for (let channel = 0; channel < channels.length; channel++) {
        const a = segments.at(channel, step)
        const state = this.state[channel]; const input = channels[channel][index]
        // 一阶全通 H(z) = (a + z⁻¹) / (1 + a·z⁻¹)，转置直接 II 型；反馈取上一个样本的全通输出。
        let value = input + feedback * this.last[channel]
        for (let stage = 0; stage < stages; stage++) {
          const y = a * value + state[stage]
          state[stage] = value - a * y
          value = y
        }
        // 只有输入几乎静音时状态才会衰减进非规格化数：这时逐级归零（有声音时省掉每级的判断）。
        if (input > -1e-20 && input < 1e-20) for (let stage = 0; stage < stages; stage++) state[stage] = flushDenormal(state[stage])
        this.last[channel] = flushDenormal(value)
        channels[channel][index] = input * (1 - mix) + value * normalization * mix
      }
      this.lfo.advance()
    }
  }
}
