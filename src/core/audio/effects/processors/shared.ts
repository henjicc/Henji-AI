import type { VideoEditBuiltinParams } from '../../../videoEdit/builtinEffects'

/**
 * 音频效果处理器的公共部分：处理器接口与新旧处理器共用的小工具（分贝换算、平滑系数、双二阶滤波、压缩曲线、延迟缓冲、低频振荡）。
 * 全部是确定性的逐样本运算，状态放在处理器里跨分块延续：同一输入在任何分块下结果逐样本一致。
 */

/** 效果链里的一个处理器。 */
export interface AudioProcessor {
  /** 输出相对输入的固定延迟（样本数）。 */
  readonly latency: number
  update(params: VideoEditBuiltinParams): void
  /** 原地处理 `length` 个样本（每个声道一个数组）。 */
  process(channels: Float32Array[], length: number): void
  /** 混入处理结果的比例（降噪强度等），缺省为 1；与效果强度相乘。 */
  wet?(): number
  /**
   * 下一个输入样本在片段时间上的位置（样本数，片段开头为 0）。带低频振荡的效果据此对齐相位：
   * 定位、预览块与导出块的划分不同，振荡相位仍只由片段内位置决定。没有调用时从 0 开始。
   */
  locate?(sample: number): void
  dispose?(): void
}

/**
 * 递归状态（滤波器、反馈延迟线、包络）衰减到 1e-30 以下时直接归零：避免静音里落进非规格化浮点数，
 * 在那里反复舍入不归零（运算慢上百倍）。逐样本判断，与分块方式无关。
 */
export const flushDenormal = (value: number): number => value > -1e-30 && value < 1e-30 ? 0 : value
export const dbToGain = (db: number): number => 10 ** (db / 20)
export const gainToDb = (gain: number): number => 20 * Math.log10(gain + 1e-12)
/** 一阶平滑的保留系数：时间常数 `seconds`。 */
export const smoothing = (seconds: number, rate: number): number => Math.exp(-1 / Math.max(1, seconds * rate))

// —— 双二阶滤波器（RBJ Audio EQ Cookbook，转置直接 II 型，双精度状态） ——
/**
 * `cut` 为有限深度的陷波：理想陷波 N 与直通按深度混合，H = G + (1 - G)·N（G 为 `gain` dB 换算的线性增益）。
 * 宽度由 N 决定（-3 dB 处带宽 ≈ 频率 / Q），深切时裙边也很窄；RBJ 峰值段的 Q 按一半深度处的带宽算，深切时裙边宽得多。
 */
export type BiquadKind = 'lowpass' | 'highpass' | 'peaking' | 'lowshelf' | 'highshelf' | 'notch' | 'allpass' | 'cut'
export interface BiquadSpec { kind: BiquadKind; frequency: number; q: number; gain?: number }
export interface Coefficients { b0: number; b1: number; b2: number; a1: number; a2: number }
/** 增益 0 dB 的峰值段：系数恰好是直通（b0 = 1，b1 = a1，b2 = a2），状态为零时输出与输入逐样本相同。用于关掉的段，保持段数不变。 */
export const BIQUAD_BYPASS: BiquadSpec = { kind: 'peaking', frequency: 1000, q: 1, gain: 0 }
/** 四阶巴特沃斯拆成两个二阶段的 Q。 */
export const BUTTERWORTH_4 = [0.5411961, 1.3065630]
export function audioBiquadCoefficients(spec: BiquadSpec, rate: number): Coefficients {
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
      case 'allpass': b0 = 1 - alpha; b1 = -2 * cos; b2 = 1 + alpha; break
      case 'cut': { const depth = A * A; b0 = depth * a0 + (1 - depth); b1 = a1; b2 = depth * a2 + (1 - depth); break }
      default: b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a2 = 1 - alpha / A
    }
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 }
}
/** 一个双二阶段处理一个样本；`state` 从 `offset` 起存两个状态（第一个状态归零后，第二个在下一个样本也归零）。 */
export function biquadSample(c: Coefficients, state: Float64Array, offset: number, x: number): number {
  const y = c.b0 * x + state[offset]
  const z1 = c.b1 * x - c.a1 * y + state[offset + 1]
  state[offset] = z1 > -1e-30 && z1 < 1e-30 ? 0 : z1; state[offset + 1] = c.b2 * x - c.a2 * y
  return y
}
/** 一个双二阶段处理一整块（与逐样本调用 `biquadSample` 的结果逐样本相同）；`output` 可以就是 `input`（原地）。 */
export function biquadBlock(c: Coefficients, state: Float64Array, offset: number, input: ArrayLike<number>, output: Float64Array | Float32Array, length: number): void {
  const { b0, b1, b2, a1, a2 } = c
  let z1 = state[offset]; let z2 = state[offset + 1]
  for (let index = 0; index < length; index++) {
    const x = input[index]; const y = b0 * x + z1
    z1 = b1 * x - a1 * y + z2; z2 = b2 * x - a2 * y
    if (z1 > -1e-30 && z1 < 1e-30) z1 = 0
    output[index] = y
  }
  state[offset] = z1; state[offset + 1] = z2
}
/** 两个系数是否相同（参数没变时不重算三角函数）。 */
export const sameBiquadSpec = (a: BiquadSpec | undefined, b: BiquadSpec): boolean => !!a && a.kind === b.kind && a.frequency === b.frequency && a.q === b.q && (a.gain ?? 0) === (b.gain ?? 0)

// —— 压缩曲线（压缩器与多段压缩器共用） ——
/** 压缩量 0–100 → 阈值、比率与自动补偿：0 不压缩；40 ≈ 阈值 -16 dB、比率 3.8:1；100 ≈ 阈值 -40 dB、比率 8:1。 */
export function audioCompressorCurve(amount: number): { threshold: number; ratio: number; makeup: number } {
  const threshold = -0.4 * amount; const ratio = 1 + 0.07 * amount
  return { threshold, ratio, makeup: -threshold * (1 - 1 / ratio) / 2 }
}
/** 静态压缩曲线（6 dB 软拐点）：输入电平 `level` dBFS 对应的增益变化（dB，≤ 0）。 */
export function audioCompressorReduction(level: number, threshold: number, ratio: number): number {
  const knee = 6; const over = level - threshold
  if (2 * over < -knee) return 0
  if (2 * Math.abs(over) <= knee) return (1 / ratio - 1) * (over + knee / 2) ** 2 / (2 * knee)
  return over / ratio - over
}

// —— 延迟缓冲 ——
/** 单声道环形延迟缓冲（双精度）：`write` 推入一个样本；`at(d)` 读 d 次写入之前的值（0 为最近一次写入）。 */
export class DelayBuffer {
  private readonly data: Float64Array
  private readonly mask: number
  private cursor = 0
  constructor(capacity: number) {
    let size = 4
    while (size < capacity + 4) size *= 2
    this.data = new Float64Array(size); this.mask = size - 1
  }
  write(value: number): void { this.data[this.cursor] = value; this.cursor = (this.cursor + 1) & this.mask }
  at(delay: number): number { return this.data[(this.cursor - 1 - delay) & this.mask] }
  /** 小数延迟，线性插值；整数延迟时直接取样（逐样本原样）。 */
  linear(delay: number): number {
    const whole = Math.floor(delay); const fraction = delay - whole
    const current = this.at(whole)
    return fraction === 0 ? current : current + (this.at(whole + 1) - current) * fraction
  }
  /** 小数延迟，四点三次埃尔米特插值（调制类效果一直在变延迟，比线性插值少损失高频）；`delay` 至少为 1。 */
  hermite(delay: number): number {
    const whole = Math.floor(delay); const t = delay - whole
    const y0 = this.at(whole - 1); const y1 = this.at(whole); const y2 = this.at(whole + 1); const y3 = this.at(whole + 2)
    const c1 = 0.5 * (y2 - y0); const c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3; const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2)
    return ((c3 * t + c2) * t + c1) * t + y1
  }
}

/**
 * 逐样本平滑的参数：参数改变时以约 `seconds` 的时间常数滑向新值（拖动增益、混合量、调制深度不爆音；延迟时间像磁带变速，
 * 不跳读指针），与目标相差小于 `tolerance` 时吸附到目标（停下后就是精确的目标值，中性参数仍逐样本原样）。第一次设置直接到位。
 */
export class SmoothedValue {
  private current = Number.NaN
  private target = 0
  private readonly keep: number
  constructor(rate: number, seconds = 0.02, private readonly tolerance = 1e-6) { this.keep = smoothing(seconds, rate) }
  set(value: number): void { this.target = value; if (Number.isNaN(this.current)) this.current = value }
  /** 已停在目标上（可以走不平滑的快速路径）。 */
  get settled(): boolean { return this.current === this.target }
  get value(): number { return this.current }
  /** 前进一个样本，返回当前值。 */
  next(): number {
    if (this.current !== this.target) {
      this.current = this.target + (this.current - this.target) * this.keep
      if (Math.abs(this.current - this.target) < this.tolerance) this.current = this.target
    }
    return this.current
  }
}
/** 延迟时间（样本数）的滑动：时间常数 50 毫秒，差 0.001 个样本以内吸附（目标为整样本时读出的就是原样的延迟副本）。 */
export const delayGlide = (rate: number): SmoothedValue => new SmoothedValue(rate, 0.05, 1e-3)

// —— 低频振荡 ——
/**
 * 低频振荡器（调制类效果）：相位 = 频率 × 片段内位置（样本数）/ 采样率，只由位置决定，与分块大小、从哪里开始播放无关；
 * 改频率时在当前位置接上（相位连续，不跳变）。
 */
export class Lfo {
  private position = 0
  private anchor = 0
  private anchorCycles = 0
  private frequency = 0
  constructor(private readonly rate: number) {}
  setFrequency(hertz: number): void {
    if (hertz === this.frequency) return
    this.anchorCycles = this.cycles(); this.anchor = this.position; this.frequency = hertz
  }
  /** 对齐到片段内位置：相位按“从片段开头一直以当前频率振荡”计算。 */
  locate(sample: number): void { this.position = sample; this.anchor = 0; this.anchorCycles = 0 }
  private cycles(ahead = 0): number { return this.anchorCycles + this.frequency * (this.position + ahead - this.anchor) / this.rate }
  /** 当前样本之后第 `ahead` 个样本的相位（0–1 的周期小数），`offset` 为额外的相位偏移（周期数）。 */
  phase(offset = 0, ahead = 0): number { const cycles = this.cycles(ahead) + offset; return cycles - Math.floor(cycles) }
  /** 当前位置在长 `size` 的分段里的序号（分段按片段内位置对齐，与分块、定位无关）。 */
  segmentIndex(size: number): number { return ((this.position % size) + size) % size }
  advance(): void { this.position++ }
}

/**
 * 按片段内位置分段计算调制量：每 `LFO_SEGMENT` 个样本精确算一次（三角函数、指数），段内线性插值。
 * 低频振荡在 16 个样本（48 kHz 下 0.33 毫秒）里几乎是直线，听感与逐样本计算相同，运算量少一个数量级；分段只由位置决定，结果与分块、定位无关。
 */
export const LFO_SEGMENT = 16
/**
 * 一组调制量的分段两端：处理器在分段开头（`Lfo.segmentIndex(LFO_SEGMENT)` 为 0）或 `valid` 为 false（参数、位置刚变）时
 * 重算两端——分段起点相对当前样本偏移 -index、终点偏移 LFO_SEGMENT - index——再用 `at` 取段内插值。
 */
export class LfoSegments {
  readonly start: Float64Array
  readonly end: Float64Array
  valid = false
  constructor(count: number) { this.start = new Float64Array(count); this.end = new Float64Array(count) }
  at(slot: number, index: number): number { return this.start[slot] + (this.end[slot] - this.start[slot]) * index / LFO_SEGMENT }
}
