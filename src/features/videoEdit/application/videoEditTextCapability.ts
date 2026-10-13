import { isVideoEditContentCurrent, verifyVideoEditContentSaved } from './videoEditDocumentAlgorithm'
import { ApplicationPersistenceFailure } from '@/core/application-control/execution/persistence'
import { ApplicationPreflightFailure } from '@/core/application-control/execution/transactionFailure'
import { VIDEO_EDIT_TEXT_CAPABILITIES, detectVideoEditTextSilenceCapability, getVideoEditClipPausesCapability } from '@/core/application-control/domains/videoEdit/videoEditTextCapabilities'
import { videoEditClipFrameBoundaryAtSource } from '@/core/videoEdit/clipSpeed'
import { getVideoEditClipPauseMap, readClipEnergyPauses } from './videoEditPauseMap'
import { videoEditComposition } from '@/core/videoEdit/document'
import { resolveVideoEditTextRanges } from '@/core/videoEdit/textTranscript'
import { editVideoEditText, restoreVideoEditText } from './videoEditTextEditing'
import { splitVideoEditRef } from './videoEditReflection'
import { openVideoEditDocument, requireVideoEditInstance, saveVideoEdit } from './videoEditService'

export async function handleVideoEditTextCapability(id: string, raw: unknown, signal?: AbortSignal): Promise<Record<string, unknown> | undefined> {
  if (id === getVideoEditClipPausesCapability.id) {
    const input = getVideoEditClipPausesCapability.inputSchema.parse(raw)
    const { projectId, childId } = splitVideoEditRef(input.clipRef)
    await openVideoEditDocument({ id: projectId }, { focus: false })
    const sequence = requireVideoEditInstance(projectId).document.sequences.find(value => value.clips.some(clip => clip.id === childId))
    if (!sequence) throw new ApplicationPreflightFailure('clipRef 不属于当前剪辑。')
    return { clipRef: input.clipRef, ...await getVideoEditClipPauseMap(projectId, sequence.id, childId, signal), message: '已读取片段停顿与词边界。' }
  }
  const definition = VIDEO_EDIT_TEXT_CAPABILITIES.find(value => value.id === id)
  if (!definition && id !== detectVideoEditTextSilenceCapability.id) return undefined
  const input = (definition ?? detectVideoEditTextSilenceCapability).inputSchema.parse(raw)
  const projectId = input.documentRef.id; const sequence = splitVideoEditRef(input.sequenceRef)
  if (sequence.projectId !== projectId || !sequence.childId) throw new ApplicationPreflightFailure('sequenceRef 必须属于 documentRef。')
  signal?.throwIfAborted()
  const owner = requireVideoEditInstance(projectId)
  if (!owner.document.sequences.some(value => value.id === sequence.childId)) throw new ApplicationPreflightFailure('目标序列不存在，请重新读取剪辑序列。')
  let ranges; let resultSequenceId = sequence.childId; let changed = true
  if (definition) {
    const parsed = definition.inputSchema.parse(raw)
    const action = id === 'ripple_delete_video_edit_text' ? 'delete' : id === 'extract_video_edit_text' ? 'extract' : 'insert'
    const result = editVideoEditText(projectId, sequence.childId, parsed.selector, action, parsed.frame, parsed.name)
    ranges = result.ranges; resultSequenceId = result.sequenceId; changed = result.changed
  } else {
    const parsed = detectVideoEditTextSilenceCapability.inputSchema.parse(raw)
    if (parsed.clipRef) {
      const contentVersion = owner.contentVersion
      const ref = splitVideoEditRef(parsed.clipRef)
      const composition = videoEditComposition(owner.document, sequence.childId)
      const clip = composition.clips.find(value => value.id === ref.childId)
      if (ref.projectId !== projectId || !clip) throw new ApplicationPreflightFailure('clipRef 必须属于目标序列。')
      const ranges = (await readClipEnergyPauses(projectId, sequence.childId, clip.id, signal)).map(pause => {
        const a = videoEditClipFrameBoundaryAtSource(clip, pause.startMs / 1000, composition.fps); const b = videoEditClipFrameBoundaryAtSource(clip, pause.endMs / 1000, composition.fps)
        return { from: Math.max(clip.start, Math.floor(Math.min(a, b))), to: Math.min(clip.start + clip.duration, Math.ceil(Math.max(a, b))) }
      }).filter(range => range.to > range.from)
      if (!isVideoEditContentCurrent(owner, contentVersion)) throw new ApplicationPreflightFailure('检测期间片段已改变，请重新检测静音。')
      return { documentRef: input.documentRef, resultRef: input.sequenceRef, ranges, changed: false, verified: true, message: `已免费检测 ${ranges.length} 处片段静音，未修改剪辑。` }
    }
    const audioId = videoEditComposition(owner.document, sequence.childId).textTranscription?.audioDocumentId
    if (!audioId) throw new ApplicationPreflightFailure('请先转录当前序列。')
    await restoreVideoEditText(projectId, sequence.childId, audioId, true, signal)
    ranges = resolveVideoEditTextRanges(videoEditComposition(owner.document, sequence.childId), { kind: 'silence' })
  }
  const expected = owner.document; const contentVersion = owner.contentVersion
  try { await saveVideoEdit(projectId) } catch (error) { throw new ApplicationPersistenceFailure('文本剪辑已处理但保存未确认，请重试保存，不要重复剪辑。', { memoryState: 'modified', persistenceState: 'unconfirmed', stage: 'document', recovery: { capabilityId: 'save_video_edit', target: input.documentRef, replayMutation: false } }, error) }
  const verified = await verifyVideoEditContentSaved(owner, expected, contentVersion)
  return { documentRef: input.documentRef, resultRef: { kind: 'video_edit.sequence', id: `${projectId}:${resultSequenceId}` }, ranges, changed, verified, message: changed ? `已处理 ${ranges.length} 处文本范围，可一步撤销。` : '当前稿子没有符合条件的可编辑范围，未修改时间线。' }
}
