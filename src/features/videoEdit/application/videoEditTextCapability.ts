import { ApplicationPersistenceFailure } from '@/core/application-control/execution/persistence'
import { VIDEO_EDIT_TEXT_CAPABILITIES, detectVideoEditTextSilenceCapability } from '@/core/application-control/domains/videoEdit/videoEditTextCapabilities'
import { videoEditComposition } from '@/core/videoEdit/document'
import { resolveVideoEditTextRanges } from '@/core/videoEdit/textTranscript'
import { editVideoEditText, restoreVideoEditText } from './videoEditTextEditing'
import { splitVideoEditRef } from './videoEditReflection'
import { requireVideoEditInstance, saveVideoEdit, verifyVideoEditSaved } from './videoEditService'

export async function handleVideoEditTextCapability(id: string, raw: unknown, signal?: AbortSignal): Promise<Record<string, unknown> | undefined> {
  const definition = VIDEO_EDIT_TEXT_CAPABILITIES.find(value => value.id === id)
  if (!definition && id !== detectVideoEditTextSilenceCapability.id) return undefined
  const input = (definition ?? detectVideoEditTextSilenceCapability).inputSchema.parse(raw)
  const projectId = input.documentRef.id; const sequence = splitVideoEditRef(input.sequenceRef)
  if (sequence.projectId !== projectId || !sequence.childId) throw new Error('sequenceRef 必须属于 documentRef。')
  signal?.throwIfAborted()
  const owner = requireVideoEditInstance(projectId)
  let ranges; let resultSequenceId = sequence.childId; let changed = true
  if (definition) {
    const parsed = definition.inputSchema.parse(raw)
    const action = id === 'ripple_delete_video_edit_text' ? 'delete' : id === 'extract_video_edit_text' ? 'extract' : 'insert'
    const result = editVideoEditText(projectId, sequence.childId, parsed.selector, action, parsed.frame, parsed.name)
    ranges = result.ranges; resultSequenceId = result.sequenceId; changed = result.changed
  } else {
    const audioId = videoEditComposition(owner.document, sequence.childId).textTranscription?.audioDocumentId
    if (!audioId) throw new Error('请先转录当前序列。')
    await restoreVideoEditText(projectId, sequence.childId, audioId, true, signal)
    ranges = resolveVideoEditTextRanges(videoEditComposition(owner.document, sequence.childId), { kind: 'silence' })
  }
  const expected = owner.document
  try { await saveVideoEdit(projectId) } catch (error) { throw new ApplicationPersistenceFailure('文本剪辑已处理但保存未确认，请重试保存，不要重复剪辑。', { memoryState: 'modified', persistenceState: 'unconfirmed', stage: 'document', recovery: { capabilityId: 'save_video_edit', target: input.documentRef, replayMutation: false } }, error) }
  const verified = requireVideoEditInstance(projectId) === owner && owner.document === expected && await verifyVideoEditSaved(projectId, expected)
  return { documentRef: input.documentRef, resultRef: { kind: 'video_edit.sequence', id: `${projectId}:${resultSequenceId}` }, ranges, changed, verified, message: changed ? `已处理 ${ranges.length} 处文本范围，可一步撤销。` : '当前稿子没有符合条件的可编辑范围，未修改时间线。' }
}
