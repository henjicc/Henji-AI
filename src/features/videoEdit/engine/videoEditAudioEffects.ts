import { videoEditFft } from '@/core/videoEdit/fft'
export { videoEditFft } from '@/core/videoEdit/fft'
import { resolveVideoEditBuiltinParams, type VideoEditBuiltinParams } from '@/core/videoEdit/builtinEffects'
import type { VideoEditBuiltinEffect } from '@/core/videoEdit/compositing'
// 静态引入：剪辑渲染工作线程按 IIFE 打包，不能拆出动态分块。模块求值只定义函数，模型与 WebAssembly 到第一次用降噪时才解码。
import { Rnnoise } from '@shiguredo/rnnoise-wasm'

/**
 * 音频内置效果的处理（任务 4.7c）：剪辑混音里逐片段、按效果链顺序处理声音，预览与导出是同一份代码（同一个混音函数）。
 * - 全部是确定性的逐样本运算（不经 WebAudio 节点，避免不同设备的实现差异与离线/实时两套路径）：同一输入在任何分块下结果逐样本一致。
 * - 每个处理器声明固定延迟（样本数，降噪、音调变换、限幅器的预判），效果链把延迟累加，由混音多读后面的素材抵消，输出与画面对齐；
 *   效果强度（干湿比）与“降噪强度”混入的原声也按同样延迟对齐，不会梳状失真。
 * - 状态跨混音块延续（滤波器、包络、混响尾音）；块不连续（定位、暂停后从别处播放、导出起点）时清空状态并从前面预读一段，
 *   让包络与滤波器先稳定下来。
 * 成熟开源：降噪用 RNNoise（`@shiguredo/rnnoise-wasm`，Apache-2.0）；滤波器系数按 RBJ Audio EQ Cookbook；混响移植 Freeverb（公有领域）；
 * 音调变换移植 smbPitchShift（相位声码器，WOL 许可）。
 */

interface AudioProcessor {
  /** 输出相对输入的固定延迟（样本数）。 */
  readonly latency: number
  update(params: VideoEditBuiltinParams): void
  /** 原地处理 `length` 个样本（每个声道一个数组）。 */
  process(channels: Float32Array[], length: number): void
  /** 混入处理结果的比例（降噪强度等），缺省为 1；与效果强度相乘。 */
  wet?(): number
  dispose?(): void
}
const dbToGain = (db: number): number => 10 ** (db / 20)
const gainToDb = (gain: number): number => 20 * Math.log10(gain + 1e-12)
const smoothing = (seconds: number, rate: number): number => Math.exp(-1 / Math.max(1, seconds * rate))

// —— 双二阶滤波器（RBJ Audio EQ Cookbook，转置直接 II 型，双精度状态） ——
type BiquadKind = 'lowpass' | 'highpass' | 'peaking' | 'lowshelf' | 'highshelf' | 'notch'
interface BiquadSpec { kind: BiquadKind; frequency: number; q: number; gain?: number }
interface Coefficients { b0: number; b1: number; b2: number; a1: number; a2: number }
export function videoEditBiquadCoefficients(spec: BiquadSpec, rate: number): Coefficients {
  const frequency = Math.min(Math.max(spec.frequency, 10), rate * 0.45)
  const w0 = 2 * Math.PI * frequency / rate; const cos = Math.cos(w0); const sin = Math.sin(w0)
  const A = 10 ** ((spec.gain ?? 0) / 40)
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number
  if (spec.kind === 'lowshelf' || spec.kind === 'highshelf') {
    const alpha = sin / 2 * Math.SQRT2; const root = 2 * Math.sqrt(A) * alpha
    if (spec.kind === 'lowshelf') {
      b0 = A * ((A + 1) - (A - 1) * cos + root); b1 = 2 * A * ((A - 1) - (A + 1) * cos); b2 = A * ((A + 1) - (A - 1) * cos - root)
      a0 = (A + 1) + (A - 1) * cos + root; a1 = -2 * ((A - 1) + (A + 1) * cos); a2 = (A + 1) + (A - 1) * cos - root
    } else {
      b0 = A * ((A + 1) + (A - 1) * cos + root); b1 = -2 * A * ((A - 1) + (A + 1) * cos); b2 = A * ((A + 1) + (A - 1) * cos - root)
      a0 = (A + 1) - (A - 1) * cos + root; a1 = 2 * ((A - 1) - (A + 1) * cos); a2 = (A + 1) - (A - 1) * cos - root
    }
  } else {
    const alpha = sin / (2 * spec.q)
    a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha
    switch (spec.kind) {
      case 'lowpass': b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = b0; break
      case 'highpass': b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = b0; break
      case 'notch': b0 = 1; b1 = -2 * cos; b2 = 1; break
      default: b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a2 = 1 - alpha / A
    }
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 }
}
class FilterCascade implements AudioProcessor {
  readonly latency = 0
  private coefficients: Coefficients[] = []
  private state: Float64Array[] = []
  constructor(private readonly rate: number, private readonly channels: number, private readonly specs: (params: VideoEditBuiltinParams, rate: number) => BiquadSpec[]) {}
  update(params: VideoEditBuiltinParams): void {
    const next = this.specs(params, this.rate).map(spec => videoEditBiquadCoefficients(spec, this.rate))
    // 滤波器个数变了（换预设、换坡度）才清空状态；只改增益或频率时保留状态，拖动参数不爆音。
    if (next.length !== this.coefficients.length) this.state = Array.from({ length: this.channels }, () => new Float64Array(next.length * 2))
    this.coefficients = next
  }
  process(channels: Float32Array[], length: number): void {
    for (let channel = 0; channel < channels.length; channel++) {
      const data = channels[channel]; const state = this.state[channel]
      for (let stage = 0; stage < this.coefficients.length; stage++) {
        const { b0, b1, b2, a1, a2 } = this.coefficients[stage]
        let z1 = state[stage * 2]; let z2 = state[stage * 2 + 1]
        for (let index = 0; index < length; index++) {
          const x = data[index]; const y = b0 * x + z1
          z1 = b1 * x - a1 * y + z2; z2 = b2 * x - a2 * y
          data[index] = y
        }
        state[stage * 2] = z1; state[stage * 2 + 1] = z2
      }
    }
  }
}
/** 参数均衡的预设曲线（与三段增益叠加）。 */
const EQ_PRESETS: Record<string, BiquadSpec[]> = {
  none: [],
  voice_clarity: [{ kind: 'highpass', frequency: 80, q: Math.SQRT1_2 }, { kind: 'peaking', frequency: 250, q: 1, gain: -3 }, { kind: 'peaking', frequency: 3000, q: 1, gain: 4 }, { kind: 'highshelf', frequency: 10000, q: 1, gain: 2 }],
  remove_hum: [{ kind: 'highpass', frequency: 40, q: Math.SQRT1_2 }, ...[50, 100, 150, 60, 120, 180].map((frequency): BiquadSpec => ({ kind: 'notch', frequency, q: 10 }))],
  warm: [{ kind: 'lowshelf', frequency: 200, q: 1, gain: 3 }, { kind: 'highshelf', frequency: 8000, q: 1, gain: -2 }],
  bright: [{ kind: 'peaking', frequency: 300, q: 1, gain: -1.5 }, { kind: 'highshelf', frequency: 6000, q: 1, gain: 4 }],
}
const BUTTERWORTH_4 = [0.5411961, 1.3065630]
const passFilters = (kind: 'highpass' | 'lowpass') => (params: VideoEditBuiltinParams): BiquadSpec[] => params.slope === 'steep'
  ? BUTTERWORTH_4.map(q => ({ kind, frequency: params.frequency as number, q }))
  : [{ kind, frequency: params.frequency as number, q: Math.SQRT1_2 }]

// —— 增益与声道平衡 ——
class GainBalance implements AudioProcessor {
  readonly latency = 0
  private gain = 1; private balance = 0; private mono = false
  update(params: VideoEditBuiltinParams): void { this.gain = dbToGain(params.gain as number); this.balance = (params.balance as number) / 100; this.mono = params.mono as boolean }
  process(channels: Float32Array[], length: number): void {
    const stereo = channels.length === 2
    const left = this.gain * (stereo && this.balance > 0 ? 1 - this.balance : 1); const right = this.gain * (stereo && this.balance < 0 ? 1 + this.balance : 1)
    for (let index = 0; index < length; index++) {
      if (stereo) {
        let l = channels[0][index]; let r = channels[1][index]
        if (this.mono) { l = r = (l + r) / 2 }
        channels[0][index] = l * left; channels[1][index] = r * right
      } else for (const data of channels) data[index] *= this.gain
    }
  }
}

// —— 压缩器：前馈、声道联动峰值检测、6 dB 软拐点，增益在 dB 域平滑 ——
const COMPRESSOR_SPEEDS: Record<string, [number, number]> = { fast: [0.002, 0.06], normal: [0.01, 0.15], slow: [0.03, 0.4] }
export function videoEditCompressorCurve(amount: number): { threshold: number; ratio: number; makeup: number } {
  const threshold = -0.4 * amount; const ratio = 1 + 0.07 * amount
  return { threshold, ratio, makeup: -threshold * (1 - 1 / ratio) / 2 }
}
class Compressor implements AudioProcessor {
  readonly latency = 0
  private threshold = 0; private ratio = 1; private makeup = 0; private attack = 0; private release = 0
  private envelope = 0
  constructor(private readonly rate: number) {}
  update(params: VideoEditBuiltinParams): void {
    const curve = videoEditCompressorCurve(params.amount as number)
    this.threshold = curve.threshold; this.ratio = curve.ratio; this.makeup = params.makeup ? curve.makeup : 0
    const [attack, release] = COMPRESSOR_SPEEDS[params.speed as string] ?? COMPRESSOR_SPEEDS.normal
    this.attack = smoothing(attack, this.rate); this.release = smoothing(release, this.rate)
  }
  private reduction(level: number): number {
    const knee = 6; const over = level - this.threshold
    if (2 * over < -knee) return 0
    if (2 * Math.abs(over) <= knee) return (1 / this.ratio - 1) * (over + knee / 2) ** 2 / (2 * knee)
    return over / this.ratio - over
  }
  process(channels: Float32Array[], length: number): void {
    for (let index = 0; index < length; index++) {
      let peak = 0
      for (const data of channels) peak = Math.max(peak, Math.abs(data[index]))
      const target = this.reduction(gainToDb(peak))
      const coefficient = target < this.envelope ? this.attack : this.release
      this.envelope = coefficient * this.envelope + (1 - coefficient) * target
      const gain = dbToGain(this.envelope + this.makeup)
      for (const data of channels) data[index] *= gain
    }
  }
}

// —— 限幅器：5 毫秒预判（滑动最小值 + 等长平均），释放只放慢回升；最后硬夹到上限，保证峰值不超过最大电平 ——
class Limiter implements AudioProcessor {
  readonly latency: number
  private readonly window: number
  private ceiling = 1; private boost = 1
  private readonly required: Float64Array; private readonly held: Float64Array
  private readonly delay: Float32Array[]
  private cursor = 0; private sum: number; private envelope = 1
  private readonly release: number
  constructor(rate: number, channels: number) {
    this.window = Math.max(2, Math.round(rate * 0.005)); this.latency = this.window - 1
    this.required = new Float64Array(this.window).fill(1); this.held = new Float64Array(this.window).fill(1); this.sum = this.window
    this.delay = Array.from({ length: channels }, () => new Float32Array(this.window))
    this.release = smoothing(0.08, rate)
  }
  update(params: VideoEditBuiltinParams): void { this.ceiling = dbToGain(params.ceiling as number); this.boost = dbToGain(params.boost as number) }
  process(channels: Float32Array[], length: number): void {
    const size = this.window
    for (let index = 0; index < length; index++) {
      let peak = 0
      for (const data of channels) peak = Math.max(peak, Math.abs(data[index]) * this.boost)
      const slot = this.cursor % size
      this.required[slot] = peak > this.ceiling ? this.ceiling / peak : 1
      let hold = 1
      for (let offset = 0; offset < size; offset++) if (this.required[offset] < hold) hold = this.required[offset]
      this.sum += hold - this.held[slot]; this.held[slot] = hold
      const average = Math.min(1, this.sum / size)
      this.envelope = average < this.envelope ? average : average - (average - this.envelope) * this.release
      // 延迟 window-1 个样本：输出的是 window-1 个样本之前的输入，它的峰值已被后面整个窗口的平均覆盖。
      const delayed = (this.cursor + 1) % size
      for (let channel = 0; channel < channels.length; channel++) {
        const line = this.delay[channel]; const input = channels[channel][index]
        line[slot] = input
        const out = line[delayed] * this.boost * this.envelope
        channels[channel][index] = Math.max(-this.ceiling, Math.min(this.ceiling, out))
      }
      this.cursor = (this.cursor + 1) % (size * 1024)
    }
  }
}

// —— 去齿音：齿音频段（高通分出的检测信号）相对全频的电平超过阈值时，用同频率的高频搁架动态压低高频；没有齿音时搁架增益为 0 dB（原样） ——
class DeEsser implements AudioProcessor {
  readonly latency = 0
  private detector: Coefficients = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 }
  private readonly detectorState: Float64Array; private readonly shelfState: Float64Array
  private high = 0; private full = 0
  private threshold = -13; private maxCut = 9; private cos = 0; private alpha = 0
  private readonly attack: number; private readonly release: number
  constructor(private readonly rate: number, channels: number) {
    this.detectorState = new Float64Array(channels * 2); this.shelfState = new Float64Array(channels * 2)
    this.attack = smoothing(0.0005, rate); this.release = smoothing(0.06, rate)
  }
  update(params: VideoEditBuiltinParams): void {
    const amount = (params.amount as number) / 100
    const frequency = Math.min(params.frequency as number, this.rate * 0.45)
    this.detector = videoEditBiquadCoefficients({ kind: 'highpass', frequency, q: Math.SQRT1_2 }, this.rate)
    const w0 = 2 * Math.PI * frequency / this.rate; this.cos = Math.cos(w0); this.alpha = Math.sin(w0) / 2 * Math.SQRT2
    this.threshold = -6 - amount * 14; this.maxCut = amount * 18
  }
  process(channels: Float32Array[], length: number): void {
    const { b0, b1, b2, a1, a2 } = this.detector
    for (let index = 0; index < length; index++) {
      let high = 0; let full = 0
      for (let channel = 0; channel < channels.length; channel++) {
        const x = channels[channel][index]; const offset = channel * 2
        const y = b0 * x + this.detectorState[offset]
        this.detectorState[offset] = b1 * x - a1 * y + this.detectorState[offset + 1]; this.detectorState[offset + 1] = b2 * x - a2 * y
        high = Math.max(high, Math.abs(y)); full = Math.max(full, Math.abs(x))
      }
      this.high = high > this.high ? this.attack * this.high + (1 - this.attack) * high : this.release * this.high + (1 - this.release) * high
      this.full = full > this.full ? this.attack * this.full + (1 - this.attack) * full : this.release * this.full + (1 - this.release) * full
      const cut = Math.min(this.maxCut, Math.max(0, (gainToDb(this.high) - gainToDb(this.full) - this.threshold) * 2))
      // 高频搁架（RBJ，S=1），增益 -cut dB；逐样本更新系数（cos、alpha 不变，只有 A 变）。
      const A = 10 ** (-cut / 40); const root = 2 * Math.sqrt(A) * this.alpha; const cos = this.cos
      const a0 = (A + 1) - (A - 1) * cos + root
      const s0 = A * ((A + 1) + (A - 1) * cos + root) / a0; const s1 = -2 * A * ((A - 1) + (A + 1) * cos) / a0; const s2 = A * ((A + 1) + (A - 1) * cos - root) / a0
      const r1 = 2 * ((A - 1) - (A + 1) * cos) / a0; const r2 = ((A + 1) - (A - 1) * cos - root) / a0
      for (let channel = 0; channel < channels.length; channel++) {
        const x = channels[channel][index]; const offset = channel * 2
        const y = s0 * x + this.shelfState[offset]
        this.shelfState[offset] = s1 * x - r1 * y + this.shelfState[offset + 1]; this.shelfState[offset + 1] = s2 * x - r2 * y
        channels[channel][index] = y
      }
    }
  }
}

// —— 混响：Freeverb（Jezar at Dreampoint，公有领域）——
const COMB_TUNING = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617]
const ALLPASS_TUNING = [556, 441, 341, 225]
const STEREO_SPREAD = 23
class Reverb implements AudioProcessor {
  readonly latency = 0
  private readonly combs: Array<{ buffer: Float64Array; index: number; store: number }>[]
  private readonly allpasses: Array<{ buffer: Float64Array; index: number }>[]
  private feedback = 0.84; private damp = 0.2; private mix = 0.25
  constructor(rate: number, private readonly channels: number) {
    const scale = rate / 44100
    const lanes = Math.min(2, channels)
    this.combs = Array.from({ length: lanes }, (_, lane) => COMB_TUNING.map(size => ({ buffer: new Float64Array(Math.round((size + lane * STEREO_SPREAD) * scale)), index: 0, store: 0 })))
    this.allpasses = Array.from({ length: lanes }, (_, lane) => ALLPASS_TUNING.map(size => ({ buffer: new Float64Array(Math.round((size + lane * STEREO_SPREAD) * scale)), index: 0 })))
  }
  update(params: VideoEditBuiltinParams): void {
    this.feedback = 0.7 + 0.28 * (params.room_size as number) / 100
    this.damp = 0.4 * (params.damping as number) / 100
    this.mix = (params.mix as number) / 100
  }
  process(channels: Float32Array[], length: number): void {
    const dry = 1 - this.mix * 0.5; const wet = this.mix * 3; const damp = this.damp; const keep = 1 - damp
    for (let index = 0; index < length; index++) {
      let input = 0
      for (const data of channels) input += data[index]
      input *= 0.015 * (2 / Math.max(1, channels.length))
      for (let lane = 0; lane < this.combs.length; lane++) {
        let out = 0
        for (const comb of this.combs[lane]) {
          const value = comb.buffer[comb.index]
          comb.store = value * keep + comb.store * damp
          if (Math.abs(comb.store) < 1e-25) comb.store = 0
          comb.buffer[comb.index] = input + comb.store * this.feedback
          if (++comb.index >= comb.buffer.length) comb.index = 0
          out += value
        }
        for (const allpass of this.allpasses[lane]) {
          const buffered = allpass.buffer[allpass.index]
          const next = -out + buffered
          allpass.buffer[allpass.index] = Math.abs(out + buffered * 0.5) < 1e-25 ? 0 : out + buffered * 0.5
          if (++allpass.index >= allpass.buffer.length) allpass.index = 0
          out = next
        }
        const target = this.channels === 1 ? channels[0] : channels[lane]
        target[index] = target[index] * dry + out * wet
      }
    }
  }
}

// —— 音调变换：smbPitchShift（Stephan M. Bernsee，相位声码器，WOL 许可），帧长 2048、4 倍重叠，固定延迟 1536 ——
const PITCH_FRAME = 2048
const PITCH_OVERSAMPLE = 4
const PITCH_STEP = PITCH_FRAME / PITCH_OVERSAMPLE
const PITCH_LATENCY = PITCH_FRAME - PITCH_STEP
const pitchWindow = Float64Array.from({ length: PITCH_FRAME }, (_, index) => -0.5 * Math.cos(2 * Math.PI * index / PITCH_FRAME) + 0.5)
class PitchChannel {
  readonly input = new Float64Array(PITCH_FRAME); readonly output = new Float64Array(PITCH_FRAME); readonly accumulator = new Float64Array(2 * PITCH_FRAME)
  readonly lastPhase = new Float64Array(PITCH_FRAME / 2 + 1); readonly sumPhase = new Float64Array(PITCH_FRAME / 2 + 1)
  rover = PITCH_LATENCY
}
class PitchShift implements AudioProcessor {
  readonly latency = PITCH_LATENCY
  private ratio = 1
  private readonly lanes: PitchChannel[]
  private readonly real = new Float64Array(PITCH_FRAME); private readonly imaginary = new Float64Array(PITCH_FRAME)
  private readonly magnitude = new Float64Array(PITCH_FRAME / 2 + 1); private readonly frequency = new Float64Array(PITCH_FRAME / 2 + 1)
  private readonly synthMagnitude = new Float64Array(PITCH_FRAME / 2 + 1); private readonly synthFrequency = new Float64Array(PITCH_FRAME / 2 + 1)
  constructor(private readonly rate: number, channels: number) { this.lanes = Array.from({ length: channels }, () => new PitchChannel()) }
  update(params: VideoEditBuiltinParams): void { this.ratio = 2 ** ((params.semitones as number) / 12) }
  /** 直接设音调比例（变速保持音调的补偿，4.13）。 */
  setRatio(ratio: number): void { this.ratio = ratio }
  process(channels: Float32Array[], length: number): void {
    for (let channel = 0; channel < channels.length; channel++) {
      const lane = this.lanes[channel]; const data = channels[channel]
      for (let index = 0; index < length; index++) {
        lane.input[lane.rover] = data[index]
        // 不变调时直接输出同样延迟的原声（不经相位声码器的音色变化）。
        data[index] = this.ratio === 1 ? lane.input[lane.rover - PITCH_LATENCY] : lane.output[lane.rover - PITCH_LATENCY]
        if (++lane.rover >= PITCH_FRAME) { lane.rover = PITCH_LATENCY; if (this.ratio !== 1) this.frame(lane); lane.input.copyWithin(0, PITCH_STEP, PITCH_FRAME) }
      }
    }
  }
  private frame(lane: PitchChannel): void {
    const half = PITCH_FRAME / 2; const binWidth = this.rate / PITCH_FRAME; const expected = 2 * Math.PI * PITCH_STEP / PITCH_FRAME
    const { real, imaginary } = this
    for (let index = 0; index < PITCH_FRAME; index++) { real[index] = lane.input[index] * pitchWindow[index]; imaginary[index] = 0 }
    videoEditFft(real, imaginary, -1)
    for (let bin = 0; bin <= half; bin++) {
      const magnitude = 2 * Math.hypot(real[bin], imaginary[bin]); const phase = Math.atan2(imaginary[bin], real[bin])
      let delta = phase - lane.lastPhase[bin]; lane.lastPhase[bin] = phase
      delta -= bin * expected
      let wraps = Math.trunc(delta / Math.PI)
      wraps += wraps >= 0 ? wraps & 1 : -(-wraps & 1)
      delta -= Math.PI * wraps
      this.magnitude[bin] = magnitude; this.frequency[bin] = bin * binWidth + PITCH_OVERSAMPLE * delta / (2 * Math.PI) * binWidth
    }
    this.synthMagnitude.fill(0); this.synthFrequency.fill(0)
    for (let bin = 0; bin <= half; bin++) {
      const target = Math.trunc(bin * this.ratio)
      if (target <= half) { this.synthMagnitude[target] += this.magnitude[bin]; this.synthFrequency[target] = this.frequency[bin] * this.ratio }
    }
    for (let bin = 0; bin <= half; bin++) {
      const deviation = (this.synthFrequency[bin] - bin * binWidth) / binWidth
      lane.sumPhase[bin] = (lane.sumPhase[bin] + 2 * Math.PI * deviation / PITCH_OVERSAMPLE + bin * expected) % (2 * Math.PI)
      real[bin] = this.synthMagnitude[bin] * Math.cos(lane.sumPhase[bin]); imaginary[bin] = this.synthMagnitude[bin] * Math.sin(lane.sumPhase[bin])
    }
    for (let index = half + 1; index < PITCH_FRAME; index++) { real[index] = 0; imaginary[index] = 0 }
    videoEditFft(real, imaginary, 1)
    for (let index = 0; index < PITCH_FRAME; index++) lane.accumulator[index] += 2 * pitchWindow[index] * real[index] / (half * PITCH_OVERSAMPLE)
    for (let index = 0; index < PITCH_STEP; index++) lane.output[index] = lane.accumulator[index]
    lane.accumulator.copyWithin(0, PITCH_STEP, 2 * PITCH_FRAME); lane.accumulator.fill(0, 2 * PITCH_FRAME - PITCH_STEP)
  }
}

// —— 降噪：RNNoise（Xiph/Mozilla 的循环神经网络降噪，WebAssembly 版 @shiguredo/rnnoise-wasm）——
interface RnnoiseState { processFrame(frame: Float32Array): number; destroy(): void }
interface RnnoiseModule { readonly frameSize: number; createDenoiseState(): RnnoiseState }
let rnnoise: Promise<RnnoiseModule> | undefined
/** 只在用到降噪时实例化（约 5 MB 的模型与 WebAssembly）；同一个工作线程只实例化一次，失败后下次重试。 */
function loadRnnoise(): Promise<RnnoiseModule> {
  rnnoise ??= Rnnoise.load().catch(error => { rnnoise = undefined; throw error })
  return rnnoise
}
/** RNNoise 自身输出比输入晚两帧（960 样本，实测）；再加上凑满一帧的缓冲（480）。 */
export const VIDEO_EDIT_RNNOISE_LATENCY = 1440
const PCM_SCALE = 32768
class NoiseReduction implements AudioProcessor {
  readonly latency = VIDEO_EDIT_RNNOISE_LATENCY
  private strength = 0.8
  private readonly lanes: Array<{ state: RnnoiseState; input: Float32Array; output: Float32Array }>
  private position = 0
  constructor(module: RnnoiseModule, channels: number) {
    if (module.frameSize !== 480) throw new Error('降噪模型的帧长不是 480 个样本。')
    this.lanes = Array.from({ length: channels }, () => ({ state: module.createDenoiseState(), input: new Float32Array(480), output: new Float32Array(480) }))
  }
  update(params: VideoEditBuiltinParams): void { this.strength = (params.strength as number) / 100 }
  wet(): number { return this.strength }
  process(channels: Float32Array[], length: number): void {
    for (let index = 0; index < length; index++) {
      for (let channel = 0; channel < channels.length; channel++) {
        const lane = this.lanes[channel]
        lane.input[this.position] = channels[channel][index] * PCM_SCALE
        channels[channel][index] = lane.output[this.position] / PCM_SCALE
      }
      if (++this.position === 480) {
        this.position = 0
        for (const lane of this.lanes) { lane.output.set(lane.input); lane.state.processFrame(lane.output) }
      }
    }
  }
  dispose(): void { for (const lane of this.lanes) lane.state.destroy() }
}

function createProcessor(id: string, rate: number, channels: number, denoiser?: RnnoiseModule): AudioProcessor {
  switch (id) {
    case 'parametric_eq': return new FilterCascade(rate, channels, params => [...(EQ_PRESETS[params.preset as string] ?? []), { kind: 'lowshelf', frequency: 100, q: 1, gain: params.low as number }, { kind: 'peaking', frequency: 1000, q: 0.8, gain: params.mid as number }, { kind: 'highshelf', frequency: 8000, q: 1, gain: params.high as number }])
    case 'high_pass': return new FilterCascade(rate, channels, passFilters('highpass'))
    case 'low_pass': return new FilterCascade(rate, channels, passFilters('lowpass'))
    case 'gain_balance': return new GainBalance()
    case 'compressor': return new Compressor(rate)
    case 'limiter': return new Limiter(rate, channels)
    case 'de_esser': return new DeEsser(rate, channels)
    case 'reverb': return new Reverb(rate, channels)
    case 'pitch_shift': return new PitchShift(rate, channels)
    case 'noise_reduction': if (!denoiser) throw new Error('降噪模型尚未加载。'); return new NoiseReduction(denoiser, channels)
    default: throw new Error(`没有音频效果“${id}”。`)
  }
}

/** 固定延迟线：按样本推入、取出 `delay` 个样本之前的值（干声对齐用）。 */
class DelayLine {
  private readonly lines: Float32Array[]
  private cursor = 0
  constructor(private readonly delay: number, channels: number) { this.lines = Array.from({ length: channels }, () => new Float32Array(Math.max(1, delay))) }
  /** 把 `input` 推入，同时把延迟后的值写到 `output`。 */
  run(input: Float32Array[], output: Float32Array[], length: number): void {
    if (!this.delay) { input.forEach((data, channel) => output[channel].set(data.subarray(0, length))); return }
    let cursor = this.cursor
    for (let index = 0; index < length; index++) {
      for (let channel = 0; channel < input.length; channel++) { const line = this.lines[channel]; output[channel][index] = line[cursor]; line[cursor] = input[channel][index] }
      if (++cursor === this.delay) cursor = 0
    }
    this.cursor = cursor
  }
}
interface Stage { effectId: string; builtinId: string; processor: AudioProcessor; amount: number; dry: DelayLine }
/** 预读多久让状态稳定下来：混响尾音长，其余效果的包络与滤波器很快稳定。 */
const PREROLL_SECONDS: Record<string, number> = { reverb: 2, noise_reduction: 0.5, compressor: 0.5, de_esser: 0.2, limiter: 0.2 }

/**
 * 一个声音片段的音频效果链：按效果顺序串联处理，声明总延迟与预读长度；`nextSample` 记下一块应从序列哪个样本开始，
 * 混音据此判断是否连续（连续时延续状态，否则由调用方 `reset` 并预读）。
 */
export class VideoEditAudioEffectChain {
  private stages: Stage[] = []
  private signature = ''
  /** 下一块连续输出应从这个序列样本开始；未开始或已重置时为 undefined。 */
  nextSample?: number
  constructor(readonly rate: number, readonly channels: number) {}
  get latency(): number { return this.stages.reduce((sum, stage) => sum + stage.processor.latency, 0) }
  get preroll(): number { return Math.round(this.rate * Math.max(0.05, ...this.stages.map(stage => PREROLL_SECONDS[stage.builtinId] ?? 0.05))) }
  /**
   * 对齐到当前效果链：效果的增删、换序或启停（结构变化）时重建并清空状态；只改参数与强度时原地更新，播放中拖动参数不中断。
   * `pitchCompensation`（4.13 变速保持音调）不为 1 时在最前面加一级音调变换，比例即此值（1/速度），改速度只更新比例。
   * 返回是否重建。
   */
  async sync(effects: readonly VideoEditBuiltinEffect[], pitchCompensation = 1): Promise<boolean> {
    const compensated = pitchCompensation !== 1
    const signature = [...(compensated ? ['speed-pitch'] : []), ...effects.map(effect => `${effect.id}:${effect.builtin.id}`)].join('|')
    let rebuilt = false
    if (signature !== this.signature) {
      const denoiser = effects.some(effect => effect.builtin.id === 'noise_reduction') ? await loadRnnoise() : undefined
      this.dispose()
      const compensation = compensated ? [new PitchShift(this.rate, this.channels)] : []
      this.stages = [
        ...compensation.map(processor => ({ effectId: 'speed-pitch', builtinId: 'pitch_shift', processor, amount: 1, dry: new DelayLine(processor.latency, this.channels) })),
        ...effects.map(effect => {
          const processor = createProcessor(effect.builtin.id, this.rate, this.channels, denoiser)
          return { effectId: effect.id, builtinId: effect.builtin.id, processor, amount: 1, dry: new DelayLine(processor.latency, this.channels) }
        }),
      ]
      this.signature = signature; this.nextSample = undefined; rebuilt = true
    }
    const offset = compensated ? 1 : 0
    if (compensated) (this.stages[0].processor as PitchShift).setRatio(pitchCompensation)
    effects.forEach((effect, index) => { const stage = this.stages[index + offset]; stage.processor.update(resolveVideoEditBuiltinParams(effect.builtin)); stage.amount = effect.amount })
    return rebuilt
  }
  /** 清空状态（重建全部处理器，参数保留）。 */
  async reset(effects: readonly VideoEditBuiltinEffect[], pitchCompensation = 1): Promise<void> { this.signature = ''; await this.sync(effects, pitchCompensation) }
  /** 原地处理；输出比输入晚 `latency` 个样本。 */
  process(channels: Float32Array[], length: number, automation?: (sample: number) => readonly VideoEditBuiltinEffect[]): void {
    if (automation) {
      // Reuse single-sample buffers; state and delay lines persist between samples and blocks.
      const one = channels.map(() => new Float32Array(1))
      const dry = channels.map(() => new Float32Array(1))
      for (let sample = 0; sample < length; sample++) {
        const effects = automation(sample)
        for (const stage of this.stages) {
          const effect = effects.find(effect => effect.id === stage.effectId)
          if (effect) { stage.processor.update(effect.builtin.params); stage.amount = effect.amount }
        }
        one.forEach((data, channel) => { data[0] = channels[channel][sample] })
        for (const stage of this.stages) {
          stage.dry.run(one, dry, 1)
          stage.processor.process(one, 1)
          const wet = stage.amount * (stage.processor.wet?.() ?? 1)
          if (wet < 1) for (let channel = 0; channel < one.length; channel++) one[channel][0] = one[channel][0] * wet + dry[channel][0] * (1 - wet)
        }
        one.forEach((data, channel) => { channels[channel][sample] = data[0] })
      }
      return
    }
    const dry = channels.map(() => new Float32Array(length))
    for (const stage of this.stages) {
      stage.dry.run(channels, dry, length)
      stage.processor.process(channels, length)
      const wet = stage.amount * (stage.processor.wet?.() ?? 1)
      if (wet >= 1) continue
      for (let channel = 0; channel < channels.length; channel++) {
        const data = channels[channel]; const original = dry[channel]
        for (let index = 0; index < length; index++) data[index] = data[index] * wet + original[index] * (1 - wet)
      }
    }
  }
  dispose(): void { for (const stage of this.stages) stage.processor.dispose?.(); this.stages = [] }
}

/**
 * 一个混音块要喂给效果链的输入范围：输出要覆盖序列样本 [first, first+length)。连续时只读 [first+L, first+length+L)；
 * 不连续时从 first-预读 开始读，丢掉前面 预读+L 个输出。L 为效果链延迟。
 */
export function planVideoEditAudioEffectBlock(chain: Pick<VideoEditAudioEffectChain, 'nextSample' | 'latency' | 'preroll'>, first: number, length: number): { contiguous: boolean; inputStart: number; inputLength: number; discard: number } {
  const latency = chain.latency
  if (chain.nextSample === first) return { contiguous: true, inputStart: first + latency, inputLength: length, discard: 0 }
  const preroll = chain.preroll
  return { contiguous: false, inputStart: first - preroll, inputLength: preroll + latency + length, discard: preroll + latency }
}
