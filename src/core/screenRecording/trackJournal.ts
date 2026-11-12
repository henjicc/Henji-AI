import { z } from 'zod'
import { clockAnchorSchema, safeClockSchema } from '../captureLog/clock'
import { createRecordingTracks, recordingTrackGapSchema, recordingTrackKindSchema, recordingTrackSegmentSchema, recordingTrackWarningSchema, type RecordingTrackGap, type RecordingTrackKind, type RecordingTrackSegment, type RecordingTracks, type RecordingTrackWarning } from './tracks'

/** 分段一开始就登记位置和时钟：写它的界面进程中途退出时，主进程凭这条记录和已写进文件的采样补出这一段。 */
export const recordingTrackOpenSegmentSchema = recordingTrackSegmentSchema.pick({ id: true, file: true, sampleRate: true, channels: true, width: true, height: true, latencyCompensationUs: true, sourceClockOffsetUs: true })
  .extend({ monoStartUs: safeClockSchema, anchor: clockAnchorSchema }).strict()
export type RecordingTrackOpenSegment = z.infer<typeof recordingTrackOpenSegmentSchema>
export const recordingTrackRecordSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('open'), kind: recordingTrackKindSchema, segment: recordingTrackOpenSegmentSchema }).strict(),
  z.object({ type: z.literal('seal'), kind: recordingTrackKindSchema, segment: recordingTrackSegmentSchema }).strict(),
  z.object({ type: z.literal('gap'), kind: recordingTrackKindSchema, gap: recordingTrackGapSchema }).strict(),
  z.object({ type: z.literal('warning'), kind: recordingTrackKindSchema, warning: recordingTrackWarningSchema }).strict(),
  /** 写轨道的界面进程断开；之后的分段由重新接上的界面写，两者之间没有数据。 */
  z.object({ type: z.literal('detach'), atUs: safeClockSchema }).strict(),
])
export type RecordingTrackRecord = z.infer<typeof recordingTrackRecordSchema>
export const RECORDING_TRACK_JOURNAL_VERSION = 1
/** tracks.journal 的一行。只追加不改写，录制多久每次写入都一样小；崩溃留下的半行在读取时丢弃。 */
export const recordingTrackJournalLineSchema = z.object({ version: z.literal(RECORDING_TRACK_JOURNAL_VERSION), sessionId: z.string().uuid(), record: recordingTrackRecordSchema }).strict()
export type RecordingTrackJournalLine = z.infer<typeof recordingTrackJournalLineSchema>
export const RECORDING_TRACK_JOURNAL_FILE = 'tracks.journal'

export function recordingTrackJournalLine(sessionId: string, record: RecordingTrackRecord): string {
  return `${JSON.stringify(recordingTrackJournalLineSchema.parse({ version: RECORDING_TRACK_JOURNAL_VERSION, sessionId, record }))}\n`
}

interface TrackData { segments: Array<{ segment: RecordingTrackSegment; generation: number }>; gaps: RecordingTrackGap[]; warnings: RecordingTrackWarning[] }
/**
 * 界面断开前后的两段之间要真有一段没覆盖的时间才算缺数据。主进程录的系统声跨断开照样首尾相接，
 * 两段只差设备时钟漂移的几十微秒；界面写的轨道跨断开至少空出重载的那一两秒。与拼接时“同一路连续声音”的容差一致。
 */
const DETACH_GAP_MIN_US = 20_000

/**
 * 轨道记录的唯一归并规则：录制中界面进程按它维护本地状态，主进程按它维护权威状态，崩溃后重放 tracks.journal 也按它。
 * 记录按发生顺序到达；分段的先后与相邻关系只在读出时按真实时钟整理。
 */
export class RecordingTrackState {
  private readonly data = new Map<RecordingTrackKind, TrackData>()
  private readonly opened = new Map<string, { kind: RecordingTrackKind; segment: RecordingTrackOpenSegment; generation: number }>()
  private generation = 0
  constructor(kinds: readonly RecordingTrackKind[]) { for (const kind of kinds) this.data.set(kind, { segments: [], gaps: [], warnings: [] }) }
  apply(record: RecordingTrackRecord): void {
    if (record.type === 'detach') { this.generation++; return }
    const track = this.data.get(record.kind)
    if (!track) throw new Error('录制轨道不属于此会话')
    if (record.type === 'open') this.opened.set(record.segment.id, { kind: record.kind, segment: record.segment, generation: this.generation })
    else if (record.type === 'seal') {
      const open = this.opened.get(record.segment.id)
      this.opened.delete(record.segment.id)
      track.segments.push({ segment: record.segment, generation: open?.generation ?? this.generation })
    } else if (record.type === 'gap') track.gaps.push(record.gap)
    else if (!track.warnings.includes(record.warning)) track.warnings.push(record.warning)
  }
  /** 开了头却没封口的分段；放弃一段用 discard。 */
  unsealed(): Array<{ kind: RecordingTrackKind; segment: RecordingTrackOpenSegment }> { return [...this.opened.values()].map(({ kind, segment }) => ({ kind, segment })) }
  discard(id: string): void { this.opened.delete(id) }
  counts(): Record<string, { segments: number; gaps: number }> {
    return Object.fromEntries([...this.data].map(([kind, track]) => [kind, { segments: track.segments.length, gaps: track.gaps.length }]))
  }
  tracks(sessionId: string, originUs: number): RecordingTracks {
    return createRecordingTracks(sessionId, originUs, [...this.data].map(([kind, track]) => {
      const ordered = [...track.segments].sort((a, b) => a.segment.monoSpanUs[0] - b.segment.monoSpanUs[0]).map(item => ({ generation: item.generation, segment: structuredClone(item.segment) }))
      const gaps = structuredClone(track.gaps)
      for (let index = 1; index < ordered.length; index++) {
        const previous = ordered[index - 1].segment, next = ordered[index].segment
        // 设备时钟漂移可能让下一段早开始一个量子：以下一段的真实起点为界，不补静音。
        if (previous.monoSpanUs[1] > next.monoSpanUs[0]) {
          previous.monoSpanUs[1] = Math.max(previous.monoSpanUs[0], next.monoSpanUs[0])
          previous.anchors = previous.anchors.filter(anchor => anchor.monoUs <= previous.monoSpanUs[1])
        }
        // 界面进程重新接上之前的这段时间没有采到数据，它不是静音。
        const [from, to] = [previous.monoSpanUs[1], next.monoSpanUs[0]]
        if (ordered[index].generation > ordered[index - 1].generation && to - from > DETACH_GAP_MIN_US && !gaps.some(gap => gap.monoSpanUs[0] <= from && gap.monoSpanUs[1] >= to)) gaps.push({ monoSpanUs: [from, to], reason: 'missing-data' })
      }
      gaps.sort((a, b) => a.monoSpanUs[0] - b.monoSpanUs[0])
      return { kind, segments: ordered.map(item => item.segment), gaps, warnings: [...track.warnings] }
    }))
  }
}
