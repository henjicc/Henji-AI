import { z } from 'zod'
import { SpeechEnergyHistogram, SpeechEnergyValleys } from './speechEnergy'

/*
 * 口播成品“现在听起来怎样”的读回：剪好的整条声音（剪切、修复、效果控件与输出都已生效，和导出的 WAV 同一份）。
 * 采样级统计（电平、峰值、削波、嗡声）在主进程工作线程里流式累计；响度来自与剪辑测量同一口径的 FFmpeg ebur128
 * （4 倍重采样后测峰值即真峰值，逐 100 毫秒的 400 毫秒块即 BS.1770 门限积分的输入），这里只做汇总。
 * 时间一律是剪后作品时间（秒）。
 */

/** 电平、静音与削波的时间分辨率 */
export const AUDIO_EDIT_SOUND_FRAME_MS = 10
const FLOOR_DB = -120
/**
 * 削波按 Audacity“查找削波”的判据：同一声道连续至少 3 个采样达到接近满刻度（-0.1 dBFS）；含有超过满刻度采样的一串
 * （浮点成品转成整数格式时一定会削掉）不论长短都算。离满刻度有余量的平坦段不算：16 位录音加增益后，波峰波谷处
 * 相邻采样本来就常常相等；也不按 FFmpeg astats 的 Flat factor 去找“信号自身峰值处的平顶”，
 * 限幅器压到 -1 dBTP 的成品在自身峰值上就有连续采样。代价：录音时削过、之后整体衰减的平顶认不出来。
 */
const CLIP_LEVEL = 10 ** (-0.1 / 20)
const CLIP_RUN = 3
/** 语音 / 非语音判定与口播粗剪的停顿检测同一判据（speech-energy.ts）：全频与 2.5 kHz 以上都低于各自第 80 百分位减这么多 dB */
const PAUSE_WIDE_BELOW_DB = 22
const PAUSE_HIGH_BELOW_DB = 16
const PAUSE_HIGH_FLOOR_DB = -110
const HIGH_BAND_HZ = 2500
/** 底噪与嗡声至少要有这么多秒非语音（不含数字静音）才估 */
const MIN_NOISE_SECONDS = 2
/** 相距不到 50 毫秒的削波算同一处 */
const CLIP_MERGE_SECONDS = 0.05
const MAINS_FAMILIES = { 50: [50, 100, 150], 60: [60, 120, 180] } as const
/** 低于这个电平当作数字静音（剪辑里静音掉的段），不参与底噪与嗡声估计 */
const DIGITAL_SILENCE_DB = -90
/** 静音段至少这么长才计入 */
const MIN_SILENCE_SECONDS = 0.25
/** 默认列出的位置条数；includeWindows 时全给 */
const DEFAULT_LISTED = 8
/** 嗡声判定：最安静的几秒里，电源频率及谐波占这一秒能量的比例中位数 */
const HUM_SHARE = 0.2

export const audioEditSoundCheckRequestSchema = z.object({
  projectId: z.string().min(1),
  startSeconds: z.number().finite().nonnegative().optional(),
  endSeconds: z.number().finite().positive().optional(),
  windowSeconds: z.number().finite().min(1).max(600).optional(),
  includeWindows: z.boolean().optional(),
  requestId: z.string().min(1).max(300).optional(),
}).strict()
export type AudioEditSoundCheckRequest = z.infer<typeof audioEditSoundCheckRequestSchema>

const seconds = z.number().finite()
const level = z.number().finite().nullable()
const timeRange = z.object({ startSeconds: seconds, endSeconds: seconds }).strict()
const windowSchema = z.object({ startSeconds: seconds, endSeconds: seconds, lufs: level.describe('这段的门限积分响度 LUFS；太轻或不足 0.4 秒为 null'), peakDbfs: level.describe('这段的采样峰值 dBFS') }).strict()

export const audioEditSoundCheckSchema = z.object({
  startSeconds: seconds.describe('测量范围开始（剪后作品时间，秒）'),
  endSeconds: seconds.describe('测量范围结束（剪后作品时间，秒）'),
  durationSeconds: seconds,
  loudness: z.object({
    integratedLufs: level.describe('整体积分响度 LUFS；静音、太轻或不足 0.4 秒为 null，不是零'),
    loudnessRangeLu: level.describe('响度范围 LRA（LU），越小越平稳；口播一般 4–8'),
    truePeakDbtp: level.describe('4 倍重建真峰值 dBTP（与 measure_video_edit_loudness 同一口径）；发布常用上限 -1'),
    samplePeakDbfs: level.describe('采样峰值 dBFS'),
    targetLufs: z.number().finite().optional().describe('输出一节打开自动匹配响度时的目标'),
  }).strict(),
  clipping: z.object({
    count: z.number().int().nonnegative().describe('削波处数：同一声道连续至少 3 个采样达到 -0.1 dBFS 以上，或有采样超过满刻度；相距不到 50 毫秒算一处。离满刻度有余量的平坦段（限幅后的峰、录音时削过又整体衰减的平顶）不算'),
    samples: z.number().int().nonnegative().describe('削波的采样数（各声道合计）'),
    ranges: z.array(timeRange).describe('削波位置（默认最多 8 处，includeWindows 时全部）'),
  }).strict(),
  silence: z.object({
    thresholdDbfs: z.number().finite().describe('停顿判定电平：这段声音自己的常见电平（第 80 百分位）减 22 dB，同时要求 2.5 kHz 以上也安静，与粗剪的停顿检测同一判据'),
    totalSeconds: seconds.describe('不短于 0.25 秒的停顿（非语音段）合计'),
    leadingSeconds: seconds, trailingSeconds: seconds,
    longPauseSeconds: seconds.describe('过长停顿的判定长度（口播批量设置的检测时长）'),
    longPauseCount: z.number().int().nonnegative(),
    longestPauseSeconds: seconds.describe('开头结尾之外最长的一段静音'),
    longPauses: z.array(timeRange.extend({ seconds })).describe('过长停顿的位置（开头结尾不算；默认最长的 8 处按时间排，includeWindows 时全部）'),
  }).strict(),
  noise: z.object({
    floorDbfs: level.describe('底噪电平 dBFS：只在非语音片段里测（50 毫秒片段的中位数），静音掉的段不算；这样的片段不足 2 秒时为 null'),
    rating: z.enum(['clean', 'audible', 'high', 'unknown']).describe('clean 不高于 -60 dBFS；audible -60～-50 停顿处能听到；high 高于 -50 明显；unknown 非语音片段太少（比如停顿都被清成了静音）估不出'),
    hum: z.object({
      status: z.enum(['none', 'suspected', 'unknown']).describe('suspected 疑似电源嗡声；unknown 非语音片段（不含静音掉的段）合计不足 2 秒，无法判断'),
      frequencyHz: z.union([z.literal(50), z.literal(60)]).optional(),
      levelDbfs: z.number().finite().optional().describe('嗡声分量电平'),
      share: z.number().min(0).max(1).optional().describe('非语音片段里电源频率及谐波占的能量比例'),
    }).strict(),
  }).strict(),
  windowSeconds: seconds.describe('分段长度'),
  keyWindows: z.array(windowSchema.extend({ note: z.enum(['loudest', 'quietest', 'louder', 'quieter', 'clipping']).describe('loudest 最响、quietest 最轻、louder / quieter 比整体响或轻 4 LU 以上、clipping 有削波') })).describe('值得注意的分段'),
  windows: z.array(windowSchema).optional().describe('全部分段（只在 includeWindows=true 时给）'),
  issues: z.array(z.string()).describe('发现的问题，用户语言；空数组表示没发现问题'),
}).strict()
export type AudioEditSoundCheck = z.infer<typeof audioEditSoundCheckSchema>

export const audioEditSoundCheckDeltaSchema = z.object({
  checkedAt: z.string().describe('上一次读回的时间'),
  integratedLufs: z.number().finite().nullable(), loudnessRangeLu: z.number().finite().nullable(), truePeakDbtp: z.number().finite().nullable(),
  noiseFloorDbfs: z.number().finite().nullable(), durationSeconds: seconds, clippingCount: z.number().int(), longPauseCount: z.number().int(),
}).strict().describe('与同一范围上一次读回相比的变化（本次减上次；任一次测不出时为 null）')
export type AudioEditSoundCheckDelta = z.infer<typeof audioEditSoundCheckDeltaSchema>

/** 工作线程交回的采样级统计；时间以分析起点为 0。 */
export interface AudioEditSoundStats {
  sampleRate: number
  frames: number
  /** 每 10 毫秒的 RMS 电平（单声道混合）dBFS */
  levelsDb: Float32Array
  /** 每 10 毫秒 2.5 kHz 以上的 RMS 电平 dBFS */
  highDb: Float32Array
  /** 每 10 毫秒的采样峰值（线性） */
  peaks: Float32Array
  clips: Array<{ startFrame: number; endFrame: number; samples: number }>
  /** 非语音片段（10 毫秒帧序号区间），与粗剪停顿检测同一判据 */
  pauses: Array<{ startFrame: number; endFrame: number }>
  /** 语音 / 非语音判定用的全频门限 dBFS */
  pauseThresholdDb: number
  /** 只用非语音、非数字静音的采样，每凑满一秒：电平与 50/60 Hz 及谐波占的能量比例 */
  hum: Array<{ levelDb: number; mains50: number; mains60: number }>
}

const toDb = (power: number): number => power > 0 ? Math.max(FLOOR_DB, 10 * Math.log10(power)) : FLOOR_DB

/** 流式累计采样级统计（第一遍）：输入是交错的 32 位浮点 PCM，按块顺序送入。 */
export class AudioEditSoundStatsCollector {
  private readonly frameSize: number
  private readonly levels: number[] = []
  private readonly high: number[] = []
  private readonly peaks: number[] = []
  private readonly clips: AudioEditSoundStats['clips'] = []
  private framePower = 0
  private frameHighPower = 0
  private framePeak = 0
  private frameFill = 0
  private position = 0
  /** 每个声道当前这串接近满刻度的采样：长度、已计入削波的个数、是否含超过满刻度的采样 */
  private readonly runLength: Float64Array
  private readonly runCounted: Float64Array
  private readonly runOver: Uint8Array
  /** 2.5 kHz 二阶高通（RBJ，Q=0.707，与 FFmpeg highpass 默认同型） */
  private readonly filter: [number, number, number, number, number]
  private x1 = 0
  private x2 = 0
  private y1 = 0
  private y2 = 0

  constructor(readonly sampleRate: number, readonly channels: number) {
    this.frameSize = Math.max(1, Math.round(sampleRate * AUDIO_EDIT_SOUND_FRAME_MS / 1000))
    this.runLength = new Float64Array(channels); this.runCounted = new Float64Array(channels); this.runOver = new Uint8Array(channels)
    const w = 2 * Math.PI * Math.min(HIGH_BAND_HZ, sampleRate * 0.45) / sampleRate, alpha = Math.sin(w) / (2 * Math.SQRT1_2), cos = Math.cos(w), a0 = 1 + alpha
    this.filter = [(1 + cos) / 2 / a0, -(1 + cos) / a0, (1 + cos) / 2 / a0, -2 * cos / a0, (1 - alpha) / a0]
  }

  private markClip(startFrame: number, endFrame: number, samples: number): void {
    const merge = Math.round(CLIP_MERGE_SECONDS * this.sampleRate)
    const last = this.clips.at(-1)
    if (last && startFrame <= last.endFrame + merge) { last.endFrame = Math.max(last.endFrame, endFrame); last.samples += samples; return }
    this.clips.push({ startFrame, endFrame, samples })
  }

  push(pcm: Float32Array): void {
    const channels = this.channels
    const frames = Math.floor(pcm.length / channels)
    const [b0, b1, b2, a1, a2] = this.filter
    for (let frame = 0; frame < frames; frame++) {
      const at = this.position + frame
      let mono = 0
      for (let channel = 0; channel < channels; channel++) {
        const value = pcm[frame * channels + channel]
        const magnitude = Math.abs(value)
        mono += value
        if (magnitude > this.framePeak) this.framePeak = magnitude
        if (magnitude >= CLIP_LEVEL) {
          const length = ++this.runLength[channel]
          if (magnitude > 1) this.runOver[channel] = 1
          if (length >= CLIP_RUN || this.runOver[channel]) {
            const fresh = length - this.runCounted[channel]
            this.markClip(at + 1 - fresh, at + 1, fresh)
            this.runCounted[channel] = length
          }
        } else if (this.runLength[channel]) { this.runLength[channel] = 0; this.runCounted[channel] = 0; this.runOver[channel] = 0 }
      }
      mono /= channels
      this.framePower += mono * mono
      const filtered = b0 * mono + b1 * this.x1 + b2 * this.x2 - a1 * this.y1 - a2 * this.y2
      this.x2 = this.x1; this.x1 = mono; this.y2 = this.y1; this.y1 = filtered
      this.frameHighPower += filtered * filtered
      if (++this.frameFill === this.frameSize) this.finishFrame()
    }
    this.position += frames
  }

  private finishFrame(): void {
    this.levels.push(toDb(this.framePower / this.frameFill)); this.high.push(toDb(this.frameHighPower / this.frameFill)); this.peaks.push(this.framePeak)
    this.framePower = 0; this.frameHighPower = 0; this.framePeak = 0; this.frameFill = 0
  }

  /** 第一遍结束：按粗剪同一判据找出非语音片段，第二遍只在这些片段里估嗡声。 */
  finish(): Omit<AudioEditSoundStats, 'hum'> {
    if (this.frameFill) this.finishFrame()
    const wide = new SpeechEnergyHistogram(), high = new SpeechEnergyHistogram()
    for (let index = 0; index < this.levels.length; index++) { wide.add(this.levels[index]); high.add(this.high[index]) }
    const pauseThresholdDb = wide.threshold(PAUSE_WIDE_BELOW_DB), highThresholdDb = high.threshold(PAUSE_HIGH_BELOW_DB, PAUSE_HIGH_FLOOR_DB)
    const valleys = new SpeechEnergyValleys(pauseThresholdDb, highThresholdDb)
    for (let index = 0; index < this.levels.length; index++) valleys.append(index * AUDIO_EDIT_SOUND_FRAME_MS, (index + 1) * AUDIO_EDIT_SOUND_FRAME_MS, this.levels[index], this.high[index])
    valleys.flush()
    const pauses = valleys.pauses.map(pause => ({ startFrame: Math.round(pause.startMs / AUDIO_EDIT_SOUND_FRAME_MS), endFrame: Math.round(pause.endMs / AUDIO_EDIT_SOUND_FRAME_MS) }))
    return { sampleRate: this.sampleRate, frames: this.position, levelsDb: Float32Array.from(this.levels), highDb: Float32Array.from(this.high), peaks: Float32Array.from(this.peaks), clips: this.clips, pauses, pauseThresholdDb }
  }
}

/** 可作底噪与嗡声证据的 10 毫秒帧：非语音、且不是数字静音（剪辑里静音掉的段）。 */
export function audioEditNoiseFrames(stats: Pick<AudioEditSoundStats, 'levelsDb' | 'pauses'>): Uint8Array {
  const mask = new Uint8Array(stats.levelsDb.length)
  for (const pause of stats.pauses) for (let index = pause.startFrame; index < Math.min(mask.length, pause.endFrame); index++) if (stats.levelsDb[index] > DIGITAL_SILENCE_DB) mask[index] = 1
  return mask
}

/**
 * 第二遍：只累计非语音帧里的采样，每凑满一秒算一次电源频率及谐波的能量占比。相位按绝对采样序号推进，
 * 中间隔着说话也不打断，持续的嗡声在拼起来的片段里照样同相叠加。
 */
export class AudioEditHumCollector {
  private readonly frameSize: number
  private readonly steps: Array<[number, number]>
  private readonly phase: Array<[number, number]>
  private readonly sums: Array<[number, number]>
  private readonly hum: AudioEditSoundStats['hum'] = []
  private power = 0
  private fill = 0
  private position = 0

  constructor(readonly sampleRate: number, readonly channels: number, private readonly mask: Uint8Array) {
    this.frameSize = Math.max(1, Math.round(sampleRate * AUDIO_EDIT_SOUND_FRAME_MS / 1000))
    const frequencies = [...MAINS_FAMILIES[50], ...MAINS_FAMILIES[60]]
    this.steps = frequencies.map(frequency => [Math.cos(2 * Math.PI * frequency / sampleRate), Math.sin(2 * Math.PI * frequency / sampleRate)])
    this.phase = frequencies.map(() => [1, 0]); this.sums = frequencies.map(() => [0, 0])
  }

  push(pcm: Float32Array): void {
    const channels = this.channels
    const frames = Math.floor(pcm.length / channels)
    for (let frame = 0; frame < frames; frame++) {
      const at = this.position + frame
      const take = this.mask[Math.floor(at / this.frameSize)] === 1
      let mono = 0
      if (take) { for (let channel = 0; channel < channels; channel++) mono += pcm[frame * channels + channel]; mono /= channels; this.power += mono * mono }
      for (let index = 0; index < this.steps.length; index++) {
        const [cos, sin] = this.steps[index], phase = this.phase[index]
        if (take) { this.sums[index][0] += mono * phase[0]; this.sums[index][1] += mono * phase[1] }
        const re = phase[0] * cos - phase[1] * sin, im = phase[0] * sin + phase[1] * cos
        phase[0] = re; phase[1] = im
      }
      // 每秒把相位拉回单位圆，长时间累计不漂
      if (at % this.sampleRate === 0) for (const phase of this.phase) { const norm = Math.hypot(phase[0], phase[1]); phase[0] /= norm; phase[1] /= norm }
      if (take && ++this.fill === this.sampleRate) this.finishSecond()
    }
    this.position += frames
  }

  private finishSecond(): void {
    const n = this.fill, total = this.power
    const shares = this.sums.map(([re, im]) => total > 0 ? (re * re + im * im) * 2 / (n * total) : 0)
    const family = MAINS_FAMILIES[50].length
    this.hum.push({ levelDb: toDb(total / n), mains50: Math.min(1, shares.slice(0, family).reduce((sum, value) => sum + value, 0)), mains60: Math.min(1, shares.slice(family).reduce((sum, value) => sum + value, 0)) })
    for (const sum of this.sums) { sum[0] = 0; sum[1] = 0 }
    this.power = 0; this.fill = 0
  }

  finish(): AudioEditSoundStats['hum'] { return this.hum }
}

/** ebur128 的 400 毫秒块（每 100 毫秒一块，第 k 块止于 (k+1)/10 秒）按 BS.1770 做绝对 -70 与相对 -10 门限积分。 */
export function gatedAudioEditLoudness(blocks: readonly number[]): number | null {
  const energy = (lufs: number): number => 10 ** ((lufs + 0.691) / 10)
  const mean = (values: readonly number[]): number => values.reduce((sum, value) => sum + energy(value), 0) / values.length
  const audible = blocks.filter(value => Number.isFinite(value) && value > -70)
  if (!audible.length) return null
  const relative = -0.691 + 10 * Math.log10(mean(audible)) - 10
  const gated = audible.filter(value => value > relative)
  return gated.length ? -0.691 + 10 * Math.log10(mean(gated)) : null
}

export interface AudioEditLoudnessTimeline {
  integratedLufs: number | null
  loudnessRangeLu: number | null
  truePeakDbtp: number | null
  /** 每 100 毫秒一个的 400 毫秒块响度（ebur128 的 M） */
  momentaryLufs: readonly number[]
}

export interface AudioEditSoundSummaryOptions {
  /** 分析起点在剪后作品里的秒数 */
  offsetSeconds: number
  windowSeconds: number
  longPauseSeconds: number
  includeWindows: boolean
  targetLufs?: number
}

const round = (value: number, digits = 1): number => { const scale = 10 ** digits; return Math.round(value * scale) / scale }
const roundLevel = (value: number | null): number | null => value === null || !Number.isFinite(value) ? null : round(value)
const peakDb = (linear: number): number | null => linear > 0 ? round(20 * Math.log10(linear)) : null
const quantile = (values: number[], q: number): number => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))] }
const clock = (value: number): string => { const total = Math.max(0, value); const minutes = Math.floor(total / 60); return minutes ? `${minutes} 分 ${(total - minutes * 60).toFixed(1)} 秒` : `${total.toFixed(1)} 秒` }

/** 把采样级统计与响度时间线汇总成助手读的结果。 */
export function summarizeAudioEditSound(stats: AudioEditSoundStats, loudness: AudioEditLoudnessTimeline, options: AudioEditSoundSummaryOptions): AudioEditSoundCheck {
  const frameSeconds = AUDIO_EDIT_SOUND_FRAME_MS / 1000
  const duration = stats.frames / stats.sampleRate
  const at = (relative: number): number => round(options.offsetSeconds + relative, 2)
  const listed = <T>(items: T[]): T[] => options.includeWindows ? items : items.slice(0, DEFAULT_LISTED)

  // 停顿：与粗剪同一判据的非语音片段（门限相对这段声音自己的电平，轻声录音不会被当成停顿）
  const silences = stats.pauses.map(pause => ({ start: pause.startFrame * frameSeconds, end: Math.min(duration, pause.endFrame * frameSeconds) })).filter(item => item.end - item.start >= MIN_SILENCE_SECONDS)
  const leading = silences[0]?.start === 0 ? silences[0].end : 0
  const trailing = silences.length && Math.abs(silences.at(-1)!.end - duration) < frameSeconds ? silences.at(-1)!.end - silences.at(-1)!.start : 0
  const inner = silences.filter(item => item.start > 0 && Math.abs(item.end - duration) >= frameSeconds)
  const long = inner.filter(item => item.end - item.start >= options.longPauseSeconds)
  const longShown = options.includeWindows ? long : [...long].sort((a, b) => (b.end - b.start) - (a.end - a.start)).slice(0, DEFAULT_LISTED).sort((a, b) => a.start - b.start)

  // 底噪：只在非语音、非数字静音的 50 毫秒片段里取中位数；这样的片段不够 2 秒就如实说估不出
  const noiseFrames = audioEditNoiseFrames(stats)
  const blockLevels: number[] = []
  for (let index = 0; index + 5 <= noiseFrames.length; index += 5) {
    if (!noiseFrames.subarray(index, index + 5).every(Boolean)) continue
    let power = 0
    for (let offset = 0; offset < 5; offset++) power += 10 ** (stats.levelsDb[index + offset] / 10)
    blockLevels.push(toDb(power / 5))
  }
  const floor = blockLevels.length * 0.05 >= MIN_NOISE_SECONDS ? round(quantile(blockLevels, 0.5)) : null
  const rating = floor === null ? 'unknown' : floor <= -60 ? 'clean' : floor <= -50 ? 'audible' : 'high'

  // 嗡声：第二遍只累计了非语音片段，凑满的每一秒都算；同样不够 2 秒就不判断
  let hum: AudioEditSoundCheck['noise']['hum'] = { status: 'unknown' }
  if (stats.hum.length >= MIN_NOISE_SECONDS) {
    const share50 = quantile(stats.hum.map(second => second.mains50), 0.5), share60 = quantile(stats.hum.map(second => second.mains60), 0.5)
    const frequency = share50 >= share60 ? 50 : 60, share = Math.max(share50, share60)
    hum = share >= HUM_SHARE
      ? { status: 'suspected', frequencyHz: frequency, share: round(share, 2), levelDbfs: round(quantile(stats.hum.map(second => second.levelDb + 10 * Math.log10(Math.max(1e-12, frequency === 50 ? second.mains50 : second.mains60))), 0.5)) }
      : { status: 'none' }
  }

  // 分段：响度用止于段内的 400 毫秒块，峰值用 10 毫秒帧
  const windowCount = Math.max(1, Math.ceil(duration / options.windowSeconds - 1e-9))
  const windows = Array.from({ length: windowCount }, (_, index) => {
    const start = index * options.windowSeconds, end = Math.min(duration, start + options.windowSeconds)
    const blocks: number[] = []
    for (let block = Math.max(0, Math.ceil((start + 0.4) * 10 - 1 - 1e-6)); block < loudness.momentaryLufs.length && (block + 1) / 10 <= end + 1e-6; block++) blocks.push(loudness.momentaryLufs[block])
    let peak = 0
    for (let frame = Math.floor(start / frameSeconds); frame < Math.min(stats.peaks.length, Math.ceil(end / frameSeconds)); frame++) peak = Math.max(peak, stats.peaks[frame])
    return { startSeconds: at(start), endSeconds: at(end), lufs: roundLevel(gatedAudioEditLoudness(blocks)), peakDbfs: peakDb(peak) }
  })
  const clipRanges = stats.clips.map(clip => ({ startSeconds: at(clip.startFrame / stats.sampleRate), endSeconds: at(clip.endFrame / stats.sampleRate) }))
  const keyWindows: AudioEditSoundCheck['keyWindows'] = []
  const measured = windows.filter(window => window.lufs !== null)
  const add = (window: typeof windows[number], note: AudioEditSoundCheck['keyWindows'][number]['note']): void => { if (!keyWindows.some(item => item.startSeconds === window.startSeconds)) keyWindows.push({ ...window, note }) }
  for (const window of windows) if (clipRanges.some(range => range.startSeconds < window.endSeconds && range.endSeconds > window.startSeconds) && keyWindows.length < 3) add(window, 'clipping')
  if (measured.length >= 2) {
    const sorted = [...measured].sort((a, b) => b.lufs! - a.lufs!)
    add(sorted[0], 'loudest'); add(sorted.at(-1)!, 'quietest')
    if (loudness.integratedLufs !== null) {
      const integrated = loudness.integratedLufs
      for (const window of measured.filter(item => Math.abs(item.lufs! - integrated) >= 4).sort((a, b) => Math.abs(b.lufs! - integrated) - Math.abs(a.lufs! - integrated)).slice(0, 6)) add(window, window.lufs! > integrated ? 'louder' : 'quieter')
    }
  }
  keyWindows.sort((a, b) => a.startSeconds - b.startSeconds)

  let samplePeak = 0
  for (const value of stats.peaks) samplePeak = Math.max(samplePeak, value)
  const integrated = roundLevel(loudness.integratedLufs), truePeak = roundLevel(loudness.truePeakDbtp)
  const issues: string[] = []
  if (integrated === null) issues.push('声音太轻或太短，测不出整体响度。')
  if (integrated !== null && options.targetLufs !== undefined && Math.abs(integrated - options.targetLufs) > 1) issues.push(`整体响度 ${integrated} LUFS，离目标 ${options.targetLufs} LUFS 差 ${round(integrated - options.targetLufs)} LU，需要重新匹配响度。`)
  if (stats.clips.length) issues.push(`有 ${stats.clips.length} 处削波，第一处在 ${clock(clipRanges[0].startSeconds)}。`)
  if (truePeak !== null && truePeak > -1) issues.push(`真峰值 ${truePeak} dBTP，高于 -1 dBTP，平台转码后可能失真。`)
  if (rating === 'high') issues.push(`底噪偏高（${floor} dBFS），停顿处能明显听到。`)
  else if (rating === 'audible') issues.push(`底噪 ${floor} dBFS，停顿处听得到。`)
  if (hum.status === 'suspected') issues.push(`疑似 ${hum.frequencyHz} Hz 电源嗡声（停顿处约占 ${Math.round(hum.share! * 100)}% 的能量）。`)
  if (long.length) issues.push(`有 ${long.length} 处停顿超过 ${round(options.longPauseSeconds)} 秒，最长 ${round(Math.max(...long.map(item => item.end - item.start)))} 秒（${clock(at(long.reduce((a, b) => b.end - b.start > a.end - a.start ? b : a).start))}）。`)

  return {
    startSeconds: at(0), endSeconds: at(duration), durationSeconds: round(duration, 2),
    loudness: { integratedLufs: integrated, loudnessRangeLu: roundLevel(loudness.loudnessRangeLu), truePeakDbtp: truePeak, samplePeakDbfs: peakDb(samplePeak), ...(options.targetLufs !== undefined ? { targetLufs: options.targetLufs } : {}) },
    clipping: { count: stats.clips.length, samples: stats.clips.reduce((sum, clip) => sum + clip.samples, 0), ranges: listed(clipRanges) },
    silence: {
      thresholdDbfs: round(stats.pauseThresholdDb), totalSeconds: round(silences.reduce((sum, item) => sum + item.end - item.start, 0), 2), leadingSeconds: round(leading, 2), trailingSeconds: round(trailing, 2),
      longPauseSeconds: options.longPauseSeconds, longPauseCount: long.length, longestPauseSeconds: round(inner.reduce((max, item) => Math.max(max, item.end - item.start), 0), 2),
      longPauses: longShown.map(item => ({ startSeconds: at(item.start), endSeconds: at(item.end), seconds: round(item.end - item.start, 2) })),
    },
    noise: { floorDbfs: floor, rating, hum },
    windowSeconds: options.windowSeconds, keyWindows,
    ...(options.includeWindows ? { windows } : {}),
    issues,
  }
}

/** 同一范围前后两次读回的差值（本次减上次）。 */
export function compareAudioEditSoundChecks(previous: AudioEditSoundCheck, next: AudioEditSoundCheck, checkedAt: string): AudioEditSoundCheckDelta {
  const delta = (a: number | null, b: number | null): number | null => a === null || b === null ? null : round(b - a)
  return {
    checkedAt,
    integratedLufs: delta(previous.loudness.integratedLufs, next.loudness.integratedLufs),
    loudnessRangeLu: delta(previous.loudness.loudnessRangeLu, next.loudness.loudnessRangeLu),
    truePeakDbtp: delta(previous.loudness.truePeakDbtp, next.loudness.truePeakDbtp),
    noiseFloorDbfs: delta(previous.noise.floorDbfs, next.noise.floorDbfs),
    durationSeconds: round(next.durationSeconds - previous.durationSeconds, 2),
    clippingCount: next.clipping.count - previous.clipping.count,
    longPauseCount: next.silence.longPauseCount - previous.silence.longPauseCount,
  }
}
