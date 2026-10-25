import type { AudioEditTimelineSpan } from './types'

/*
 * 剪切点的柔化：每个拼接点做等功率交叉淡化，借用被删部分紧挨着的一小段声音当“把手”（DAW 的做法），
 * 时间线长度一帧不变，字幕、XML 与时间映射都不受影响。
 *
 * - 拼接点两侧都安静（落在停顿或气口里）：两侧各 20 ms、共 40 ms，让底噪平滑过渡，不会“咔”一下换底噪；
 * - 贴着说话：两侧各 5 ms、共 10 ms，只消除爆音，不把被删的字带进来；
 * - 进出静音区：没有可借的声音，只做淡入淡出。
 * 长度只由拼接点附近的实际声音决定，试听与导出读同一份声音、调用同一个函数，听到的就是导出的。
 */

export const AUDIO_EDIT_SPLICE_QUIET_HALF_SECONDS = 0.02
export const AUDIO_EDIT_SPLICE_SPEECH_HALF_SECONDS = 0.005
/** 拼接点两侧各 20 ms 的声音都低于它才算安静（dBFS，按全部声道的均方根） */
export const AUDIO_EDIT_SPLICE_QUIET_DBFS = -42

/** 按源采样帧随机读取交错 PCM；越界部分补零。 */
export interface AudioEditPcmReader {
  read(startFrame: number, frameCount: number): Promise<Float32Array>
}

export interface AudioEditSplicePlan {
  kind: 'none' | 'crossfade' | 'fade'
  /** 拼接点每一侧参与淡化的帧数 */
  halfFrames: number
}

const isSplice = (left: AudioEditTimelineSpan, right: AudioEditTimelineSpan): boolean =>
  left.sourceEndFrame !== right.sourceStartFrame || Boolean(left.muted) !== Boolean(right.muted)

const length = (span: AudioEditTimelineSpan): number => span.sourceEndFrame - span.sourceStartFrame

function rmsDbfs(pcm: Float32Array): number {
  if (!pcm.length) return -Infinity
  let sum = 0
  for (const value of pcm) sum += value * value
  return 10 * Math.log10(sum / pcm.length + 1e-20)
}

/** 交叉淡化第 k 帧（共 2h 帧）两侧的增益：等功率，中点两边各约 0.707。 */
export function audioEditCrossfadeGains(k: number, halfFrames: number): [number, number] {
  const t = (k + 0.5) / (2 * halfFrames)
  return [Math.cos(t * Math.PI / 2), Math.sin(t * Math.PI / 2)]
}

export class AudioEditSpliceRenderer {
  private readonly plans = new Map<number, Promise<AudioEditSplicePlan>>()

  constructor(
    private readonly spans: readonly AudioEditTimelineSpan[],
    private readonly source: { sampleRate: number; channels: number; durationFrames: number },
    private readonly reader: AudioEditPcmReader,
  ) {}

  /** 第 index 个片段与下一个片段之间的拼接方式（结果缓存，试听反复读取时不重算）。 */
  plan(index: number): Promise<AudioEditSplicePlan> {
    let plan = this.plans.get(index)
    if (!plan) { plan = this.computePlan(index); this.plans.set(index, plan) }
    return plan
  }

  private async computePlan(index: number): Promise<AudioEditSplicePlan> {
    const a = this.spans[index], b = this.spans[index + 1]
    if (!a || !b || !isSplice(a, b)) return { kind: 'none', halfFrames: 0 }
    const { sampleRate, durationFrames } = this.source
    const limit = Math.floor(Math.min(length(a), length(b)) / 2)
    const speech = Math.round(sampleRate * AUDIO_EDIT_SPLICE_SPEECH_HALF_SECONDS)
    if (a.muted || b.muted) return { kind: 'fade', halfFrames: Math.max(0, Math.min(speech, limit)) }
    const quiet = Math.round(sampleRate * AUDIO_EDIT_SPLICE_QUIET_HALF_SECONDS)
    const windows = await Promise.all([
      this.reader.read(a.sourceEndFrame - quiet, quiet), this.reader.read(a.sourceEndFrame, quiet),
      this.reader.read(b.sourceStartFrame - quiet, quiet), this.reader.read(b.sourceStartFrame, quiet),
    ])
    const calm = windows.every((pcm) => rmsDbfs(pcm) < AUDIO_EDIT_SPLICE_QUIET_DBFS)
    const handles = Math.min(durationFrames - a.sourceEndFrame, b.sourceStartFrame)
    const half = Math.max(0, Math.min(calm ? quiet : speech, limit, handles))
    return { kind: half > 0 ? 'crossfade' : 'none', halfFrames: half }
  }

  /** 第 index 个片段内 [localStart, localEnd) 的成片声音（交错 PCM）。 */
  async render(index: number, localStart: number, localEnd: number): Promise<Float32Array> {
    const span = this.spans[index]
    const { channels } = this.source
    const count = Math.max(0, localEnd - localStart)
    const output = span.muted ? new Float32Array(count * channels) : (await this.reader.read(span.sourceStartFrame + localStart, count)).slice()
    const spanLength = length(span)
    // 结尾：与下一个片段的拼接
    if (index + 1 < this.spans.length) {
      const plan = await this.plan(index)
      const from = Math.max(localStart, spanLength - plan.halfFrames)
      if (plan.kind !== 'none' && from < localEnd) {
        const next = this.spans[index + 1]
        const incoming = plan.kind === 'crossfade' ? await this.reader.read(next.sourceStartFrame - plan.halfFrames + (from - (spanLength - plan.halfFrames)), localEnd - from) : undefined
        for (let frame = from; frame < localEnd; frame++) {
          const k = frame - (spanLength - plan.halfFrames)
          const [own, other] = plan.kind === 'crossfade' ? audioEditCrossfadeGains(k, plan.halfFrames) : [Math.cos((k + 0.5) / plan.halfFrames * Math.PI / 2), 0]
          for (let channel = 0; channel < channels; channel++) {
            const at = (frame - localStart) * channels + channel
            output[at] = output[at] * own + (incoming ? incoming[(frame - from) * channels + channel] * other : 0)
          }
        }
      }
    }
    // 开头：与上一个片段的拼接
    if (index > 0) {
      const plan = await this.plan(index - 1)
      const to = Math.min(localEnd, plan.halfFrames)
      if (plan.kind !== 'none' && localStart < to) {
        const previous = this.spans[index - 1]
        const outgoing = plan.kind === 'crossfade' ? await this.reader.read(previous.sourceEndFrame + localStart, to - localStart) : undefined
        for (let frame = localStart; frame < to; frame++) {
          const k = plan.halfFrames + frame
          const [other, own] = plan.kind === 'crossfade' ? audioEditCrossfadeGains(k, plan.halfFrames) : [0, Math.sin((frame + 0.5) / plan.halfFrames * Math.PI / 2)]
          for (let channel = 0; channel < channels; channel++) {
            const at = (frame - localStart) * channels + channel
            output[at] = output[at] * own + (outgoing ? outgoing[(frame - localStart) * channels + channel] * other : 0)
          }
        }
      }
    }
    return output
  }
}
