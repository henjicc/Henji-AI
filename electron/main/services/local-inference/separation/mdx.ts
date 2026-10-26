import { RealFft } from './fft'
import type { AudioSeparationMode } from './protocol'

/*
 * MDX-Net 推理的前后处理（照 UVR 5.6 的 SeperateMDX.demix / run_model 与 lib_v5 的 STFT 类实现）：
 *
 * - 频谱：torch.stft(center=True, 反射补边, 周期 Hann 窗) 取前 dim_f 个频点，实虚部拼成
 *   [1, 4, dim_f, dim_t]（左实、左虚、右实、右虚，时间维最快），前 3 个频点置零；
 *   模型输出同形状的谱，补零到 n_fft/2+1 个频点后 torch.istft(center=True) 还原，乘 compensate。
 * - 分块：块长 chunk = hop·(dim_t−1)（正好 dim_t 帧），整段前补 n_fft/2 个零、后补到块的整数倍，
 *   步长 chunk − n_fft（UVR 默认重叠）；每块输出乘 np.hanning(块长)，按窗权重归一化后拼接，再去掉前补的部分。
 *   相邻两块只重叠 n_fft 个样本，所以逐块算完就能交付前一段，不用整段频谱常驻。
 * - 声道：每两路一组送进模型；单声道（或多声道的最后一路）复制成立体声，输出取两路平均。
 */

export const MDX_SAMPLE_RATE = 44_100

export interface MdxNetParameters {
  nFft: number
  hop: number
  dimF: number
  dimT: number
  /** UVR model_data 的 compensate：模型输出整体乘这个系数。 */
  compensate: number
}

export interface MdxSeparationModel extends MdxNetParameters {
  /** 模型直接预测的分量：主分量（人声）还是残差（混响）；另一个由原声减出。 */
  predicts: 'primary' | 'residual'
}

/**
 * 参数取自 UVR model_data.json（按模型文件末尾 10 MB 的 MD5 查找）：
 * Kim_Vocal_2 970b3f9492014d18fefeedfe4773cb42、Reverb_HQ_By_FoxJoy cd5b2989ad863f116c855db1dfe24e39。
 * dim_t 在 UVR 里写成 2 的指数（8、9）。
 */
export const MDX_SEPARATION_MODELS: Readonly<Record<AudioSeparationMode, MdxSeparationModel>> = {
  vocals: { nFft: 7680, hop: 1024, dimF: 3072, dimT: 256, compensate: 1.009, predicts: 'primary' },
  dereverb: { nFft: 6144, hop: 1024, dimF: 3072, dimT: 512, compensate: 1.035, predicts: 'residual' },
}

/** UVR 把输入谱前 3 个频点（< 17 Hz）置零。 */
const ZEROED_BINS = 3

/** np.hanning：对称 Hann 窗，两端为 0；长度 1 时为 [1]。 */
export function symmetricHann(length: number): Float64Array {
  const window = new Float64Array(length)
  if (length === 1) { window[0] = 1; return window }
  for (let index = 0; index < length; index++) window[index] = 0.5 - 0.5 * Math.cos(2 * Math.PI * index / (length - 1))
  return window
}

/** 一块双声道波形与模型谱之间的互相转换；实例带工作缓冲，逐块复用。 */
export class MdxStft {
  readonly chunkSize: number
  /** 模型输入 / 输出张量的元素数：4 × dim_f × dim_t。 */
  readonly specLength: number
  private readonly fft: RealFft
  private readonly window: Float64Array
  /** 保留区间 [n_fft/2, n_fft/2 + chunk) 上窗平方和的倒数（torch.istft 的包络归一化）。 */
  private readonly inverseEnvelope: Float64Array
  private readonly padded: Float64Array
  private readonly frame: Float64Array
  private readonly re: Float64Array
  private readonly im: Float64Array
  private readonly synthRe: Float64Array
  private readonly synthIm: Float64Array
  private readonly overlap: Float64Array

  /** `zeroedBins` 只给单测改成 0（核对纯 STFT 往返）；推理一律按 UVR 清零前 3 个频点。 */
  constructor(private readonly params: MdxNetParameters, private readonly zeroedBins = ZEROED_BINS) {
    const { nFft, hop, dimF, dimT } = params
    if (nFft % 2 || dimF > nFft / 2 + 1 || dimF <= zeroedBins || dimT < 2) throw new Error('MDX-Net 参数无效。')
    this.chunkSize = hop * (dimT - 1)
    if (this.chunkSize <= nFft / 2) throw new Error('MDX-Net 块长必须大于半个 n_fft。')
    this.specLength = 4 * dimF * dimT
    this.fft = new RealFft(nFft)
    this.window = Float64Array.from({ length: nFft }, (_, index) => 0.5 - 0.5 * Math.cos(2 * Math.PI * index / nFft))
    const bins = nFft / 2 + 1
    this.re = new Float64Array(bins); this.im = new Float64Array(bins)
    this.synthRe = new Float64Array(bins); this.synthIm = new Float64Array(bins)
    this.padded = new Float64Array(this.chunkSize + nFft)
    this.frame = new Float64Array(nFft)
    this.overlap = new Float64Array(this.chunkSize + nFft)
    const envelope = new Float64Array(this.chunkSize + nFft)
    for (let t = 0; t < dimT; t++) for (let n = 0; n < nFft; n++) envelope[t * hop + n] += this.window[n] * this.window[n]
    this.inverseEnvelope = Float64Array.from({ length: this.chunkSize }, (_, index) => 1 / envelope[index + nFft / 2])
  }

  /** 一块双声道波形（各 chunkSize 个样本）→ 模型输入谱。 */
  analyze(left: Float64Array, right: Float64Array, out: Float32Array): void {
    const { nFft, hop, dimF, dimT } = this.params
    const half = nFft / 2, length = this.chunkSize, plane = dimF * dimT
    const { padded, frame, window, re, im } = this
    for (const [channel, samples] of [left, right].entries()) {
      padded.set(samples, half)
      // 反射补边（不重复端点），与 torch.stft 的 pad_mode='reflect' 一致。
      for (let index = 0; index < half; index++) { padded[index] = samples[half - index]; padded[half + length + index] = samples[length - 2 - index] }
      const reBase = 2 * channel * plane, imBase = reBase + plane
      for (let t = 0; t < dimT; t++) {
        const origin = t * hop
        for (let n = 0; n < nFft; n++) frame[n] = padded[origin + n] * window[n]
        this.fft.forward(frame, re, im)
        for (let f = 0; f < this.zeroedBins; f++) { out[reBase + f * dimT + t] = 0; out[imBase + f * dimT + t] = 0 }
        for (let f = this.zeroedBins; f < dimF; f++) { out[reBase + f * dimT + t] = re[f]; out[imBase + f * dimT + t] = im[f] }
      }
    }
  }

  /** 模型输出谱 → 一块双声道波形（各 chunkSize 个样本，未乘 compensate）。 */
  synthesize(spec: Float32Array, left: Float64Array, right: Float64Array): void {
    const { nFft, hop, dimF, dimT } = this.params
    const half = nFft / 2, plane = dimF * dimT
    const { frame, window, overlap, synthRe: re, synthIm: im, inverseEnvelope } = this
    for (const [channel, out] of [left, right].entries()) {
      overlap.fill(0)
      const reBase = 2 * channel * plane, imBase = reBase + plane
      for (let t = 0; t < dimT; t++) {
        // dim_f 以上的频点保持为零（构造时清零，之后只写前 dim_f 个）。
        for (let f = 0; f < dimF; f++) { re[f] = spec[reBase + f * dimT + t]; im[f] = spec[imBase + f * dimT + t] }
        this.fft.inverse(re, im, frame)
        const origin = t * hop
        for (let n = 0; n < nFft; n++) overlap[origin + n] += frame[n] * window[n]
      }
      for (let index = 0; index < this.chunkSize; index++) out[index] = overlap[index + half] * inverseEnvelope[index]
    }
  }
}

export interface MdxChunkPlan {
  /** 输入样本数（44.1 kHz）。 */
  length: number
  /** 整段前补的零（n_fft/2）。 */
  trim: number
  chunkSize: number
  step: number
  /** 补零后的总长。 */
  mixtureLength: number
  /** 起点落在输出范围内的块数（每组声道各推理一次）。 */
  count: number
}

export function mdxChunkPlan(length: number, params: MdxNetParameters): MdxChunkPlan {
  if (!Number.isInteger(length) || length < 1) throw new Error('声音为空。')
  const trim = params.nFft / 2
  const chunkSize = params.hop * (params.dimT - 1)
  const generated = chunkSize - 2 * trim
  const pad = generated + trim - (length % generated)
  const mixtureLength = trim + length + pad
  const step = chunkSize - params.nFft
  // UVR 按 range(0, 补零后总长, 步长) 取块，最后一块常常整个落在补零区（只影响被裁掉的尾部），这里不推理它。
  return { length, trim, chunkSize, step, mixtureLength, count: Math.ceil((trim + length) / step) }
}

/** 声道分组：每两路一组，落单的一路单独成组（推理时复制成立体声）。 */
export function mdxChannelGroups(channels: number): number[][] {
  const groups: number[][] = []
  for (let first = 0; first < channels; first += 2) groups.push(first + 1 < channels ? [first, first + 1] : [first])
  return groups
}

export interface MdxSeparationOptions {
  /** 44.1 kHz，各声道等长。 */
  channels: readonly Float32Array[]
  params: MdxNetParameters
  /** 推理一块：输入谱（形状 [1, 4, dim_f, dim_t]，缓冲会被下一块复用），返回同形状的预测谱。 */
  infer(spec: Float32Array): Promise<Float32Array>
  /** 按时间顺序交付模型预测的分量（已乘 compensate）：每声道一段，offset 是这段的起始样本。 */
  emit(block: Float32Array[], offset: number): Promise<void> | void
  signal?: AbortSignal
  progress?(done: number, total: number): void
}

/** 分块推理整段声音（流式：每块算完交付已定稿的一段，内存只留一块的累加缓冲）。 */
export async function separateMdx(options: MdxSeparationOptions): Promise<void> {
  const { channels, params } = options
  if (!channels.length) throw new Error('声音没有声道。')
  const length = channels[0].length
  if (channels.some(channel => channel.length !== length)) throw new Error('各声道长度不一致。')
  const plan = mdxChunkPlan(length, params)
  const { trim, chunkSize, step, mixtureLength, count } = plan
  const stft = new MdxStft(params)
  const groups = mdxChannelGroups(channels.length)
  const total = count * groups.length
  const accumulated = channels.map(() => new Float64Array(chunkSize))
  const divider = new Float64Array(chunkSize)
  const fullWindow = symmetricHann(chunkSize)
  const left = new Float64Array(chunkSize), right = new Float64Array(chunkSize)
  const outLeft = new Float64Array(chunkSize), outRight = new Float64Array(chunkSize)
  const spec = new Float32Array(stft.specLength)
  /** 补零后整段的第 position 个样本落在原声的哪里（前补 trim 个零，原声之后全是零）。 */
  const fill = (target: Float64Array, source: Float32Array, start: number): void => {
    for (let index = 0; index < chunkSize; index++) {
      const at = start + index - trim
      target[index] = at >= 0 && at < length ? source[at] : 0
    }
  }
  let done = 0
  for (let chunk = 0; chunk < count; chunk++) {
    const start = chunk * step
    const actual = Math.min(chunkSize, mixtureLength - start)
    const window = actual === chunkSize ? fullWindow : symmetricHann(actual)
    for (const group of groups) {
      options.signal?.throwIfAborted()
      fill(left, channels[group[0]], start)
      fill(right, channels[group[1] ?? group[0]], start)
      stft.analyze(left, right, spec)
      const predicted = await options.infer(spec)
      if (predicted.length !== stft.specLength) throw new Error('分离模型输出形状不符。')
      stft.synthesize(predicted, outLeft, outRight)
      if (group.length === 2) {
        const a = accumulated[group[0]], b = accumulated[group[1]]
        for (let index = 0; index < actual; index++) { a[index] += outLeft[index] * window[index]; b[index] += outRight[index] * window[index] }
      } else {
        const a = accumulated[group[0]]
        for (let index = 0; index < actual; index++) a[index] += 0.5 * (outLeft[index] + outRight[index]) * window[index]
      }
      options.progress?.(++done, total)
    }
    for (let index = 0; index < actual; index++) divider[index] += window[index]
    // 下一块从 start + step 开始，之前的部分不会再有贡献，可以定稿交付。
    const settled = chunk === count - 1 ? actual : step
    const from = Math.max(start, trim), to = Math.min(start + settled, trim + length)
    if (to > from) {
      const block = accumulated.map((values) => {
        const out = new Float32Array(to - from)
        for (let index = 0; index < out.length; index++) {
          const at = from - start + index
          out[index] = divider[at] > 0 ? values[at] / divider[at] * params.compensate : 0
        }
        return out
      })
      await options.emit(block, from - trim)
    }
    for (const values of [...accumulated, divider]) { values.copyWithin(0, step); values.fill(0, chunkSize - step) }
  }
}
