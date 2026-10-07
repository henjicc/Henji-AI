import type { z } from 'zod'
import { nestVideoEditClipsCapability } from '@/core/application-control/domains/videoEdit/videoEditNestCapability'
import type { CapabilityExecutionContext } from '@/features/application-control/capabilities/handlerTypes'
import { splitVideoEditRef } from './videoEditReflection'
import { requireVideoEditInstance, saveVideoEdit, verifyVideoEditSaved } from './videoEditService'
import { nestVideoEditSelection } from './videoEditNesting'

export async function nestVideoEditClipsFromCapability(raw: unknown, context: CapabilityExecutionContext): Promise<z.infer<typeof nestVideoEditClipsCapability.outputSchema>> {
  const input = nestVideoEditClipsCapability.inputSchema.parse(raw)
  const id = input.documentRef.id; const owner = requireVideoEditInstance(id)
  const ids = [...new Set(input.clipRefs.map(ref => {
    const value = splitVideoEditRef(ref)
    if (value.projectId !== id || !value.childId) throw new Error('clipRefs 必须属于目标剪辑，请使用目录中的完整引用。')
    return value.childId
  }))]
  const sequence = owner.document.sequences.find(sequence => sequence.clips.some(clip => clip.id === ids[0]))
  if (!sequence || ids.some(id => !sequence.clips.some(clip => clip.id === id))) throw new Error('clipRefs 必须属于同一序列。')
  context.signal?.throwIfAborted()
  const result = nestVideoEditSelection({ projectId: id, sequenceId: sequence.id, clipIds: ids }, input.name, input.linked !== false)
  const document = owner.document
  await saveVideoEdit(id)
  const verified = requireVideoEditInstance(id) === owner && await verifyVideoEditSaved(id, document)
  return { resultRef: input.documentRef, sequenceRef: { kind: 'video_edit.sequence', id: `${id}:${result.sequence.id}` }, parentSequenceRef: { kind: 'video_edit.sequence', id: `${id}:${sequence.id}` }, itemRef: { kind: 'video_edit.item', id: `${id}:${result.clip.itemId}` },
    clipRef: { kind: 'video_edit.clip', id: `${id}:${result.clip.id}` }, movedClipRefs: result.movedClipIds.map(clipId => ({ kind: 'video_edit.clip', id: `${id}:${clipId}` })), message: '片段已嵌套为序列，可一步撤销；新序列和替换片段均可读回编辑。',
    verification: { verified, target: input.documentRef, condition: '已从剪辑文件回读核对新序列、移动片段、素材引用与父序列替换片段。' },
  }
}
