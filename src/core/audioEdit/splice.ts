import { z } from 'zod'
import type { AudioEditProjectDocument, AudioEditRange, AudioEditSourceMetadata } from './types'

export const audioEditSpliceSchema = z.object({
  projectId: z.string().regex(/^[\w-]+$/), sourcePath: z.string().min(1).max(4096),
  startFrame: z.number().int().nonnegative(), endFrame: z.number().int().nonnegative(),
  requestId: z.string().uuid(), resultId: z.string().uuid().optional(),
  matchRecordingLoudness: z.boolean().optional(),
}).strict().refine(value => value.endFrame >= value.startFrame, '覆盖终点不能早于起点')
export type AudioEditSpliceRequest = z.infer<typeof audioEditSpliceSchema>
export interface AudioEditSpliceResult { source: AudioEditSourceMetadata; insertedFrames: number; recordingGainDb?: number }

/** 半开区间：插入点左右分开保留，避免旧静音、删除和音量覆盖新录音。 */
export function spliceAudioRanges<T extends AudioEditRange & { id: string }>(ranges: readonly T[], start: number, end: number, inserted: number): T[] {
  const delta = inserted - (end - start)
  const ids = new Set(ranges.map(range => range.id))
  const splitId = (id: string): string => {
    let ordinal = 1
    let next = `${id.slice(0, 150)}-splice-${ordinal}`
    while (ids.has(next)) next = `${id.slice(0, 150)}-splice-${++ordinal}`
    ids.add(next)
    return next
  }
  return ranges.flatMap(range => {
    if (range.endFrame <= start) return [{ ...range }]
    if (range.startFrame >= end) return [{ ...range, startFrame: range.startFrame + delta, endFrame: range.endFrame + delta }]
    const parts: T[] = []
    if (range.startFrame < start) parts.push({ ...range, endFrame: start })
    if (range.endFrame > end) parts.push({ ...range, id: parts.length ? splitId(range.id) : range.id, startFrame: start + inserted, endFrame: range.endFrame + delta })
    return parts
  })
}

export function assertAudioEditSplicePosition(project: AudioEditProjectDocument, start: number, end: number): void {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > project.source.durationFrames) throw new Error('录音插入范围无效')
  if (project.transcript.some(block => block.locked && block.startFrame < (end === start ? start : end) && block.endFrame > start)) throw new Error('录音位置包含锁定的词块，请先解锁')
}

/** 素材帧相关真相集中迁移；字幕由词块派生，频谱笔画按矩形归一化，跨切点整条撤掉。 */
export function spliceAudioEditProject(project: AudioEditProjectDocument, source: AudioEditSourceMetadata, start: number, end: number, inserted: number): AudioEditProjectDocument {
  assertAudioEditSplicePosition(project, start, end)
  if (inserted <= 0) throw new Error('录音插入范围无效')
  if (project.source.durationFrames && (source.sampleRate !== project.source.sampleRate || source.channels !== project.source.channels)) throw new Error('拼接素材的采样格式不一致')
  if (source.durationFrames !== project.source.durationFrames - (end - start) + inserted) throw new Error('拼接素材长度不一致')
  const overlaps = (range: AudioEditRange): boolean => range.startFrame < end && range.endFrame > start || start === end && range.startFrame < start && range.endFrame > start
  if (project.transcript.some(block => block.locked && overlaps(block))) throw new Error('录音位置包含锁定的词块，请先解锁')
  const shiftIntact = <T extends AudioEditRange & { id: string }>(items: readonly T[]): T[] => spliceAudioRanges(items.filter(item => !overlaps(item)), start, end, inserted)
  const transcript = shiftIntact(project.transcript)
  // 不捏造识别词时间；占位词块使文字区和字幕区都能看见需要重新转写的区间。
  if (project.transcript.length) {
    let ordinal = 0
    let id = `recording-${project.revision}-${start}-${ordinal}`
    while (transcript.some(block => block.id === id)) id = `recording-${project.revision}-${start}-${++ordinal}`
    transcript.push({ id, text: '（需要重新转写）', startFrame: start, endFrame: start + inserted, included: true, locked: false, granularity: 'segment', confidence: 0 })
  }
  transcript.sort((a, b) => a.startFrame - b.startFrame)
  const suggestions = shiftIntact(project.suggestions).map(item => ({ ...item, blockIds: item.blockIds.filter(id => transcript.some(block => block.id === id)) }))
  return {
    ...project, source, transcript, suggestions,
    cuts: spliceAudioRanges([...(project.cuts ?? []), ...project.transcript.filter(block => !block.included && !block.locked && overlaps(block)).map(block => ({ id: `transcript-${block.id}`, startFrame: block.startFrame, endFrame: block.endFrame, enabled: true, reason: 'manual' as const, mode: 'delete' as const }))], start, end, inserted),
    gainRegions: spliceAudioRanges((project.gainRegions ?? []).map(region => ({ ...region, original: region })), start, end, inserted).map(({ original, ...region }) => {
      const delta = region.endFrame <= start ? 0 : inserted - (end - start)
      const from = region.startFrame - delta, to = region.endFrame - delta
      const fadeInFrames = Math.max(0, Math.min(to, original.startFrame + original.fadeInFrames) - from)
      const fadeOutFrames = Math.max(0, to - Math.max(from, original.endFrame - original.fadeOutFrames))
      return { ...region, fadeInFrames, fadeOutFrames }
    }),
    repairs: shiftIntact(project.repairs ?? []),
    ...(project.editBaseline ? { editBaseline: { ...project.editBaseline, transcript: shiftIntact(project.editBaseline.transcript), suggestions: shiftIntact(project.editBaseline.suggestions) } } : {}),
  }
}
