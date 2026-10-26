import type { VideoEditBuiltinParams } from '../../../videoEdit/builtinEffects'
import { audioBiquadCoefficients, BIQUAD_BYPASS, BUTTERWORTH_4, dbToGain, sameBiquadSpec, SmoothedValue, type AudioProcessor, type BiquadSpec, type Coefficients } from './shared'

/**
 * 滤波与均衡类效果：都是一串双二阶段（RBJ）加可选的输出增益，由 `FilterCascade` 统一处理；各效果只描述段的设计。
 * - 段数不随参数变（关掉的段用直通系数 `BIQUAD_BYPASS` 占位），拖动参数、开关高低通都不清状态、不爆音；
 *   段数确实变了（参数均衡换预设）才清空状态。
 * - 直通段在状态为零时跳过（输出本来就与输入逐样本相同），中性参数下整条链原样输出、不经滤波。
 * - 状态衰减到 1e-30 以下归零（见 `flushDenormal`），静音里不落进非规格化浮点数，关掉的段也能回到零状态被跳过。
 */
export class FilterCascade implements AudioProcessor {
  readonly latency = 0
  private specs: BiquadSpec[] = []
  private coefficients: Coefficients[] = []
  private state: Float64Array[] = []
  /** 输出增益（线性，逐样本平滑）；没有输出增益参数的效果恒为 1。 */
  private readonly gain: SmoothedValue
  constructor(private readonly rate: number, private readonly channels: number, private readonly design: (params: VideoEditBuiltinParams, rate: number) => BiquadSpec[], private readonly output?: (params: VideoEditBuiltinParams) => number) {
    this.gain = new SmoothedValue(rate)
  }
  update(params: VideoEditBuiltinParams): void {
    const specs = this.design(params, this.rate)
    // 只重算变了的段（关键帧逐样本更新参数时，大部分段不变）。
    const next = specs.map((spec, index) => sameBiquadSpec(this.specs[index], spec) ? this.coefficients[index] : audioBiquadCoefficients(spec, this.rate))
    // 滤波器个数变了（换预设、换坡度）才清空状态；只改增益或频率时保留状态，拖动参数不爆音。
    if (next.length !== this.coefficients.length) this.state = Array.from({ length: this.channels }, () => new Float64Array(next.length * 2))
    this.specs = specs; this.coefficients = next
    this.gain.set(this.output ? dbToGain(this.output(params)) : 1)
  }
  process(channels: Float32Array[], length: number): void {
    for (let channel = 0; channel < channels.length; channel++) {
      const data = channels[channel]; const state = this.state[channel]
      for (let stage = 0; stage < this.coefficients.length; stage++) {
        const { b0, b1, b2, a1, a2 } = this.coefficients[stage]
        let z1 = state[stage * 2]; let z2 = state[stage * 2 + 1]
        // 直通段且状态为零：处理结果就是输入本身（b0 = 1、b1 = a1、b2 = a2 时状态保持为零），跳过不算。
        if (b0 === 1 && b1 === a1 && b2 === a2 && z1 === 0 && z2 === 0) continue
        for (let index = 0; index < length; index++) {
          const x = data[index]; const y = b0 * x + z1
          z1 = b1 * x - a1 * y + z2; z2 = b2 * x - a2 * y
          if (z1 > -1e-30 && z1 < 1e-30) z1 = 0
          data[index] = y
        }
        state[stage * 2] = z1; state[stage * 2 + 1] = z2
      }
    }
    const gain = this.gain
    if (gain.settled) {
      const value = gain.value
      if (value !== 1) for (const data of channels) for (let index = 0; index < length; index++) data[index] *= value
    } else {
      for (let index = 0; index < length; index++) { const value = gain.next(); for (const data of channels) data[index] *= value }
    }
  }
}

/** 图形均衡器的 10 个倍频程频段（参数键 → 中心频率）。 */
export const GRAPHIC_EQ_BANDS: ReadonlyArray<readonly [string, number]> = [['band_31', 31.25], ['band_63', 62.5], ['band_125', 125], ['band_250', 250], ['band_500', 500], ['band_1k', 1000], ['band_2k', 2000], ['band_4k', 4000], ['band_8k', 8000], ['band_16k', 16000]]
/** 每段一个倍频程宽的峰值滤波器（Q = √2）。 */
export const graphicEqDesign = (params: VideoEditBuiltinParams): BiquadSpec[] => GRAPHIC_EQ_BANDS.map(([key, frequency]) => ({ kind: 'peaking', frequency, q: Math.SQRT2, gain: params[key] as number }))

/** 参数均衡器的“窄度”0–100 → Q 0.3–8（平方曲线：30 ≈ Q 1，50 ≈ Q 2.2，100 = Q 8）。 */
export const eqBandQ = (narrowness: number): number => 0.3 + 7.7 * (narrowness / 100) ** 2
/** 参数均衡器：高通、低频搁架、三个峰值段、高频搁架、低通，固定 7 段（关掉的高低通为直通段）。 */
export function eqBandsDesign(params: VideoEditBuiltinParams): BiquadSpec[] {
  const band = (index: number): BiquadSpec => ({ kind: 'peaking', frequency: params[`band${index}_frequency`] as number, q: eqBandQ(params[`band${index}_q`] as number), gain: params[`band${index}_gain`] as number })
  return [
    params.hp_on ? { kind: 'highpass', frequency: params.hp_frequency as number, q: Math.SQRT1_2 } : BIQUAD_BYPASS,
    { kind: 'lowshelf', frequency: params.low_frequency as number, q: 1, gain: params.low_gain as number },
    band(1), band(2), band(3),
    { kind: 'highshelf', frequency: params.high_frequency as number, q: 1, gain: params.high_gain as number },
    params.lp_on ? { kind: 'lowpass', frequency: params.lp_frequency as number, q: Math.SQRT1_2 } : BIQUAD_BYPASS,
  ]
}

/** 陷波的“宽度”0–100 → Q 30–1（对数插值：50 ≈ Q 5.5）。-3 dB 处带宽 ≈ 频率 / Q。 */
export const notchQ = (width: number): number => 30 * (1 / 30) ** (width / 100)
/** 陷波：有限深度的陷波段（`cut`，中心衰减 = 深度），一个倍频程外几乎不受影响。 */
export const notchDesign = (params: VideoEditBuiltinParams): BiquadSpec[] => [{ kind: 'cut', frequency: params.frequency as number, q: notchQ(params.width as number), gain: params.depth as number }]

/** 去嗡声最多处理的谐波数（含基频）。 */
export const DEHUM_MAX_HARMONICS = 10
/** 去嗡声的“强度”0–100 → 每个陷波的深度（dB）与 Q：强度越大越深、略宽（容得下电源频率的小漂移）。 */
export const dehumNotch = (amount: number): { depth: number; q: number } => ({ depth: -0.6 * amount, q: 30 - 20 * amount / 100 })
/** 去嗡声：30 Hz 四阶高通（直流与次低频）+ 基频及倍频的陷波，固定 2 + 10 段（多出的谐波为直通段）。 */
export function dehumDesign(params: VideoEditBuiltinParams): BiquadSpec[] {
  const fundamental = Number(params.mains); const harmonics = Math.round(params.harmonics as number)
  const { depth, q } = dehumNotch(params.amount as number)
  return [
    ...BUTTERWORTH_4.map((stageQ): BiquadSpec => ({ kind: 'highpass', frequency: 30, q: stageQ })),
    ...Array.from({ length: DEHUM_MAX_HARMONICS }, (_, index): BiquadSpec => index < harmonics ? { kind: 'cut', frequency: fundamental * (index + 1), q, gain: depth } : BIQUAD_BYPASS),
  ]
}
