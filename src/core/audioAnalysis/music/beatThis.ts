import { videoEditFft } from '../../videoEdit/fft'

/*
 * Beat This!（CPJKU，ISMIR 2024，代码与权重均为 MIT）的宿主侧前后处理，与 musetric/beat-this-onnx 的 config.json 逐项一致：
 * 22050 Hz、声道算术平均；STFT n_fft 1024、hop 441、周期 Hann、center=True 反射补边；幅度除以 sqrt(n_fft)
 * （torchaudio normalized='frame_length'）；投影到官方梅尔滤波器组 [513,128]；log1p(1000·x)。
 * 网络每次只吃一个 1500 帧窗口，长曲按 split_piece / aggregate_prediction(keep_first) 切分与拼回，
 * 再按官方 minimal 后处理取峰（±3 帧最大值、logit>0、相邻帧去重、下拍吸附到最近的拍）。
 * 同一遍 STFT 顺带算每帧色度（12 维），供结构分析使用，避免二次变换。
 */

export const BEAT_THIS_SAMPLE_RATE = 22050
export const BEAT_THIS_FPS = 50
export const BEAT_THIS_N_FFT = 1024
export const BEAT_THIS_HOP = 441
export const BEAT_THIS_MELS = 128
export const BEAT_THIS_CHUNK = 1500
export const BEAT_THIS_BORDER = 6
const BINS = BEAT_THIS_N_FFT / 2 + 1
const CHROMA_MIN_HZ = 55
const CHROMA_MAX_HZ = 5000

export interface MusicSpectrogram {
  frames: number
  /** frames × 128，Beat This 输入（log1p(1000·mel)）。 */
  mel: Float32Array
  /** frames × 12，每帧色度（未归一化幅度和）。 */
  chroma: Float32Array
}

/** 声道算术平均（参考实现 Audio2Frames；FFmpeg -ac 1 是能量保持的重混，会响 √2 倍，不能代替）。 */
export function meanDownmix(channels: readonly Float32Array[]): Float32Array {
  if (!channels.length) throw new Error('声音没有声道。')
  if (channels.length === 1) return channels[0]
  const out = new Float32Array(channels[0].length)
  for (const channel of channels) for (let i = 0; i < out.length; i++) out[i] += channel[i]
  for (let i = 0; i < out.length; i++) out[i] /= channels.length
  return out
}

/** 每个 STFT 频点对应的音级（-1 表示不计入色度）。 */
function chromaBins(): Int8Array {
  const classes = new Int8Array(BINS).fill(-1)
  for (let bin = 1; bin < BINS; bin++) {
    const hz = bin * BEAT_THIS_SAMPLE_RATE / BEAT_THIS_N_FFT
    if (hz < CHROMA_MIN_HZ || hz > CHROMA_MAX_HZ) continue
    classes[bin] = ((Math.round(12 * Math.log2(hz / 440)) + 69) % 12 + 12) % 12
  }
  return classes
}

/** 单声道 22050 Hz PCM → Beat This 对数梅尔谱 + 每帧色度。帧数 = 1 + floor(样本数 / 441)。 */
export function beatThisSpectrogram(mono: Float32Array, filterbank: Float32Array): MusicSpectrogram {
  if (filterbank.length !== BINS * BEAT_THIS_MELS) throw new Error('梅尔滤波器组尺寸不符。')
  if (!mono.length) throw new Error('声音为空。')
  const frames = 1 + Math.floor(mono.length / BEAT_THIS_HOP)
  const half = BEAT_THIS_N_FFT / 2
  const window = Float64Array.from({ length: BEAT_THIS_N_FFT }, (_, n) => 0.5 - 0.5 * Math.cos(2 * Math.PI * n / BEAT_THIS_N_FFT))
  const scale = 1 / Math.sqrt(BEAT_THIS_N_FFT)
  const real = new Float64Array(BEAT_THIS_N_FFT), imaginary = new Float64Array(BEAT_THIS_N_FFT), magnitude = new Float64Array(BINS)
  const mel = new Float32Array(frames * BEAT_THIS_MELS), chroma = new Float32Array(frames * 12)
  const classes = chromaBins()
  // 三角滤波器组每个频点最多落在两个梅尔带里，只保留非零项（与稠密矩阵乘法结果相同，快约 60 倍）。
  const sparse = { bins: [] as number[], mels: [] as number[], weights: [] as number[] }
  for (let bin = 0; bin < BINS; bin++) for (let m = 0; m < BEAT_THIS_MELS; m++) {
    const weight = filterbank[bin * BEAT_THIS_MELS + m]
    if (weight !== 0) { sparse.bins.push(bin); sparse.mels.push(m); sparse.weights.push(weight) }
  }
  const last = mono.length - 1
  // torch.stft(center=True, pad_mode='reflect')：越界下标按反射取（不重复端点）。
  const sample = (index: number): number => {
    if (last === 0) return mono[0]
    let i = index
    while (i < 0 || i > last) i = i < 0 ? -i : 2 * last - i
    return mono[i]
  }
  for (let frame = 0; frame < frames; frame++) {
    const origin = frame * BEAT_THIS_HOP - half
    for (let n = 0; n < BEAT_THIS_N_FFT; n++) { real[n] = sample(origin + n) * window[n]; imaginary[n] = 0 }
    videoEditFft(real, imaginary, -1)
    for (let bin = 0; bin < BINS; bin++) {
      magnitude[bin] = Math.hypot(real[bin], imaginary[bin]) * scale
      const pc = classes[bin]
      if (pc >= 0) chroma[frame * 12 + pc] += magnitude[bin]
    }
    const row = frame * BEAT_THIS_MELS
    for (let k = 0; k < sparse.bins.length; k++) mel[row + sparse.mels[k]] += magnitude[sparse.bins[k]] * sparse.weights[k]
    for (let m = 0; m < BEAT_THIS_MELS; m++) mel[row + m] = Math.log1p(1000 * mel[row + m])
  }
  return { frames, mel, chroma }
}

/** split_piece(avoid_short_end=True)：每个窗口的起始帧（可为负，负数部分补零）。 */
export function beatThisChunkStarts(frames: number, chunk = BEAT_THIS_CHUNK, border = BEAT_THIS_BORDER): number[] {
  const step = chunk - 2 * border
  const starts: number[] = []
  for (let start = -border; start < frames - border; start += step) starts.push(start)
  if (frames > step) starts[starts.length - 1] = frames - (chunk - border)
  return starts
}

/** 取一个窗口的输入（固定 1500 帧，越界与不足的部分补零，与参考实现的 zeropad 一致）。 */
export function beatThisWindow(spectrogram: MusicSpectrogram, start: number, chunk = BEAT_THIS_CHUNK): Float32Array {
  const window = new Float32Array(chunk * BEAT_THIS_MELS)
  const from = Math.max(0, start), to = Math.min(spectrogram.frames, start + chunk)
  if (to > from) window.set(spectrogram.mel.subarray(from * BEAT_THIS_MELS, to * BEAT_THIS_MELS), (from - start) * BEAT_THIS_MELS)
  return window
}

/** aggregate_prediction(keep_first)：去掉每个窗口两侧边界后拼回整曲，前面的窗口覆盖后面的重叠部分。 */
export function aggregateBeatThis(frames: number, starts: readonly number[], logits: ReadonlyArray<{ beat: Float32Array; downbeat: Float32Array }>, chunk = BEAT_THIS_CHUNK, border = BEAT_THIS_BORDER): { beat: Float32Array; downbeat: Float32Array } {
  const beat = new Float32Array(frames).fill(-1000), downbeat = new Float32Array(frames).fill(-1000)
  for (let index = starts.length - 1; index >= 0; index--) {
    const start = starts[index], prediction = logits[index]
    for (let k = border; k < chunk - border; k++) {
      const frame = start + k
      if (frame < 0 || frame >= frames) continue
      beat[frame] = prediction.beat[k]; downbeat[frame] = prediction.downbeat[k]
    }
  }
  return { beat, downbeat }
}

/** deduplicate_peaks：相距不超过 width 帧的一串峰合并为它们的平均位置。 */
function deduplicatePeaks(peaks: readonly number[], width = 1): number[] {
  const result: number[] = []
  if (!peaks.length) return result
  let mean = peaks[0], count = 1
  for (let i = 1; i < peaks.length; i++) {
    const peak = peaks[i]
    // 参考实现比较的是“新峰与当前均值”的距离。
    if (peak - mean <= width) { count++; mean += (peak - mean) / count }
    else { result.push(mean); mean = peak; count = 1 }
  }
  result.push(mean)
  return result
}

function pickPeaks(logits: Float32Array): number[] {
  const peaks: number[] = []
  for (let i = 0; i < logits.length; i++) {
    const value = logits[i]
    if (!(value > 0)) continue
    let max = -Infinity
    for (let j = Math.max(0, i - 3); j <= Math.min(logits.length - 1, i + 3); j++) max = Math.max(max, logits[j])
    if (value === max) peaks.push(i)
  }
  return peaks
}

export interface BeatThisBeats { beats: number[]; downbeats: number[]; beatLogits: number[] }

/** 官方 minimal 后处理：返回拍与下拍的秒数（下拍已吸附到最近的拍并去重），以及每拍处的 beat logit。 */
export function beatThisMinimalPostprocess(beat: Float32Array, downbeat: Float32Array): BeatThisBeats {
  const beatFrames = deduplicatePeaks(pickPeaks(beat))
  const beats = beatFrames.map(frame => frame / BEAT_THIS_FPS)
  const downbeats = [...new Set(deduplicatePeaks(pickPeaks(downbeat)).map(frame => {
    const time = frame / BEAT_THIS_FPS
    let best = beats[0] ?? time
    for (const value of beats) if (Math.abs(value - time) < Math.abs(best - time)) best = value
    return best
  }))].sort((a, b) => a - b)
  return { beats, downbeats, beatLogits: beatFrames.map(frame => beat[Math.round(frame)] ?? 0) }
}
