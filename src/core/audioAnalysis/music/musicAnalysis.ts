import { z } from 'zod'
import { BEAT_THIS_FPS, BEAT_THIS_MELS, BEAT_THIS_SAMPLE_RATE, type MusicSpectrogram } from './beatThis'

/*
 * 音乐结构分析结果（音频重构用）：拍与小节位置、每拍特征（色度、音色、响度）、结构段落与适用性。
 * 只依赖拍点时刻与同一遍 STFT 的谱，主进程后台推理进程算一次，按素材内容身份缓存；时刻都是素材源秒数。
 */

export const MUSIC_ANALYSIS_VERSION = 1
/** 每拍音色向量维数（梅尔倒谱 c1..c12）。 */
export const MUSIC_TIMBRE_DIMS = 12
const ONSET_HOP = 64
const ONSET_SEARCH_SECONDS = 0.03

const finite = z.number().finite()
export const musicAnalysisSchema = z.object({
  version: z.literal(MUSIC_ANALYSIS_VERSION),
  durationSeconds: finite.nonnegative(),
  /** beat_this：Beat This! 模型（含下拍）；spectral_flux：模型未下载时的谱通量回退，小节位置按重音估计。 */
  beatSource: z.enum(['beat_this', 'spectral_flux']),
  tempo: finite.nonnegative(),
  beatsPerBar: z.number().int().min(2).max(12),
  /** 拍点（源秒数，已按起音细化）。 */
  beats: z.array(finite.nonnegative()),
  /** 每拍在小节内的位置，0 为下拍；-1 表示所在小节拍数不规整。 */
  barPositions: z.array(z.number().int().min(-1).max(11)),
  /** 每拍色度（beats × 12，单位向量）。 */
  chroma: z.array(finite),
  /** 每拍音色（beats × 12）。 */
  timbre: z.array(finite),
  /** 每拍响度（dBFS）。 */
  loudness: z.array(finite),
  /** 结构段落：起始拍下标与相似段落标签（A、B…）。第一段视为前奏、最后一段视为尾奏。 */
  sections: z.array(z.object({ startBeat: z.number().int().nonnegative(), label: z.string().min(1).max(4) }).strict()),
  /** 节拍稳定度 0–1：相邻拍间隔与局部中位数偏差在 12% 以内的比例。 */
  regularity: finite.min(0).max(1),
  /** 节拍网格覆盖的时长比例 0–1。 */
  coverage: finite.min(0).max(1),
  suitable: z.boolean(),
  /** 不适合重构时给用户看的原因。 */
  unsuitableReason: z.string().max(200).optional(),
}).strict()
export type MusicAnalysis = z.infer<typeof musicAnalysisSchema>

const median = (values: readonly number[]): number => {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length % 2 ? sorted[sorted.length >> 1] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
}
const round = (value: number, digits = 4): number => Math.round(value * 10 ** digits) / 10 ** digits

/** 高频预加重后的对数能量起音包络（约 2.9 ms 一点），用于把 20 ms 网格上的拍点细化到实际起音。 */
function onsetEnvelope(mono: Float32Array): Float32Array {
  const points = Math.floor(mono.length / ONSET_HOP)
  const energy = new Float32Array(points)
  for (let p = 0; p < points; p++) {
    let sum = 0
    const from = p * ONSET_HOP
    for (let i = Math.max(1, from); i < Math.min(mono.length, from + ONSET_HOP * 4); i++) { const d = mono[i] - mono[i - 1]; sum += d * d }
    energy[p] = Math.log(1e-10 + sum)
  }
  const onset = new Float32Array(points)
  for (let p = 2; p < points; p++) onset[p] = Math.max(0, energy[p] - energy[p - 2])
  return onset
}

/** 拍点向 ±30 ms 内最强的起音靠拢；附近没有明显起音（如持续音）时保持模型给出的时刻。 */
export function refineBeatsToOnsets(beats: readonly number[], mono: Float32Array, sampleRate = BEAT_THIS_SAMPLE_RATE): number[] {
  const onset = onsetEnvelope(mono)
  const radius = Math.round(ONSET_SEARCH_SECONDS * sampleRate / ONSET_HOP)
  return beats.map(time => {
    // 包络第 p 点描述 [p·hop, p·hop + 4·hop) 的能量，起音时刻取窗口前缘。
    const center = Math.round(time * sampleRate / ONSET_HOP)
    let best = -1, bestValue = 0, total = 0, count = 0
    for (let p = Math.max(2, center - radius); p <= Math.min(onset.length - 1, center + radius); p++) {
      total += onset[p]; count++
      if (onset[p] > bestValue) { bestValue = onset[p]; best = p }
    }
    if (best < 0 || !count || bestValue < 2.5 * (total / count) || bestValue < 0.7) return time
    return (best + 3) * ONSET_HOP / sampleRate
  })
}

/** 由下拍给每拍编小节位置；拍数为众数整数倍的小节为规整小节，其余小节内的拍标 -1。 */
export function barPositionsFromDownbeats(beats: readonly number[], downbeats: readonly number[]): { beatsPerBar: number; positions: number[] } {
  const isDown = new Set(downbeats.map(time => beats.findIndex(beat => Math.abs(beat - time) < 1e-6)).filter(index => index >= 0))
  const starts = [...isDown].sort((a, b) => a - b)
  const lengths = starts.slice(1).map((start, i) => start - starts[i])
  const counts = new Map<number, number>()
  for (const length of lengths) counts.set(length, (counts.get(length) ?? 0) + 1)
  let beatsPerBar = 4, best = 0
  for (const [length, count] of counts) if (length >= 2 && length <= 12 && count > best) { best = count; beatsPerBar = length }
  const positions = new Array<number>(beats.length).fill(-1)
  if (!starts.length) return { beatsPerBar, positions }
  // 首个下拍之前的弱起按规整小节倒推；最后一个下拍之后同理按规整小节往后数。
  for (let i = 0; i < starts[0]; i++) positions[i] = ((i - starts[0]) % beatsPerBar + beatsPerBar) % beatsPerBar
  for (let s = 0; s < starts.length; s++) {
    const from = starts[s], to = s + 1 < starts.length ? starts[s + 1] : beats.length
    // 漏检一个下拍时小节长度是整数倍，按规整小节继续数；不是整数倍的小节（变拍、错检）不参与跳转。
    const regular = s + 1 >= starts.length || (to - from) % beatsPerBar === 0
    for (let i = from; i < to; i++) positions[i] = regular ? (i - from) % beatsPerBar : -1
  }
  return { beatsPerBar, positions }
}

/** 无下拍信息（谱通量回退）时，取平均起音强度最大的相位作为下拍。 */
export function barPositionsFromAccents(strengths: readonly number[], beatsPerBar = 4): number[] {
  const sums = new Array<number>(beatsPerBar).fill(0), counts = new Array<number>(beatsPerBar).fill(0)
  strengths.forEach((value, i) => { sums[i % beatsPerBar] += value; counts[i % beatsPerBar]++ })
  let phase = 0
  for (let p = 1; p < beatsPerBar; p++) if (sums[p] / Math.max(1, counts[p]) > sums[phase] / Math.max(1, counts[phase])) phase = p
  return strengths.map((_, i) => ((i - phase) % beatsPerBar + beatsPerBar) % beatsPerBar)
}

function dct(values: Float64Array, coefficient: number): number {
  let sum = 0
  for (let m = 0; m < values.length; m++) sum += values[m] * Math.cos(Math.PI * coefficient * (m + 0.5) / values.length)
  return sum
}

interface BeatFeatures { chroma: number[]; timbre: number[]; loudness: number[] }

/** 每拍跨度 [t_i, t_{i+1}) 内的平均色度（归一化）、梅尔倒谱 c1..c12 与 RMS 响度。 */
export function beatFeatures(beats: readonly number[], spectrogram: MusicSpectrogram, mono: Float32Array, durationSeconds: number, sampleRate = BEAT_THIS_SAMPLE_RATE): BeatFeatures {
  const chroma: number[] = [], timbre: number[] = [], loudness: number[] = []
  const typical = median(beats.slice(1).map((beat, i) => beat - beats[i])) || 0.5
  const mel = new Float64Array(BEAT_THIS_MELS)
  for (let i = 0; i < beats.length; i++) {
    const start = beats[i], end = Math.min(durationSeconds, beats[i + 1] ?? start + typical)
    const from = Math.max(0, Math.min(spectrogram.frames - 1, Math.floor(start * BEAT_THIS_FPS)))
    const to = Math.max(from + 1, Math.min(spectrogram.frames, Math.ceil(end * BEAT_THIS_FPS)))
    const pitch = new Float64Array(12); mel.fill(0)
    for (let frame = from; frame < to; frame++) {
      for (let c = 0; c < 12; c++) pitch[c] += spectrogram.chroma[frame * 12 + c]
      for (let m = 0; m < BEAT_THIS_MELS; m++) mel[m] += spectrogram.mel[frame * BEAT_THIS_MELS + m]
    }
    const norm = Math.hypot(...pitch) || 1
    for (let c = 0; c < 12; c++) chroma.push(round(pitch[c] / norm))
    for (let m = 0; m < BEAT_THIS_MELS; m++) mel[m] /= to - from
    for (let c = 1; c <= MUSIC_TIMBRE_DIMS; c++) timbre.push(round(dct(mel, c) / BEAT_THIS_MELS, 5))
    const a = Math.max(0, Math.floor(start * sampleRate)), b = Math.min(mono.length, Math.max(a + 1, Math.floor(end * sampleRate)))
    let sum = 0
    for (let s = a; s < b; s++) sum += mono[s] * mono[s]
    loudness.push(round(10 * Math.log10(1e-10 + sum / Math.max(1, b - a)), 2))
  }
  return { chroma, timbre, loudness }
}

/** 每拍组合特征（色度 + 标准化音色），供自相似与新奇度使用。 */
function combined(features: BeatFeatures, count: number): Float64Array[] {
  const means = new Float64Array(MUSIC_TIMBRE_DIMS), scales = new Float64Array(MUSIC_TIMBRE_DIMS)
  for (let i = 0; i < count; i++) for (let d = 0; d < MUSIC_TIMBRE_DIMS; d++) means[d] += features.timbre[i * MUSIC_TIMBRE_DIMS + d] / count
  for (let i = 0; i < count; i++) for (let d = 0; d < MUSIC_TIMBRE_DIMS; d++) scales[d] += (features.timbre[i * MUSIC_TIMBRE_DIMS + d] - means[d]) ** 2 / count
  return Array.from({ length: count }, (_, i) => {
    const vector = new Float64Array(12 + MUSIC_TIMBRE_DIMS)
    for (let c = 0; c < 12; c++) vector[c] = features.chroma[i * 12 + c]
    for (let d = 0; d < MUSIC_TIMBRE_DIMS; d++) vector[12 + d] = (features.timbre[i * MUSIC_TIMBRE_DIMS + d] - means[d]) / (Math.sqrt(scales[d]) || 1) / Math.sqrt(MUSIC_TIMBRE_DIMS)
    const norm = Math.hypot(...vector) || 1
    return vector.map(value => value / norm)
  })
}

/**
 * Foote（2000）棋盘核新奇度：拍级自相似矩阵上滑动高斯渐隐的棋盘核，峰值即段落边界，吸附到最近的下拍。
 * 段落标签按段均值特征贪心聚类（余弦相似 ≥ 0.9 视为同一类）。
 */
export function musicSections(features: BeatFeatures, positions: readonly number[], beatsPerBar: number): MusicAnalysis['sections'] {
  const count = features.loudness.length
  if (count < beatsPerBar * 8) return [{ startBeat: 0, label: 'A' }]
  const vectors = combined(features, count)
  const half = beatsPerBar * 4
  const novelty = new Float64Array(count)
  for (let i = half; i < count - half; i++) {
    let sum = 0
    for (let a = -half; a < half; a++) for (let b = -half; b < half; b++) {
      const sign = (a < 0) === (b < 0) ? 1 : -1
      const taper = Math.exp(-((a + 0.5) ** 2 + (b + 0.5) ** 2) / (2 * (half / 2) ** 2))
      let dot = 0
      const x = vectors[i + a], y = vectors[i + b]
      for (let d = 0; d < x.length; d++) dot += x[d] * y[d]
      sum += sign * taper * dot
    }
    novelty[i] = Math.max(0, sum)
  }
  const values = [...novelty].filter(value => value > 0)
  const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
  const deviation = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length))
  const boundaries = [0]
  for (let i = half; i < count - half; i++) {
    let peak = true
    for (let j = Math.max(0, i - half); j <= Math.min(count - 1, i + half); j++) if (novelty[j] > novelty[i]) { peak = false; break }
    if (!peak || novelty[i] < mean + 0.5 * deviation) continue
    // 吸附到最近的下拍（±半小节内）。
    let snapped = i
    for (let d = 0; d <= beatsPerBar / 2; d++) {
      if (positions[i - d] === 0) { snapped = i - d; break }
      if (positions[i + d] === 0) { snapped = i + d; break }
    }
    if (snapped - boundaries[boundaries.length - 1] >= beatsPerBar * 4) boundaries.push(snapped)
  }
  const centroids: Float64Array[] = [], labels: string[] = []
  return boundaries.map((startBeat, s) => {
    const end = boundaries[s + 1] ?? count
    const centroid = new Float64Array(vectors[0].length)
    for (let i = startBeat; i < end; i++) vectors[i].forEach((value, d) => { centroid[d] += value })
    const norm = Math.hypot(...centroid) || 1
    centroid.forEach((value, d) => { centroid[d] = value / norm })
    let label = -1
    centroids.forEach((other, index) => { let dot = 0; for (let d = 0; d < other.length; d++) dot += other[d] * centroid[d]; if (label < 0 && dot >= 0.9) label = index })
    if (label < 0) { centroids.push(centroid); label = centroids.length - 1; labels.push(String.fromCharCode(65 + Math.min(25, label))) }
    return { startBeat, label: labels[label] }
  })
}

/** 节拍稳定度与覆盖率：判断是否属于“自由节奏”（rubato、散板、氛围铺底），这类音乐不做重构。 */
export function beatGridQuality(beats: readonly number[], durationSeconds: number): { regularity: number; coverage: number; tempo: number } {
  if (beats.length < 3 || durationSeconds <= 0) return { regularity: 0, coverage: 0, tempo: 0 }
  const intervals = beats.slice(1).map((beat, i) => beat - beats[i])
  let steady = 0
  intervals.forEach((interval, i) => {
    const local = median(intervals.slice(Math.max(0, i - 4), i + 5))
    if (local > 0 && Math.abs(interval / local - 1) <= 0.12) steady++
  })
  const typical = median(intervals)
  // 网格覆盖：拍与拍之间的空档超过两拍的部分不算覆盖。
  let covered = 0
  for (const interval of intervals) covered += Math.min(interval, typical * 2)
  return { regularity: steady / intervals.length, coverage: Math.min(1, covered / durationSeconds), tempo: typical > 0 ? 60 / typical : 0 }
}

export interface BuildMusicAnalysisInput {
  mono: Float32Array
  spectrogram: MusicSpectrogram
  beats: readonly number[]
  /** Beat This 给出下拍；谱通量回退时省略，并提供每拍起音强度。 */
  downbeats?: readonly number[]
  accents?: readonly number[]
  beatSource: MusicAnalysis['beatSource']
  sampleRate?: number
}

export const MUSIC_MIN_BEATS = 16
export const MUSIC_MIN_REGULARITY = 0.75
export const MUSIC_MIN_COVERAGE = 0.5

/** 汇总一首曲子的结构分析：细化拍点、编小节位置、算每拍特征与段落，并判定是否适合重构。 */
export function buildMusicAnalysis(input: BuildMusicAnalysisInput): MusicAnalysis {
  const sampleRate = input.sampleRate ?? BEAT_THIS_SAMPLE_RATE
  const durationSeconds = input.mono.length / sampleRate
  const beats = refineBeatsToOnsets(input.beats, input.mono, sampleRate).map(value => round(value, 5))
  // 细化后保持严格递增（极少数相邻拍被拉到同一个起音时保留原时刻）。
  for (let i = 1; i < beats.length; i++) if (beats[i] <= beats[i - 1] + 0.05) beats[i] = Math.max(input.beats[i], beats[i - 1] + 0.05)
  const grid = input.downbeats
    ? barPositionsFromDownbeats(input.beats, input.downbeats)
    : { beatsPerBar: 4, positions: barPositionsFromAccents(input.accents ?? beats.map(() => 0)) }
  const features = beatFeatures(beats, input.spectrogram, input.mono, durationSeconds, sampleRate)
  const quality = beatGridQuality(beats, durationSeconds)
  const unsuitableReason = beats.length < MUSIC_MIN_BEATS ? '没有找到足够的节拍，这段声音不像有稳定节奏的音乐。'
    : quality.regularity < MUSIC_MIN_REGULARITY ? '节奏是自由的（速度时快时慢或没有稳定拍子），重构会打乱音乐，建议手动剪辑或淡入淡出。'
      : quality.coverage < MUSIC_MIN_COVERAGE ? '只有不到一半的时长有稳定节拍，重构容易在无节拍段落产生明显接缝。'
        : undefined
  return musicAnalysisSchema.parse({
    version: MUSIC_ANALYSIS_VERSION, durationSeconds: round(durationSeconds, 5), beatSource: input.beatSource,
    tempo: round(quality.tempo, 3), beatsPerBar: grid.beatsPerBar, beats, barPositions: grid.positions,
    ...features, sections: musicSections(features, grid.positions, grid.beatsPerBar),
    regularity: round(quality.regularity, 4), coverage: round(quality.coverage, 4),
    suitable: !unsuitableReason, ...(unsuitableReason ? { unsuitableReason } : {}),
  })
}
