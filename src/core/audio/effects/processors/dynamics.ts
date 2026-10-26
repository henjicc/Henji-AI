import type { VideoEditBuiltinParams } from '../../../videoEdit/builtinEffects'
import { audioBiquadCoefficients, audioCompressorCurve, audioCompressorReduction, biquadBlock, dbToGain, flushDenormal, SmoothedValue, smoothing, type AudioProcessor, type Coefficients } from './shared'

/**
 * 动态类效果：噪声门、语音音量级别（自动电平）、三段压缩器。检测都按声道联动（同一增益作用于所有声道，立体声像不漂移），
 * 增益在 dB 域平滑。
 */

// —— 噪声门：1.5 毫秒预判，峰值包络对比阈值（关门阈值低 4 dB 防抖），开关门按 dB 线性渐变 ——
/** 预判时长（秒）：门在声音到来前就开始打开，不吃掉字头。 */
const GATE_LOOKAHEAD = 0.0015
/** 关门阈值比开门阈值低多少 dB（迟滞，阈值附近不反复开关）。 */
const GATE_HYSTERESIS = 4
export class NoiseGate implements AudioProcessor {
  readonly latency: number
  private readonly delay: Float32Array[]
  private cursor = 0
  private open = 0; private close = 0; private reduction = 30
  private attackStep = 1; private releaseStep = 1; private holdSamples = 0
  private level = 0; private opened = false; private holdLeft = 0
  /** 当前增益（dB，0 为门全开，-reduction 为全关）；第一次设置参数时从关门开始。 */
  private gainDb = Number.NaN
  private readonly detectorRelease: number
  constructor(private readonly rate: number, channels: number) {
    this.latency = Math.max(1, Math.round(rate * GATE_LOOKAHEAD))
    this.delay = Array.from({ length: channels }, () => new Float32Array(this.latency))
    this.detectorRelease = smoothing(0.01, rate)
  }
  update(params: VideoEditBuiltinParams): void {
    const threshold = params.threshold as number
    this.open = dbToGain(threshold); this.close = dbToGain(threshold - GATE_HYSTERESIS)
    this.reduction = params.reduction as number
    // 开门：attack 毫秒内从全关升到全开；关门：release 毫秒内从全开降到全关（dB 线性，听感上是均匀的淡入淡出）。
    const span = Math.max(1, this.reduction)
    this.attackStep = span / Math.max(1, (params.attack as number) / 1000 * this.rate)
    this.releaseStep = span / Math.max(1, (params.release as number) / 1000 * this.rate)
    this.holdSamples = Math.round((params.hold as number) / 1000 * this.rate)
    if (Number.isNaN(this.gainDb)) this.gainDb = -this.reduction
  }
  process(channels: Float32Array[], length: number): void {
    const size = this.latency
    for (let index = 0; index < length; index++) {
      let peak = 0
      for (const data of channels) peak = Math.max(peak, Math.abs(data[index]))
      this.level = peak > this.level ? peak : flushDenormal(this.level * this.detectorRelease)
      if (this.level >= this.open) { this.opened = true; this.holdLeft = this.holdSamples }
      else if (this.holdLeft > 0) this.holdLeft--
      else if (this.level < this.close) this.opened = false
      const target = this.opened ? 0 : -this.reduction
      let gain = Math.max(this.gainDb, -this.reduction)
      gain = gain < target ? Math.min(target, gain + this.attackStep) : Math.max(target, gain - this.releaseStep)
      this.gainDb = gain
      const linear = gain === 0 ? 1 : dbToGain(gain)
      for (let channel = 0; channel < channels.length; channel++) {
        const line = this.delay[channel]; const input = channels[channel][index]
        channels[channel][index] = line[this.cursor] * linear; line[this.cursor] = input
      }
      if (++this.cursor === size) this.cursor = 0
    }
  }
}

// —— 语音音量级别：快包络判断有没有在说话，说话时慢 RMS 估计电平、把增益平滑地推向目标；停顿时冻结电平与增益 ——
/** 响应速度：慢 RMS 时间常数、增益上升（提升）与下降（衰减）的时间常数，秒。提升比衰减慢，避免抬起呼吸与尾音。 */
const LEVELER_SPEEDS: Record<string, [number, number, number]> = { slow: [0.8, 3, 1], normal: [0.4, 1.5, 0.5], fast: [0.2, 0.6, 0.2] }
/** 第一次出现声音后的起步时长（秒）：电平估计不低于快包络、增益以 50 毫秒跟上，片段开头不必等好几秒才到目标电平。 */
const LEVELER_WARMUP = 0.5
export class SpeechLeveler implements AudioProcessor {
  readonly latency = 0
  private target = -18; private maxBoost = 12; private maxCut = 12; private floor = -55
  private slowKeep = 0; private upKeep = 0; private downKeep = 0
  private readonly fastKeep: number; private readonly warmKeep: number; private readonly warmupLength: number
  private fast = 0; private slow = 0; private primed = false; private warmupLeft = 0; private gainDb = 0
  constructor(private readonly rate: number) {
    this.fastKeep = smoothing(0.03, rate); this.warmKeep = smoothing(0.05, rate); this.warmupLength = Math.round(LEVELER_WARMUP * rate)
  }
  update(params: VideoEditBuiltinParams): void {
    this.target = params.target as number; this.maxBoost = params.max_boost as number; this.maxCut = params.max_cut as number; this.floor = params.noise_floor as number
    const [slow, up, down] = LEVELER_SPEEDS[params.speed as string] ?? LEVELER_SPEEDS.normal
    this.slowKeep = smoothing(slow, this.rate); this.upKeep = smoothing(up, this.rate); this.downKeep = smoothing(down, this.rate)
  }
  process(channels: Float32Array[], length: number): void {
    const count = channels.length
    for (let index = 0; index < length; index++) {
      let power = 0
      for (const data of channels) power += data[index] * data[index]
      power /= count
      this.fast = flushDenormal(this.fastKeep * this.fast + (1 - this.fastKeep) * power)
      // 低于噪声电平视为停顿：不更新电平估计、保持当前增益（不把停顿里的底噪抬上来）。
      if (10 * Math.log10(this.fast + 1e-20) >= this.floor) {
        if (!this.primed) { this.primed = true; this.warmupLeft = this.warmupLength }
        this.slow = this.slowKeep * this.slow + (1 - this.slowKeep) * power
        const warming = this.warmupLeft > 0
        if (warming) { this.slow = Math.max(this.slow, this.fast); this.warmupLeft-- }
        const desired = Math.min(this.maxBoost, Math.max(-this.maxCut, this.target - 10 * Math.log10(this.slow + 1e-20)))
        const keep = warming ? this.warmKeep : desired > this.gainDb ? this.upKeep : this.downKeep
        this.gainDb = keep * this.gainDb + (1 - keep) * desired
      }
      const gain = this.gainDb === 0 ? 1 : dbToGain(this.gainDb)
      for (const data of channels) data[index] *= gain
    }
  }
}

// —— 三段压缩器：Linkwitz-Riley 4 阶分频（低段补一个高分频点的全通，三段相加幅频平直），每段一个压缩器 ——
/** 每段的启动与释放时间（秒）：低频慢、高频快，避免低频被压出失真、高频瞬态压不住。 */
const BAND_SPEEDS: ReadonlyArray<readonly [number, number]> = [[0.02, 0.25], [0.01, 0.15], [0.003, 0.08]]
/** 每个声道 9 段双二阶：低分频点低通 ×2、高通 ×2，高分频点低通 ×2、高通 ×2，低段全通 ×1。 */
const CROSSOVER_STAGES = 9
/** 自然对数 → dB 的系数（逐样本的电平换算用 Math.log / Math.exp，比 log10 与乘方快）。 */
const NEPER_TO_DB = 20 / Math.LN10
/**
 * 一段压缩器：静态曲线、启动/释放保留系数与 dB 域增益包络（含自动补偿，改压缩量时补偿也平滑变化；第一次设置参数时直接到位）。
 * `quiet` 是软拐点起点的线性电平：峰值低于它时不压缩，省掉对数运算。
 */
interface CompressorBand { threshold: number; ratio: number; makeup: number; quiet: number; attack: number; release: number; envelope: number; gainDb: number; gain: number }
export class MultibandCompressor implements AudioProcessor {
  readonly latency = 0
  private filters: Coefficients[] = []
  private readonly state: Float64Array[]
  private readonly bands: CompressorBand[]
  private readonly output: SmoothedValue
  private crossovers: [number, number] = [0, 0]
  /** 每个声道一块的分频结果：低、中、高与中间结果。 */
  private scratch: Float64Array[][] = []
  constructor(private readonly rate: number, private readonly channels: number) {
    this.state = Array.from({ length: channels }, () => new Float64Array(CROSSOVER_STAGES * 2))
    this.bands = BAND_SPEEDS.map(([attack, release]) => ({ threshold: 0, ratio: 1, makeup: 0, quiet: 0, attack: smoothing(attack, rate), release: smoothing(release, rate), envelope: Number.NaN, gainDb: 0, gain: 1 }))
    this.output = new SmoothedValue(rate)
  }
  update(params: VideoEditBuiltinParams): void {
    const low = params.low_crossover as number; const high = Math.max(low, params.high_crossover as number)
    if (low !== this.crossovers[0] || high !== this.crossovers[1]) {
      const pass = (kind: 'lowpass' | 'highpass' | 'allpass', frequency: number): Coefficients => audioBiquadCoefficients({ kind, frequency, q: Math.SQRT1_2 }, this.rate)
      const lowLp = pass('lowpass', low); const lowHp = pass('highpass', low); const highLp = pass('lowpass', high); const highHp = pass('highpass', high)
      this.filters = [lowLp, lowLp, lowHp, lowHp, highLp, highLp, highHp, highHp, pass('allpass', high)]
      this.crossovers = [low, high]
    }
    for (const [index, key] of ['low_amount', 'mid_amount', 'high_amount'].entries()) {
      const curve = audioCompressorCurve(params[key] as number); const band = this.bands[index]
      band.threshold = curve.threshold; band.ratio = curve.ratio; band.makeup = curve.makeup; band.quiet = dbToGain(curve.threshold - 3)
      if (Number.isNaN(band.envelope)) band.envelope = curve.makeup
    }
    this.output.set(dbToGain(params.output as number))
  }
  /** 一段的增益（不含输出增益）：峰值检测 → 静态曲线加自动补偿 → dB 域启动/释放平滑；包络不变时沿用上次的线性增益。 */
  private bandGain(band: CompressorBand, peak: number): number {
    const target = (peak < band.quiet ? 0 : audioCompressorReduction(Math.log(peak) * NEPER_TO_DB, band.threshold, band.ratio)) + band.makeup
    if (target !== band.envelope) {
      const keep = target < band.envelope ? band.attack : band.release
      const next = keep * band.envelope + (1 - keep) * target
      band.envelope = Math.abs(next - target) < 1e-9 ? target : next
    }
    if (band.envelope !== band.gainDb) { band.gainDb = band.envelope; band.gain = band.envelope === 0 ? 1 : Math.exp(band.envelope / NEPER_TO_DB) }
    return band.gain
  }
  process(channels: Float32Array[], length: number): void {
    const f = this.filters; const bands = this.bands; const count = channels.length
    if (!this.scratch.length || this.scratch[0][0].length < length) this.scratch = Array.from({ length: this.channels }, () => Array.from({ length: 4 }, () => new Float64Array(length)))
    // 分频按块做（与逐样本逐段计算结果相同）：低段 = 全通(低通²)，中段 = 低通²(高通²)，高段 = 高通²(高通²)。
    for (let channel = 0; channel < count; channel++) {
      const state = this.state[channel]; const x = channels[channel]; const [low, mid, high, rest] = this.scratch[channel]
      biquadBlock(f[0], state, 0, x, rest, length); biquadBlock(f[1], state, 2, rest, rest, length); biquadBlock(f[8], state, 16, rest, low, length)
      biquadBlock(f[2], state, 4, x, rest, length); biquadBlock(f[3], state, 6, rest, rest, length)
      biquadBlock(f[4], state, 8, rest, mid, length); biquadBlock(f[5], state, 10, mid, mid, length)
      biquadBlock(f[6], state, 12, rest, high, length); biquadBlock(f[7], state, 14, high, high, length)
    }
    const lows = this.scratch.map(band => band[0]); const mids = this.scratch.map(band => band[1]); const highs = this.scratch.map(band => band[2])
    for (let index = 0; index < length; index++) {
      let lowPeak = 0; let midPeak = 0; let highPeak = 0
      for (let channel = 0; channel < count; channel++) {
        lowPeak = Math.max(lowPeak, Math.abs(lows[channel][index])); midPeak = Math.max(midPeak, Math.abs(mids[channel][index])); highPeak = Math.max(highPeak, Math.abs(highs[channel][index]))
      }
      const output = this.output.next()
      const lowGain = this.bandGain(bands[0], lowPeak) * output; const midGain = this.bandGain(bands[1], midPeak) * output; const highGain = this.bandGain(bands[2], highPeak) * output
      for (let channel = 0; channel < count; channel++) channels[channel][index] = lows[channel][index] * lowGain + mids[channel][index] * midGain + highs[channel][index] * highGain
    }
  }
}
