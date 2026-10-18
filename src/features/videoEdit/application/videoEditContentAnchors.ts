import { videoEditContentAnchorInputSchema, videoEditContentAnchorAtRanges, type VideoEditContentAnchor } from '@/core/videoEdit/contentAnchors'
import { videoEditClipSourceRange } from '@/core/videoEdit/clipSpeed'
import { videoEditComposition } from '@/core/videoEdit/document'
import { editVideoProject, requireVideoEditInstance } from './videoEditService'
import { resolveVideoEditTranscriptAnchorMatch } from './videoEditTranscriptQuery'
import { videoEditTranscriptWords } from '@/core/videoEdit/textTranscript'
import { createLogger } from '@/core/logging'

const logger = createLogger('features.videoEdit.contentAnchor')

/** The generic content_anchor property resolves a query candidate through the formal source projection. */
export function resolveVideoEditContentAnchor(projectId: string, sequenceId: string, clipId: string, raw: unknown): VideoEditContentAnchor | undefined {
  const input = videoEditContentAnchorInputSchema.parse(raw)
  if (!input) return undefined
  const composition = videoEditComposition(requireVideoEditInstance(projectId).document, sequenceId)
  let result: VideoEditContentAnchor
  if ('matchId' in input) {
    const match = resolveVideoEditTranscriptAnchorMatch(projectId, sequenceId, input.matchId)
    const target = composition.clips.find(clip => clip.id === match.clipId)
    if (!target) throw new Error('关联来源不属于此序列。')
    result = videoEditContentAnchorAtRanges(composition, [{ clipId: target.id, from: match.from, to: match.to }], input)
  } else result = input
  for (const range of result.ranges) {
    const target = composition.clips.find(clip => clip.id === range.clipId)
    if (!target || target.itemId !== range.itemId || target.id === clipId) throw new Error('内容关联须引用同序列的其他现有片段及其来源素材。')
    const visible = videoEditClipSourceRange(target, composition.fps)
    if (range.fromUs < Math.round(visible.from * 1e6) || range.toUs > Math.round(visible.to * 1e6)) throw new Error('关联范围超出来源片段的保留内容，请重新查询。')
  }
  return result
}

export function setVideoEditClipContentAnchors(projectId: string, sequenceId: string, clipIds: readonly string[], raw: unknown, baseline?: object): void {
  const owner = requireVideoEditInstance(projectId)
  const sequence = owner.document.sequences.find(sequence => sequence.id === sequenceId)
  if (!sequence || baseline && baseline !== sequence) throw new Error('时间线已有修改，请重新选择文字和画面。')
  if (!clipIds.length || clipIds.some(id => !sequence.clips.some(clip => clip.id === id && clip.kind !== 'audio'))) throw new Error('请在时间线上选择要关联的画面片段。')
  logger.info('关联画面内容开始', { event: 'video_edit.content_anchor.start', context: { projectId, sequenceId, count: clipIds.length } })
  try {
    const values = new Map(clipIds.map(id => [id, resolveVideoEditContentAnchor(projectId, sequenceId, id, raw)]))
    editVideoProject(projectId, document => ({ ...document, sequences: document.sequences.map(value => value.id === sequenceId ? { ...value, clips: value.clips.map(clip => values.has(clip.id) ? { ...clip, contentAnchor: values.get(clip.id) } : clip) } : value) }))
    logger.info('关联画面内容完成', { event: 'video_edit.content_anchor.completed', context: { projectId, sequenceId, count: clipIds.length } })
  } catch (error) { logger.error('关联画面内容失败', { event: 'video_edit.content_anchor.failed', context: { projectId, sequenceId }, error }); throw error }
}

export function bindVideoEditClipsToWords(projectId: string, sequenceId: string, clipIds: readonly string[], ranges: readonly { start: number; end: number }[], baseline: object): void {
  const owner = requireVideoEditInstance(projectId); const sequence = owner.document.sequences.find(sequence => sequence.id === sequenceId)
  if (!sequence || sequence !== baseline) throw new Error('时间线已有修改，请重新选择文字和画面。')
  const words = videoEditTranscriptWords(videoEditComposition(owner.document, sequenceId))
  const selected = ranges.flatMap(range => words.slice(range.start, range.end + 1))
  if (!selected.length || selected.some(word => word.granularity !== 'word') || ranges.some(range => range.start < 0 || range.end >= words.length)) throw new Error('请选择已有词级时间的口述内容。')
  const targetRanges: { clipId: string; from: number; to: number }[] = []
  let previousIndex: number | undefined
  for (const word of selected) {
    const previous = targetRanges.at(-1)
    if (previous?.clipId === word.clipId && word.index === (previousIndex ?? -2) + 1) previous.to = Math.max(previous.to, word.to)
    else targetRanges.push({ clipId: word.clipId, from: word.from, to: word.to })
    previousIndex = word.index
  }
  setVideoEditClipContentAnchors(projectId, sequenceId, clipIds, videoEditContentAnchorAtRanges(sequence, targetRanges), baseline)
}
