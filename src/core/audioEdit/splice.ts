import { z } from 'zod'
import type { AudioEditProjectDocument, AudioEditRange, AudioEditSourceMetadata, AudioEditSuggestion, AudioEditTranscriptBlock } from './types'
import { createAudioEditBaseline } from './baseline'
import { buildAudioEditCaptionGroups } from './captions'
import { buildProjectAudioEditTimeline, editedDurationFrames, nextRetainedSourceFrame, outputFrameToSourceFrame, sourceFrameToOutputFrame } from './timeline'

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

/** 插入段的占位文字：转写里还没有识别的那一段，文字区看得见，字幕不出现它。 */
export const AUDIO_EDIT_UNTRANSCRIBED_TEXT = '（需要重新转写）'
const UNTRANSCRIBED_ID = /^recording-\d+-\d+-\d+$/

/**
 * 插入段的占位词块（spliceAudioEditProject 唯一生成）：整句粒度、编号形如 recording-修订号-起点-序号。
 * 补转写得到的词块编号带“:序号”，不会再被认成占位。
 */
export function isAudioEditUntranscribedBlock(block: Pick<AudioEditTranscriptBlock, 'id' | 'granularity'>): boolean {
  return block.granularity === 'segment' && UNTRANSCRIBED_ID.test(block.id)
}

/** 占位词块还显示着占位文字：用户手动填过字的占位当作已有文字，不再补识别、也照常进字幕。 */
export function isAudioEditPendingTranscriptionBlock(block: Pick<AudioEditTranscriptBlock, 'id' | 'granularity' | 'text'>): boolean {
  return isAudioEditUntranscribedBlock(block) && block.text === AUDIO_EDIT_UNTRANSCRIBED_TEXT
}

/** 还要补转写的插入段：保留着、仍是占位文字的占位词块（删掉的那段声音已经剪掉，不必再识别）。 */
export function audioEditUntranscribedBlocks(project: Pick<AudioEditProjectDocument, 'transcript'>): AudioEditTranscriptBlock[] {
  return project.transcript.filter((block) => (block.included || block.locked) && isAudioEditPendingTranscriptionBlock(block) && block.endFrame > block.startFrame)
}

/**
 * 补转写得到的词块换掉占位：原文基线里补上这些词（插入时基线里没有这段，恢复原文后不能丢），
 * 已整理过字幕分段的口播给新词块按停顿与长度断好句，不动其余已调好的分段。
 */
export function replaceAudioEditPlaceholders(project: AudioEditProjectDocument, replacedIds: ReadonlySet<string>, filled: readonly AudioEditTranscriptBlock[], suggestions: readonly AudioEditSuggestion[]): AudioEditProjectDocument {
  const formatted = project.transcript.some(block => block.captionBreakAfter !== undefined)
  const ends = formatted ? new Set(buildAudioEditCaptionGroups(filled, project.source.sampleRate).map(group => group.blocks.at(-1)!.id)) : null
  const blocks = ends ? filled.map(block => ({ ...block, captionBreakAfter: ends.has(block.id) })) : [...filled]
  const transcript = [...project.transcript.filter(item => !replacedIds.has(item.id)), ...blocks].sort((a, b) => a.startFrame - b.startFrame)
  const merged = [...project.suggestions.filter(item => !item.blockIds.some(id => replacedIds.has(id))), ...suggestions]
  if (!project.editBaseline) return { ...project, transcript, suggestions: merged }
  const added = createAudioEditBaseline({ ...project, transcript: [...filled], suggestions: [...suggestions] }, project.editBaseline.kind)
  return {
    ...project, transcript, suggestions: merged,
    editBaseline: {
      ...project.editBaseline,
      transcript: [...project.editBaseline.transcript.filter(item => !replacedIds.has(item.id)), ...added.transcript].sort((a, b) => a.startFrame - b.startFrame),
      suggestions: [...project.editBaseline.suggestions, ...added.suggestions],
    },
  }
}

/**
 * 插入或录音的位置。秒数（positionSeconds / replaceUntilSeconds）是剪后作品时间，与 audio_edit.caption 的 start_ms、
 * 剪后时长同一坐标；采样帧（positionSourceFrame / replaceUntilSourceFrame）是原素材时间，与 transcript_block 的 start_frame 同一坐标。
 * 同一端只能给一种。
 */
export interface AudioEditPlacementInput { positionSeconds?: number; replaceUntilSeconds?: number; positionSourceFrame?: number; replaceUntilSourceFrame?: number }

type TimelineProject = Pick<AudioEditProjectDocument, 'source' | 'transcript' | 'cuts'>

/**
 * 把位置换成原素材采样帧 [起点, 终点]。剪后时间落在剪切处时，起点取剪切之后那段保留声音的开头，
 * 终点取剪切之前那段的末尾（不把剪掉的声音算进覆盖范围的末端）。fallback 是省略起点时的原素材帧。
 * 参数错误抛出点名字段的 Error。
 */
export function audioEditPlacementFrames(project: TimelineProject, input: AudioEditPlacementInput, fallback: number): [number, number] {
  if (input.positionSeconds !== undefined && input.positionSourceFrame !== undefined) throw new Error('positionSeconds 与 positionSourceFrame 只能给一个：秒数按剪后作品时间，采样帧按原素材时间。')
  if (input.replaceUntilSeconds !== undefined && input.replaceUntilSourceFrame !== undefined) throw new Error('replaceUntilSeconds 与 replaceUntilSourceFrame 只能给一个。')
  const rate = project.source.sampleRate, total = project.source.durationFrames
  const spans = buildProjectAudioEditTimeline(project)
  const edited = editedDurationFrames(spans)
  const fromSeconds = (field: string, seconds: number, end: boolean): number => {
    const target = Math.round(seconds * rate)
    if (target > edited) throw new Error(`${field} 超出剪后作品长度（${(edited / rate).toFixed(2)} 秒）。`)
    if (!spans.length) return 0
    // 终点落在两段之间时归前一段：按“目标在 (开头, 末尾]”找段；起点按“[开头, 末尾)”找（outputFrameToSourceFrame）
    const span = end && target > 0 ? spans.find((item) => target > item.outputStartFrame && target <= item.outputEndFrame) : undefined
    return span ? span.sourceStartFrame + target - span.outputStartFrame : outputFrameToSourceFrame(target, spans) ?? 0
  }
  const fromFrame = (field: string, frame: number): number => {
    if (!Number.isSafeInteger(frame) || frame < 0 || frame > total) throw new Error(`${field} 要是 0 到 ${total}（原素材采样帧总数）之间的整数。`)
    return frame
  }
  const start = input.positionSourceFrame !== undefined ? fromFrame('positionSourceFrame', input.positionSourceFrame)
    : input.positionSeconds !== undefined ? fromSeconds('positionSeconds', input.positionSeconds, false) : fallback
  // 起点终点给同一个剪后时刻就是只插入不覆盖：落在剪切处时两端分属前后两段，不能按“终点早于起点”拒绝
  const sameMoment = input.positionSeconds !== undefined && input.replaceUntilSeconds !== undefined && Math.round(input.positionSeconds * rate) === Math.round(input.replaceUntilSeconds * rate)
  const end = input.replaceUntilSourceFrame !== undefined ? fromFrame('replaceUntilSourceFrame', input.replaceUntilSourceFrame)
    : input.replaceUntilSeconds !== undefined && !sameMoment ? fromSeconds('replaceUntilSeconds', input.replaceUntilSeconds, true) : start
  if (end < start) throw new Error('覆盖终点（replaceUntilSeconds / replaceUntilSourceFrame）不能早于插入位置。')
  return [start, end]
}

/** 原素材帧在剪后作品里的秒数（读回用，与 positionSeconds 同一坐标）；落在剪掉的声音里时取其后第一段保留声音的位置。 */
export function audioEditOutputSeconds(project: TimelineProject, sourceFrame: number): number {
  const spans = buildProjectAudioEditTimeline(project)
  const retained = nextRetainedSourceFrame(sourceFrame, spans)
  const output = (retained === null ? null : sourceFrameToOutputFrame(retained, spans)) ?? editedDurationFrames(spans)
  return output / project.source.sampleRate
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
  const placeholderId = (at: number): string => {
    let ordinal = 0
    while (transcript.some(block => block.id === `recording-${project.revision}-${at}-${ordinal}`)) ordinal++
    return `recording-${project.revision}-${at}-${ordinal}`
  }
  // 插在一段还没逐词转写的插入段中间：那段声音左右两半都还在，各留一个词块。左半沿用原文字（手填的字留着），
  // 右半没法确定对应哪些字，标回占位，之后照样能补识别
  for (const block of project.transcript.filter(item => item.included && isAudioEditUntranscribedBlock(item) && overlaps(item))) {
    if (block.startFrame < start) transcript.push({ ...block, endFrame: start })
    if (block.endFrame > end) transcript.push({ ...block, id: placeholderId(start + inserted), text: AUDIO_EDIT_UNTRANSCRIBED_TEXT, startFrame: start + inserted, endFrame: block.endFrame + inserted - (end - start) })
  }
  // 不捏造识别词时间；占位词块使文字区和字幕区都能看见需要重新转写的区间。
  if (project.transcript.length) transcript.push({ id: placeholderId(start), text: AUDIO_EDIT_UNTRANSCRIBED_TEXT, startFrame: start, endFrame: start + inserted, included: true, locked: false, granularity: 'segment', confidence: 0 })
  transcript.sort((a, b) => a.startFrame - b.startFrame)
  const suggestions = shiftIntact(project.suggestions).map(item => ({ ...item, blockIds: item.blockIds.filter(id => transcript.some(block => block.id === id)) }))
  // 交接材料跟着线索走：跨过插入位置的线索已经丢掉，条目一并丢；留下的各种做法与线索同样平移，跨过插入位置的那种做法不再提供
  const kept = new Set(suggestions.map(item => item.id))
  const present = new Set(transcript.map(block => block.id))
  const suggestionHandoff = project.suggestionHandoff && Object.fromEntries(Object.entries(project.suggestionHandoff).filter(([id]) => kept.has(id)).map(([id, handoff]) => [id, {
    ...handoff, ...(handoff.options ? { options: shiftIntact(handoff.options).map(option => ({ ...option, blockIds: option.blockIds.filter(blockId => present.has(blockId)) })) } : {}),
  }]))
  return {
    ...project, source, transcript, suggestions, ...(suggestionHandoff ? { suggestionHandoff } : {}),
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
