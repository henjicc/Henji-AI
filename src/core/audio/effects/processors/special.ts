import type { VideoEditBuiltinParams } from '@/core/videoEdit/builtinEffects'
import { audioBiquadCoefficients, biquadSample, dbToGain, flushDenormal, SmoothedValue, type AudioProcessor, type BiquadSpec, type Coefficients } from './shared'

/** 特殊效果：扭曲（波形整形失真）、人声增强（固定均衡曲线，处理由 `FilterCascade` 完成）。 */

// —— 扭曲：前级增益 → 波形整形 → 失真后低通 → 隔直流；输出按“-6 dBFS 峰值的输入整形后仍约 -6 dBFS”补偿，驱动加大时不会越来越响 ——
type Shape = (value: number) => number
/** 电子管：偏置后的 tanh，正负半波不对称，带来偶次谐波（偏置产生的直流由隔直流滤波去掉）。 */
const TUBE_BIAS = 0.25
const SHAPES: Record<string, Shape> = {
  soft: value => Math.tanh(value),
  hard: value => Math.max(-1, Math.min(1, value)),
  tube: value => Math.tanh(value + TUBE_BIAS) - Math.tanh(TUBE_BIAS),
}
/** 隔直流一阶高通的转折频率（Hz）。 */
const DC_BLOCK_HZ = 10
export class Distortion implements AudioProcessor {
  readonly latency = 0
  private shape: Shape = SHAPES.soft
  /** 驱动、补偿与混合量逐样本平滑（拖动驱动时电平与失真量连续变化）。 */
  private readonly drive: SmoothedValue; private readonly makeup: SmoothedValue; private readonly mix: SmoothedValue
  private tone: Coefficients = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 }
  private toneFrequency = 0
  private readonly toneState: Float64Array
  private readonly dcInput: Float64Array; private readonly dcOutput: Float64Array
  private readonly dcKeep: number
  constructor(private readonly rate: number, channels: number) {
    this.drive = new SmoothedValue(rate); this.makeup = new SmoothedValue(rate); this.mix = new SmoothedValue(rate)
    this.toneState = new Float64Array(channels * 2)
    this.dcInput = new Float64Array(channels); this.dcOutput = new Float64Array(channels)
    this.dcKeep = Math.exp(-2 * Math.PI * DC_BLOCK_HZ / rate)
  }
  update(params: VideoEditBuiltinParams): void {
    this.shape = SHAPES[params.character as string] ?? SHAPES.soft
    const drive = dbToGain(params.drive as number)
    this.drive.set(drive)
    this.makeup.set(0.5 / Math.abs(this.shape(drive * 0.5) - this.shape(0)) || 1)
    this.mix.set((params.mix as number) / 100)
    const tone = params.tone as number
    if (tone !== this.toneFrequency) { this.tone = audioBiquadCoefficients({ kind: 'lowpass', frequency: tone, q: Math.SQRT1_2 }, this.rate); this.toneFrequency = tone }
  }
  process(channels: Float32Array[], length: number): void {
    const { shape, dcKeep } = this
    for (let index = 0; index < length; index++) {
      const drive = this.drive.next(); const makeup = this.makeup.next(); const mix = this.mix.next()
      for (let channel = 0; channel < channels.length; channel++) {
        const input = channels[channel][index]
        const shaped = biquadSample(this.tone, this.toneState, channel * 2, shape(input * drive) * makeup)
        // 隔直流：y = x - x₁ + R·y₁。
        const wet = flushDenormal(shaped - this.dcInput[channel] + dcKeep * this.dcOutput[channel])
        this.dcInput[channel] = shaped; this.dcOutput[channel] = wet
        channels[channel][index] = input * (1 - mix) + wet * mix
      }
    }
  }
}

// —— 人声增强：去浑浊（中低频峰值衰减）+ 提升存在感（中高频峰值提升）+ 柔和高频（高频搁架略降），增益乘强度 ——
/** 强度 100 时的三段曲线；强度 0 时三段增益都是 0，声音不变。 */
const VOCAL_CURVES: Record<string, readonly BiquadSpec[]> = {
  low: [{ kind: 'peaking', frequency: 220, q: 1, gain: -5 }, { kind: 'peaking', frequency: 3200, q: 1, gain: 4 }, { kind: 'highshelf', frequency: 9000, q: 1, gain: -2 }],
  high: [{ kind: 'peaking', frequency: 350, q: 1, gain: -3 }, { kind: 'peaking', frequency: 2500, q: 1, gain: 3 }, { kind: 'highshelf', frequency: 7000, q: 1, gain: -4 }],
  music: [{ kind: 'peaking', frequency: 300, q: 0.8, gain: -3 }, { kind: 'peaking', frequency: 2000, q: 0.9, gain: 4 }, { kind: 'highshelf', frequency: 10000, q: 1, gain: -1.5 }],
}
export const vocalEnhancerDesign = (params: VideoEditBuiltinParams): BiquadSpec[] => (VOCAL_CURVES[params.voice as string] ?? VOCAL_CURVES.low).map(spec => ({ ...spec, gain: (spec.gain ?? 0) * (params.amount as number) / 100 }))
