import type { RecordingDocument, RecordingMedia } from './document'
import { recordingMediaSpans } from './range'

/**
 * 一次录制（开始到停止，中间暂停几次都算）在剪辑里是一个画面素材：把暂停分出的各画面分片首尾相接、无损拼成一个文件，
 * 暂停的那段不在里面。每个分片从它自己的第一帧（关键帧）用起，只在末尾按帧切开，所以不重新编码。
 *
 * 合并文件的时间就是“会话时钟减去暂停”：片段 i 里会话时刻 m 落在 fileUs + (m − monoUs)。暂停长度与事件时钟扣掉的暂停一致时
 * （收尾时 alignRecordingPauses 已对齐），光标、点击等按 recordingUs 记的事件在合并文件上处处对齐。
 */
export interface RecordingCombinedPart {
  mediaId: string
  /** 这一片的第一帧（会话时钟）。 */
  monoUs: number
  /** 用到这一片的第几帧为止（不含），从这片自己的第一帧数起。 */
  frames: number
  /** 这一片在合并文件里的起点。 */
  fileUs: number
}
export interface RecordingCombinedGroup { parts: RecordingCombinedPart[]; fps: number; frames: number }

/** 暂停对齐允许的误差：事件时钟恢复的时刻最多比画面第一帧晚这么多，超过（较早版本录的会话约 1 秒）就不按合并处理。 */
export const PAUSE_ALIGNMENT_TOLERANCE_US = 250_000

function pausedWithin(pauses: ReadonlyArray<{ startUs: number; endUs: number }>, from: number, to: number): number {
  return pauses.reduce((sum, pause) => sum + Math.max(0, Math.min(to, pause.endUs) - Math.max(from, pause.startUs)), 0)
}

/**
 * 按时间先后把画面分片分组：相邻两片之间整段都是会话暂停、后一片的第一帧正是暂停结束、编码参数一样，才接进同一组；
 * 编码器意外重启留下的真实空档、编码参数变了（软件编码回退）都从那里分开，分开的各组各自成一个文件，空档如实留空。
 * `streams` 是每片的编码参数指纹（主进程探测），不给时只按时间判断。没有任何一组能合并时返回 null，照原样逐片导入。
 */
export function recordingCombinePlan(recording: Pick<RecordingDocument, 'media' | 'startUs' | 'endUs' | 'pauses' | 'tracks' | 'source'>, streams?: ReadonlyMap<string, string>): RecordingCombinedGroup[] | null {
  const fps = recording.source?.options.fps
  if (!fps) return null
  const pauses = [...recording.pauses ?? []].sort((a, b) => a.startUs - b.startUs)
  const screens = recording.media.filter(item => item.kind === 'screen' && item.durationUs > 0).sort((a, b) => a.monoUs - b.monoUs)
  const groups: RecordingCombinedGroup[] = []
  let previous: { media: RecordingMedia; endUs: number } | undefined, groupStartUs = 0
  for (const media of screens) {
    const spans = recordingMediaSpans(recording, media)
    if (!spans.length) continue
    // 一个文件中间被暂停切开（较早的兼容采集）只能逐片导入：流复制切不开文件中间。
    if (spans.length > 1) return null
    const [{ startUs, endUs }] = spans
    // 恢复后的分片第一帧落在暂停里（这次暂停没能与画面对齐）时，按帧数算出的位置会把暂停里的画面算进来：整次录制逐片导入。
    if (previous && startUs !== media.monoUs) return null
    const joins = previous && streams?.get(previous.media.id) === streams?.get(media.id)
      && media.monoUs > previous.endUs && pausedWithin(pauses, previous.endUs, media.monoUs) >= media.monoUs - previous.endUs - 1
    if (!joins) { groups.push({ parts: [], fps, frames: 0 }); groupStartUs = media.monoUs }
    const group = groups.at(-1)!
    // 在组内的位置 = 离组起点的会话时间减去其间的暂停；按帧取整，误差不累积。
    const endFrame = Math.round((endUs - groupStartUs - pausedWithin(pauses, groupStartUs, endUs)) * fps / 1e6)
    const frames = endFrame - group.frames
    if (frames <= 0) return null
    group.parts.push({ mediaId: media.id, monoUs: media.monoUs, frames, fileUs: group.frames * 1e6 / fps })
    group.frames = endFrame
    previous = { media, endUs }
  }
  return groups.some(group => group.parts.length > 1) ? groups : null
}

/** 主进程合并的结果：每组一个画面文件（只有一片的组直接用原片）与每路声音一条，时间都是这组的文件时间。 */
export interface RecordingCombinedFiles extends RecordingCombinedGroup { screen: string; audio: Partial<Record<'microphone' | 'systemAudio', string>> }

export const recordingCombinedPartEndUs =(part: RecordingCombinedPart, fps: number): number => part.monoUs + part.frames * 1e6 / fps

/** 会话时钟区间落在合并文件里的各段（文件时间）；暂停里的部分不在文件里，相邻片段首尾相接的合成一段。 */
export function recordingCombinedIntervals(group: RecordingCombinedGroup, fromUs: number, toUs: number): Array<[number, number]> {
  const result: Array<[number, number]> = []
  for (const part of group.parts) {
    const start = Math.max(fromUs, part.monoUs), end = Math.min(toUs, recordingCombinedPartEndUs(part, group.fps))
    if (end <= start) continue
    const interval: [number, number] = [part.fileUs + start - part.monoUs, part.fileUs + end - part.monoUs]
    const last = result.at(-1)
    if (last && interval[0] - last[1] < 1000) last[1] = interval[1]; else result.push(interval)
  }
  return result
}

/**
 * 统一暂停区间，让画面、声音和事件扣掉的是同一段：事件时钟在按下暂停时停、在恢复时从画面第一帧接着走，
 * 暂停长度以它为准（recordingUs 已按它扣掉暂停，事件页不可改）。暂停结束放在恢复后画面的第一帧上，起点往前推同样的长度，
 * 于是恢复后的画面从第一帧就用得上，合并文件上的事件不偏。
 *
 * 只在能确认时改：暂停与恢复的事件成对、恢复后的画面片段落在暂停与事件时钟恢复之间、两者相差不超过容差。
 * 较早版本录的会话事件时钟在画面恢复约 1 秒后才接着走，对不齐，原样保留（逐片导入）。
 */
export function alignRecordingPauses(pauses: ReadonlyArray<{ startUs: number; endUs: number }> | undefined, controls: ReadonlyArray<{ action: 'pause' | 'resume'; monoUs: number }>, screens: ReadonlyArray<{ monoUs: number }>): Array<{ startUs: number; endUs: number }> | undefined {
  if (!pauses?.length) return pauses ? [] : undefined
  const sorted = [...pauses].sort((a, b) => a.startUs - b.startUs)
  const marks = [...controls].sort((a, b) => a.monoUs - b.monoUs)
  // 暂停着按停止的那一次没有恢复：它不对齐，照原样留着。
  const pairs: Array<[number, number | undefined]> = []
  for (let index = 0; index < marks.length; index++) {
    if (marks[index].action !== 'pause') continue
    const next = marks.slice(index + 1).find(mark => mark.action === 'pause' || mark.action === 'resume')
    pairs.push([marks[index].monoUs, next?.action === 'resume' ? next.monoUs : undefined])
  }
  if (pairs.length !== sorted.length) return sorted
  const starts = screens.map(screen => screen.monoUs).sort((a, b) => a - b)
  let floor = 0
  return sorted.map((pause, index) => {
    const [pausedUs, resumedUs] = pairs[index]
    const picture = resumedUs === undefined ? undefined : starts.find(start => start > pausedUs && start <= resumedUs)
    const aligned = picture !== undefined && resumedUs !== undefined && resumedUs - picture <= PAUSE_ALIGNMENT_TOLERANCE_US ? { startUs: picture - (resumedUs - pausedUs), endUs: picture } : undefined
    const result = aligned && aligned.startUs >= floor ? aligned : pause
    floor = result.endUs
    return result
  })
}
